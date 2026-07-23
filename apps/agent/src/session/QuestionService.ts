import { Effect } from "effect"
import { AgentError } from "../domain"
import type { PendingApproval, PlanCheckpoint } from "../orchestration/AgentRuntimeTypes"
import type { AgentDatabase } from "../storage/Database"
import type { EventHub } from "../storage/EventHub"

type ResumeHandler = (threadID: string, turnID: string) => void

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

  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub) {}

  setResumeHandler(handler: ResumeHandler) {
    this.resumeHandler = handler
  }

  async checkpoint(threadID: string, turnID: string, agentID: string, approval: PendingApproval) {
    const payload = {
      question: approval.question,
      options: approval.options,
      checkpoint: approval.checkpoint,
      kind: approval.kind,
    }
    const { question: created, events } = this.db.createResumableQuestion({
      threadID,
      turnID,
      agentID,
      toolCallID: toolCallID(approval.checkpoint.interruption),
      payload,
      payloadVersion: 1,
      checkpoint: {
        payload: { state: approval.checkpoint.state, interruption: approval.checkpoint.interruption },
        version: 1,
      },
    })
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
    return created.id
  }

  async ask(threadID: string, turnID: string, payload: Record<string, unknown>, _signal: AbortSignal) {
    const agent = this.db.agentForTurn(turnID)
    if (!agent) throw new AgentError("AGENT_NOT_FOUND", "Turn 没有根 Agent", 409)
    return this.checkpoint(threadID, turnID, agent.id, {
      kind: "clarification",
      question: typeof payload.question === "string" ? payload.question : "需要你的确认",
      options: Array.isArray(payload.options) ? payload.options.filter((item): item is string => typeof item === "string") : ["继续", "停止"],
      checkpoint: { state: "", interruption: null },
    })
  }

  claimResolvedCheckpoint(turnID: string): ResolvedCheckpoint | null {
    const row = this.db.sqlite.query("SELECT id, payload, answer FROM question_requests WHERE turn_id = ? AND status = 'resolved' ORDER BY resolved_at LIMIT 1").get(turnID) as { id: string; payload: string; answer: string | null } | null
    if (!row) return null
    const payload = parse(row.payload)
    const checkpoint = record(payload.checkpoint)
    const state = typeof checkpoint.state === "string" ? checkpoint.state : typeof checkpoint.payload === "object" && checkpoint.payload ? (checkpoint.payload as Record<string, unknown>).state : undefined
    const interruption = checkpoint.interruption ?? (typeof checkpoint.payload === "object" && checkpoint.payload ? (checkpoint.payload as Record<string, unknown>).interruption : undefined)
    if (typeof state !== "string" || interruption === undefined) return null
    this.db.run("UPDATE question_requests SET status = 'resuming' WHERE id = ? AND status = 'resolved'", row.id)
    const storedAnswer = row.answer ? parse(row.answer) : {}
    const answer = Object.prototype.hasOwnProperty.call(storedAnswer, "value") ? storedAnswer.value : row.answer === "null" ? null : row.answer
    return { id: row.id, approval: { state, interruption, answer: typeof answer === "string" ? answer : answer == null ? null : JSON.stringify(answer), checkpointID: row.id } }
  }

  async reply(id: string, answer: unknown, ignored = false) {
    const row = this.db.resolveResumableQuestion(id, answer, ignored)
    if (!row) throw new AgentError("QUESTION_NOT_FOUND", "问题不存在或已经回答", 409)
    for (const event of row.events) await Effect.runPromise(this.hub.publish(event))
    this.resumeHandler?.(row.threadID, row.turnID)
  }

  cancelTurn(turnID: string) {
    this.db.run("UPDATE question_requests SET status = 'cancelled', answer = '__stopped__', resolved_at = ? WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')", Date.now(), turnID)
  }
}
