export type PermissionMode = "ask" | "review" | "full"
export type SendStrategy = "queue" | "guide"
export type TaskMode = "chat" | "plan"
export type TurnStatus =
  | "queued"
  | "running"
  | "waiting_permission"
  | "waiting_question"
  | "waiting_plan_confirmation"
  | "completed"
  | "failed"
  | "interrupted"

export type ModelRef = Model.Ref

export interface SubmitMessage {
  content: string
  model: ModelRef
  permissionMode: PermissionMode
  strategy: SendStrategy
  taskMode: TaskMode
}

export type ItemType = "reasoning" | "activity" | "text" | "tool" | "plan" | "question" | "patch"

export type AgentRole = "planner" | "developer" | "reviewer"

export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "waiting_question"
  | "completed"
  | "failed"
  | "interrupted"

export interface WorkflowStage {
  turnID: string
  role: AgentRole
  attempt: number
  status: WorkflowStageStatus
  model: ModelRef
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface Item {
  id: string
  turnID: string
  type: ItemType
  status: "pending" | "running" | "completed" | "error" | "interrupted"
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ThreadSnapshot {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: Array<{
    id: string
    status: TurnStatus
    mode: TaskMode
    startedAt: number | null
    finishedAt: number | null
    items: Item[]
  }>
  stages?: WorkflowStage[]
}

export interface EventEnvelope<T = unknown> {
  id: number
  threadId: string | null
  turnId: string | null
  method: string
  params: T
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
  threadID: string
  turnID: string
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
import type { Model } from "@codepilotx/model-schema"
