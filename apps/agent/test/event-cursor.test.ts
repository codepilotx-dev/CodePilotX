import { describe, expect, test } from "bun:test"
import { resolveEventCursor } from "../src/transport/server"

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
})
