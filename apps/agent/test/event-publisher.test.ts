import { afterEach, describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { AgentDatabase } from "../src/storage/Database"
import { EventHub } from "../src/storage/EventHub"
import { publishAgentEvent } from "../src/storage/EventPublisher"

const paths: string[] = []
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(50)
    }
  }
}
afterEach(async () => Promise.all(paths.splice(0).map(removePath)))

describe("manifest-aware event publisher", () => {
  test("live 事件只发 EventHub，durable 事件才进入 SQLite", async () => {
    const path = join(tmpdir(), `codepilotx-events-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const hub = await Effect.runPromise(EventHub.make)
    const received: string[] = []
    const unlisten = hub.listen((event) => received.push(event.method))

    const live = await publishAgentEvent(db, hub, null, null, "catalog/updated", { catalogVersion: 2 })
    expect(live.id).toBe(0)
    expect(db.eventsAfter(0)).toEqual([])

    const durable = await publishAgentEvent(db, hub, "thread:1", null, "thread/updated", {})
    expect(durable.id).toBeGreaterThan(0)
    expect(db.eventsAfter(0).map((event) => event.method)).toEqual(["thread/updated"])
    expect(received).toEqual(["catalog/updated", "thread/updated"])

    unlisten()
    db.close()
  })
})
