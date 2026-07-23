import { describe, expect, test } from "bun:test"
import { deliverAnchoredLive, resolveEventCursor } from "../src/transport/server"

describe("Agent SSE event cursor", () => {
  test("fresh subscriptions start after existing events", () => {
    expect(resolveEventCursor(undefined, undefined, 418)).toBe(418)
  })

  test("explicit cursors preserve replay semantics", () => {
    expect(resolveEventCursor("120", undefined, 418)).toBe(120)
    expect(resolveEventCursor(undefined, "240", 418)).toBe(240)
    expect(resolveEventCursor("120", "240", 418)).toBe(240)
    expect(resolveEventCursor("0", undefined, 418)).toBe(0)
  })

  test("live delivery catches durable state up to its fixed anchor first", async () => {
    let cursor = 3
    const order: string[] = []
    const delivered = await deliverAnchoredLive(
      () => cursor,
      5,
      async (target) => {
        order.push(`durable:${target}`)
        cursor = target
      },
      async () => { order.push("live") },
    )

    expect(delivered).toBe(true)
    expect(order).toEqual(["durable:5", "live"])
  })

  test("live delivery drops an event whose anchor is behind the stream cursor", async () => {
    const order: string[] = []
    const delivered = await deliverAnchoredLive(
      () => 6,
      5,
      async () => { order.push("durable") },
      async () => { order.push("live") },
    )

    expect(delivered).toBe(false)
    expect(order).toEqual([])
  })
})
