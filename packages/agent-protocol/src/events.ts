import { Integration, Model } from "@codepilotx/model-schema"
import {
  AgentExecutionSchema,
  InputSchema,
  ItemSchema,
  PlanItemSchema,
  SubagentProjectionSchema,
  ThreadSchema,
  ThreadSettingsSchema,
  ToolItemSchema,
  TurnSchema,
  TurnStatusSchema,
} from "@codepilotx/shared/thread"
import { Schema } from "effect"
import { defineEvent, type EventPayloadOf } from "./definition"
import {
  ApprovalRequestParamsSchema,
  HookTrustRequestParamsSchema,
  ServerRequestResultSchema,
  PlanRequestParamsSchema,
  QuestionRequestParamsSchema,
} from "./interactions"
import { JsonValueSchema, OpaqueIDSchema, SequenceSchema, TimestampSchema } from "./wire"

const VersionSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
const SanitizedErrorSchema = Schema.Struct({
  code: Schema.String.check(Schema.isMinLength(1)),
  message: Schema.String.check(Schema.isMinLength(1)),
  retryable: Schema.Boolean,
})
const ItemDeltaSchema = Schema.Struct({
  itemId: OpaqueIDSchema,
  turnId: OpaqueIDSchema,
  agentId: OpaqueIDSchema,
  delta: Schema.String,
})
const CompleteSubagentProjectionSchema = Schema.Struct({
  projection: SubagentProjectionSchema,
})
const ToolTerminalPayloadSchema = Schema.Struct({
  item: ToolItemSchema,
})

export const EventManifest = {
  "thread/created": defineEvent({
    payload: Schema.Struct({ thread: ThreadSchema }),
    version: 1,
    durability: "durable",
    stream: "global",
    capability: "events.replay.v1",
  }),
  "thread/updated": defineEvent({
    payload: Schema.Struct({ thread: ThreadSchema, version: VersionSchema }),
    version: 1,
    durability: "durable",
    stream: "global",
    capability: "events.replay.v1",
  }),
  "thread/settings/updated": defineEvent({
    payload: Schema.Struct({ threadId: OpaqueIDSchema, settings: ThreadSettingsSchema, version: VersionSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "thread/prompt-settings/updated": defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      cacheKey: OpaqueIDSchema,
      promptVersion: OpaqueIDSchema,
      baselineVersion: VersionSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "thread/deleted": defineEvent({
    payload: Schema.Struct({ threadId: OpaqueIDSchema, deletedAt: TimestampSchema }),
    version: 1,
    durability: "durable",
    stream: "global",
    capability: "events.replay.v1",
  }),
  "turn/queued": defineEvent({
    payload: Schema.Struct({ turn: TurnSchema, inputId: OpaqueIDSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "turn/started": defineEvent({
    payload: Schema.Struct({ turn: TurnSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "turn/statusChanged": defineEvent({
    payload: Schema.Struct({
      turnId: OpaqueIDSchema,
      status: TurnStatusSchema,
      reason: Schema.optional(Schema.String),
      changedAt: TimestampSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "turn/completed": defineEvent({
    payload: Schema.Struct({ turn: TurnSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "turn/failed": defineEvent({
    payload: Schema.Struct({ turn: TurnSchema, error: SanitizedErrorSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "turn/interrupted": defineEvent({
    payload: Schema.Struct({
      turn: TurnSchema,
      reason: Schema.String.check(Schema.isMinLength(1)),
      recoveryAvailable: Schema.Boolean,
      checkpointVersion: Schema.optional(VersionSchema),
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "agent/upserted": defineEvent({
    payload: Schema.Struct({ agent: AgentExecutionSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "subagent/created": defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "subagents.v1",
  }),
  "subagent/updated": defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "subagents.v1",
  }),
  "subagent/workspaceUpdated": defineEvent({
    payload: CompleteSubagentProjectionSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "subagents.v1",
  }),
  "item/started": defineEvent({
    payload: Schema.Struct({ item: ItemSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "item/completed": defineEvent({
    payload: Schema.Struct({ item: ItemSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "item/agentMessage/delta": defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "item/completed",
  }),
  "reasoning/textDelta": defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "item/completed",
  }),
  "reasoning/summaryPartAdded": defineEvent({
    payload: Schema.Struct({
      itemId: OpaqueIDSchema,
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      partIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    }),
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "item/completed",
  }),
  "reasoning/summaryTextDelta": defineEvent({
    payload: Schema.Struct({
      itemId: OpaqueIDSchema,
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      partIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      delta: Schema.String,
    }),
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "item/completed",
  }),
  "plan/delta": defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "plan/ready",
  }),
  "plan/ready": defineEvent({
    payload: PlanRequestParamsSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "plan/decision": defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      plan: PlanItemSchema,
      decision: Schema.Literals(["continue", "reject"]),
      decidedAt: TimestampSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "tool/callStarted": defineEvent({
    payload: Schema.Struct({
      item: ToolItemSchema,
      inputSummary: Schema.String,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "tool/outputDelta": defineEvent({
    payload: ItemDeltaSchema,
    version: 1,
    durability: "live",
    stream: "thread",
    capability: "events.live.v1",
    reconcilesWith: "tool/callCompleted",
  }),
  "tool/callCompleted": defineEvent({
    payload: ToolTerminalPayloadSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "tool/error": defineEvent({
    payload: Schema.Struct({ item: ToolItemSchema, error: SanitizedErrorSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "approval/requested": defineEvent({
    payload: ApprovalRequestParamsSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "approval/cancelled": defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      reason: Schema.String.check(Schema.isMinLength(1)),
      cancelledAt: TimestampSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "question/requested": defineEvent({
    payload: QuestionRequestParamsSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "interaction/resolved": defineEvent({
    payload: Schema.Struct({ result: ServerRequestResultSchema, resolvedAt: TimestampSchema }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "context/compacted": defineEvent({
    payload: Schema.Struct({
      compactionId: OpaqueIDSchema,
      beforeCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      afterCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      beforeTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      afterTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      targetTokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      baselineVersion: VersionSchema,
      usageSampleId: OpaqueIDSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "context.compact.v1",
  }),
  "context/recoveryRequired": defineEvent({
    payload: Schema.Struct({
      turnId: OpaqueIDSchema,
      agentId: OpaqueIDSchema,
      attemptOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      completedSideEffects: Schema.Array(Schema.Struct({
        toolCallId: OpaqueIDSchema,
        tool: Schema.String.check(Schema.isMinLength(1)),
        summary: Schema.String,
      })),
      checkpointVersion: VersionSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "hook/trust/requested": defineEvent({
    payload: HookTrustRequestParamsSchema,
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "hooks.trust.v1",
  }),
  "hook/trust/resolved": defineEvent({
    payload: Schema.Struct({
      interactionId: OpaqueIDSchema,
      configPath: Schema.String,
      configSha256: Schema.String,
      decision: Schema.Literals(["allow", "block"]),
      resumed: Schema.Boolean,
      resolvedAt: TimestampSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "hooks.trust.v1",
  }),
  "queue/updated": defineEvent({
    payload: Schema.Struct({
      threadId: OpaqueIDSchema,
      turns: Schema.Array(TurnSchema),
      inputs: Schema.Array(InputSchema),
      version: VersionSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "thread",
    capability: "events.replay.v1",
  }),
  "catalog/updated": defineEvent({
    payload: Schema.Struct({ catalogVersion: OpaqueIDSchema, models: Schema.optional(Schema.Array(Model.Info)) }),
    version: 1,
    durability: "live",
    stream: "global",
    capability: "events.live.v1",
    reconcilesWith: "model/list",
  }),
  "integration/updated": defineEvent({
    payload: Schema.Struct({ integrationId: Integration.ID }),
    version: 1,
    durability: "live",
    stream: "global",
    capability: "events.live.v1",
    reconcilesWith: "integration/list",
  }),
  "integration/authorizationCompleted": defineEvent({
    payload: Schema.Struct({
      attemptId: Integration.AttemptID,
      integrationId: Integration.ID,
      connection: Schema.optional(Integration.Ref),
    }),
    version: 1,
    durability: "durable",
    stream: "global",
    capability: "events.replay.v1",
  }),
  "integration/authorizationFailed": defineEvent({
    payload: Schema.Struct({
      attemptId: Integration.AttemptID,
      integrationId: Integration.ID,
      error: SanitizedErrorSchema,
    }),
    version: 1,
    durability: "durable",
    stream: "global",
    capability: "events.replay.v1",
  }),
} as const

export type EventType = keyof typeof EventManifest
export type EventPayload<T extends EventType> = EventPayloadOf<(typeof EventManifest)[T]>
export type DurableEventType = {
  [T in EventType]: (typeof EventManifest)[T]["durability"] extends "durable" ? T : never
}[EventType]
export type LiveEventType = Exclude<EventType, DurableEventType>
export type EventEnvelope = DurableEventEnvelope | LiveEventEnvelope

const eventTypes = Object.keys(EventManifest) as [EventType, ...EventType[]]
export const EventTypeSchema = Schema.Literals(eventTypes)

const EventEnvelopeBaseFields = {
  eventId: OpaqueIDSchema,
  streamId: OpaqueIDSchema,
  version: VersionSchema,
  occurredAt: TimestampSchema,
  threadId: Schema.optional(OpaqueIDSchema),
  turnId: Schema.optional(OpaqueIDSchema),
} as const

export const DurableEventEnvelopeSchema = Schema.Struct({
  ...EventEnvelopeBaseFields,
  type: EventTypeSchema,
  durability: Schema.Literal("durable"),
  sequence: SequenceSchema,
  payload: JsonValueSchema,
})

export const LiveEventEnvelopeSchema = Schema.Struct({
  ...EventEnvelopeBaseFields,
  type: EventTypeSchema,
  durability: Schema.Literal("live"),
  sequence: Schema.Null,
  afterSequence: SequenceSchema,
  payload: JsonValueSchema,
})

export type DurableEventEnvelope<T extends DurableEventType = DurableEventType> = T extends DurableEventType ? {
  readonly eventId: string
  readonly streamId: string
  readonly type: T
  readonly version: (typeof EventManifest)[T]["version"]
  readonly occurredAt: number
  readonly threadId?: string
  readonly turnId?: string
  readonly durability: "durable"
  readonly sequence: number
  readonly payload: EventPayload<T>
} : never

export type LiveEventEnvelope<T extends LiveEventType = LiveEventType> = T extends LiveEventType ? {
  readonly eventId: string
  readonly streamId: string
  readonly type: T
  readonly version: (typeof EventManifest)[T]["version"]
  readonly occurredAt: number
  readonly threadId?: string
  readonly turnId?: string
  readonly durability: "live"
  readonly sequence: null
  readonly afterSequence: number
  readonly payload: EventPayload<T>
} : never

export const EventEnvelopeSchema = Schema.Union([DurableEventEnvelopeSchema, LiveEventEnvelopeSchema])

export function decodeEventEnvelope(input: unknown): EventEnvelope {
  const envelope = Schema.decodeUnknownSync(EventEnvelopeSchema)(input)
  const definition = EventManifest[envelope.type]

  if (envelope.version !== definition.version) {
    throw new Error(`Unsupported ${envelope.type} event version: ${envelope.version}`)
  }
  if (envelope.durability !== definition.durability) {
    throw new Error(`Invalid durability for ${envelope.type}: ${envelope.durability}`)
  }

  const payload = Schema.decodeUnknownSync(definition.payload)(envelope.payload)
  return { ...envelope, payload } as EventEnvelope
}

export const EventNextNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("event/next"),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    event: EventEnvelopeSchema,
  }),
})

export const EventReplayCompleteNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("event/replayComplete"),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    positions: Schema.Array(Schema.Struct({ streamId: OpaqueIDSchema, sequence: SequenceSchema })),
  }),
})

export const SubscriptionClosedReasonSchema = Schema.Literals([
  "unsubscribed",
  "overflow",
  "cursor-expired",
  "server-shutdown",
])

export const EventSubscriptionClosedNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literal("event/subscriptionClosed"),
  params: Schema.Struct({
    subscriptionId: OpaqueIDSchema,
    reason: SubscriptionClosedReasonSchema,
    positions: Schema.Array(Schema.Struct({ streamId: OpaqueIDSchema, sequence: SequenceSchema })),
  }),
})

export const ServerNotificationSchema = Schema.Union([
  EventNextNotificationSchema,
  EventReplayCompleteNotificationSchema,
  EventSubscriptionClosedNotificationSchema,
])
export type ServerNotification = typeof ServerNotificationSchema.Type

export function decodeServerNotification(input: unknown): ServerNotification {
  const notification = Schema.decodeUnknownSync(ServerNotificationSchema)(input)
  if (notification.method !== "event/next") return notification

  return {
    ...notification,
    params: {
      ...notification.params,
      event: decodeEventEnvelope(notification.params.event),
    },
  } as unknown as ServerNotification
}
