import { Schema } from "effect"

export const EmptyParamsSchema = Schema.Struct({})
export type EmptyParams = typeof EmptyParamsSchema.Type

export const JsonValueSchema = Schema.Json
export type JsonValue = typeof JsonValueSchema.Type

export const OpaqueIDSchema = Schema.String.check(Schema.isMinLength(1))
export const RpcIDSchema = Schema.Union([Schema.String, Schema.Number])
export type RpcID = typeof RpcIDSchema.Type

export const CursorSchema = Schema.String.check(Schema.isMinLength(1))
export const LimitSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
export const SequenceSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const TimestampSchema = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export const OperationParamsSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
})

export const OkResultSchema = Schema.Struct({ ok: Schema.Literal(true) })

export const CapabilitySchema = Schema.String.check(Schema.isMinLength(1))
export const CapabilityListSchema = Schema.Array(CapabilitySchema)

export const ApplicationErrorCodeSchema = Schema.Literals([
  "PROTOCOL_VERSION_UNSUPPORTED",
  "CAPABILITY_REQUIRED",
  "UNAUTHORIZED",
  "CURSOR_EXPIRED",
  "SUBSCRIPTION_NOT_FOUND",
  "SUBSCRIPTION_OVERFLOW",
  "REQUEST_NOT_PENDING",
  "CHECKPOINT_UNAVAILABLE",
  "PROJECT_NOT_FOUND",
  "PATH_DENIED",
  "FILE_NOT_FOUND",
  "FILE_NOT_TEXT",
  "FILE_TOO_LARGE",
  "FILE_READONLY",
  "THREAD_NOT_FOUND",
  "TURN_NOT_FOUND",
  "MODEL_UNAVAILABLE",
  "SANDBOX_UNAVAILABLE",
  "TOOLING_UNAVAILABLE",
  "TOOLING_INSTALL_FAILED",
  "TOOLING_DOWNLOAD_FAILED",
  "TOOLING_INTEGRITY_FAILED",
  "TOOLING_ABORTED",
  "PERMISSION_DENIED",
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_LIMIT",
  "MEMORY_NOT_FOUND",
  "MEMORY_REJECTED",
  "SUBAGENT_NOT_FOUND",
  "WORKSPACE_CONFLICT",
  "PROVIDER_UNAVAILABLE",
  "INTEGRATION_NOT_FOUND",
  "AUTHORIZATION_FAILED",
  "REPOSITORY_NOT_FOUND",
  "REVIEW_SOURCE_UNAVAILABLE",
  "REVIEW_SNAPSHOT_EXPIRED",
  "GITHUB_AUTH_REQUIRED",
  "GITHUB_AUTH_INVALID",
  "GITHUB_OAUTH_FAILED",
  "GITHUB_API_FAILED",
  "GITHUB_UNAVAILABLE",
  "GITHUB_RATE_LIMITED",
  "GITHUB_REMOTE_UNSUPPORTED",
  "GITHUB_PUSH_FAILED",
  "GITHUB_RESPONSE_INVALID",
  "GITHUB_GRAPHQL_FAILED",
  "GIT_REMOTE_NOT_FOUND",
  "GIT_BRANCH_REQUIRED",
  "GIT_PUSH_FAILED",
  "GIT_STATUS_FAILED",
  "GIT_OUTPUT_TOO_LARGE",
  "GIT_OUTPUT_ENCODING_INVALID",
  "GIT_COMMAND_FAILED",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
])
export type ApplicationErrorCode = typeof ApplicationErrorCodeSchema.Type

export const RpcApplicationErrorDataSchema = Schema.Struct({
  code: ApplicationErrorCodeSchema,
  retryable: Schema.Boolean,
  requestId: Schema.optional(OpaqueIDSchema),
  details: Schema.optional(JsonValueSchema),
})
export type RpcApplicationErrorData = typeof RpcApplicationErrorDataSchema.Type

export const RpcErrorSchema = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(RpcApplicationErrorDataSchema),
})
export type RpcError = typeof RpcErrorSchema.Type

export const StreamPositionSchema = Schema.Struct({
  streamId: OpaqueIDSchema,
  sequence: SequenceSchema,
})
export type StreamPosition = typeof StreamPositionSchema.Type

export const PageParamsSchema = Schema.Struct({
  cursor: Schema.optional(CursorSchema),
  limit: Schema.optional(LimitSchema),
})

export const MutationMetaSchema = Schema.Struct({
  operationId: OpaqueIDSchema,
  expectedVersion: Schema.optional(SequenceSchema),
})

export const AdmissionDispositionSchema = Schema.Literals(["accepted", "duplicate"])
export const AdmissionSchema = Schema.Struct({
  inputId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  disposition: AdmissionDispositionSchema,
  streamPosition: StreamPositionSchema,
})
