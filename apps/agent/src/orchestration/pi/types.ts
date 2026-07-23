import type {
  AgentHarness,
  AgentHarnessEvent,
  AgentHarnessResources,
  AgentTool,
  CompactResult,
  ExecutionEnv,
  Session,
  ThinkingLevel,
} from "@codepilotx/pi-agent-core"
import type { ImageContent, Model, Models } from "@earendil-works/pi-ai"
import type { ModelRef, PermissionConfig, SubagentProfile, SubagentResult, TaskMode } from "../../domain"
import type { PromptBundle, PromptSection } from "../../prompt/types"
import type { ToolExecutor } from "../../tool/ToolExecutor"
import type { WorkspaceService } from "../../workspace/WorkspaceService"

export type PiRunResult =
  | { status: "completed"; output: string; result?: SubagentResult }
  | { status: "paused"; output: string }
  | { status: "plan-ready"; output: string; plan: string }

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
  onPromptComposed?: (bundle: PromptBundle) => void | Promise<void>
  preapprovedToolCallIDs?: ReadonlySet<string>
}

export interface PiHarnessDependencies {
  models: Models
  env: ExecutionEnv
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

/**
 * Persistence is deliberately outside the Pi adapter. The eventual Agent integration
 * must implement savePoint/settled with AgentDatabase transactions and publish only
 * after the transaction commits.
 */
export interface PiRuntimeEventSink {
  event?(context: PiRuntimeEventContext, event: AgentHarnessEvent): void | Promise<void>
  assistantMessageStarted?(context: PiRuntimeEventContext, input: { textItemID: string; reasoningItemID: string }): void | Promise<void>
  assistantMessageCompleted?(context: PiRuntimeEventContext, input: { textItemID: string; reasoningItemID: string; content: unknown }): void | Promise<void>
  textDelta?(context: PiRuntimeEventContext, input: { itemID: string; delta: string }): void | Promise<void>
  reasoningDelta?(context: PiRuntimeEventContext, input: { itemID: string; delta: string }): void | Promise<void>
  toolStarted?(context: PiRuntimeEventContext, input: { toolCallID: string; tool: string; input: unknown }): void | Promise<void>
  toolUpdated?(context: PiRuntimeEventContext, input: { toolCallID: string; tool: string; update: unknown }): void | Promise<void>
  toolFinished?(context: PiRuntimeEventContext, input: { toolCallID: string; tool: string; result: unknown; isError: boolean }): void | Promise<void>
  queueUpdated?(context: PiRuntimeEventContext, input: { steer: number; followUp: number; nextTurn: number }): void | Promise<void>
  compacted?(context: PiRuntimeEventContext, input: { entryID: string; summary: string; tokensBefore: number; beforeCount: number }): void | Promise<void>
  savePoint?(context: PiRuntimeEventContext, input: { hadPendingMutations: boolean }): void | Promise<void>
  settled?(context: PiRuntimeEventContext, input: { nextTurnCount: number }): void | Promise<void>
  aborted?(context: PiRuntimeEventContext): void | Promise<void>
}

export interface PiToolAdapterOptions {
  executor: ToolExecutor
  request: PiRuntimeRequest
}

export interface PiLifecycleCallbacks {
  skillList?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  skillRead?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  requestUserInput?(input: { question: string; options?: string[] }, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  requestPermissions?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  spawnAgents?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  waitAgents?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  sendAgent?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  stopAgent?(input: Record<string, unknown>, toolCallID: string, signal?: AbortSignal): Promise<unknown>
  finalizePlan?(input: { plan: string }, toolCallID: string): Promise<unknown>
  finalizeResult?(input: SubagentResult, toolCallID: string): Promise<unknown>
}

export interface PiAgentRuntimeOptions {
  harnessFactory: PiHarnessFactory
  toolExecutor: ToolExecutor
  eventSink?: PiRuntimeEventSink
  lifecycle?: PiLifecycleCallbacks
  beforeToolCall?: (request: PiRuntimeRequest, input: { toolCallID: string; tool: string; input: Record<string, unknown> }) => Promise<{ block?: boolean; reason?: string; pause?: boolean } | undefined>
}

export interface ActivePiHarness {
  harness: AgentHarness
  unsubscribe: () => void
}

export interface PiAgentRuntimeApi {
  run(request: PiRuntimeRequest): Promise<PiRunResult>
  steer(threadID: string, content: string, images?: ImageContent[]): Promise<void>
  followUp(threadID: string, content: string, images?: ImageContent[]): Promise<void>
  abort(threadID: string): Promise<void>
  compact(threadID: string, instructions?: string): Promise<CompactResult>
  dispose(): Promise<void>
}

export type PiTool = AgentTool<any, unknown>
