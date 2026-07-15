import type { PermissionConfig, ShellReview, ThreadSettings } from "@codepilotx/shared/thread"
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
  | "waiting_subagents"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"

export type ModelRef = Model.Ref

export interface SubmitMessage {
  content: string
  model: ModelRef
  permissionConfig: PermissionConfig
  strategy: SendStrategy
  taskMode: TaskMode
}

export type ItemType = "reasoning" | "activity" | "text" | "tool" | "plan" | "question" | "patch" | "subagent"

export type SubagentProfile = "main" | "default" | "explorer" | "worker"
export type SubagentWorkspaceMode = "shared" | "worktree"
export type SubagentWorkspaceState = "ready" | "preparing" | "conflict" | "applied" | "discarded"

export interface SubagentWorkspace {
  mode: SubagentWorkspaceMode
  state: SubagentWorkspaceState
  rootPath: string | null
  baselineRef: string | null
}

export type SubagentStatus =
  | "queued"
  | "preparing"
  | "running"
  | "steering"
  | "waiting_question"
  | "waiting_permission"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted"

export type SubagentQueueReason = "parent_limit" | "global_limit" | "workspace_writer" | null

export interface SubagentResult {
  outcome: "succeeded" | "partial" | "blocked"
  summary: string
  findings: Array<{
    title: string
    detail: string
    severity: "info" | "warning" | "error"
  }>
  changedFiles: Array<{
    path: string
    summary: string
  }>
  validation: Array<{
    command: string
    status: "passed" | "failed" | "skipped"
    output?: string
  }>
  risks: string[]
  references: Array<{
    kind: "file" | "url" | "thread" | "subagent"
    value: string
    label?: string
  }>
}

export interface SubagentRun {
  id: string
  taskID: string
  generation: number
  status: SubagentStatus
  queueReason: SubagentQueueReason
  model: ModelRef
  permissionConfig: PermissionConfig
  result: SubagentResult | null
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  updatedAt: number
}

export interface SubagentTask {
  id: string
  parentThreadID: string
  parentTurnID: string
  parentAgentID: string
  childThreadID: string
  displayName: string
  profile: Exclude<SubagentProfile, "main">
  task: string
  permissionCeiling: PermissionConfig
  workspace: SubagentWorkspace
  currentRun: SubagentRun | null
  createdAt: number
  updatedAt: number
}

export interface SubagentProjection {
  task: SubagentTask
  currentRun: SubagentRun | null
}

export type AgentExecutionStatus =
  | "queued"
  | "running"
  | "waiting_question"
  | "waiting_permission"
  | "waiting_confirmation"
  | "waiting_subagents"
  | "completed"
  | "failed"
  | "interrupted"
  | "cancelled"

export interface AgentExecution {
  id: string
  threadID: string
  turnID: string
  parentAgentID: string | null
  profile: string
  task: string
  model: ModelRef
  sessionID: string
  depth: number
  status: AgentExecutionStatus
  error: string | null
  subagentRunID: string | null
  runSequence: number
  createdAt: number
  updatedAt: number
}

export interface Item {
  id: string
  turnID: string
  agentID: string
  type: ItemType
  status: "pending" | "running" | "completed" | "error" | "interrupted"
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export interface ThreadSnapshot {
  id: string
  title: string
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  turns: Array<{
    id: string
    rootAgentID: string
    status: TurnStatus
    mode: TaskMode
    startedAt: number | null
    finishedAt: number | null
    items: Item[]
  }>
  agents?: AgentExecution[]
  subagents?: SubagentProjection[]
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
  agentID: string
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
