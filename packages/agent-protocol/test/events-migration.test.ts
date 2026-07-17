import { describe, expect, test } from "bun:test"
import { AgentEventMethodSchema, AgentRpcMethodSchema } from "@codepilotx/shared/thread"
import { Schema } from "effect"
import {
  DurableEventEnvelopeSchema,
  EventManifest,
  LiveEventEnvelopeSchema,
} from "../src/events"
import { ServerRequests } from "../src/interactions"
import { RpcMethods } from "../src/methods"
import {
  V2EventMigrationManifest,
  V2MethodMigrationManifest,
  type MigrationEntry,
} from "../src/migration"

const MigrationStatuses = ["keep", "rename", "replace", "remove"] as const

const sorted = (values: readonly string[]) => [...values].sort()

const assertCompleteMigration = (
  manifest: Record<string, MigrationEntry>,
  authoritativeNames: readonly string[],
  expectedCount: number,
) => {
  expect(authoritativeNames).toHaveLength(expectedCount)
  expect(Object.keys(manifest)).toHaveLength(expectedCount)
  expect(sorted(Object.keys(manifest))).toEqual(sorted(authoritativeNames))
}

describe("v2 migration manifests", () => {
  test("covers all 64 methods and all 44 events", () => {
    assertCompleteMigration(V2MethodMigrationManifest, AgentRpcMethodSchema.literals, 64)
    assertCompleteMigration(V2EventMigrationManifest, AgentEventMethodSchema.literals, 44)
  })

  test("uses only supported statuses and valid unique method targets", () => {
    const rpcTargets = new Set(Object.keys(RpcMethods))
    const serverRequestTargets = new Set(Object.keys(ServerRequests))
    const targets: string[] = []

    for (const [source, entry] of Object.entries(V2MethodMigrationManifest)) {
      expect(MigrationStatuses).toContain(entry.status)

      if (entry.status === "remove") {
        expect(entry.reason.trim()).not.toBe("")
        continue
      }

      targets.push(entry.target)
      if (entry.status === "keep") {
        expect(entry.target === source).toBe(true)
      }

      const targetExists = rpcTargets.has(entry.target)
        || (entry.status === "replace" && serverRequestTargets.has(entry.target))
      expect(targetExists).toBe(true)
    }

    expect(new Set(targets).size).toBe(targets.length)
  })

  test("uses only supported statuses and valid unique event targets", () => {
    const eventTargets = new Set(Object.keys(EventManifest))
    const targets: string[] = []

    for (const [source, entry] of Object.entries(V2EventMigrationManifest)) {
      expect(MigrationStatuses).toContain(entry.status)

      if (entry.status === "remove") {
        expect(entry.reason.trim()).not.toBe("")
        continue
      }

      targets.push(entry.target)
      expect(eventTargets.has(entry.target)).toBe(true)
      if (entry.status === "keep") {
        expect(entry.target === source).toBe(true)
      }
    }

    expect(new Set(targets).size).toBe(targets.length)
  })
})

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
})
