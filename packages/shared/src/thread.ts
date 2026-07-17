import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"

export const SandboxModeSchema = Schema.Literals(["read-only", "workspace-write", "danger-full-access"])
export type SandboxMode = typeof SandboxModeSchema.Type

export const GranularApprovalConfigSchema = Schema.Struct({
  sandboxApproval: Schema.Boolean,
  rules: Schema.Boolean,
  skillApproval: Schema.Boolean,
  requestPermissions: Schema.Boolean,
  mcpElicitations: Schema.Boolean,
})
export type GranularApprovalConfig = typeof GranularApprovalConfigSchema.Type

export const GranularApprovalPolicySchema = Schema.Struct({
  type: Schema.Literal("granular"),
  sandboxApproval: Schema.Boolean,
  rules: Schema.Boolean,
  skillApproval: Schema.Boolean,
  requestPermissions: Schema.Boolean,
  mcpElicitations: Schema.Boolean,
})
export type GranularApprovalPolicy = typeof GranularApprovalPolicySchema.Type

export const ApprovalPolicySchema = Schema.Union([
  Schema.Literals(["untrusted", "on-failure", "on-request", "never"]),
  GranularApprovalPolicySchema,
])
export type ApprovalPolicy = typeof ApprovalPolicySchema.Type

export const isGranularApprovalPolicy = (policy: ApprovalPolicy): policy is GranularApprovalPolicy => typeof policy === "object" && policy.type === "granular"

/** Stable TEXT representation used by SQLite and other string-only transports. */
export const encodeApprovalPolicy = (policy: ApprovalPolicy) => typeof policy === "string" ? policy : JSON.stringify(policy)

export const decodeApprovalPolicy = (value: unknown): ApprovalPolicy => {
  if (value === "on-failure") return "on-request"
  if (value === "untrusted" || value === "on-request" || value === "never") return value
  const candidate = typeof value === "string" ? JSON.parse(value) as unknown : value
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("approvalPolicy 无效")
  const config = candidate as Record<string, unknown>
  if (config.type !== "granular") throw new Error("granular approvalPolicy 无效")
  const keys = ["sandboxApproval", "rules", "skillApproval", "requestPermissions", "mcpElicitations"] as const
  if (keys.some((key) => typeof config[key] !== "boolean")) throw new Error("granular approvalPolicy 缺少布尔配置")
  return { type: "granular", sandboxApproval: config.sandboxApproval as boolean, rules: config.rules as boolean, skillApproval: config.skillApproval as boolean, requestPermissions: config.requestPermissions as boolean, mcpElicitations: config.mcpElicitations as boolean }
}

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

export const ThreadSettingsSchema = Schema.Struct({
  taskMode: TaskModeSchema,
  permissionConfig: PermissionConfigSchema,
})
export type ThreadSettings = typeof ThreadSettingsSchema.Type

export const ThreadSettingsPatchSchema = Schema.Struct({
  taskMode: Schema.optional(TaskModeSchema),
  permissionConfig: Schema.optional(PermissionConfigSchema),
})
export type ThreadSettingsPatch = typeof ThreadSettingsPatchSchema.Type

export const SubagentProfileSchema = Schema.Literals(["main", "default", "explorer", "worker"])
export type SubagentProfile = typeof SubagentProfileSchema.Type

export const SubagentWorkspaceSchema = Schema.Struct({
  mode: Schema.Literals(["shared", "worktree"]),
  state: Schema.Literals(["ready", "preparing", "conflict", "applied", "discarded"]),
  rootPath: Schema.NullOr(Schema.String),
  baselineRef: Schema.NullOr(Schema.String),
})
export type SubagentWorkspace = typeof SubagentWorkspaceSchema.Type

export const SubagentStatusSchema = Schema.Literals([
  "queued",
  "preparing",
  "running",
  "steering",
  "waiting-question",
  "waiting-permission",
  "completed",
  "failed",
  "stopped",
  "interrupted",
])
export type SubagentStatus = typeof SubagentStatusSchema.Type

export const SubagentQueueReasonSchema = Schema.NullOr(
  Schema.Literals(["parent-limit", "global-limit", "workspace-writer"]),
)
export type SubagentQueueReason = typeof SubagentQueueReasonSchema.Type

export const SubagentFindingSchema = Schema.Struct({
  title: Schema.String,
  detail: Schema.String,
  severity: Schema.Literals(["info", "warning", "error"]),
})
export type SubagentFinding = typeof SubagentFindingSchema.Type

export const SubagentChangedFileSchema = Schema.Struct({
  path: Schema.String,
  summary: Schema.String,
})
export type SubagentChangedFile = typeof SubagentChangedFileSchema.Type

export const SubagentValidationSchema = Schema.Struct({
  command: Schema.String,
  status: Schema.Literals(["passed", "failed", "skipped"]),
  output: Schema.optional(Schema.String),
})
export type SubagentValidation = typeof SubagentValidationSchema.Type

export const SubagentReferenceSchema = Schema.Struct({
  kind: Schema.Literals(["file", "url", "thread", "subagent"]),
  value: Schema.String,
  label: Schema.optional(Schema.String),
})
export type SubagentReference = typeof SubagentReferenceSchema.Type

export const SubagentResultSchema = Schema.Struct({
  outcome: Schema.Literals(["succeeded", "partial", "blocked"]),
  summary: Schema.String,
  findings: Schema.Array(SubagentFindingSchema),
  changedFiles: Schema.Array(SubagentChangedFileSchema),
  validation: Schema.Array(SubagentValidationSchema),
  risks: Schema.Array(Schema.String),
  references: Schema.Array(SubagentReferenceSchema),
})
export type SubagentResult = typeof SubagentResultSchema.Type

export const SubagentRunSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  generation: Schema.Number,
  status: SubagentStatusSchema,
  queueReason: SubagentQueueReasonSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  result: Schema.NullOr(SubagentResultSchema),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number),
  updatedAt: Schema.Number,
})
export type SubagentRun = typeof SubagentRunSchema.Type

export const SubagentTaskSchema = Schema.Struct({
  id: Schema.String,
  parentThreadId: Schema.String,
  parentTurnId: Schema.String,
  parentAgentId: Schema.String,
  childThreadId: Schema.String,
  displayName: Schema.String,
  profile: Schema.Literals(["default", "explorer", "worker"]),
  task: Schema.String,
  permissionCeiling: PermissionConfigSchema,
  workspace: SubagentWorkspaceSchema,
  currentRun: Schema.NullOr(SubagentRunSchema),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type SubagentTask = typeof SubagentTaskSchema.Type

export const SubagentProjectionSchema = Schema.Struct({
  task: SubagentTaskSchema,
  currentRun: Schema.NullOr(SubagentRunSchema),
})
export type SubagentProjection = typeof SubagentProjectionSchema.Type

export const AgentExecutionStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting-question",
  "waiting-permission",
  "waiting-confirmation",
  "waiting-subagents",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
])
export type AgentExecutionStatus = typeof AgentExecutionStatusSchema.Type

export const AgentExecutionSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  parentAgentId: Schema.NullOr(Schema.String),
  profile: Schema.String,
  task: Schema.String,
  model: Model.Ref,
  sessionId: Schema.String,
  depth: Schema.Number,
  status: AgentExecutionStatusSchema,
  error: Schema.NullOr(Schema.String),
  subagentRunId: Schema.NullOr(Schema.String),
  runSequence: Schema.Number,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type AgentExecution = typeof AgentExecutionSchema.Type

export const ProjectSettingsSchema = Schema.Struct({
  defaultModel: Schema.NullOr(Model.Ref),
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

export const TurnStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting-permission",
  "waiting-question",
  "waiting-plan-confirmation",
  "waiting-subagents",
  "completed",
  "failed",
  "stopped",
  "interrupted",
  "cancelled",
])
export type TurnStatus = typeof TurnStatusSchema.Type

export const ThreadSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  projectID: Schema.NullOr(Schema.String),
  settings: ThreadSettingsSchema,
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
  settings: ThreadSettingsSchema,
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
  rootAgentId: Schema.String,
  canContinueFromPlan: Schema.Boolean,
  mergedInputIDs: Schema.Array(Schema.String),
  queuePosition: Schema.optional(Schema.NullOr(Schema.Number)),
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
  agentId: Schema.String,
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
  agentId: Schema.String,
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
  agentId: Schema.String,
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
  agentId: Schema.String,
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
  agentId: Schema.String,
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
  agentId: Schema.String,
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
  agentId: Schema.String,
  type: Schema.Literal("patch"),
  files: Schema.Array(EditedFileSchema),
  totalAdditions: Schema.Number,
  totalDeletions: Schema.Number,
  createdAt: Schema.Number,
})
export type PatchItem = typeof PatchItemSchema.Type

export const SubagentItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal("subagent"),
  subagentTaskId: Schema.String,
  runId: Schema.String,
  childThreadId: Schema.String,
  displayName: Schema.String,
  profile: SubagentProfileSchema,
  task: Schema.String,
  status: SubagentStatusSchema,
  queueReason: SubagentQueueReasonSchema,
  result: Schema.NullOr(SubagentResultSchema),
  createdAt: Schema.Number,
})
export type SubagentItem = typeof SubagentItemSchema.Type

export const ItemSchema = Schema.Union([
  TextItemSchema,
  ReasoningItemSchema,
  ActivityItemSchema,
  ToolItemSchema,
  PlanItemSchema,
  QuestionItemSchema,
  PatchItemSchema,
  SubagentItemSchema,
])
export type Item = typeof ItemSchema.Type

export const ApprovalRequestSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
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

export const AttachmentSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["text", "image"]),
  name: Schema.String,
  mediaType: Schema.String,
  sizeBytes: Schema.Number,
  sha256: Schema.String,
  createdAt: Schema.Number,
})
export type Attachment = typeof AttachmentSchema.Type

export const TurnStartParamsSchema = Schema.Struct({
  threadId: Schema.String,
  content: Schema.String,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  strategy: Schema.optional(SendStrategySchema),
  taskMode: TaskModeSchema,
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
})
export type TurnStartParams = typeof TurnStartParamsSchema.Type

export const MutationMetaSchema = Schema.Struct({
  operationId: Schema.String,
  expectedVersion: Schema.optional(Schema.Number),
})
export type MutationMeta = typeof MutationMetaSchema.Type

export const QueuePauseReasonSchema = Schema.NullOr(Schema.Literals(["interrupted", "turn_failed"]))
export type QueuePauseReason = typeof QueuePauseReasonSchema.Type

export const QueueUpdateParamsSchema = Schema.Struct({
  threadId: Schema.String,
  inputId: Schema.String,
  content: Schema.String,
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
  ...MutationMetaSchema.fields,
})
export type QueueUpdateParams = typeof QueueUpdateParamsSchema.Type

export const QueueInputParamsSchema = Schema.Struct({
  threadId: Schema.String,
  inputId: Schema.String,
  ...MutationMetaSchema.fields,
})
export type QueueInputParams = typeof QueueInputParamsSchema.Type

export const QueueReorderParamsSchema = Schema.Struct({
  threadId: Schema.String,
  inputIds: Schema.Array(Schema.String),
  ...MutationMetaSchema.fields,
})
export type QueueReorderParams = typeof QueueReorderParamsSchema.Type

export const QueueResumeParamsSchema = Schema.Struct({
  threadId: Schema.String,
  ...MutationMetaSchema.fields,
})
export type QueueResumeParams = typeof QueueResumeParamsSchema.Type

export const QueueStateResultSchema = Schema.Struct({
  threadId: Schema.String,
  version: Schema.Number,
  pauseReason: QueuePauseReasonSchema,
  turns: Schema.Array(TurnSchema),
  inputs: Schema.Array(InputSchema),
  streamPosition: Schema.Struct({
    streamId: Schema.String,
    sequence: Schema.Number,
  }),
})
export type QueueStateResult = typeof QueueStateResultSchema.Type

export const ApprovalRespondParamsSchema = Schema.Struct({
  approvalId: Schema.String,
  decision: Schema.Literals(["allow-once", "deny", "stop"]),
})
export type ApprovalRespondParams = typeof ApprovalRespondParamsSchema.Type

export const ThreadSnapshotSchema = Schema.Struct({
  thread: ThreadSchema,
  turns: Schema.Array(TurnSchema),
  agents: Schema.Array(AgentExecutionSchema),
  subagents: Schema.Array(SubagentProjectionSchema),
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  items: Schema.Array(ItemSchema),
  approvals: Schema.Array(ApprovalRequestSchema),
  queue: Schema.optional(Schema.Struct({
    version: Schema.Number,
    pauseReason: QueuePauseReasonSchema,
  })),
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
  "prompt/preview",
  "prompt/refresh",
  "thread/compact",
  "thread/update",
  "thread/settings/update",
  "thread/delete",
  "turn/start",
  "turn/interrupt",
  "turn/resume",
  "queue/update",
  "queue/remove",
  "queue/reorder",
  "queue/steer",
  "queue/resume",
  "turn/submitPlanDecision",
  "approval/respond",
  "hook/trust/respond",
  "sandbox/status",
  "sandbox/install",
  "sandbox/repair",
  "sandbox/uninstall",
  "question/respond",
  "attachment/import",
  "attachment/read",
  "memory/list",
  "memory/read",
  "memory/save",
  "memory/delete",
  "memory/reset",
  "subagent/list",
  "subagent/read",
  "subagent/send",
  "subagent/stop",
  "subagent/retry",
  "subagent/worktree/diff",
  "subagent/worktree/apply",
  "subagent/worktree/discard",
  "subagent/workspace/restore",
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
  "thread/settings/updated",
  "thread/prompt-settings/updated",
  "thread/deleted",
  "turn/queued",
  "turn/started",
  "turn/statusChanged",
  "turn/completed",
  "turn/failed",
  "turn/interrupted",
  "agent/upserted",
  "subagent/created",
  "subagent/updated",
  "subagent/workspaceUpdated",
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
  "approval/cancelled",
  "question/requested",
  "serverRequest/resolved",
  "context/compacted",
  "context/recoveryRequired",
  "hook/trust/requested",
  "hook/trust/resolved",
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
