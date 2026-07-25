import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  DurableEventEnvelopeSchema,
  EventManifest,
  LiveEventEnvelopeSchema,
} from "../src/wire/events"
import { RpcMethods } from "../src/methods/index"

describe("event manifest invariants", () => {
  test("gives every live event an authoritative reconciliation target", () => {
    const authoritativeTargets = new Set([
      ...Object.keys(EventManifest),
      ...Object.keys(RpcMethods),
    ])

    for (const definition of Object.values(EventManifest)) {
      if (definition.durability !== "live") continue
      expect(typeof definition.reconcilesWith).toBe("string")
      expect(definition.reconcilesWith?.trim()).not.toBe("")
      expect(authoritativeTargets.has(definition.reconcilesWith ?? "")).toBe(true)
    }
  })

  test("gives every durable event a valid version and stream", () => {
    for (const definition of Object.values(EventManifest)) {
      if (definition.durability !== "durable") continue
      expect(Number.isInteger(definition.version)).toBe(true)
      expect(definition.version).toBeGreaterThanOrEqual(1)
      expect(["global", "thread"]).toContain(definition.stream)
    }
  })

  test("discriminates durable and live envelopes", () => {
    const decodeDurable = Schema.decodeUnknownSync(DurableEventEnvelopeSchema)
    const decodeLive = Schema.decodeUnknownSync(LiveEventEnvelopeSchema)
    const durable = {
      eventId: "event-1",
      streamId: "thread-1",
      type: "thread/created",
      version: 1,
      occurredAt: 1,
      durability: "durable",
      sequence: 0,
      payload: {},
    } as const
    const live = {
      eventId: "event-2",
      streamId: "thread-1",
      type: "item/agentMessage/delta",
      version: 1,
      occurredAt: 2,
      durability: "live",
      sequence: null,
      afterSequence: 0,
      payload: {},
    } as const

    expect(decodeDurable(durable)).toEqual(durable)
    expect(decodeLive(live)).toEqual(live)
    expect(() => decodeDurable(live)).toThrow()
    expect(() => decodeLive(durable)).toThrow()
    expect(() => decodeDurable({ ...durable, sequence: null })).toThrow()
    expect(() => decodeLive({ ...live, sequence: 0 })).toThrow()
  })

  test("keeps MCP update events path- and configuration-free", () => {
    const decode = Schema.decodeUnknownSync(
      EventManifest["mcp/updated"].payload,
      { onExcessProperty: "error" },
    )
    expect(decode({ generation: 2 })).toEqual({ generation: 2 })
    expect(() => decode({
      generation: 2,
      workspace: "C:\\sensitive\\workspace",
    })).toThrow()
    expect(() => decode({
      generation: 2,
      server: { url: "https://example.com", headers: { Authorization: "secret" } },
    })).toThrow()
  })
})
