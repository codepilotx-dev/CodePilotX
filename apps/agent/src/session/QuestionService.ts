import { Effect } from "effect"
import { AgentError } from "../domain"
import type { PendingApproval, PlanCheckpoint } from "../orchestration/AgentOrchestrator"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"

type ResumeHandler = (sessionID: string, runID: string) => void

export interface ResolvedCheckpoint {
  id: string
  approval: PlanCheckpoint
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {}
const parse = (value: string) => {
  try { return record(JSON.parse(value)) } catch { return {} }
}
const toolCallID = (value: unknown) => {
  const item = record(value)
  const rawItem = record(item.rawItem)
  const direct = [item.callId, item.toolCallId, rawItem.callId, rawItem.id]
  return direct.find((candidate): candidate is string => typeof candidate === "string") ?? crypto.randomUUID()
}

/**
 * Question rows are the durable checkpoint between an Agents SDK approval
 * interruption and its resumed RunState. No in-memory promise owns a reply.
 */
export class QuestionService {
  private resumeHandler: ResumeHandler | undefined

  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub) {
    // AgentDatabase marks active runs interrupted on process start. Re-open only
    // checkpoint-backed questions that were not explicitly stopped by the user.
    this.db.transaction(() => {
      this.db.run("UPDATE questions SET status = 'pending', resolved_at = NULL WHERE status = 'cancelled' AND answer IS NULL AND json_extract(payload, '$.checkpoint.state') IS NOT NULL")
      this.db.run("UPDATE runs SET status = 'waiting_question', finished_at = NULL WHERE status = 'interrupted' AND id IN (SELECT run_id FROM questions WHERE status = 'pending' AND json_extract(payload, '$.checkpoint.state') IS NOT NULL)")
      this.db.run("UPDATE parts SET status = 'pending', updated_at = ? WHERE type = 'question' AND id IN (SELECT id FROM questions WHERE status = 'pending' AND json_extract(payload, '$.checkpoint.state') IS NOT NULL)", Date.now())
    })
  }

  setResumeHandler(handler: ResumeHandler) {
    this.resumeHandler = handler
  }

  private async emit(sessionID: string, type: string, payload: unknown) {
    const event = this.db.insertEvent(sessionID, type, payload)
    await Effect.runPromise(this.hub.publish(event))
  }

  async checkpoint(sessionID: string, runID: string, approval: PendingApproval) {
    const payload = {
      question: approval.question,
      options: approval.options,
      checkpoint: approval.checkpoint,
      kind: approval.kind,
    }
    const created = this.db.createResumableQuestion({
      sessionID,
      runID,
      toolCallID: toolCallID(approval.checkpoint.interruption),
      payload,
      payloadVersion: 1,
      checkpoint: {
        stage: "planner",
        payload: { state: approval.checkpoint.state, interruption: approval.checkpoint.interruption },
        version: 1,
      },
    })
    await this.emit(sessionID, "question.requested", { id: created.id, runID, ...payload, createdAt: created.createdAt })
    return created.id
  }

  /** Legacy entrypoint retained for existing callers; it persists and returns immediately. */
  async ask(sessionID: string, runID: string, payload: Record<string, unknown>, _signal: AbortSignal) {
    return this.checkpoint(sessionID, runID, {
      kind: "clarification",
      question: typeof payload.question === "string" ? payload.question : "需要你的确认",
      options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === "string") : ["继续", "停止"],
      checkpoint: { state: "", interruption: null },
    })
  }

  claimResolvedCheckpoint(runID: string): ResolvedCheckpoint | null {
    const row = this.db.sqlite.query("SELECT id, payload, answer FROM questions WHERE run_id = ? AND status = 'resolved' ORDER BY resolved_at LIMIT 1").get(runID) as { id: string; payload: string; answer: string | null } | null
    if (!row) return null
    const payload = parse(row.payload)
    const checkpoint = record(payload.checkpoint)
    const state = typeof checkpoint.state === "string" ? checkpoint.state : typeof checkpoint.payload === "object" && checkpoint.payload ? (checkpoint.payload as Record<string, unknown>).state : undefined
    const interruption = checkpoint.interruption ?? (typeof checkpoint.payload === "object" && checkpoint.payload ? (checkpoint.payload as Record<string, unknown>).interruption : undefined)
    if (typeof state !== "string" || interruption === undefined) return null
    this.db.run("UPDATE questions SET status = 'resuming' WHERE id = ? AND status = 'resolved'", row.id)
    const storedAnswer = row.answer ? parse(row.answer) : {}
    const answer = Object.prototype.hasOwnProperty.call(storedAnswer, "value") ? storedAnswer.value : row.answer === "null" ? null : row.answer
    return { id: row.id, approval: { state, interruption, answer: typeof answer === "string" ? answer : answer == null ? null : JSON.stringify(answer) } }
  }

  async reply(id: string, answer: unknown, ignored = false) {
    const row = this.db.resolveResumableQuestion(id, answer, ignored)
    if (!row) throw new AgentError("QUESTION_NOT_FOUND", "问题不存在或已经回答", 409)
    await this.emit(row.sessionID, "question.resolved", { id, runID: row.runID, answer, ignored })
    this.resumeHandler?.(row.sessionID, row.runID)
  }

  cancelRun(runID: string) {
    this.db.run("UPDATE questions SET status = 'cancelled', answer = '__stopped__', resolved_at = ? WHERE run_id = ? AND status IN ('pending', 'resolved', 'resuming')", Date.now(), runID)
  }
}
