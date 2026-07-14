import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"

export const PermissionModeSchema = Schema.Literals(["ask", "review", "full"])
export type PermissionMode = typeof PermissionModeSchema.Type

export const SendStrategySchema = Schema.Literals(["queue", "guide"])
export type SendStrategy = typeof SendStrategySchema.Type

export const TaskModeSchema = Schema.Literals(["chat", "plan"])
export type TaskMode = typeof TaskModeSchema.Type

export const AgentRoleSchema = Schema.Literals(["planner", "developer", "reviewer"])
export type AgentRole = typeof AgentRoleSchema.Type

export const WorkflowStageStatusSchema = Schema.Literals([
  "pending",
  "running",
  "waiting-question",
  "completed",
  "failed",
  "interrupted",
])
export type WorkflowStageStatus = typeof WorkflowStageStatusSchema.Type

export const WorkflowStageSchema = Schema.Struct({
  turnId: Schema.String,
  role: AgentRoleSchema,
  attempt: Schema.Number,
  status: WorkflowStageStatusSchema,
  model: Model.Ref,
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
})
export type WorkflowStage = typeof WorkflowStageSchema.Type

export const ProposalStatusSchema = Schema.Literals(["pending", "reviewed", "rejected"])
export type ProposalStatus = typeof ProposalStatusSchema.Type

export const ProjectSettingsSchema = Schema.Struct({
  defaultModel: Schema.NullOr(Model.Ref),
  plannerModel: Schema.NullOr(Model.Ref),
  developerModel: Schema.NullOr(Model.Ref),
  reviewerModel: Schema.NullOr(Model.Ref),
})
export type ProjectSettings = typeof ProjectSettingsSchema.Type

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rootPath: Schema.String,
  lastOpenedAt: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
  settings: ProjectSettingsSchema,
})
export type Project = typeof ProjectSchema.Type

export const ProposalSchema = Schema.Struct({
  id: Schema.String,
  turnId: Schema.String,
  projectID: Schema.String,
  role: AgentRoleSchema,
  kind: Schema.Literals(["patch", "command"]),
  title: Schema.String,
  payload: Schema.Unknown,
  review: Schema.NullOr(Schema.String),
  status: ProposalStatusSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Proposal = typeof ProposalSchema.Type

export const TurnStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting-permission",
  "waiting-question",
  "waiting-plan-confirmation",
  "completed",
  "failed",
  "stopped",
  "interrupted",
])
export type TurnStatus = typeof TurnStatusSchema.Type

export const ThreadSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type Thread = typeof ThreadSchema.Type

export const ThreadListItemSchema = Schema.Struct({
  id: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  title: Schema.String,
  preview: Schema.NullOr(Schema.String),
  firstUserMessage: Schema.NullOr(Schema.String),
  messageCount: Schema.Number,
  latestTurnStatus: Schema.NullOr(TurnStatusSchema),
  archivedAt: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ThreadListItem = typeof ThreadListItemSchema.Type

export const TurnSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  sourceInputID: Schema.String,
  status: TurnStatusSchema,
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionMode: PermissionModeSchema,
  currentStage: Schema.NullOr(AgentRoleSchema),
  canContinueFromPlan: Schema.Boolean,
  stages: Schema.Array(WorkflowStageSchema),
  mergedInputIDs: Schema.Array(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  elapsedSeconds: Schema.Number,
  error: Schema.NullOr(Schema.String),
})
export type Turn = typeof TurnSchema.Type

export const InputSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  content: Schema.String,
  strategy: SendStrategySchema,
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionMode: PermissionModeSchema,
  state: Schema.Literals(["queued", "merged", "active", "completed", "cancelled"]),
  createdAt: Schema.Number,
})
export type Input = typeof InputSchema.Type

export const MessageSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  role: Schema.Literals(["user", "assistant", "system"]),
  createdAt: Schema.Number,
})
export type Message = typeof MessageSchema.Type

export const ToolStateSchema = Schema.Literals([
  "pending",
  "waiting-permission",
  "running",
  "completed",
  "error",
  "interrupted",
])
export type ToolState = typeof ToolStateSchema.Type

export const EditedFileSchema = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  patch: Schema.optional(Schema.String),
})
export type EditedFile = typeof EditedFileSchema.Type

export const QuestionChoiceSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  recommended: Schema.Boolean,
})
export type QuestionChoice = typeof QuestionChoiceSchema.Type

export const TextItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("text"),
  placement: Schema.Literals(["process", "result"]),
  text: Schema.String,
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  createdAt: Schema.Number,
})
export type TextItem = typeof TextItemSchema.Type

export const ReasoningItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("reasoning"),
  text: Schema.String,
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  createdAt: Schema.Number,
})
export type ReasoningItem = typeof ReasoningItemSchema.Type

export const ActivityCommandSchema = Schema.Struct({
  command: Schema.String,
  output: Schema.String,
  status: Schema.optional(Schema.Literals(["success", "running", "error", "interrupted"])),
  truncated: Schema.optional(Schema.Boolean),
})
export type ActivityCommand = typeof ActivityCommandSchema.Type

export const ActivityItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("activity"),
  activity: Schema.Literals(["context-compression", "file-edit", "build", "notice"]),
  title: Schema.String,
  detail: Schema.optional(Schema.String),
  commands: Schema.optional(Schema.Array(ActivityCommandSchema)),
  status: Schema.Literals(["running", "completed", "error", "interrupted"]),
  createdAt: Schema.Number,
})
export type ActivityItem = typeof ActivityItemSchema.Type

export const ToolItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("tool"),
  callID: Schema.String,
  tool: Schema.String,
  title: Schema.String,
  state: ToolStateSchema,
  input: Schema.Unknown,
  command: Schema.NullOr(Schema.String),
  output: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  durationMs: Schema.NullOr(Schema.Number),
  createdAt: Schema.Number,
})
export type ToolItem = typeof ToolItemSchema.Type

export const PlanItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("plan"),
  title: Schema.String,
  markdown: Schema.String,
  version: Schema.Number,
  state: Schema.Literals(["draft", "awaiting-confirmation", "confirmed", "rejected"]),
  createdAt: Schema.Number,
})
export type PlanItem = typeof PlanItemSchema.Type

export const QuestionItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("question"),
  prompt: Schema.String,
  choices: Schema.Array(QuestionChoiceSchema),
  status: Schema.Literals(["pending", "answered", "ignored", "cancelled"]),
  answer: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
})
export type QuestionItem = typeof QuestionItemSchema.Type

export const QuestionRequestSchema = QuestionItemSchema
export type QuestionRequest = typeof QuestionRequestSchema.Type

export const PatchItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  type: Schema.Literal("patch"),
  files: Schema.Array(EditedFileSchema),
  totalAdditions: Schema.Number,
  totalDeletions: Schema.Number,
  createdAt: Schema.Number,
})
export type PatchItem = typeof PatchItemSchema.Type

export const ItemSchema = Schema.Union([
  TextItemSchema,
  ReasoningItemSchema,
  ActivityItemSchema,
  ToolItemSchema,
  PlanItemSchema,
  QuestionItemSchema,
  PatchItemSchema,
])
export type Item = typeof ItemSchema.Type

export const ApprovalRequestSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  toolCallID: Schema.String,
  tool: Schema.String,
  command: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
  risk: Schema.Literals(["low", "medium", "high"]),
  reason: Schema.String,
  status: Schema.Literals(["pending", "allowed", "denied", "cancelled"]),
  createdAt: Schema.Number,
})
export type ApprovalRequest = typeof ApprovalRequestSchema.Type

export const ThreadSnapshotSchema = Schema.Struct({
  thread: ThreadSchema,
  turns: Schema.Array(TurnSchema),
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  items: Schema.Array(ItemSchema),
  approvals: Schema.Array(ApprovalRequestSchema),
  proposals: Schema.Array(ProposalSchema),
})
export type ThreadSnapshot = typeof ThreadSnapshotSchema.Type

export const AgentRpcMethodSchema = Schema.Literals([
  "initialize",
  "shutdown",
  "desktop/settings/get",
  "desktop/settings/save",
  "project/list",
  "project/open",
  "project/updateSettings",
  "thread/list",
  "thread/create",
  "thread/read",
  "thread/update",
  "thread/delete",
  "turn/start",
  "turn/interrupt",
  "turn/resume",
  "turn/submitPlanDecision",
  "approval/respond",
  "question/respond",
  "proposal/list",
  "proposal/review",
  "model/list",
  "model/refresh",
  "model/setDefault",
  "model/setReviewer",
  "provider/test",
  "provider/updateSettings",
  "integration/list",
  "integration/connect",
  "integration/authorize",
  "integration/authorizeComplete",
  "integration/authorizeStatus",
  "integration/disconnect",
])
export type AgentRpcMethod = typeof AgentRpcMethodSchema.Type

export const AgentEventMethodSchema = Schema.Literals([
  "thread/created",
  "thread/snapshot",
  "thread/updated",
  "thread/deleted",
  "turn/queued",
  "turn/started",
  "turn/statusChanged",
  "turn/completed",
  "turn/failed",
  "turn/interrupted",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "reasoning/textDelta",
  "reasoning/summaryPartAdded",
  "reasoning/summaryTextDelta",
  "plan/delta",
  "plan/ready",
  "plan/decision",
  "tool/callStarted",
  "tool/outputDelta",
  "tool/callCompleted",
  "tool/error",
  "approval/requested",
  "question/requested",
  "serverRequest/resolved",
  "workflow/stageStarted",
  "workflow/stageCompleted",
  "workflow/stagePaused",
  "proposal/created",
  "proposal/reviewed",
  "queue/updated",
  "catalog/updated",
  "integration/updated",
  "integration/authorizationCompleted",
  "integration/authorizationFailed",
  "heartbeat",
])
export type AgentEventMethod = typeof AgentEventMethodSchema.Type

export const AgentNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: AgentEventMethodSchema,
  params: Schema.Unknown,
})
export type AgentNotification = typeof AgentNotificationSchema.Type

export const AgentRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: AgentRpcMethodSchema,
  params: Schema.optional(Schema.Unknown),
})
export type AgentRpcRequest = typeof AgentRpcRequestSchema.Type

export const AgentRpcErrorSchema = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Unknown),
})
export type AgentRpcError = typeof AgentRpcErrorSchema.Type

export const AgentRpcResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Number, Schema.Null]),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(AgentRpcErrorSchema),
})
export type AgentRpcResponse = typeof AgentRpcResponseSchema.Type

export const AgentServerRequestSchema = AgentNotificationSchema
export type AgentServerRequest = typeof AgentServerRequestSchema.Type
