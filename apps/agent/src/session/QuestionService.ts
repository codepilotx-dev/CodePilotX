import { Effect } from "effect"
import { AgentError } from "../domain"
import type { PendingApproval, PlanCheckpoint } from "../orchestration/AgentRuntimeTypes"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import type { EventHub } from "../storage/events/EventHub"
import type { InteractionOperationInput } from "../storage/repositories/interaction-repository"
import {
  interactionQuestions,
  requestUserInputSchema,
  type InteractionQuestion,
} from "./QuestionInput"

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

type StoredAnswer = {
  resolution: "user" | "auto"
  answers: Array<{ questionId: string; choiceIds: string[]; text?: string }>
}

const storedQuestions = (payload: Record<string, unknown>): InteractionQuestion[] => {
  if (!Array.isArray(payload.questions)) return []
  return payload.questions.flatMap((value) => {
    const question = record(value)
    if (
      typeof question.id !== "string"
      || typeof question.header !== "string"
      || typeof question.prompt !== "string"
      || !Array.isArray(question.choices)
    ) return []
    const choices = question.choices.flatMap((item) => {
      const choice = record(item)
      return typeof choice.id === "string"
        && typeof choice.label === "string"
        && typeof choice.description === "string"
        ? [{
            id: choice.id,
            label: choice.label,
            description: choice.description,
            recommended: choice.recommended === true,
          }]
        : []
    })
    if (choices.length < 2 || choices.length > 3) return []
    return [{
      id: question.id,
      header: question.header,
      prompt: question.prompt,
      choices,
      allowFreeform: true as const,
      required: true as const,
      minAnswers: typeof question.minAnswers === "number" ? question.minAnswers : 1,
      maxAnswers: typeof question.maxAnswers === "number" ? question.maxAnswers : 1,
    }]
  })
}

const normalizeRichAnswer = (
  questions: readonly InteractionQuestion[],
  answer: unknown,
  resolution: "user" | "auto",
): StoredAnswer => {
  const candidate = Array.isArray(answer)
    ? answer
    : Array.isArray(record(answer).answers)
      ? record(answer).answers as unknown[]
      : []
  const byQuestion = new Map<string, { questionId: string; choiceIds: string[]; text?: string }>()
  for (const value of candidate) {
    const item = record(value)
    if (typeof item.questionId !== "string" || !Array.isArray(item.choiceIds)) {
      throw new AgentError("INVALID_QUESTION_ANSWER", "问题答案格式无效", 400)
    }
    const question = questions.find(({ id }) => id === item.questionId)
    if (!question || byQuestion.has(question.id)) {
      throw new AgentError("INVALID_QUESTION_ANSWER", "问题答案包含未知或重复的问题", 400)
    }
    const choiceIds = item.choiceIds.filter((choice): choice is string => typeof choice === "string")
    if (choiceIds.length !== item.choiceIds.length || choiceIds.some((choice) => !question.choices.some(({ id }) => id === choice))) {
      throw new AgentError("INVALID_QUESTION_ANSWER", "问题答案包含未知选项", 400)
    }
    const text = typeof item.text === "string" && item.text.trim() ? item.text.trim().slice(0, 4_000) : undefined
    const answerCount = choiceIds.length + (text ? 1 : 0)
    if (answerCount < question.minAnswers || answerCount > question.maxAnswers) {
      throw new AgentError("INVALID_QUESTION_ANSWER", "问题答案数量不符合要求", 400)
    }
    byQuestion.set(question.id, { questionId: question.id, choiceIds, ...(text ? { text } : {}) })
  }
  if (questions.some((question) => question.required && !byQuestion.has(question.id))) {
    throw new AgentError("INVALID_QUESTION_ANSWER", "必答问题尚未回答", 400)
  }
  return { resolution, answers: questions.flatMap((question) => byQuestion.get(question.id) ?? []) }
}

const autoAnswer = (questions: readonly InteractionQuestion[]): StoredAnswer => ({
  resolution: "auto",
  answers: questions.map((question) => ({
    questionId: question.id,
    choiceIds: question.choices[0] ? [question.choices[0].id] : [],
  })),
})

/**
 * Question rows are the durable checkpoint between an Agents SDK approval
 * interruption and its resumed RunState. No in-memory promise owns a reply.
 */
export class QuestionService {
  private resumeHandler: ResumeHandler | undefined
  private readonly autoResolutionTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly db: AgentDatabase, private readonly hub: EventHub) {
    this.restoreAutoResolutions()
  }

  setResumeHandler(handler: ResumeHandler) {
    this.resumeHandler = handler
  }

  async checkpoint(threadID: string, turnID: string, agentID: string, approval: PendingApproval) {
    const legacyOptions = approval.options?.length
      ? approval.options.slice(0, 3)
      : ["继续", "停止"]
    if (legacyOptions.length === 1) legacyOptions.push("其他")
    const questions = approval.questions?.length
      ? interactionQuestions(approval.questions)
      : interactionQuestions([{
          id: toolCallID(approval.checkpoint.interruption),
          header: "确认",
          question: approval.question ?? "需要你的确认",
          options: legacyOptions
            .map((label, index) => ({ label, description: index === 0 ? "继续当前流程" : "选择此项并反馈给 Agent" })),
        }])
    const first = questions[0]!
    const payload = {
      // Keep the first-question fields until the v4 interaction projection has
      // switched to the canonical questions array.
      question: first.prompt,
      options: first.choices.map(({ label }) => label),
      questions,
      answerFormat: approval.questions?.length ? "structured" : "legacy",
      ...(approval.autoResolutionMs ? { autoResolutionMs: approval.autoResolutionMs } : {}),
      checkpoint: approval.checkpoint,
      kind: approval.kind,
    }
    const { question: created, events } = this.db.createResumableQuestion({
      threadID,
      turnID,
      agentID,
      toolCallID: toolCallID(approval.checkpoint.interruption),
      payload,
      payloadVersion: 2,
      checkpoint: {
        payload: { state: approval.checkpoint.state, interruption: approval.checkpoint.interruption },
        version: 1,
      },
    })
    for (const event of events) await Effect.runPromise(this.hub.publish(event))
    this.scheduleAutoResolution(created.id, created.createdAt, approval.autoResolutionMs, questions)
    return created.id
  }

  async ask(threadID: string, turnID: string, payload: Record<string, unknown>, _signal: AbortSignal) {
    const agent = this.db.agentForTurn(turnID)
    if (!agent) throw new AgentError("AGENT_NOT_FOUND", "Turn 没有根 Agent", 409)
    if (agent.subagentRunID) throw new AgentError("TOOL_NOT_ALLOWED_FOR_PROFILE", "子 Agent 不能直接向用户提问", 403)
    const parsed = requestUserInputSchema.safeParse(payload)
    if (!parsed.success) throw new AgentError("INVALID_TOOL_INPUT", parsed.error.message, 400)
    return this.checkpoint(threadID, turnID, agent.id, {
      kind: "clarification",
      questions: parsed.data.questions,
      ...(parsed.data.autoResolutionMs ? { autoResolutionMs: parsed.data.autoResolutionMs } : {}),
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

  async reply(
    id: string,
    answer: unknown,
    ignored = false,
    resolution: "user" | "auto" = "user",
    resume = true,
    operation?: InteractionOperationInput,
  ) {
    const stored = this.db.sqlite.query("SELECT payload FROM question_requests WHERE id = ? AND status = 'pending'").get(id) as { payload: string } | null
    if (!stored) throw new AgentError("QUESTION_NOT_FOUND", "问题不存在或已经回答", 409)
    const payload = parse(stored.payload)
    const questions = storedQuestions(payload)
    const normalizedAnswer = ignored || questions.length === 0 || payload.answerFormat !== "structured"
      ? answer
      : normalizeRichAnswer(questions, answer, resolution)
    const row = this.db.resolveResumableQuestion(id, normalizedAnswer, ignored, operation)
    if (!row) throw new AgentError("QUESTION_NOT_FOUND", "问题不存在或已经回答", 409)
    this.clearAutoResolution(id)
    for (const event of row.events) await Effect.runPromise(this.hub.publish(event))
    if (resume) this.resumeHandler?.(row.threadID, row.turnID)
    return row
  }

  cancelTurn(turnID: string) {
    const rows = this.db.sqlite.query("SELECT id FROM question_requests WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')").all(turnID) as Array<{ id: string }>
    this.db.run("UPDATE question_requests SET status = 'cancelled', answer = '__stopped__', resolved_at = ? WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')", Date.now(), turnID)
    for (const { id } of rows) this.clearAutoResolution(id)
  }

  dispose() {
    for (const timer of this.autoResolutionTimers.values()) clearTimeout(timer)
    this.autoResolutionTimers.clear()
  }

  private restoreAutoResolutions() {
    const rows = this.db.sqlite.query("SELECT id, payload, created_at FROM question_requests WHERE status = 'pending'").all() as Array<{ id: string; payload: string; created_at: number }>
    for (const row of rows) {
      const payload = parse(row.payload)
      const timeout = typeof payload.autoResolutionMs === "number" ? payload.autoResolutionMs : undefined
      this.scheduleAutoResolution(row.id, row.created_at, timeout, storedQuestions(payload))
    }
  }

  private scheduleAutoResolution(
    id: string,
    createdAt: number,
    timeout: number | undefined,
    questions: readonly InteractionQuestion[],
  ) {
    if (timeout === undefined || timeout < 60_000 || timeout > 240_000 || questions.length === 0) return
    this.clearAutoResolution(id)
    const timer = setTimeout(() => {
      this.autoResolutionTimers.delete(id)
      void this.reply(id, autoAnswer(questions), false, "auto").catch(() => undefined)
    }, Math.max(0, createdAt + timeout - Date.now()))
    timer.unref?.()
    this.autoResolutionTimers.set(id, timer)
  }

  private clearAutoResolution(id: string) {
    const timer = this.autoResolutionTimers.get(id)
    if (timer) clearTimeout(timer)
    this.autoResolutionTimers.delete(id)
  }
}
