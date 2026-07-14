import { Schema } from "effect"
import { ModelRefSchema, ProviderInfoSchema, ProviderSettingSchema } from "./model"
import {
  ProjectSchema,
  ProjectSettingsSchema,
  ProposalSchema,
  WorkflowStageSchema,
  InputSchema,
  MessageSchema,
  PartSchema,
  PermissionModeSchema,
  PermissionRequestSchema,
  QuestionRequestSchema,
  RunSchema,
  SendStrategySchema,
  SessionListItemSchema,
  SessionSnapshotSchema,
  TaskModeSchema,
} from "./session"

export const SubmitMessageSchema = Schema.Struct({
  content: Schema.String,
  model: ModelRefSchema,
  permissionMode: PermissionModeSchema,
  strategy: SendStrategySchema,
  taskMode: TaskModeSchema,
})
export type SubmitMessage = typeof SubmitMessageSchema.Type

export const CreateSessionRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.String),
  projectID: Schema.optional(Schema.String),
})
export type CreateSessionRequest = typeof CreateSessionRequestSchema.Type

export const CreateSessionResponseSchema = SessionSnapshotSchema
export type CreateSessionResponse = typeof CreateSessionResponseSchema.Type

export const ListSessionsResponseSchema = Schema.Struct({
  sessions: Schema.Array(SessionListItemSchema),
  nextCursor: Schema.NullOr(Schema.String),
})
export type ListSessionsResponse = typeof ListSessionsResponseSchema.Type

export const UpdateSessionRequestSchema = Schema.Struct({
  title: Schema.optional(Schema.NullOr(Schema.String)),
  archived: Schema.optional(Schema.Boolean),
})
export type UpdateSessionRequest = typeof UpdateSessionRequestSchema.Type

export const UpdateSessionResponseSchema = Schema.Struct({
  session: SessionListItemSchema,
})
export type UpdateSessionResponse = typeof UpdateSessionResponseSchema.Type

export const SessionMessagesResponseSchema = Schema.Struct({
  messages: Schema.Array(MessageSchema),
  parts: Schema.Array(PartSchema),
  nextCursor: Schema.NullOr(Schema.String),
})
export type SessionMessagesResponse = typeof SessionMessagesResponseSchema.Type

export const ProjectsResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectSchema),
})
export type ProjectsResponse = typeof ProjectsResponseSchema.Type

export const ProjectResponseSchema = Schema.Struct({
  project: ProjectSchema,
})
export type ProjectResponse = typeof ProjectResponseSchema.Type

export const CreateProjectRequestSchema = Schema.Struct({
  rootPath: Schema.String,
})
export type CreateProjectRequest = typeof CreateProjectRequestSchema.Type

export const UpdateProjectSettingsRequestSchema = Schema.Struct({
  settings: ProjectSettingsSchema,
})
export type UpdateProjectSettingsRequest = typeof UpdateProjectSettingsRequestSchema.Type

export const UpdateProposalReviewRequestSchema = Schema.Struct({
  status: Schema.Literals(["reviewed", "rejected"]),
})
export type UpdateProposalReviewRequest = typeof UpdateProposalReviewRequestSchema.Type

export const ProposalsResponseSchema = Schema.Struct({
  proposals: Schema.Array(ProposalSchema),
})
export type ProposalsResponse = typeof ProposalsResponseSchema.Type

export const SubmitMessageResponseSchema = Schema.Struct({
  input: InputSchema,
  run: Schema.NullOr(RunSchema),
})
export type SubmitMessageResponse = typeof SubmitMessageResponseSchema.Type

export const PermissionReplySchema = Schema.Struct({
  decision: Schema.Literals(["allow-once", "deny", "stop"]),
})
export type PermissionReply = typeof PermissionReplySchema.Type

export const QuestionReplySchema = Schema.Struct({
  answer: Schema.String,
  ignored: Schema.optional(Schema.Boolean),
})
export type QuestionReply = typeof QuestionReplySchema.Type

export const PlanDecisionSchema = Schema.Struct({
  decision: Schema.Literals(["continue", "reject"]),
})
export type PlanDecision = typeof PlanDecisionSchema.Type

export const ProviderCredentialRequestSchema = Schema.Struct({
  apiKey: Schema.String,
})
export type ProviderCredentialRequest = typeof ProviderCredentialRequestSchema.Type

export const UpsertProviderRequestSchema = Schema.Struct({
  setting: ProviderSettingSchema,
})
export type UpsertProviderRequest = typeof UpsertProviderRequestSchema.Type

export const ProvidersResponseSchema = Schema.Struct({
  providers: Schema.Array(ProviderInfoSchema),
  defaultModel: Schema.NullOr(ModelRefSchema),
  reviewerModel: Schema.NullOr(ModelRefSchema),
})
export type ProvidersResponse = typeof ProvidersResponseSchema.Type

export const ApiErrorSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
    details: Schema.optional(Schema.Unknown),
  }),
})
export type ApiError = typeof ApiErrorSchema.Type

export const HealthResponseSchema = Schema.Struct({
  ok: Schema.Literal(true),
  service: Schema.Literal("codepilotx-agent"),
  version: Schema.String,
  pid: Schema.Number,
})
export type HealthResponse = typeof HealthResponseSchema.Type

export const SessionEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session.snapshot"), snapshot: SessionSnapshotSchema }),
  Schema.Struct({ type: Schema.Literal("run.updated"), run: RunSchema }),
  Schema.Struct({ type: Schema.Literal("input.updated"), input: InputSchema }),
  Schema.Struct({ type: Schema.Literal("message.upserted"), message: MessageSchema }),
  Schema.Struct({ type: Schema.Literal("part.upserted"), part: PartSchema }),
  Schema.Struct({
    type: Schema.Literal("permission.updated"),
    permission: PermissionRequestSchema,
  }),
  Schema.Struct({ type: Schema.Literal("workflow.stages-updated"), runID: Schema.String, stages: Schema.Array(WorkflowStageSchema) }),
  Schema.Struct({
    type: Schema.Literal("question.updated"),
    question: QuestionRequestSchema,
  }),
  Schema.Struct({ type: Schema.Literal("queue.updated"), runIDs: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("heartbeat"), at: Schema.Number }),
])
export type SessionEvent = typeof SessionEventSchema.Type

export const EventEnvelopeSchema = Schema.Struct({
  id: Schema.Number,
  sessionID: Schema.String,
  runID: Schema.NullOr(Schema.String),
  event: SessionEventSchema,
  createdAt: Schema.Number,
})
export type EventEnvelope = typeof EventEnvelopeSchema.Type

export const ServerEventSchema = EventEnvelopeSchema
export type ServerEvent = typeof ServerEventSchema.Type
