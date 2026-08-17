import type {
  AgentHarness,
  AgentHarnessEvent,
  AgentHarnessResources,
  AgentTool,
  CompactResult,
  Session,
  ThinkingLevel,
} from "@codepilotx/pi-agent-core"
import type { ImageContent, Model, Models } from "@earendil-works/pi-ai"
import type { ModelRef, PermissionConfig, SubagentProfile, SubagentResult, TaskMode } from "../../domain"
import type { PromptBundle, PromptSection } from "../../prompt/types"
import type { ToolExecutor } from "../../tool/ToolExecutor"
import type { ToolCatalog } from "../../tool/ToolRegistry"
import type { WorkspaceService } from "../../workspace/WorkspaceService"
import type { AgentRuntimeScope, RuntimeLease } from "../../runtime/AgentRuntimeScope"
import type { AgentLogger } from "../../observability/AgentLogger"
import type { RuntimeContributionRegistry, RuntimeSnapshot } from "../../runtime/RuntimeContribution"
import type { RequestSnapshotRecorder } from "../../snapshot/RequestSnapshotRecorder"
import type { RuntimeStepService } from "../../runtime/RuntimeStepService"
import type { ExecutionPlanInput } from "../plan/ExecutionPlanInput"
import type { RequestUserInput } from "../../session/QuestionInput"

export type PiRunResult =
  | { status: "completed"; output: string; result?: SubagentResult }
  | { status: "paused"; output: string }

export type RuntimeCompactionTrigger = "manual" | "automatic" | "reactive"

export interface PiRuntimeRequest {
  threadID: string
  turnID: string
  agentID: string
  sessionID: string
  profile?: SubagentProfile
  content: string
  taskMode: TaskMode
  permissionConfig: PermissionConfig
  signal: AbortSignal
  workspace: WorkspaceService
  defaultCwd?: string
  model: Model<any>
  policyModel: ModelRef
  thinkingLevel?: ThinkingLevel
  exposedTools: readonly string[]
  promptSections: readonly PromptSection[]
  attachments?: Array<{ kind: "text"; name: string; text: string } | { kind: "image"; name: string; mediaType: string; base64: string }>
  allowedTools?: readonly string[]
  toolCatalog?: ToolCatalog
  onPromptComposed?: (bundle: PromptBundle) => void | Promise<void>
  preapprovedToolCalls?: ReadonlyMap<string, string | undefined>
  canAutoCompact?: () => boolean | Promise<boolean>
}

export interface PiHarnessDependencies {
  models: Models
  session: Session
  resources?: AgentHarnessResources
}

export interface PiHarnessFactory {
  resolve(request: PiRuntimeRequest): Promise<PiHarnessDependencies>
}

export interface PiRuntimeEventContext {
  threadID: string
  turnID: string
  agentID: string
}

export type PiAssistantMessagePlacement = "process" | "result"

/** 语义运行时事件的载荷部分（不带 context）。 */
export type PiRuntimeEventPayload =
  | { type: "assistant.started"; textItemID: string; reasoningItemID: string; placement: PiAssistantMessagePlacement }
  | {
      type: "assistant.completed"
      textItemID: string
      reasoningItemID: string
      planItemID: string
      placement: PiAssistantMessagePlacement
      content: unknown
      text?: string
      plan?: string | null
      provider: string
      api: string
      model: string
      /** Final assistant message entry in the private Pi session tree. */
      sessionEntryID?: string
      usage: {
        input: number
        output: number
        cacheRead: number
        cacheWrite: number
        reasoning: number
      }
    }
  | { type: "assistant.text.delta"; itemID: string; delta: string }
  | { type: "assistant.reasoning.delta"; itemID: string; delta: string }
  | { type: "plan.started"; itemID: string }
  | { type: "plan.delta"; itemID: string; delta: string }
  | { type: "tool.started"; toolCallID: string; tool: string; input: unknown }
  | { type: "tool.updated"; toolCallID: string; tool: string; update: unknown }
  | {
      type: "tool.finished"
      toolCallID: string
      tool: string
      result: string
      details: unknown
      isError: boolean
    }
  | { type: "queue.updated"; steer: number; followUp: number; nextTurn: number }
  | { type: "queue.consumed"; delivery: "steer" | "follow-up" | "next-turn"; inputIDs: string[] }
  | {
      type: "compaction.completed"
      entryID: string
      summary: string
      firstKeptEntryID: string | null
      tokensBefore: number
      beforeCount: number
      trigger: RuntimeCompactionTrigger
      promptText: string
    }
  | { type: "runtime.savepoint"; hadPendingMutations: boolean }
  | { type: "runtime.settled"; nextTurnCount: number }
  | { type: "runtime.aborted" }

/** 语义运行时事件：Pi 原始事件经 PiEventAdapter 映射后的唯一投影输入。 */
export type PiRuntimeEvent = { context: PiRuntimeEventContext } & PiRuntimeEventPayload

/** 唯一投影入口：PiRuntimeProjector 消费同一事件流，不再有大型可选回调接口。 */
export type PiRuntimeEventHandler = (event: PiRuntimeEvent) => void | Promise<void>

export interface PiToolAdapterOptions {
  executor: ToolExecutor
  request: PiRuntimeRequest
}

export interface PiLifecycleCallbacks {
  skillList?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  skillRead?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  projectSourceList?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  projectSourceRead?(
    input: { sourceId: string; offset?: number; length?: number },
    toolCallID: string,
    signal?: AbortSignal,
  ): Promise<{
    source: { id: string; name: string; kind: "text" | "image" }
    data: Uint8Array
    mediaType: string
    range: { offset: number; length: number; total: number }
  }>
  requestUserInput?(input: RequestUserInput & { question?: string; options?: string[] }, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  requestPermissions?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  updatePlan?(input: ExecutionPlanInput, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  spawnAgents?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  waitAgents?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  sendAgent?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  stopAgent?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  finalizeResult?(input: SubagentResult, toolCallID: string): Promise<unknown>
}

export interface PiAgentRuntimeOptions {
  harnessFactory: PiHarnessFactory
  toolExecutor: ToolExecutor
  /** 语义事件投影入口；持久化由 PiRuntimeProjector 在事务提交后完成。 */
  eventHandler?: PiRuntimeEventHandler
  /** 原始 Harness 事件观测（仅用于诊断日志，不进入协议）。 */
  observeHarnessEvent?: (context: PiRuntimeEventContext, event: AgentHarnessEvent) => void
  lifecycle?: PiLifecycleCallbacks
  /** 仓库内静态贡献注册表；每次运行时绑定到新 scope。 */
  contributions?: RuntimeContributionRegistry
  /**
   * 运行时开始时获取的资源租约（scope 释放时逆序回收）。
   * PR 0 无宿主接线；为 MCP/插件 generation lease 预留的装配位。
   */
  acquireLeases?: (request: PiRuntimeRequest) => Promise<readonly RuntimeLease[]>
  /** 诊断日志（observer 失败等）；失败不回滚已完成的 canonical projection。 */
  logger?: AgentLogger
  /** 完整 Provider 请求快照采集器；未开启配置时内部直接跳过。 */
  requestSnapshot?: RequestSnapshotRecorder
  /** 持久 step 状态机与 model-visible context invariant；未注入时跳过（测试/无宿主）。 */
  runtimeSteps?: RuntimeStepService
  beforeToolCall?: (request: PiRuntimeRequest, input: { toolCallID: string; tool: string; input: Record<string, unknown> }) => Promise<{ block?: boolean; reason?: string; pause?: boolean } | undefined>
  compaction?: {
    shouldAutoCompact(threadID: string): boolean | Promise<boolean>
    recordFailure(threadID: string, trigger: RuntimeCompactionTrigger): void | Promise<void>
  }
}

export interface ActivePiHarness {
  harness: AgentHarness
  /** 本次运行的可回收 scope；释放即解除订阅并中止 harness。 */
  scope: AgentRuntimeScope
  compact(trigger: RuntimeCompactionTrigger, instructions?: string): Promise<CompactResult>
  /** 本轮运行开始时冻结的快照。 */
  snapshot: RuntimeSnapshot
}

export interface PiAgentRuntimeApi {
  run(request: PiRuntimeRequest): Promise<PiRunResult>
  steer(threadID: string, content: string, images?: ImageContent[], inputID?: string): Promise<void>
  followUp(threadID: string, content: string, images?: ImageContent[]): Promise<void>
  abort(threadID: string): Promise<void>
  compact(threadID: string, instructions?: string): Promise<CompactResult>
  dispose(): Promise<void>
}

export type PiTool = AgentTool<any, unknown>
