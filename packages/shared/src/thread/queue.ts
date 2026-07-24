import { Model } from "@codepilotx/model-schema"
import { Schema } from "effect"
import {
  ApprovalRequestSchema,
  AttachmentSchema,
  InputSchema,
  ItemSchema,
  MessageSchema,
  ThreadTurnBundleSchema,
} from "./items"
import { PermissionConfigSchema } from "./permission"
import { ThreadListItemSchema, ThreadSchema, TurnSchema } from "./schema"
import { SendStrategySchema, TaskModeSchema } from "./settings"
import { AgentExecutionSchema, SubagentProjectionSchema } from "./subagent"

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
