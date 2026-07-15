import { Agent, RunState, run, setTracingDisabled, tool } from "@openai/agents"
import type { AgentInputItem, Session } from "@openai/agents"
import type { LanguageModel } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import type { EventEnvelope, Item, ModelRef, PermissionConfig, TaskMode } from "../domain"
import type { SubagentProfile, SubagentResult } from "@codepilotx/shared/thread"
import { asAgentModel } from "../llm/AgentModelBridge"
import type { ApplyPatchResult, WorkspaceService } from "../workspace/WorkspaceService"
import type { ToolExecutor } from "../tool/ToolExecutor"
import type { ProcessResult } from "../sandbox/SandboxRuntimeAdapter"

export interface PlanCheckpoint {
  state: string
  interruption: unknown
  answer: string | null
}

export class SafeBoundaryInterrupt extends Error {
  constructor() { super("SUBAGENT_STEERING_BOUNDARY") }
}

export interface PendingApproval {
  checkpoint: Omit<PlanCheckpoint, "answer">
  kind: "clarification" | "subagents"
  question?: string
  options?: string[]
  runIDs?: string[]
  waitMode?: "all" | "any"
}

export interface DelegationController {
  spawn(input: { agents: Array<{ name?: string; profile: "default" | "explorer" | "worker"; task: string; workspaceMode?: "shared" | "worktree"; model?: ModelRef }> }): Promise<unknown>
  wait(input: { runIDs: string[]; mode: "all" | "any" }): Promise<unknown>
  isWaitSatisfied(input: { runIDs: string[]; mode: "all" | "any" }): Promise<boolean>
  send(input: { taskID: string; message: string }): Promise<unknown>
  stop(input: { taskID: string }): Promise<unknown>
}

export interface OrchestrationPersistence {
  upsertItem(threadID: string, item: Item): void
  getItem(itemID: string): Item | null
  insertEvent(threadId: string | null, turnId: string | null, method: string, params: unknown): EventEnvelope
}

export interface OrchestrationPublisher {
  publish(event: EventEnvelope): Effect.Effect<unknown>
}

export interface OrchestrationRequest {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  profile?: SubagentProfile
  depth?: number
  delegation?: DelegationController
  content: string
  taskMode: TaskMode
  fallbackModel: ModelRef
  permissionConfig: PermissionConfig
  signal: AbortSignal
  workspace: WorkspaceService
  resume?: PlanCheckpoint
  continueFromPlan?: boolean
  plan?: string
  defaultModeRequestUserInput?: boolean
  resolveModel(fallback: ModelRef): Promise<{ ref: ModelRef; model: LanguageModel }>
  pause(approval: PendingApproval): Promise<void>
  checkSafeBoundary?: () => Promise<boolean>
  attachments?: Array<{ kind: "text"; name: string; text: string } | { kind: "image"; name: string; mediaType: string; base64: string }>
}

export interface AgentOrchestratorOptions {
  db: OrchestrationPersistence
  hub: OrchestrationPublisher
  toolExecutor: ToolExecutor
  sessionFor?: (sessionID: string) => Session
}

type RunResult =
  | { status: "completed"; output: string; result?: SubagentResult }
  | { status: "paused"; output: string }
  | { status: "plan-ready"; output: string; plan: string }

type ActivityCommand = {
  command: string
  output: string
  status?: "success" | "running" | "error" | "interrupted"
  truncated?: boolean
}

const MAIN_INSTRUCTIONS = [
  "你是 CodePilotX 的主 Agent，负责从调查到实现和验证的完整任务。",
  "先读取和搜索实际工作区，再做判断；不要虚构没有检查过的代码。",
  "普通模式可使用 apply_patch 直接修改工作区，并只运行与改动相关的检查。检查失败时读取错误并继续修复。",
  "需要执行 PowerShell 时使用 shell，声明额外路径、网络域名和理由；命令会经过统一权限边界。",
].join("\n")

const PLAN_INSTRUCTIONS = [
  "当前处于 Plan 模式。只能调查、提问和形成计划，禁止修改文件或执行 Shell。",
  "完成调查后必须调用 finalize_plan，传入完整 Markdown 计划。",
].join("\n")

const QUESTION_ENABLED_INSTRUCTIONS = "只有缺少会改变实现方向的关键信息时才调用 request_user_input。"
const QUESTION_DISABLED_INSTRUCTIONS = "普通模式下 request_user_input 不可用。优先调查并采用合理假设继续执行；确实无法继续时，只能发送简短的普通文本问题，不要把多选问题伪装成普通回复。"

const PROFILE_INSTRUCTIONS: Record<Exclude<SubagentProfile, "main">, string> = {
  default: "你是主 Agent 派生的通用子 Agent。独立完成委派任务，不得再创建子 Agent；最后给出结构化、可核验的结果。",
  explorer: "你是只读 Explorer。只搜索、读取和分析，不得修改文件或执行有副作用的命令；最后给出结构化发现与引用。",
  worker: "你是 Worker。完成委派的代码修改与必要验证，不得再创建子 Agent；最后给出变更、验证和风险的结构化结果。",
}

const subagentResultSchema = z.object({
  outcome: z.enum(["succeeded", "partial", "blocked"]),
  summary: z.string(),
  findings: z.array(z.object({ title: z.string(), detail: z.string(), severity: z.enum(["info", "warning", "error"]) })),
  changedFiles: z.array(z.object({ path: z.string(), summary: z.string() })),
  validation: z.array(z.object({ command: z.string(), status: z.enum(["passed", "failed", "skipped"]), output: z.string().optional() })),
  risks: z.array(z.string()),
  references: z.array(z.object({ kind: z.enum(["file", "url", "thread", "subagent"]), value: z.string(), label: z.string().optional() })),
})

const now = () => Date.now()
const ACTIVITY_OUTPUT_CHAR_CAP = 1_048_576
const cleanText = (value: string) => value.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim()
const capActivityOutput = (value: string) => value.length <= ACTIVITY_OUTPUT_CHAR_CAP
  ? { output: value, truncated: false }
  : { output: `${value.slice(0, ACTIVITY_OUTPUT_CHAR_CAP)}\n... 输出已截断，超过 ${ACTIVITY_OUTPUT_CHAR_CAP} 字符`, truncated: true }
const formatToolOutput = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value, null, 2)
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {}
const parseArguments = (value: unknown) => {
  if (typeof value !== "string") return record(value)
  try { return record(JSON.parse(value)) } catch { return {} }
}

export function isMainAgentRequestUserInputEnabled(request: Pick<OrchestrationRequest, "taskMode" | "continueFromPlan" | "defaultModeRequestUserInput">) {
  const planning = request.taskMode === "plan" && !request.continueFromPlan
  return planning || request.defaultModeRequestUserInput === true
}

/** A single durable root agent owns investigation, implementation and verification. */
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

  private async executeTool<T>(request: OrchestrationRequest, name: string, input: Record<string, unknown>) {
    const result = await this.options.toolExecutor.execute<T>(name, input, {
      threadID: request.threadID,
      turnID: request.turnID,
      agentID: request.agentID,
      taskMode: request.continueFromPlan ? "chat" : request.taskMode,
      signal: request.signal,
      workspace: request.workspace,
      permissionConfig: request.permissionConfig,
      model: request.fallbackModel,
      taskSummary: request.content,
    })
    return result
  }

  private async interruptAtSafeBoundary(request: OrchestrationRequest) {
    if (await request.checkSafeBoundary?.()) throw new SafeBoundaryInterrupt()
  }

  private async recordActivity(request: OrchestrationRequest, title: string, detail: string, command?: ActivityCommand, onRecorded?: () => void) {
    const createdAt = now()
    await this.saveItem(request.threadID, {
      id: crypto.randomUUID(),
      turnID: request.turnID,
      agentID: request.agentID,
      type: "activity",
      status: command?.status === "error" ? "error" : "completed",
      data: { activity: "notice", title, detail, ...(command ? { commands: [command] } : {}) },
      createdAt,
      updatedAt: createdAt,
    })
    onRecorded?.()
  }

  private async recordResult(request: OrchestrationRequest, title: string, detail: string, command: string, output: unknown, onRecorded?: () => void) {
    const capped = capActivityOutput(formatToolOutput(output))
    await this.recordActivity(request, title, detail, { command, output: capped.output, status: "success", ...(capped.truncated ? { truncated: true } : {}) }, onRecorded)
  }

  private async recordError(request: OrchestrationRequest, title: string, detail: string, command: string, cause: unknown, onRecorded?: () => void) {
    await this.recordActivity(request, title, detail, { command, output: cause instanceof Error ? cause.message : String(cause), status: "error" }, onRecorded)
  }

  private delegationTools(request: OrchestrationRequest) {
    if (!request.delegation || (request.depth ?? 0) !== 0) return []
    const controller = request.delegation
    const modelSchema = z.object({ providerID: z.string().min(1), id: z.string().min(1), variant: z.string().optional() })
    return [
      tool({
        name: "spawn_agents",
        description: "按需创建一个或多个独立子 Agent。Plan 未确认时只能创建 explorer。",
        parameters: z.object({ agents: z.array(z.object({ name: z.string().min(1).max(32).optional(), profile: z.enum(["default", "explorer", "worker"]), task: z.string().min(1), workspaceMode: z.enum(["shared", "worktree"]).optional(), model: modelSchema.optional() })).min(1).max(4) }),
        execute: async (input) => {
          if (request.taskMode === "plan" && !request.continueFromPlan && input.agents.some((agent) => agent.profile !== "explorer")) {
            throw new Error("Plan 确认前只能创建 Explorer")
          }
          return controller.spawn({
            agents: input.agents.map((agent) => ({
              profile: agent.profile,
              task: agent.task,
              ...(agent.name === undefined ? {} : { name: agent.name }),
              ...(agent.workspaceMode === undefined ? {} : { workspaceMode: agent.workspaceMode }),
              ...(agent.model === undefined ? {} : { model: agent.model as ModelRef }),
            })),
          })
        },
      }),
      tool({
        name: "wait_agents",
        description: "等待指定子 Agent 全部或任意一个进入终态，并读取结构化结果。",
        parameters: z.object({ runIDs: z.array(z.string().min(1)).min(1).max(6), mode: z.enum(["all", "any"]).default("all") }),
        needsApproval: async (_context, input) => !(await controller.isWaitSatisfied(input)),
        execute: (input) => controller.wait(input),
      }),
      tool({
        name: "send_agent",
        description: "向已有子 Agent 发送补充要求；运行中会在安全边界引导，已完成则创建后续 run。",
        parameters: z.object({ taskID: z.string().min(1), message: z.string().min(1) }),
        execute: (input) => controller.send(input),
      }),
      tool({
        name: "stop_agent",
        description: "停止指定子 Agent 的当前 run。",
        parameters: z.object({ taskID: z.string().min(1) }),
        execute: (input) => controller.stop(input),
      }),
    ]
  }

  private toolsFor(request: OrchestrationRequest, onPlanFinalized: (plan: string) => void, onReadActivityRecorded: () => void) {
    const profile = request.profile ?? "main"
    const mainQuestionEnabled = isMainAgentRequestUserInputEnabled(request)
    const readTools = [
      tool({ name: "workspace_list", description: "列出工作区目录内容。路径相对于项目根目录。", parameters: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
        const command = `workspace_list ${path}`
        let result: unknown
        try {
          result = await this.executeTool(request, "workspace.list", { path })
          await this.recordResult(request, "列出目录", path, command, result, onReadActivityRecorded)
        } catch (cause) {
          await this.recordError(request, "列出目录", path, command, cause, onReadActivityRecorded)
          throw cause
        }
        await this.interruptAtSafeBoundary(request)
        return result
      } }),
      tool({ name: "workspace_read", description: "以 UTF-8 读取工作区文本文件。", parameters: z.object({ path: z.string().min(1) }), execute: async ({ path }) => {
        const command = `workspace_read ${path}`
        let result: unknown
        try {
          result = await this.executeTool(request, "workspace.read", { path })
          await this.recordResult(request, "读取文件", path, command, result, onReadActivityRecorded)
        } catch (cause) {
          await this.recordError(request, "读取文件", path, command, cause, onReadActivityRecorded)
          throw cause
        }
        await this.interruptAtSafeBoundary(request)
        return result
      } }),
      tool({ name: "workspace_search", description: "按文件名和 UTF-8 文本搜索工作区。", parameters: z.object({ path: z.string().min(1), query: z.string().min(1) }), execute: async ({ path, query }) => {
        const detail = `${path}: ${query}`
        const command = `workspace_search ${path} ${query}`
        let result: unknown
        try {
          result = await this.executeTool(request, "workspace.search", { path, query })
          await this.recordResult(request, "搜索工作区", detail, command, result, onReadActivityRecorded)
        } catch (cause) {
          await this.recordError(request, "搜索工作区", detail, command, cause, onReadActivityRecorded)
          throw cause
        }
        await this.interruptAtSafeBoundary(request)
        return result
      } }),
    ]
    const questionTool = tool({
      name: "request_user_input",
      description: "仅在缺少关键实现决策时向用户提问。",
      needsApproval: true,
      parameters: z.object({ question: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(3) }),
      execute: ({ question, options }) => ({ question, options, answer: request.resume?.answer ?? "" }),
    })
    const questionTools = profile !== "main" || mainQuestionEnabled ? [questionTool] : []
    const delegationTools = profile === "main" ? this.delegationTools(request) : []
    if (profile === "explorer") return [...readTools, questionTool]
    if (profile === "main" && request.taskMode === "plan" && !request.continueFromPlan) {
      return [...readTools, ...questionTools, tool({
        name: "finalize_plan",
        description: "提交完整计划以请求用户确认。",
        parameters: z.object({ plan: z.string().min(1) }),
        execute: ({ plan }) => {
          const normalized = cleanText(plan)
          onPlanFinalized(normalized)
          return normalized
        },
      }), ...delegationTools]
    }
    if (request.permissionConfig.sandboxMode === "read-only") return [...readTools, questionTool, ...delegationTools]
    return [...readTools, ...questionTools,
      tool({
        name: "apply_patch",
        description: "直接且原子地更新、创建或删除一个工作区文件。",
        parameters: z.object({
          operation: z.enum(["update", "create", "delete"]),
          path: z.string().min(1),
          before: z.string().optional(),
          after: z.string().optional(),
          content: z.string().optional(),
          expectedSha256: z.string().optional(),
        }),
        execute: async (input) => {
          const patchInput = input.operation === "update"
            ? { operation: input.operation, path: input.path, before: input.before ?? "", after: input.after ?? "" }
            : input.operation === "create"
              ? { operation: input.operation, path: input.path, content: input.content ?? "" }
              : { operation: input.operation, path: input.path, expectedSha256: input.expectedSha256 ?? "" }
          const result = await this.executeTool<ApplyPatchResult>(request, "apply_patch", patchInput)
          const createdAt = now()
          await this.saveItem(request.threadID, {
            id: crypto.randomUUID(), turnID: request.turnID, agentID: request.agentID, type: "patch", status: "completed",
            data: { files: [{ path: result.path, additions: result.additions, deletions: result.deletions, patch: result.diff }], totalAdditions: result.additions, totalDeletions: result.deletions },
            createdAt, updatedAt: createdAt,
          })
          await this.interruptAtSafeBoundary(request)
          return result
        },
      }),
      tool({
        name: "shell",
        description: "执行一条经过审核的 PowerShell 命令。必须声明工作区外访问和简短理由。",
        parameters: z.object({
          command: z.string().min(1), cwd: z.string().min(1).optional(), timeoutMs: z.number().positive().max(600_000).optional(),
          additionalPermissions: z.object({ readPaths: z.array(z.string().min(1)).optional(), writePaths: z.array(z.string().min(1)).optional(), networkDomains: z.array(z.string().min(1)).optional() }).optional(),
          justification: z.string().min(1).optional(),
        }),
        execute: async (input) => {
          const command = `shell ${input.command}`
          let result: ProcessResult
          try {
            result = await this.executeTool<ProcessResult>(request, "shell", input)
            const output = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim()
            const capped = capActivityOutput(output)
            await this.recordActivity(request, "执行 Shell", input.cwd ?? request.workspace.rootPath, { command, output: capped.output, status: result.exitCode === 0 ? "success" : "error", ...(result.truncated || capped.truncated ? { truncated: true } : {}) })
          } catch (cause) {
            await this.recordError(request, "执行 Shell", input.cwd ?? request.workspace.rootPath, command, cause)
            throw cause
          }
          await this.interruptAtSafeBoundary(request)
          return result
        },
      }),
      ...delegationTools,
    ]
  }

  private pendingApproval(streamed: { interruptions?: readonly unknown[]; state: unknown }): PendingApproval | null {
    const interruption = streamed.interruptions?.[0]
    if (!interruption) return null
    const item = interruption as { name?: unknown; arguments?: unknown }
    const args = parseArguments(item.arguments)
    if (item.name === "wait_agents") {
      const runIDs = Array.isArray(args.runIDs) ? args.runIDs.filter((value): value is string => typeof value === "string") : []
      const waitMode = args.mode === "any" ? "any" : "all"
      return { checkpoint: { state: JSON.stringify(streamed.state), interruption }, kind: "subagents", runIDs, waitMode }
    }
    if (item.name !== "request_user_input") return null
    const question = typeof args.question === "string" ? args.question : "需要你的确认"
    const options = Array.isArray(args.options) ? args.options.filter((option): option is string => typeof option === "string") : []
    return {
      checkpoint: { state: JSON.stringify(streamed.state), interruption },
      kind: "clarification",
      question,
      options: options.length >= 2 ? options : ["继续按当前假设", "补充更多信息"],
    }
  }

  async run(request: OrchestrationRequest): Promise<RunResult> {
    const { model } = await request.resolveModel(request.fallbackModel)
    const profile = request.profile ?? "main"
    const startedAt = now()
    let textItemID = crypto.randomUUID()
    let segmentStartedAt = startedAt
    let segmentText = ""
    let segmentSaved = false
    let rawOutput = ""
    let finalizedPlan = ""
    const saveText = async (status: Item["status"], fallback = "正在分析…", error?: string) => {
      const text = cleanText(segmentText) || fallback
      if (!segmentSaved && !text) return
      segmentSaved = true
      await this.saveItem(request.threadID, {
        id: textItemID, turnID: request.turnID, agentID: request.agentID, type: "text", status,
        data: { placement: "result", text, ...(error ? { error } : {}) },
        createdAt: segmentStartedAt, updatedAt: now(),
      })
    }
    const startNextSegment = () => {
      textItemID = crypto.randomUUID()
      segmentStartedAt = now()
      segmentText = ""
      segmentSaved = false
    }
    const planning = profile === "main" && request.taskMode === "plan" && !request.continueFromPlan
    const instructions = profile === "main"
      ? [
          MAIN_INSTRUCTIONS,
          planning ? PLAN_INSTRUCTIONS : "",
          isMainAgentRequestUserInputEnabled(request) ? QUESTION_ENABLED_INSTRUCTIONS : QUESTION_DISABLED_INSTRUCTIONS,
        ].filter(Boolean).join("\n")
      : PROFILE_INSTRUCTIONS[profile]
    const agent = new Agent({
      name: profile === "main" ? "CodePilotX Main Agent" : `CodePilotX ${profile} Agent`,
      instructions,
      model: asAgentModel(model),
      tools: this.toolsFor(request, (plan) => { finalizedPlan = plan }, startNextSegment),
      ...(profile === "main" ? {} : { outputType: subagentResultSchema }),
      ...(planning ? { toolUseBehavior: { stopAtToolNames: ["finalize_plan"] } } : {}),
    })
    try {
      const context = request.continueFromPlan
        ? `用户任务：\n${request.content}\n\n已确认的实施计划：\n${request.plan ?? ""}\n\n现在直接实施并完成必要验证。`
        : request.content
      const modelInput: string | AgentInputItem[] = request.attachments?.length
        ? [{
            role: "user",
            content: [
              { type: "input_text", text: context },
              ...request.attachments.map((attachment) => attachment.kind === "text"
                ? { type: "input_text" as const, text: `附件 ${attachment.name}:\n${attachment.text}` }
                : { type: "input_image" as const, image: `data:${attachment.mediaType};base64,${attachment.base64}` }),
            ],
          }]
        : context
      const resume = request.resume
        ? await RunState.fromString(agent, request.resume.state).then((state) => {
            const interruption = state.getInterruptions()[0]
            if (!interruption) throw new Error("Agent checkpoint 中没有待恢复的问题")
            state.approve(interruption)
            return state
          })
        : modelInput
      const session = this.options.sessionFor?.(request.sessionID)
      const streamed = session
        ? await run(agent, resume, { stream: true, signal: request.signal, maxTurns: profile === "worker" ? 24 : 12, session })
        : await run(agent, resume, { stream: true, signal: request.signal, maxTurns: profile === "worker" ? 24 : 12 })
      for await (const delta of streamed.toTextStream() as AsyncIterable<string>) {
        rawOutput += delta
        segmentText += delta
        await saveText("running")
      }
      await streamed.completed
      if (request.signal.aborted || streamed.cancelled) {
        await saveText("interrupted", cleanText(rawOutput))
        return { status: "completed", output: cleanText(rawOutput) }
      }
      const pause = this.pendingApproval(streamed)
      if (pause) {
        await request.pause(pause)
        await saveText("pending", cleanText(rawOutput))
        return { status: "paused", output: cleanText(rawOutput) }
      }
      const structuredResult = profile === "main" ? undefined : subagentResultSchema.safeParse(streamed.finalOutput)
      const result = structuredResult?.success ? structuredResult.data as SubagentResult : undefined
      const finalOutput = cleanText(finalizedPlan || result?.summary || (typeof streamed.finalOutput === "string" ? streamed.finalOutput : rawOutput))
      if (planning) {
        await saveText("completed", "已完成工作区分析")
        const createdAt = now()
        await this.saveItem(request.threadID, {
          id: crypto.randomUUID(), turnID: request.turnID, agentID: request.agentID, type: "plan", status: "completed",
          data: { title: "实施计划", markdown: finalOutput, version: 1, state: "awaiting-confirmation" },
          createdAt, updatedAt: createdAt,
        })
        return { status: "plan-ready", output: finalOutput, plan: finalOutput }
      }
      await saveText("completed", finalOutput)
      return { status: "completed", output: finalOutput, ...(result ? { result } : {}) }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause)
      await saveText(request.signal.aborted ? "interrupted" : "error", cleanText(rawOutput), error)
      throw cause
    }
  }
}
