export type PermissionMode = "ask" | "review" | "full"
export type SendStrategy = "queue" | "guide"
export type TaskMode = "chat" | "plan"
export type RunStatus =
  | "queued"
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "waiting_plan_confirmation"
  | "completed"
  | "failed"
  | "interrupted"

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface SubmitMessage {
  content: string
  model: ModelRef
  permissionMode: PermissionMode
  strategy: SendStrategy
  taskMode: TaskMode
}

export interface ModelCapabilities {
  reasoning: boolean
  tools: boolean
  image: boolean
  inputLimit: number
  outputLimit: number
}

export interface ResolvedModel extends ModelRef {
  name: string
  protocol: "openai" | "anthropic" | "openai-compatible"
  baseURL?: string | undefined
  headers?: Record<string, string> | undefined
  capabilities: ModelCapabilities
  defaults?: Record<string, unknown> | undefined
}

export interface ProviderInfo {
  id: string
  name: string
  protocol: ResolvedModel["protocol"]
  baseURL?: string | undefined
  configured: boolean
  models: ResolvedModel[]
}

export type PartType = "reasoning" | "activity" | "text" | "tool" | "plan" | "question" | "patch"

export type AgentRole = "planner" | "developer" | "reviewer"

export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "waiting_question"
  | "completed"
  | "failed"
  | "interrupted"

export interface WorkflowStage {
  runID: string
  role: AgentRole
  attempt: number
  status: WorkflowStageStatus
  model: ModelRef
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface SessionPart {
  id: string
  runID: string
  type: PartType
  status: "pending" | "running" | "completed" | "error" | "interrupted"
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface SessionSnapshot {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  runs: Array<{
    id: string
    status: RunStatus
    mode: TaskMode
    startedAt: number | null
    finishedAt: number | null
    parts: SessionPart[]
  }>
  stages?: WorkflowStage[]
}

export interface EventEnvelope<T = unknown> {
  id: number
  sessionID: string | null
  type: string
  payload: T
  createdAt: number
}

export type NormalizedLLMEvent =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "tool-input-start"; id: string; toolName: string }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | { type: "tool-call"; id: string; toolName: string; input: unknown }
  | { type: "tool-result"; id: string; output: unknown }
  | { type: "tool-error"; id: string; error: string }
  | { type: "step-start"; id: string }
  | { type: "step-finish"; id: string; finishReason?: string }
  | { type: "finish"; finishReason?: string }
  | { type: "provider-error"; message: string; retryable: boolean }

export interface ToolInvocation {
  id: string
  sessionID: string
  runID: string
  name: string
  input: Record<string, unknown>
  permissionMode: PermissionMode
  taskMode: TaskMode
}

export interface PermissionDecision {
  decision: "allow" | "ask" | "deny"
  risk: "low" | "medium" | "high"
  reason: string
}

export class AgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 500,
    readonly details?: unknown,
  ) {
    super(message)
  }
}
