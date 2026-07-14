import { Schema } from "effect"
import {
  InputSchema,
  MessageSchema,
  PartSchema,
  PermissionRequestSchema,
  QuestionRequestSchema,
  RunSchema,
  SessionSnapshotSchema,
  WorkflowStageSchema,
} from "./session"

export * from "./session"

export const SessionEventSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("session.snapshot"), snapshot: SessionSnapshotSchema }),
  Schema.Struct({ type: Schema.Literal("run.updated"), run: RunSchema }),
  Schema.Struct({ type: Schema.Literal("input.updated"), input: InputSchema }),
  Schema.Struct({ type: Schema.Literal("message.upserted"), message: MessageSchema }),
  Schema.Struct({ type: Schema.Literal("part.upserted"), part: PartSchema }),
  Schema.Struct({ type: Schema.Literal("permission.updated"), permission: PermissionRequestSchema }),
  Schema.Struct({ type: Schema.Literal("workflow.stages-updated"), runID: Schema.String, stages: Schema.Array(WorkflowStageSchema) }),
  Schema.Struct({ type: Schema.Literal("question.updated"), question: QuestionRequestSchema }),
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
