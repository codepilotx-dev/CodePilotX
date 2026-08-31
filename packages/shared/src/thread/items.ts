import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"
import {
  AdditionalPermissionsSchema,
  PermissionConfigSchema,
  PermissionGrantScopeSchema,
  RiskCategorySchema,
  ShellInputSchema,
  ShellReviewSchema,
} from "./permission"
import { TaskModeSchema } from "./settings"
import {
  AgentExecutionSchema,
  SubagentProfileSchema,
  SubagentQueueReasonSchema,
  SubagentResultSchema,
  SubagentStatusSchema,
} from "./subagent"
import { TurnSchema } from "./schema"

export const InputDeliverySchema = Schema.Literals(["start", "steer", "follow-up"])
export type InputDelivery = typeof InputDeliverySchema.Type

export const InputSchema = Schema.Struct({
  id: Schema.String,
  threadId: Schema.String,
  turnId: Schema.NullOr(Schema.String),
  content: Schema.String,
  delivery: InputDeliverySchema,
  mode: TaskModeSchema,
  model: Model.Ref,
  permissionConfig: PermissionConfigSchema,
  attachmentIds: Schema.optional(Schema.Array(Schema.String)),
  contextReferenceIds: Schema.optional(Schema.Array(Schema.String)),
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

/** Rich tool-result block projected from any provider protocol. */
export const ToolResultBlockSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("citation"),
    title: Schema.optional(Schema.String),
    url: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("json"),
    value: Schema.Json,
  }),
  Schema.Struct({
    type: Schema.Literal("artifact"),
    artifactId: Schema.String,
    name: Schema.String,
    mimeType: Schema.String,
    size: Schema.optional(Schema.Number),
  }),
])
export type ToolResultBlock = typeof ToolResultBlockSchema.Type

export const ToolCompletionMetadataSchema = Schema.Struct({
  stopReason: Schema.optional(Schema.String),
  inputTokens: Schema.optional(Schema.Number),
  outputTokens: Schema.optional(Schema.Number),
  totalTokens: Schema.optional(Schema.Number),
})
export type ToolCompletionMetadata = typeof ToolCompletionMetadataSchema.Type

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

export const ModelUsageSchema = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  contextWindow: Schema.Number,
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  reasoning: Schema.Number,
})
export type ModelUsage = typeof ModelUsageSchema.Type

export const TextItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal("text"),
  placement: Schema.Literals(["process", "result"]),
  text: Schema.String,
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  usage: Schema.optional(ModelUsageSchema),
  /** Safe completion metadata reported by the provider for this response. */
  completion: Schema.optional(ToolCompletionMetadataSchema),
  ordinal: Schema.optional(Schema.Number),
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
  ordinal: Schema.optional(Schema.Number),
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
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ActivityItem = typeof ActivityItemSchema.Type

export const ToolActivityTargetSchema = Schema.Struct({
  displayLabel: Schema.String,
  workspacePath: Schema.optional(Schema.String),
})
export type ToolActivityTarget = typeof ToolActivityTargetSchema.Type

export const ToolActivityFileChangeSchema = Schema.Struct({
  path: Schema.String,
  operation: Schema.Literals(["write", "create", "update", "delete"]),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
})
export type ToolActivityFileChange = typeof ToolActivityFileChangeSchema.Type

/** Presentation-neutral semantic activity projected for tool timelines. */
export const ToolActivityDescriptorSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("read"),
    subject: Schema.Literals(["file", "skill"]),
    target: Schema.optional(ToolActivityTargetSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("search"),
    query: Schema.optional(Schema.String),
    path: Schema.optional(ToolActivityTargetSchema),
    filesOnly: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    type: Schema.Literal("list_files"),
    path: Schema.optional(ToolActivityTargetSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("file_change"),
    changes: Schema.Array(ToolActivityFileChangeSchema),
  }),
  Schema.Struct({
    type: Schema.Literal("command"),
    kind: Schema.Literals([
      "generic",
      "format",
      "test",
      "lint",
      "noop",
      "current_time",
      "skill_script",
    ]),
    skillName: Schema.optional(Schema.String),
    scriptName: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("web_search") }),
  Schema.Struct({
    type: Schema.Literal("integration"),
    source: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    mode: Schema.Literals(["search", "load", "call"]),
    name: Schema.optional(Schema.String),
  }),
])
export type ToolActivityDescriptor = typeof ToolActivityDescriptorSchema.Type

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
  activity: Schema.optional(ToolActivityDescriptorSchema),
  mutationDiffPaths: Schema.optional(Schema.Array(Schema.String)),
  resultBlocks: Schema.optional(Schema.Array(ToolResultBlockSchema)),
  ordinal: Schema.optional(Schema.Number),
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
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type PlanItem = typeof PlanItemSchema.Type

export const ExecutionPlanStepSchema = Schema.Struct({
  step: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
})
export type ExecutionPlanStep = typeof ExecutionPlanStepSchema.Type

export const ExecutionPlanItemSchema = Schema.Struct({
  id: Schema.String,
  messageID: Schema.String,
  turnId: Schema.String,
  agentId: Schema.String,
  type: Schema.Literal("execution-plan"),
  explanation: Schema.optional(Schema.String),
  steps: Schema.Array(ExecutionPlanStepSchema),
  status: Schema.Literals(["streaming", "completed", "interrupted"]),
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type ExecutionPlanItem = typeof ExecutionPlanItemSchema.Type

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
  ordinal: Schema.optional(Schema.Number),
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
  reversible: Schema.optional(Schema.Boolean),
  applyState: Schema.optional(Schema.Literals(["applied", "undone"])),
  actionVersion: Schema.optional(Schema.Number),
  ordinal: Schema.optional(Schema.Number),
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
  ordinal: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
})
export type SubagentItem = typeof SubagentItemSchema.Type

export const ItemSchema = Schema.Union([
  TextItemSchema,
  ReasoningItemSchema,
  ActivityItemSchema,
  ToolItemSchema,
  PlanItemSchema,
  ExecutionPlanItemSchema,
  QuestionItemSchema,
  PatchItemSchema,
  SubagentItemSchema,
])
export type Item = typeof ItemSchema.Type

export const ToolAffectedPathSchema = Schema.Struct({
  path: Schema.String,
  operation: Schema.Literals(["create", "update"]),
})
export type ToolAffectedPath = typeof ToolAffectedPathSchema.Type

export const ToolReviewSummarySchema = Schema.Struct({
  fileCount: Schema.Number,
  hunkCount: Schema.Number,
  additions: Schema.Number,
  deletions: Schema.Number,
})
export type ToolReviewSummary = typeof ToolReviewSummarySchema.Type

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
  affectedPaths: Schema.optional(Schema.Array(ToolAffectedPathSchema)),
  reviewSummary: Schema.optional(ToolReviewSummarySchema),
  requestedPermissions: AdditionalPermissionsSchema,
  review: Schema.NullOr(ShellReviewSchema),
  risk: Schema.Literals(["low", "medium", "high", "critical"]),
  reason: Schema.String,
  status: Schema.Literals(["pending", "allowed", "denied", "cancelled"]),
  createdAt: Schema.Number,
  // Optional dynamic permission-grant metadata for request_permissions; the
  // plain approval structure above stays untouched for ordinary approvals.
  permissionGrant: Schema.optional(Schema.Struct({
    requestedScope: PermissionGrantScopeSchema,
    allowedScopes: Schema.Array(PermissionGrantScopeSchema)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(3)),
  })),
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

export const LocalContextReferenceSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  kind: Schema.Literals(["file", "directory"]),
  status: Schema.Literals(["available", "missing"]),
  createdAt: Schema.Number,
})
export type LocalContextReference = typeof LocalContextReferenceSchema.Type

export const ThreadTurnBundleSchema = Schema.Struct({
  turn: TurnSchema,
  inputs: Schema.Array(InputSchema),
  messages: Schema.Array(MessageSchema),
  agents: Schema.Array(AgentExecutionSchema),
  items: Schema.Array(ItemSchema),
  approvals: Schema.Array(ApprovalRequestSchema),
  attachments: Schema.Array(AttachmentSchema),
  contextReferences: Schema.optional(Schema.Array(LocalContextReferenceSchema)),
})
export type ThreadTurnBundle = typeof ThreadTurnBundleSchema.Type
