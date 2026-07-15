import type { PermissionConfig, ShellReview } from "@codepilotx/shared/thread"
import type { Model } from "@codepilotx/model-schema"

export type { PermissionConfig } from "@codepilotx/shared/thread"
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
  permissionConfig: PermissionConfig
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

export interface ToolInvocation {
  id: string
  threadID: string
  turnID: string
  name: string
  input: Record<string, unknown>
  permissionConfig: PermissionConfig
  model: Model.Ref
  taskMode: TaskMode
}

export interface PermissionDecision {
  decision: "allow" | "ask" | "deny"
  risk: "low" | "medium" | "high" | "critical"
  reason: string
  review?: ShellReview
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
