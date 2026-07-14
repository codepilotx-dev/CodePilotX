import { Agent, RunState, run, setTracingDisabled, tool } from "@openai/agents"
import type { Session } from "@openai/agents"
import type { LanguageModel } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import type { EventEnvelope, Item, ModelRef, TaskMode } from "../domain"
import { asAgentModel } from "../llm/AgentModelBridge"
import type { ProposalDraft, WorkspaceService } from "../workspace/WorkspaceService"
import { stagesForTask, type AgentRole } from "./stages"

export type { AgentRole } from "./stages"

export interface PlanCheckpoint {
  state: string
  interruption: unknown
  answer: string | null
}

export interface PendingApproval {
  checkpoint: Omit<PlanCheckpoint, "answer">
  kind: "clarification" | "plan_confirmation"
  question: string
  options: string[]
}

export interface OrchestrationPersistence {
  upsertItem(threadID: string, item: Item): void
  getItem(itemID: string): Item | null
  insertEvent(threadId: string | null, turnId: string | null, method: string, params: unknown): EventEnvelope
  upsertTurnStage?(stage: {
    turnID: string
    role: Exclude<AgentRole, "assistant">
    attempt: number
    status: "pending" | "running" | "waiting_question" | "completed" | "failed" | "interrupted"
    model: ModelRef
    startedAt: number | null
    finishedAt: number | null
    error: string | null
  }): void
  setTurnWorkflowState?(turnID: string, input: { status: "running" | "waiting_question"; currentStage: Exclude<AgentRole, "assistant"> | null; canContinueFromPlan: boolean }): void
}

export interface OrchestrationPublisher {
  publish(event: EventEnvelope): Effect.Effect<unknown>
}

export interface OrchestrationRequest {
  threadID: string
  turnID: string
  content: string
  taskMode: TaskMode
  fallbackModel: ModelRef
  signal: AbortSignal
  workspace: WorkspaceService
  resume?: PlanCheckpoint
  continueFromPlan?: boolean
  plan?: string
  resolveModel(role: AgentRole, fallback: ModelRef): Promise<{ ref: ModelRef; model: LanguageModel }>
  saveProposal(draft: ProposalDraft, role: AgentRole): Promise<unknown>
  pause(approval: PendingApproval): Promise<void>
}

export interface AgentOrchestratorOptions {
  db: OrchestrationPersistence
  hub: OrchestrationPublisher
  sessionFor?: (threadID: string, role: AgentRole) => Session
}

type StageResult = { status: "completed"; output: string } | { status: "paused"; output: string }
type ActivityCommand = {
  command: string
  output: string
  status?: "success" | "running" | "error" | "interrupted"
  truncated?: boolean
}

const stageTitle: Record<AgentRole, string> = {
  assistant: "对话",
  planner: "规划",
  developer: "拟议修改",
  reviewer: "审查",
}

const stageInstructions: Record<AgentRole, string> = {
  assistant: "你是项目助手。自然、简洁地回答用户；不要把闲聊或简单问候误写成实施计划。",
  planner: [
    "你是项目规划 Agent。先使用只读工具核实工作区，再形成实施计划。",
    "不能写文件、不能执行命令，也不能虚构未读过的代码。",
    "仅当缺少会改变实现方向的关键信息时调用 request_user_input；不要为普通推断提问。",
    "在调研完成后，必须调用 finalize_plan，传入完整 Markdown 计划；这会交由用户确认。",
  ].join("\n"),
  developer: [
    "你是只读开发 Agent。先检查相关文件，绝不能写文件或执行命令。",
    "建议改动时必须调用 propose_patch 保存精确 before/after；建议验证时必须调用 propose_command。",
  ].join("\n"),
  reviewer: "你是代码审查 Agent。检查计划和提议的风险、遗漏及验证建议；只能读取项目。",
}

const now = () => Date.now()
const ACTIVITY_OUTPUT_CHAR_CAP = 1_048_576
const cleanText = (value: string) => value.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim()
const capActivityOutput = (value: string) => {
  if (value.length <= ACTIVITY_OUTPUT_CHAR_CAP) return { output: value, truncated: false }
  return {
    output: `${value.slice(0, ACTIVITY_OUTPUT_CHAR_CAP)}\n... 输出已截断，超过 ${ACTIVITY_OUTPUT_CHAR_CAP} 字符`,
    truncated: true,
  }
}
const formatToolOutput = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2)
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {}
const parseArguments = (value: unknown) => {
  if (typeof value !== "string") return record(value)
  try { return record(JSON.parse(value)) } catch { return {} }
}

/** Fixed orchestration with durable human checkpoints; no free-form handoffs. */
export class AgentOrchestrator {
  constructor(private readonly options: AgentOrchestratorOptions) {
    setTracingDisabled(true)
  }

  private async publish(threadID: string, turnID: string, method: string, params: unknown) {
    const event = this.options.db.insertEvent(threadID, turnID, method, params)
    await Effect.runPromise(this.options.hub.publish(event))
  }

  private async saveItem(threadID: string, item: Item) {
    this.options.db.upsertItem(threadID, item)
    const method = item.status === "pending" || item.status === "running" ? "item/started" : "item/completed"
    await this.publish(threadID, item.turnID, method, { item: this.options.db.getItem(item.id) ?? item })
  }

  private async recordReadActivity(request: OrchestrationRequest, role: AgentRole, title: string, detail: string, command?: ActivityCommand, onRecorded?: () => void) {
    const createdAt = now()
    const item: Item = {
      id: crypto.randomUUID(), turnID: request.turnID, type: "activity", status: "completed",
      data: { role, activity: "notice", title, detail, ...(command ? { commands: [command] } : {}) }, createdAt, updatedAt: createdAt,
    }
    await this.saveItem(request.threadID, item)
    onRecorded?.()
  }

  private async recordReadResult(request: OrchestrationRequest, role: AgentRole, title: string, detail: string, command: string, output: unknown, onRecorded?: () => void) {
    const capped = capActivityOutput(formatToolOutput(output))
    await this.recordReadActivity(request, role, title, detail, { command, output: capped.output, status: "success", ...(capped.truncated ? { truncated: true } : {}) }, onRecorded)
  }

  private async recordReadError(request: OrchestrationRequest, role: AgentRole, title: string, detail: string, command: string, cause: unknown, onRecorded?: () => void) {
    const output = cause instanceof Error ? cause.message : String(cause)
    await this.recordReadActivity(request, role, title, detail, { command, output, status: "error" }, onRecorded)
  }

  private toolsFor(role: AgentRole, request: OrchestrationRequest, onPlanFinalized?: (plan: string) => void, onReadActivityRecorded?: () => void) {
    if (role === "assistant") return []
    const readTools = [
      tool({ name: "workspace_list", description: "列出工作区目录内容。路径相对于项目根目录。", parameters: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
        const command = `workspace_list ${path}`
        try {
          const result = await request.workspace.list(path)
          await this.recordReadResult(request, role, "列出目录", path, command, result, onReadActivityRecorded)
          return result
        } catch (cause) {
          await this.recordReadError(request, role, "列出目录", path, command, cause, onReadActivityRecorded)
          throw cause
        }
      } }),
      tool({ name: "workspace_read", description: "以 UTF-8 读取工作区文本文件。路径相对于项目根目录。", parameters: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
        const command = `workspace_read ${path}`
        try {
          const result = await request.workspace.read(path)
          await this.recordReadResult(request, role, "读取文件", path, command, result, onReadActivityRecorded)
          return result
        } catch (cause) {
          await this.recordReadError(request, role, "读取文件", path, command, cause, onReadActivityRecorded)
          throw cause
        }
      } }),
      tool({ name: "workspace_search", description: "按文件名和 UTF-8 文本搜索工作区。", parameters: z.object({ path: z.string().min(1), query: z.string().min(1) }), execute: async ({ path, query }) => {
        const detail = `${path}: ${query}`
        const command = `workspace_search ${path} ${query}`
        try {
          const result = await request.workspace.search(path, query, request.signal)
          await this.recordReadResult(request, role, "搜索工作区", detail, command, result, onReadActivityRecorded)
          return result
        } catch (cause) {
          await this.recordReadError(request, role, "搜索工作区", detail, command, cause, onReadActivityRecorded)
          throw cause
        }
      } }),
    ]
    if (role === "planner") return [...readTools,
      tool({
        name: "request_user_input", description: "仅在缺少关键实现决策时向用户提问。", needsApproval: true,
        parameters: z.object({ question: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(3) }),
        execute: ({ question, options }) => ({ question, options, answer: request.resume?.answer ?? "" }),
      }),
      tool({
        name: "finalize_plan", description: "提交完整计划以请求用户确认。仅在调研和计划完成后调用一次。",
        parameters: z.object({ plan: z.string().min(1) }), execute: ({ plan }) => {
          const normalized = cleanText(plan)
          onPlanFinalized?.(normalized)
          return normalized
        },
      }),
    ]
    if (role !== "developer") return readTools
    return [...readTools,
      tool({ name: "propose_patch", description: "保存不执行的精确文本替换提议。", parameters: z.object({ path: z.string().min(1), before: z.string(), after: z.string() }), execute: async ({ path, before, after }) => {
        const draft = await request.workspace.proposePatch(path, before, after)
        await request.saveProposal(draft, role)
        await this.publish(request.threadID, request.turnID, "proposal/created", { turnId: request.turnID, role, proposal: draft })
        return { recorded: true, type: "patch", path: draft.payload.path, diff: draft.payload.diff }
      } }),
      tool({ name: "propose_command", description: "保存不执行的验证或后续操作命令提议。", parameters: z.object({ command: z.string().min(1), cwd: z.string().min(1).optional(), description: z.string().min(1) }), execute: async ({ command, cwd, description }) => {
        const draft = await request.workspace.proposeCommand(command, cwd, description)
        await request.saveProposal(draft, role)
        await this.publish(request.threadID, request.turnID, "proposal/created", { turnId: request.turnID, role, proposal: draft })
        return { recorded: true, type: "command", command: draft.payload.command }
      } }),
    ]
  }

  private approval(streamed: { interruptions?: readonly unknown[]; state: unknown }, request: OrchestrationRequest): PendingApproval | null {
    const interruption = streamed.interruptions?.[0]
    if (!interruption) return null
    const item = interruption as { name?: unknown; arguments?: unknown }
    const name = typeof item.name === "string" ? item.name : ""
    const args = parseArguments(item.arguments)
    const checkpoint = { state: JSON.stringify(streamed.state), interruption }
    if (name === "request_user_input") {
      const question = typeof args.question === "string" ? args.question : "需要你的确认"
      const options = Array.isArray(args.options) ? args.options.filter((item): item is string => typeof item === "string") : []
      return { checkpoint, kind: "clarification", question, options: options.length >= 2 ? options : ["继续按当前假设", "补充更多信息"] }
    }
    if (name === "finalize_plan") {
      const plan = typeof args.plan === "string" ? cleanText(args.plan) : ""
      return { checkpoint, kind: "plan_confirmation", question: plan || "计划已经完成，是否确认并进入拟议修改与审查？", options: ["确认计划并继续", "返回继续完善计划"] }
    }
    return null
  }

  private async runStage(role: AgentRole, request: OrchestrationRequest, context: string): Promise<StageResult> {
    const { ref, model } = await request.resolveModel(role, request.fallbackModel)
    const startedAt = now()
    const itemType: Item["type"] = role === "planner" ? "activity" : "text"
    let textItemID = crypto.randomUUID()
    let segmentStartedAt = startedAt
    let segmentText = ""
    let segmentSaved = false
    let rawOutput = ""
    let finalizedPlan = ""
    const segmentData = (text: string, error?: string) => itemType === "activity"
      ? { role, activity: "notice", title: stageTitle[role], detail: text || "正在分析…", ...(error ? { error } : {}) }
      : { role, title: stageTitle[role], text, ...(error ? { error } : {}) }
    const saveTextSegment = async (status: Item["status"], fallback = "正在分析…", error?: string) => {
      const text = cleanText(segmentText) || fallback
      if (!segmentSaved && !text) return
      segmentSaved = true
      await this.saveItem(request.threadID, {
        id: textItemID,
        turnID: request.turnID,
        type: itemType,
        status,
        data: segmentData(text, error),
        createdAt: segmentStartedAt,
        updatedAt: now(),
      })
    }
    const startNextTextSegment = () => {
      textItemID = crypto.randomUUID()
      segmentStartedAt = now()
      segmentText = ""
      segmentSaved = false
    }
    if (role !== "assistant") {
      this.options.db.setTurnWorkflowState?.(request.turnID, { status: "running", currentStage: role, canContinueFromPlan: false })
      this.options.db.upsertTurnStage?.({ turnID: request.turnID, role, attempt: 1, status: "running", model: ref, startedAt, finishedAt: null, error: null })
    }
    await this.publish(request.threadID, request.turnID, "workflow/stageStarted", { turnId: request.turnID, role, title: stageTitle[role], model: ref, startedAt })
    await saveTextSegment("running")
    const agent = new Agent({
      name: `${stageTitle[role]} Agent`, instructions: stageInstructions[role], model: asAgentModel(model), tools: this.toolsFor(role, request, (plan) => { finalizedPlan = plan }, startNextTextSegment),
      ...(role === "planner" ? { toolUseBehavior: { stopAtToolNames: ["finalize_plan"] } } : {}),
    })
    try {
      const checkpoint = request.resume
      const resume = checkpoint && role === "planner"
        ? await RunState.fromString(agent, checkpoint.state).then((state) => {
            const interruption = state.getInterruptions()[0]
            if (!interruption) throw new Error("规划 checkpoint 中没有待恢复的问题")
            state.approve(interruption)
            return state
          })
        : context
      const session = this.options.sessionFor?.(request.threadID, role)
      const streamed = session
        ? await run(agent, resume, { stream: true, signal: request.signal, maxTurns: 12, session })
        : await run(agent, resume, { stream: true, signal: request.signal, maxTurns: 12 })
      for await (const delta of streamed.toTextStream() as AsyncIterable<string>) {
        rawOutput += delta
        segmentText += delta
        await saveTextSegment("running")
      }
      await streamed.completed
      if (request.signal.aborted || streamed.cancelled) {
        if (role !== "assistant") this.options.db.upsertTurnStage?.({ turnID: request.turnID, role, attempt: 1, status: "interrupted", model: ref, startedAt, finishedAt: now(), error: null })
        await saveTextSegment("interrupted", cleanText(rawOutput))
        return { status: "completed", output: cleanText(rawOutput) }
      }
      const pause = role === "planner" ? this.approval(streamed, request) : null
      if (pause) {
        await request.pause(pause)
        if (role !== "assistant") this.options.db.upsertTurnStage?.({ turnID: request.turnID, role, attempt: 1, status: pause.kind === "clarification" ? "waiting_question" : "running", model: ref, startedAt, finishedAt: null, error: null })
        await saveTextSegment("pending", cleanText(rawOutput))
        await this.publish(request.threadID, request.turnID, "workflow/stagePaused", { turnId: request.turnID, role, kind: pause.kind })
        return { status: "paused", output: cleanText(rawOutput) }
      }
      const finalOutput = cleanText(finalizedPlan || (typeof streamed.finalOutput === "string" ? streamed.finalOutput : rawOutput))
      if (role === "planner") {
        await saveTextSegment("completed", "已完成工作区分析")
        const planTimestamp = now()
        await this.saveItem(request.threadID, { id: crypto.randomUUID(), turnID: request.turnID, type: "plan", status: "completed", data: { role, title: "实施计划", markdown: finalOutput, version: 1, state: "awaiting-confirmation" }, createdAt: planTimestamp, updatedAt: planTimestamp })
      } else {
        await saveTextSegment("completed", finalOutput)
      }
      await this.publish(request.threadID, request.turnID, "workflow/stageCompleted", { turnId: request.turnID, role, title: stageTitle[role], model: ref, completedAt: now() })
      if (role !== "assistant") this.options.db.upsertTurnStage?.({ turnID: request.turnID, role, attempt: 1, status: "completed", model: ref, startedAt, finishedAt: now(), error: null })
      return { status: "completed", output: finalOutput }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      if (role !== "assistant") this.options.db.upsertTurnStage?.({ turnID: request.turnID, role, attempt: 1, status: request.signal.aborted ? "interrupted" : "failed", model: ref, startedAt, finishedAt: now(), error })
      await saveTextSegment(request.signal.aborted ? "interrupted" : "error", cleanText(rawOutput), error)
      throw cause
    }
  }

  async run(request: OrchestrationRequest) {
    if (request.continueFromPlan) {
      const plan = request.plan ?? ""
      const developer = await this.runStage("developer", request, `用户任务：\n${request.content}\n\n已确认的计划：\n${plan}`)
      if (developer.status === "paused" || request.signal.aborted) return { status: developer.status, plan, development: developer.output }
      const reviewer = await this.runStage("reviewer", request, `用户任务：\n${request.content}\n\n已确认的计划：\n${plan}\n\n开发提议：\n${developer.output}`)
      return { status: reviewer.status, plan, development: developer.output, review: reviewer.output }
    }
    const first = stagesForTask(request.taskMode, request.content)[0] ?? "assistant"
    if (first === "assistant") {
      const result = await this.runStage("assistant", request, request.content)
      return { status: result.status, text: result.output }
    }
    const planner = await this.runStage("planner", request, `用户任务：\n${request.content}`)
    if (planner.status === "paused" || request.signal.aborted) return { status: planner.status, plan: planner.output }
    return { status: "plan-ready" as const, plan: planner.output }
  }
}
