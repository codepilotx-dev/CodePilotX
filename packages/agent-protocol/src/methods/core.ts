import { Model } from "@codepilotx/model-schema"
import { AgentThread } from "@codepilotx/shared"
import { Schema } from "effect"
import { defineMethod, type MethodMap } from "../wire/definition"
import {
  AdmissionSchema,
  CapabilityListSchema,
  CapabilitySchema,
  CursorSchema,
  EmptyParamsSchema,
  JsonValueSchema,
  LimitSchema,
  MutationMetaSchema,
  OkResultSchema,
  OpaqueIDSchema,
  OperationParamsSchema,
  SequenceSchema,
  StreamPositionSchema,
  TimestampSchema,
} from "../wire/primitives"

const CommonErrors = ["RATE_LIMITED", "INTERNAL_ERROR"] as const
const InitializationErrors = ["PROTOCOL_VERSION_UNSUPPORTED", "CAPABILITY_REQUIRED", "UNAUTHORIZED", ...CommonErrors] as const
const SubscriptionErrors = ["CURSOR_EXPIRED", "SUBSCRIPTION_NOT_FOUND", "SUBSCRIPTION_OVERFLOW", "CAPABILITY_REQUIRED", ...CommonErrors] as const
const InteractionErrors = ["REQUEST_NOT_PENDING", "CONFLICT", "CHECKPOINT_UNAVAILABLE", "CAPABILITY_REQUIRED", ...CommonErrors] as const
const ProjectErrors = ["PROJECT_NOT_FOUND", "PATH_DENIED", "CONFLICT", ...CommonErrors] as const
const WorkspaceFileErrors = ["PROJECT_NOT_FOUND", "PATH_DENIED", "FILE_NOT_FOUND", "FILE_NOT_TEXT", "FILE_TOO_LARGE", "FILE_READONLY", "CONFLICT", ...CommonErrors] as const
const ThreadErrors = ["THREAD_NOT_FOUND", "TURN_NOT_FOUND", "CONFLICT", "CHECKPOINT_UNAVAILABLE", "MODEL_UNAVAILABLE", ...CommonErrors] as const
const SandboxErrors = ["SANDBOX_UNAVAILABLE", "SANDBOX_BUSY", "PERMISSION_DENIED", "CONFLICT", ...CommonErrors] as const
const AttachmentErrors = ["ATTACHMENT_NOT_FOUND", "ATTACHMENT_LIMIT", "PERMISSION_DENIED", ...CommonErrors] as const
const MemoryErrors = ["MEMORY_NOT_FOUND", "MEMORY_REJECTED", "PERMISSION_DENIED", ...CommonErrors] as const

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const ApprovalFeedbackSchema = Schema.String.check(Schema.isMaxLength(4_000))
const NonNegativeIntSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const NonNegativeNumberSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const PositiveIntSchema = Schema.Int.check(Schema.isGreaterThan(0))
const NullableCursorSchema = Schema.NullOr(CursorSchema)

export const ClientInfoSchema = Schema.Struct({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
  platform: Schema.optional(NonEmptyStringSchema),
  instanceId: Schema.optional(OpaqueIDSchema),
})

export const InitializeParamsSchema = Schema.Struct({
  clientInfo: ClientInfoSchema,
  protocols: Schema.Array(NonEmptyStringSchema),
  capabilities: CapabilityListSchema,
  interactionDelivery: Schema.Literals(["active", "observe"]),
})

export const InitializeResultSchema = Schema.Struct({
  protocol: Schema.Literal("thread-rpc-v4"),
  serverInfo: Schema.Struct({
    name: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
  }),
  capabilities: CapabilityListSchema,
  limits: Schema.Struct({
    maxFrameBytes: PositiveIntSchema,
    maxSubscriptions: PositiveIntSchema,
    maxStreamsPerSubscription: PositiveIntSchema,
    maxPendingRequests: PositiveIntSchema,
  }),
  connectionId: OpaqueIDSchema,
})

export const ShutdownResultSchema = Schema.Struct({
  ok: Schema.Literal(true),
  acceptedAt: TimestampSchema,
})

export const StreamCursorSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  after: Schema.Union([SequenceSchema, Schema.Literal("latest")]),
})

export const EventSubscribeParamsSchema = Schema.Struct({
  streams: Schema.Array(StreamCursorSchema),
  liveEventTypes: Schema.optional(Schema.Array(NonEmptyStringSchema)),
})

export const SubscriptionPositionSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  sequence: SequenceSchema,
})

export const EventSubscribeResultSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  highWatermarks: Schema.Array(SubscriptionPositionSchema),
})

export const EventAckParamsSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  positions: Schema.Array(SubscriptionPositionSchema),
})

export const EventAckResultSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
  acknowledged: Schema.Array(SubscriptionPositionSchema),
})

export const EventUnsubscribeParamsSchema = Schema.Struct({
  subscriptionId: OpaqueIDSchema,
})

export const InteractionKindSchema = Schema.Literals(["approval", "question", "plan", "hookTrust"])
export const InteractionStateSchema = Schema.Literals(["pending", "resolved", "cancelled", "expired"])

const InteractionMetadataFields = {
  interactionId: OpaqueIDSchema,
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  agentId: OpaqueIDSchema,
  createdAt: TimestampSchema,
  version: SequenceSchema,
}

export const PendingApprovalInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal("approval"),
  toolCallId: OpaqueIDSchema,
  tool: NonEmptyStringSchema,
  risk: Schema.Literals(["low", "medium", "high", "critical"]),
  reason: NonEmptyStringSchema,
  command: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
  requestedPermissions: AgentThread.AdditionalPermissionsSchema,
  allowedChoices: Schema.Array(Schema.Literals(["allow-once", "deny", "stop"])),
})

export const InteractionQuestionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  header: Schema.optional(Schema.String),
  prompt: NonEmptyStringSchema,
  choices: Schema.Array(AgentThread.QuestionChoiceSchema),
  allowFreeform: Schema.Boolean,
  required: Schema.Boolean,
  minAnswers: Schema.optional(NonNegativeIntSchema),
  maxAnswers: Schema.optional(PositiveIntSchema),
})

export const PendingQuestionInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal("question"),
  questions: Schema.Array(InteractionQuestionSchema),
})

export const PendingPlanInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal("plan"),
  title: NonEmptyStringSchema,
  markdown: NonEmptyStringSchema,
})

export const PendingHookTrustInteractionSchema = Schema.Struct({
  ...InteractionMetadataFields,
  kind: Schema.Literal("hookTrust"),
  configPath: NonEmptyStringSchema,
  sha256: NonEmptyStringSchema,
  hook: Schema.Struct({
    id: OpaqueIDSchema,
    name: NonEmptyStringSchema,
    event: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
  }),
})

export const PendingInteractionSchema = Schema.Union([
  PendingApprovalInteractionSchema,
  PendingQuestionInteractionSchema,
  PendingPlanInteractionSchema,
  PendingHookTrustInteractionSchema,
])

export const InteractionListPendingParamsSchema = Schema.Struct({
  threadId: Schema.optional(OpaqueIDSchema),
  kinds: Schema.optional(Schema.Array(InteractionKindSchema)),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const InteractionListPendingResultSchema = Schema.Struct({
  interactions: Schema.Array(PendingInteractionSchema),
  nextCursor: NullableCursorSchema,
})

export const ApprovalInteractionResponseSchema = Schema.Struct({
  kind: Schema.Literal("approval"),
  decision: Schema.Literals(["allow-once", "deny", "stop"]),
  feedback: Schema.optional(ApprovalFeedbackSchema),
  remember: Schema.optional(Schema.Struct({
    scope: Schema.Literals(["command", "tool", "workspace"]),
    value: NonEmptyStringSchema,
  })),
})

export const QuestionInteractionResponseSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("question"),
    status: Schema.Literal("answered"),
    answers: Schema.Array(Schema.Struct({
      questionId: OpaqueIDSchema,
      choiceIds: Schema.Array(OpaqueIDSchema),
      text: Schema.optional(Schema.String),
    })),
  }),
  Schema.Struct({ kind: Schema.Literal("question"), status: Schema.Literal("ignored") }),
])

export const PlanInteractionResponseSchema = Schema.Struct({
  kind: Schema.Literal("plan"),
  decision: Schema.Literals(["continue", "reject"]),
})

export const HookTrustInteractionResponseSchema = Schema.Struct({
  kind: Schema.Literal("hookTrust"),
  decision: Schema.Literals(["allow", "block"]),
})

export const InteractionResponseSchema = Schema.Union([
  ApprovalInteractionResponseSchema,
  QuestionInteractionResponseSchema,
  PlanInteractionResponseSchema,
  HookTrustInteractionResponseSchema,
])

export const InteractionRespondParamsSchema = Schema.Struct({
  interactionId: OpaqueIDSchema,
  expectedVersion: SequenceSchema,
  response: InteractionResponseSchema,
  operationId: OpaqueIDSchema,
})

export const InteractionRespondResultSchema = Schema.Struct({
  interactionId: OpaqueIDSchema,
  kind: InteractionKindSchema,
  state: InteractionStateSchema,
  version: SequenceSchema,
  resolvedAt: TimestampSchema,
  response: InteractionResponseSchema,
})

export const ProjectListParamsSchema = Schema.Struct({
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const ProjectListResultSchema = Schema.Struct({
  projects: Schema.Array(AgentThread.ProjectSchema),
  nextCursor: NullableCursorSchema,
})

export const ProjectOpenParamsSchema = Schema.Struct({
  rootPath: NonEmptyStringSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectOpenResultSchema = Schema.Struct({ project: AgentThread.ProjectSchema })

export const ProjectSettingsPatchSchema = Schema.Struct({
  defaultModel: Schema.optional(Schema.NullOr(Model.Ref)),
})

export const ProjectSettingsUpdateParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  settings: ProjectSettingsPatchSchema,
  ...OperationParamsSchema.fields,
})

export const ProjectSettingsUpdateResultSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  settings: AgentThread.ProjectSettingsSchema,
  version: SequenceSchema,
})

export const WorkspaceFileRevisionSchema = Schema.Struct({
  mtimeMs: NonNegativeNumberSchema,
  sha256: NonEmptyStringSchema,
})

export const WorkspaceFileListParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  path: Schema.String,
})

export const WorkspaceFileListResultSchema = Schema.Struct({
  entries: Schema.Array(Schema.Struct({
    name: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    type: Schema.Literals(["file", "directory"]),
    depth: NonNegativeIntSchema,
  })),
})

export const WorkspaceFileReadParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
})

export const WorkspaceFileReadResultSchema = Schema.Struct({
  path: NonEmptyStringSchema,
  content: Schema.String,
  sizeBytes: NonNegativeIntSchema,
  readonly: Schema.Boolean,
  truncated: Schema.Literal(false),
  revision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileSaveParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
  content: Schema.String,
  expectedRevision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileSaveResultSchema = Schema.Struct({
  outcome: Schema.Literals(["saved", "conflict"]),
  revision: WorkspaceFileRevisionSchema,
})

export const WorkspaceFileWatchParamsSchema = Schema.Struct({
  projectId: OpaqueIDSchema,
  path: NonEmptyStringSchema,
})

export const WorkspaceFileWatchResultSchema = Schema.Struct({
  watching: Schema.Boolean,
  path: NonEmptyStringSchema,
})

export const ThreadListParamsSchema = Schema.Struct({
  projectId: Schema.optional(OpaqueIDSchema),
  archived: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const ThreadListResultSchema = Schema.Struct({
  threads: Schema.Array(AgentThread.ThreadListItemSchema),
  nextCursor: NullableCursorSchema,
})

export const ThreadCreateWorkspaceSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("project"), projectId: OpaqueIDSchema }),
  Schema.Struct({
    kind: Schema.Literal("projectless"),
    prompt: Schema.optional(Schema.String),
  }),
])

const ThreadCreateFields = {
  title: Schema.optional(Schema.String),
  settings: Schema.optional(AgentThread.ThreadSettingsSchema),
  ...OperationParamsSchema.fields,
}

export const ThreadCreateParamsSchema = Schema.Struct({
  workspace: ThreadCreateWorkspaceSchema,
  ...ThreadCreateFields,
})

export const ThreadSnapshotResultSchema = Schema.Struct({
  snapshot: AgentThread.ThreadSnapshotSchema,
  streamPosition: StreamPositionSchema,
})

export const ThreadReadParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })

const ThreadHistoryLimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))

export const ThreadHistoryReadParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  before: Schema.optional(CursorSchema),
  limit: Schema.optional(ThreadHistoryLimitSchema),
})

export const ThreadHistoryPageResultSchema = Schema.Struct({
  thread: AgentThread.ThreadSchema,
  subagents: Schema.Array(AgentThread.SubagentProjectionSchema),
  turns: Schema.Array(AgentThread.ThreadTurnBundleSchema),
  queue: Schema.Struct({
    version: SequenceSchema,
    pauseReason: AgentThread.QueuePauseReasonSchema,
    turns: Schema.Array(AgentThread.TurnSchema),
    inputs: Schema.Array(AgentThread.InputSchema),
  }),
  olderCursor: Schema.NullOr(CursorSchema),
  hasOlder: Schema.Boolean,
  streamPosition: StreamPositionSchema,
})

export const ThreadUpdateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  patch: Schema.Struct({
    title: Schema.optional(Schema.String),
    archived: Schema.optional(Schema.Boolean),
  }),
  ...MutationMetaSchema.fields,
})

export const ThreadUpdateResultSchema = Schema.Struct({ thread: AgentThread.ThreadListItemSchema })

export const ThreadSettingsUpdateParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: AgentThread.ThreadSettingsPatchSchema,
  ...MutationMetaSchema.fields,
})

export const ThreadSettingsUpdateResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: AgentThread.ThreadSettingsSchema,
  version: SequenceSchema,
})

export const ThreadDeleteParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const ThreadDeleteResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  deletedAt: TimestampSchema,
})

export const PromptSourceSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("builtin"), name: NonEmptyStringSchema }),
  Schema.Struct({ type: Schema.Literal("setting"), name: NonEmptyStringSchema }),
  Schema.Struct({ type: Schema.Literal("file"), path: NonEmptyStringSchema, scope: Schema.optional(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("runtime"), name: NonEmptyStringSchema }),
])

export const PromptRoleSchema = Schema.Literals(["system", "developer", "contextual-user"])
export const PromptCacheClassSchema = Schema.Literals(["global-stable", "session-stable", "dynamic"])
export const PromptAuthoritySchema = Schema.Literals(["builtin", "user", "project", "memory", "external-data"])

export const PromptSectionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  role: PromptRoleSchema,
  cache: PromptCacheClassSchema,
  authority: PromptAuthoritySchema,
  source: PromptSourceSchema,
  content: Schema.String,
  modes: Schema.optional(Schema.Array(AgentThread.TaskModeSchema)),
  profiles: Schema.optional(Schema.Array(AgentThread.SubagentProfileSchema)),
  requiredTools: Schema.optional(Schema.Array(NonEmptyStringSchema)),
})

export const PromptSectionDiagnosticSchema = Schema.Struct({
  id: OpaqueIDSchema,
  role: PromptRoleSchema,
  cache: PromptCacheClassSchema,
  authority: PromptAuthoritySchema,
  source: PromptSourceSchema,
  hash: NonEmptyStringSchema,
  bytes: NonNegativeIntSchema,
  estimatedTokens: NonNegativeIntSchema,
  included: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(["empty", "mode", "profile", "required-tools"])),
})

export const PromptCacheSegmentSchema = Schema.Struct({
  index: NonNegativeIntSchema,
  cache: PromptCacheClassSchema,
  role: Schema.Literals(["instructions", "context"]),
  sectionIds: Schema.Array(OpaqueIDSchema),
  content: Schema.String,
  hash: NonEmptyStringSchema,
  start: NonNegativeIntSchema,
  end: NonNegativeIntSchema,
  cacheable: Schema.Boolean,
})

export const PromptCacheBoundarySchema = Schema.Struct({
  segmentIndex: NonNegativeIntSchema,
  cache: Schema.Literals(["global-stable", "session-stable"]),
  offset: NonNegativeIntSchema,
  hash: NonEmptyStringSchema,
})

export const PromptCacheCapabilitySchema = Schema.Union([
  Schema.Struct({ provider: Schema.Literal("openai"), strategy: Schema.Literal("prompt-cache-key") }),
  Schema.Struct({ provider: Schema.Literal("anthropic"), strategy: Schema.Literal("explicit-ephemeral"), maxBreakpoints: PositiveIntSchema }),
  Schema.Struct({ provider: Schema.Literal("other"), strategy: Schema.Literal("stable-prefix") }),
])

export const PromptContextFragmentSchema = Schema.Struct({
  id: OpaqueIDSchema,
  kind: Schema.Literals(["mode", "permission", "settings", "project", "skill", "memory", "subagent", "plan"]),
  version: SequenceSchema,
  hash: NonEmptyStringSchema,
  payload: JsonValueSchema,
  createdAt: TimestampSchema,
})

export const PromptBaselineSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  baselineVersion: SequenceSchema,
  promptVersion: NonEmptyStringSchema,
  baseHash: NonEmptyStringSchema,
  contextHash: NonEmptyStringSchema,
  cacheKey: NonEmptyStringSchema,
  fragments: Schema.Array(PromptContextFragmentSchema),
  contextWindowTokens: NonNegativeIntSchema,
  usageTokens: NonNegativeIntSchema,
  usageSource: Schema.Literals(["measured", "estimated", "compaction-estimate"]),
  usageSampleId: Schema.NullOr(OpaqueIDSchema),
  needsCompaction: Schema.Boolean,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

export const PromptPreviewSchema = Schema.Struct({
  instructions: Schema.String,
  contextItems: Schema.Array(JsonValueSchema),
  diagnostics: Schema.Array(PromptSectionDiagnosticSchema),
  cacheSegments: Schema.Array(PromptCacheSegmentSchema),
  cacheBoundaries: Schema.Array(PromptCacheBoundarySchema),
  baseHash: NonEmptyStringSchema,
  contextHash: NonEmptyStringSchema,
  cacheHash: NonEmptyStringSchema,
  cacheKey: NonEmptyStringSchema,
  cacheMode: PromptCacheCapabilitySchema,
  sections: Schema.Array(PromptSectionSchema),
  baseline: Schema.NullOr(PromptBaselineSchema),
})

export const PromptPreviewParamsSchema = Schema.Struct({ threadId: OpaqueIDSchema })
export const PromptPreviewResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  preview: PromptPreviewSchema,
  cacheKey: NonEmptyStringSchema,
})

export const PromptSettingsSchema = Schema.Struct({
  systemPrompt: Schema.optional(Schema.String),
  personality: Schema.optional(Schema.String),
  customInstructions: Schema.optional(Schema.String),
  appendPrompt: Schema.optional(Schema.String),
  appendSystemPrompt: Schema.optional(Schema.String),
  enableMemory: Schema.optional(Schema.Boolean),
  defaultModeRequestUserInput: Schema.optional(Schema.Boolean),
})

export const PromptSettingsSnapshotSchema = Schema.Struct({
  engine: Schema.Literal("prompt-engine-v2"),
  version: Schema.Literal(2),
  snapshottedAt: TimestampSchema,
  settings: PromptSettingsSchema,
})

export const PromptRefreshParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const PromptRefreshResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  settings: PromptSettingsSnapshotSchema,
  cacheKey: NonEmptyStringSchema,
})

export const CompactionSchema = Schema.Struct({
  id: OpaqueIDSchema,
  beforeCount: NonNegativeIntSchema,
  afterCount: NonNegativeIntSchema,
  beforeTokens: NonNegativeIntSchema,
  afterTokens: NonNegativeIntSchema,
  targetTokens: NonNegativeIntSchema,
  usageSampleId: OpaqueIDSchema,
  baselineVersion: SequenceSchema,
})

export const ThreadCompactParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})
export const ThreadCompactResultSchema = Schema.Struct({ compaction: CompactionSchema })

const TurnContentFields = {
  content: NonEmptyStringSchema,
  attachmentIds: Schema.optional(Schema.Array(OpaqueIDSchema)),
}

export const TurnStartParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
  model: Model.Ref,
  permissionConfig: AgentThread.PermissionConfigSchema,
  taskMode: AgentThread.TaskModeSchema,
})

export const TurnSteerParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
})

export const QueuePauseReasonSchema = Schema.NullOr(Schema.Literals(["interrupted", "turn_failed"]))

const QueueMutationFields = {
  threadId: OpaqueIDSchema,
  ...MutationMetaSchema.fields,
}

export const QueueUpdateParamsSchema = Schema.Struct({
  ...QueueMutationFields,
  inputId: OpaqueIDSchema,
  ...TurnContentFields,
})

export const QueueInputParamsSchema = Schema.Struct({
  ...QueueMutationFields,
  inputId: OpaqueIDSchema,
})

export const QueueReorderParamsSchema = Schema.Struct({
  ...QueueMutationFields,
  inputIds: Schema.Array(OpaqueIDSchema),
})

export const QueueResumeParamsSchema = Schema.Struct(QueueMutationFields)

export const QueueStateResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  version: SequenceSchema,
  pauseReason: QueuePauseReasonSchema,
  turns: Schema.Array(AgentThread.TurnSchema),
  inputs: Schema.Array(AgentThread.InputSchema),
  streamPosition: StreamPositionSchema,
})

export const TurnInterruptParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: Schema.optional(OpaqueIDSchema),
  ...OperationParamsSchema.fields,
})

export const TurnInterruptResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: Schema.optional(OpaqueIDSchema),
  status: AgentThread.TurnStatusSchema,
})

export const TurnResumeParamsSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  ...OperationParamsSchema.fields,
})

export const TurnResumeResultSchema = Schema.Struct({
  threadId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  status: AgentThread.TurnStatusSchema,
})

export const SandboxStateSchema = Schema.Literals(["unsupported", "not-installed", "installing", "available", "damaged", "repair-required"])
export const SandboxStatusSchema = Schema.Struct({
  state: SandboxStateSchema,
  platform: NonEmptyStringSchema,
  architecture: NonEmptyStringSchema,
  runtimeVersion: NonEmptyStringSchema,
  maturity: Schema.Literal("alpha"),
  maxConcurrentCommands: PositiveIntSchema,
  error: Schema.NullOr(Schema.String),
  operations: Schema.Struct({
    canInstall: Schema.Boolean,
    canRepair: Schema.Boolean,
    canUninstall: Schema.Boolean,
  }),
})
export const SandboxResultSchema = Schema.Struct({ sandbox: SandboxStatusSchema })
export const SandboxUninstallParamsSchema = Schema.Struct({
  confirm: Schema.Literal(true),
  ...OperationParamsSchema.fields,
})

export const AttachmentUploadSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literals(["utf8", "base64"]),
    data: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    name: NonEmptyStringSchema,
    mediaType: NonEmptyStringSchema,
    encoding: Schema.Literal("base64"),
    data: NonEmptyStringSchema,
  }),
])

export const AttachmentImportParamsSchema = Schema.Struct({
  uploads: Schema.Array(AttachmentUploadSchema),
  ...OperationParamsSchema.fields,
})
export const AttachmentImportResultSchema = Schema.Struct({
  attachments: Schema.Array(AgentThread.AttachmentSchema),
})

export const AttachmentReadParamsSchema = Schema.Struct({
  attachmentId: OpaqueIDSchema,
  range: Schema.optional(Schema.Struct({
    offset: NonNegativeIntSchema,
    length: PositiveIntSchema,
  })),
})

export const AttachmentReadResultSchema = Schema.Struct({
  attachment: AgentThread.AttachmentSchema,
  data: Schema.String,
  encoding: Schema.Literals(["utf8", "base64"]),
  range: Schema.Struct({
    offset: NonNegativeIntSchema,
    length: NonNegativeIntSchema,
    total: NonNegativeIntSchema,
  }),
})

export const MemoryScopeSchema = Schema.Literals(["user", "project"])
export const MemoryEntrySchema = Schema.Struct({
  id: OpaqueIDSchema,
  scope: MemoryScopeSchema,
  projectId: Schema.NullOr(OpaqueIDSchema),
  content: Schema.String,
  sourceThreadId: Schema.NullOr(OpaqueIDSchema),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
})

const UserMemoryScopeFields = { scope: Schema.Literal("user") }
const ProjectMemoryScopeFields = { scope: Schema.Literal("project"), projectId: OpaqueIDSchema }

export const MemoryListParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, cursor: Schema.optional(CursorSchema), limit: Schema.optional(LimitSchema) }),
  Schema.Struct({ ...ProjectMemoryScopeFields, cursor: Schema.optional(CursorSchema), limit: Schema.optional(LimitSchema) }),
])
export const MemoryListResultSchema = Schema.Struct({
  entries: Schema.Array(MemoryEntrySchema),
  nextCursor: NullableCursorSchema,
})

export const MemoryReadParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, id: OpaqueIDSchema }),
  Schema.Struct({ ...ProjectMemoryScopeFields, id: OpaqueIDSchema }),
])
export const MemoryReadResultSchema = Schema.Struct({ entry: MemoryEntrySchema })

export const MemorySaveParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, id: Schema.optional(OpaqueIDSchema), content: NonEmptyStringSchema, ...OperationParamsSchema.fields }),
  Schema.Struct({ ...ProjectMemoryScopeFields, id: Schema.optional(OpaqueIDSchema), content: NonEmptyStringSchema, ...OperationParamsSchema.fields }),
])
export const MemorySaveResultSchema = Schema.Struct({ entry: MemoryEntrySchema })

export const MemoryDeleteParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, id: OpaqueIDSchema, ...OperationParamsSchema.fields }),
  Schema.Struct({ ...ProjectMemoryScopeFields, id: OpaqueIDSchema, ...OperationParamsSchema.fields }),
])
export const MemoryDeleteResultSchema = Schema.Struct({ deleted: Schema.Boolean, id: OpaqueIDSchema })

export const MemoryResetParamsSchema = Schema.Union([
  Schema.Struct({ ...UserMemoryScopeFields, includeEventLog: Schema.Boolean, ...OperationParamsSchema.fields }),
  Schema.Struct({ ...ProjectMemoryScopeFields, includeEventLog: Schema.Boolean, ...OperationParamsSchema.fields }),
])
export const MemoryResetResultSchema = Schema.Struct({ deleted: NonNegativeIntSchema })

export const CoreRpcMethods = {
  initialize: defineMethod({ params: InitializeParamsSchema, result: InitializeResultSchema, errors: InitializationErrors, capability: null, mutation: false }),
  shutdown: defineMethod({ params: OperationParamsSchema, result: ShutdownResultSchema, errors: InitializationErrors, capability: "agent.shutdown.v1", mutation: true, exactParams: true }),
  "event/subscribe": defineMethod({ params: EventSubscribeParamsSchema, result: EventSubscribeResultSchema, errors: SubscriptionErrors, capability: "events.replay.v1", mutation: false }),
  "event/ack": defineMethod({ params: EventAckParamsSchema, result: EventAckResultSchema, errors: SubscriptionErrors, capability: "events.replay.v1", mutation: false }),
  "event/unsubscribe": defineMethod({ params: EventUnsubscribeParamsSchema, result: OkResultSchema, errors: SubscriptionErrors, capability: "events.replay.v1", mutation: false }),
  "interaction/listPending": defineMethod({ params: InteractionListPendingParamsSchema, result: InteractionListPendingResultSchema, errors: InteractionErrors, capability: "interaction.recovery.v1", mutation: false }),
  "interaction/respond": defineMethod({ params: InteractionRespondParamsSchema, result: InteractionRespondResultSchema, errors: InteractionErrors, capability: "interactions.serverRequests.v1", mutation: true, exactParams: true }),
  "project/list": defineMethod({ params: ProjectListParamsSchema, result: ProjectListResultSchema, errors: ProjectErrors, capability: null, mutation: false }),
  "project/open": defineMethod({ params: ProjectOpenParamsSchema, result: ProjectOpenResultSchema, errors: ProjectErrors, capability: null, mutation: true, exactParams: true }),
  "project/settings/update": defineMethod({ params: ProjectSettingsUpdateParamsSchema, result: ProjectSettingsUpdateResultSchema, errors: ProjectErrors, capability: null, mutation: true }),
  "workspace/file/list": defineMethod({ params: WorkspaceFileListParamsSchema, result: WorkspaceFileListResultSchema, errors: WorkspaceFileErrors, capability: "workspace.editor.v1", mutation: false, exactParams: true, exactResult: true }),
  "workspace/file/read": defineMethod({ params: WorkspaceFileReadParamsSchema, result: WorkspaceFileReadResultSchema, errors: WorkspaceFileErrors, capability: "workspace.editor.v1", mutation: false, exactParams: true, exactResult: true }),
  "workspace/file/save": defineMethod({ params: WorkspaceFileSaveParamsSchema, result: WorkspaceFileSaveResultSchema, errors: WorkspaceFileErrors, capability: "workspace.editor.v1", mutation: true, exactParams: true, exactResult: true }),
  "workspace/file/watch": defineMethod({ params: WorkspaceFileWatchParamsSchema, result: WorkspaceFileWatchResultSchema, errors: WorkspaceFileErrors, capability: "workspace.editor.v1", mutation: true, exactParams: true, exactResult: true }),
  "workspace/file/unwatch": defineMethod({ params: WorkspaceFileWatchParamsSchema, result: WorkspaceFileWatchResultSchema, errors: WorkspaceFileErrors, capability: "workspace.editor.v1", mutation: true, exactParams: true, exactResult: true }),
  "thread/list": defineMethod({ params: ThreadListParamsSchema, result: ThreadListResultSchema, errors: ThreadErrors, capability: null, mutation: false }),
  "thread/create": defineMethod({ params: ThreadCreateParamsSchema, result: ThreadSnapshotResultSchema, errors: ThreadErrors, capability: null, mutation: true }),
  "thread/read": defineMethod({ params: ThreadReadParamsSchema, result: ThreadSnapshotResultSchema, errors: ThreadErrors, capability: null, mutation: false }),
  "thread/history/read": defineMethod({ params: ThreadHistoryReadParamsSchema, result: ThreadHistoryPageResultSchema, errors: ThreadErrors, capability: null, mutation: false, exactParams: true, exactResult: true }),
  "thread/update": defineMethod({ params: ThreadUpdateParamsSchema, result: ThreadUpdateResultSchema, errors: ThreadErrors, capability: null, mutation: true }),
  "thread/settings/update": defineMethod({ params: ThreadSettingsUpdateParamsSchema, result: ThreadSettingsUpdateResultSchema, errors: ThreadErrors, capability: null, mutation: true }),
  "thread/delete": defineMethod({ params: ThreadDeleteParamsSchema, result: ThreadDeleteResultSchema, errors: ThreadErrors, capability: null, mutation: true }),
  "prompt/preview": defineMethod({ params: PromptPreviewParamsSchema, result: PromptPreviewResultSchema, errors: ThreadErrors, capability: "prompt.preview.sensitive.v1", mutation: false }),
  "prompt/refresh": defineMethod({ params: PromptRefreshParamsSchema, result: PromptRefreshResultSchema, errors: ThreadErrors, capability: "prompt.refresh.v1", mutation: true }),
  "thread/compact": defineMethod({ params: ThreadCompactParamsSchema, result: ThreadCompactResultSchema, errors: ThreadErrors, capability: "context.compact.v1", mutation: true, exactResult: true }),
  "turn/start": defineMethod({ params: TurnStartParamsSchema, result: AdmissionSchema, errors: ThreadErrors, capability: "turn.admission.v1", mutation: true, exactParams: true }),
  "turn/steer": defineMethod({ params: TurnSteerParamsSchema, result: AdmissionSchema, errors: ThreadErrors, capability: "turn.steer.v1", mutation: true, exactParams: true }),
  "turn/interrupt": defineMethod({ params: TurnInterruptParamsSchema, result: TurnInterruptResultSchema, errors: ThreadErrors, capability: null, mutation: true }),
  "turn/resume": defineMethod({ params: TurnResumeParamsSchema, result: TurnResumeResultSchema, errors: ThreadErrors, capability: "turn.resume.v1", mutation: true }),
  "queue/update": defineMethod({ params: QueueUpdateParamsSchema, result: QueueStateResultSchema, errors: ThreadErrors, capability: "turn.queue.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "queue/remove": defineMethod({ params: QueueInputParamsSchema, result: QueueStateResultSchema, errors: ThreadErrors, capability: "turn.queue.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "queue/reorder": defineMethod({ params: QueueReorderParamsSchema, result: QueueStateResultSchema, errors: ThreadErrors, capability: "turn.queue.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "queue/steer": defineMethod({ params: QueueInputParamsSchema, result: QueueStateResultSchema, errors: ThreadErrors, capability: "turn.queue.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "queue/resume": defineMethod({ params: QueueResumeParamsSchema, result: QueueStateResultSchema, errors: ThreadErrors, capability: "turn.queue.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "sandbox/status": defineMethod({ params: EmptyParamsSchema, result: SandboxResultSchema, errors: SandboxErrors, capability: "sandbox.management.v1", mutation: false, exactResult: true }),
  "sandbox/refresh": defineMethod({ params: EmptyParamsSchema, result: SandboxResultSchema, errors: SandboxErrors, capability: "sandbox.management.v1", mutation: false, exactResult: true }),
  "sandbox/install": defineMethod({ params: OperationParamsSchema, result: SandboxResultSchema, errors: SandboxErrors, capability: "sandbox.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "sandbox/repair": defineMethod({ params: OperationParamsSchema, result: SandboxResultSchema, errors: SandboxErrors, capability: "sandbox.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "sandbox/uninstall": defineMethod({ params: SandboxUninstallParamsSchema, result: SandboxResultSchema, errors: SandboxErrors, capability: "sandbox.management.v1", mutation: true, exactParams: true, exactResult: true }),
  "attachment/import": defineMethod({ params: AttachmentImportParamsSchema, result: AttachmentImportResultSchema, errors: AttachmentErrors, capability: "attachments.v1", mutation: true, exactParams: true }),
  "attachment/read": defineMethod({ params: AttachmentReadParamsSchema, result: AttachmentReadResultSchema, errors: AttachmentErrors, capability: "attachments.v1", mutation: false }),
  "memory/list": defineMethod({ params: MemoryListParamsSchema, result: MemoryListResultSchema, errors: MemoryErrors, capability: "memory.v2", mutation: false, exactResult: true }),
  "memory/read": defineMethod({ params: MemoryReadParamsSchema, result: MemoryReadResultSchema, errors: MemoryErrors, capability: "memory.v2", mutation: false, exactResult: true }),
  "memory/save": defineMethod({ params: MemorySaveParamsSchema, result: MemorySaveResultSchema, errors: MemoryErrors, capability: "memory.v2", mutation: true, exactParams: true, exactResult: true }),
  "memory/delete": defineMethod({ params: MemoryDeleteParamsSchema, result: MemoryDeleteResultSchema, errors: MemoryErrors, capability: "memory.v2", mutation: true, exactParams: true, exactResult: true }),
  "memory/reset": defineMethod({ params: MemoryResetParamsSchema, result: MemoryResetResultSchema, errors: MemoryErrors, capability: "memory.v2", mutation: true, exactParams: true, exactResult: true }),
} as const satisfies MethodMap

export type CoreRpcMethod = keyof typeof CoreRpcMethods
