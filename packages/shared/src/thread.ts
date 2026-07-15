import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"

export const SandboxModeSchema = Schema.Literals(["read-only", "workspace-write", "danger-full-access"])
export type SandboxMode = typeof SandboxModeSchema.Type

export const ApprovalPolicySchema = Schema.Literals(["untrusted", "on-request", "never"])
export type ApprovalPolicy = typeof ApprovalPolicySchema.Type

export const ApprovalsReviewerSchema = Schema.Literals(["user", "auto_review"])
export type ApprovalsReviewer = typeof ApprovalsReviewerSchema.Type

export const PermissionConfigSchema = Schema.Struct({
  sandboxMode: SandboxModeSchema,
  approvalPolicy: ApprovalPolicySchema,
  approvalsReviewer: ApprovalsReviewerSchema,
})
export type PermissionConfig = typeof PermissionConfigSchema.Type

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
}

export const AUTO_REVIEW_PERMISSION_CONFIG: PermissionConfig = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
}

export const FULL_ACCESS_PERMISSION_CONFIG: PermissionConfig = {
  sandboxMode: "danger-full-access",
  approvalPolicy: "never",
  approvalsReviewer: "auto_review",
}

export const AdditionalPermissionsSchema = Schema.Struct({
  readPaths: Schema.optional(Schema.Array(Schema.String)),
  writePaths: Schema.optional(Schema.Array(Schema.String)),
  networkDomains: Schema.optional(Schema.Array(Schema.String)),
})
export type AdditionalPermissions = typeof AdditionalPermissionsSchema.Type

export const ShellInputSchema = Schema.Struct({
  command: Schema.String,
  cwd: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  additionalPermissions: Schema.optional(AdditionalPermissionsSchema),
  justification: Schema.optional(Schema.String),
})
export type ShellInput = typeof ShellInputSchema.Type

export const RiskCategorySchema = Schema.Literals([
  "destructive",
  "irreversible_change",
  "system_modification",
  "security_control",
  "credential_access",
  "credential_exfiltration",
  "privilege_escalation",
  "persistence",
  "resource_exhaustion",
  "network_access",
  "scope_escape",
  "prompt_injection",
  "obfuscation",
  "unknown_infrastructure",
])
export type RiskCategory = typeof RiskCategorySchema.Type

export const ShellReviewSchema = Schema.Struct({
  decision: Schema.Literals(["allow", "ask", "deny"]),
  risk: Schema.Literals(["low", "medium", "high", "critical"]),
  confidence: Schema.Literals(["low", "medium", "high"]),
  categories: Schema.Array(RiskCategorySchema),
  requestedScopeValid: Schema.Boolean,
  reason: Schema.String,
})
export type ShellReview = typeof ShellReviewSchema.Type

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
  permissionConfig: PermissionConfigSchema,
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
  permissionConfig: PermissionConfigSchema,
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
  cwd: Schema.NullOr(Schema.String),
  paths: Schema.Array(Schema.String),
  requestedPermissions: AdditionalPermissionsSchema,
  review: Schema.NullOr(ShellReviewSchema),
  risk: Schema.Literals(["low", "medium", "high", "critical"]),
  reason: Schema.String,
  status: Schema.Literals(["pending", "allowed", "denied", "cancelled"]),
  createdAt: Schema.Number,
})
export type ApprovalRequest = typeof ApprovalRequestSchema.Type

export const TurnStartParamsSchema = Schema.Struct({
  threadId: Schema.String,
  content: Schema.String,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  strategy: Schema.optional(SendStrategySchema),
  taskMode: Schema.optional(TaskModeSchema),
})
export type TurnStartParams = typeof TurnStartParamsSchema.Type

export const ApprovalRespondParamsSchema = Schema.Struct({
  approvalId: Schema.String,
  decision: Schema.Literals(["allow-once", "deny", "stop"]),
})
export type ApprovalRespondParams = typeof ApprovalRespondParamsSchema.Type

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
  "sandbox/status",
  "sandbox/install",
  "sandbox/repair",
  "sandbox/uninstall",
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

export const RpcParamsSchema = Schema.Record(Schema.String, Schema.Unknown)
export type RpcParams = typeof RpcParamsSchema.Type
export const SandboxUninstallParamsSchema = Schema.Struct({ confirm: Schema.Literal(true) })
export type SandboxUninstallParams = typeof SandboxUninstallParamsSchema.Type

export const AgentNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: AgentEventMethodSchema,
  params: RpcParamsSchema,
})
export type AgentNotification = typeof AgentNotificationSchema.Type

export const AgentRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  method: AgentRpcMethodSchema,
  params: Schema.optional(RpcParamsSchema),
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
