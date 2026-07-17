import { describe, expect, test } from "bun:test"
import {
  decodeEventEnvelope,
  decodeServerNotification,
  EventManifest,
} from "../src/events"

const durable = {
  eventId: "event-1",
  streamId: "global",
  type: "thread/deleted",
  version: 1,
  occurredAt: 1,
  durability: "durable",
  sequence: 2,
  payload: { threadId: "thread-1", deletedAt: 1 },
} as const

describe("manifest-driven event decoding", () => {
  test("decodes type, version, durability, and payload from one manifest", () => {
    expect(decodeEventEnvelope(durable)).toEqual(durable)
    expect(EventManifest[durable.type].version).toBe(durable.version)
  })

  test("rejects mismatched durability, version, and payload", () => {
    expect(() => decodeEventEnvelope({ ...durable, durability: "live", sequence: null, afterSequence: 1 })).toThrow()
    expect(() => decodeEventEnvelope({ ...durable, version: 2 })).toThrow("Unsupported")
    expect(() => decodeEventEnvelope({ ...durable, payload: { threadId: "" } })).toThrow()
  })

  test("validates event/next notifications through the event manifest", () => {
    const notification = {
      jsonrpc: "2.0",
      method: "event/next",
      params: { subscriptionId: "subscription-1", event: durable },
    } as const
    expect(decodeServerNotification(notification)).toEqual(notification)
    expect(() => decodeServerNotification({
      ...notification,
      params: { ...notification.params, event: { ...durable, payload: {} } },
    })).toThrow()
  })

  test("兼容 queue/updated 的局部 outbox payload", () => {
    const event = {
      eventId: "event-queue-1",
      streamId: "thread-1",
      type: "queue/updated",
      version: 1,
      occurredAt: 1,
      durability: "durable",
      sequence: 3,
      payload: { threadId: "thread-1", pauseReason: "interrupted" },
    } as const
    expect(decodeEventEnvelope(event)).toEqual(event)
  })

  test("兼容历史 guide mailbox 事件未重复携带 threadId", () => {
    const event = {
      eventId: "event-queue-guide-1",
      streamId: "thread-1",
      type: "queue/updated",
      version: 1,
      occurredAt: 1,
      durability: "durable",
      sequence: 4,
      payload: {},
    } as const
    expect(decodeEventEnvelope(event)).toEqual(event)
  })
})
