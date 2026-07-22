import { describe, expect, test } from "bun:test"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import { EventManifest } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { PiEventAdapter } from "../src/orchestration/pi/PiEventAdapter"
import { piCompactionEventPayload, piItemDeltaPayload } from "../src/orchestration/PiOrchestratorAdapter"

describe("PiEventAdapter", () => {
  test("routes live text and reasoning deltas without inventing durable events", async () => {
    const seen: string[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      textDelta: async (_context, delta) => { seen.push(`text:${delta}`) },
      reasoningDelta: async (_context, delta) => { seen.push(`reasoning:${delta}`) },
    })

    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "why" } } as AgentHarnessEvent)

    expect(seen).toEqual(["text:hello", "reasoning:why"])
  })

  test("routes transaction boundaries and queue counts", async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      queueUpdated: async (_context, queue) => { seen.push(queue) },
      savePoint: async (_context, point) => { seen.push(point) },
      settled: async (_context, settled) => { seen.push(settled) },
    })

    await adapter.handle({ type: "queue_update", steer: [{}], followUp: [{}, {}], nextTurn: [] } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "save_point", hadPendingMutations: true } as AgentHarnessEvent)
    await adapter.handle({ type: "settled", nextTurnCount: 0 } as AgentHarnessEvent)

    expect(seen).toEqual([
      { steer: 1, followUp: 2, nextTurn: 0 },
      { hadPendingMutations: true },
      { nextTurnCount: 0 },
    ])
  })

  test("routes tool output updates with the stable tool call identity", async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      toolUpdated: async (_context, update) => { seen.push(update) },
    })

    await adapter.handle({
      type: "tool_execution_update",
      toolCallId: "call-1",
      toolName: "read_file",
      partialResult: { content: [{ type: "text", text: "partial" }] },
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([{
      toolCallID: "call-1",
      tool: "read_file",
      update: { content: [{ type: "text", text: "partial" }] },
    }])
  })

  test("maps Pi compaction metadata to the existing protocol payload", () => {
    const payload = piCompactionEventPayload({
      compactionID: "compact-1",
      beforeCount: 12,
      afterCount: 4,
      beforeTokens: 8000,
      afterTokens: 0,
      targetTokens: 0,
    })

    expect(() => Schema.decodeUnknownSync(EventManifest["context/compacted"].payload)(payload)).not.toThrow()
    expect(payload).toMatchObject({
      compactionId: "compact-1",
      usageSampleId: "compact-1",
      beforeTokens: 8000,
    })
    expect(payload).not.toHaveProperty("entryID")
    expect(payload).not.toHaveProperty("summary")
    expect(payload).not.toHaveProperty("tokensBefore")
  })

  test("carries the pre-compaction branch size into the compacted callback", async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      compacted: async (_context, compacted) => { seen.push(compacted) },
    })

    await adapter.handle({
      type: "session_before_compact",
      branchEntries: [{}, {}, {}],
      preparation: {},
      signal: new AbortController().signal,
    } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: "session_compact",
      compactionEntry: { id: "compact-1", summary: "summary", tokensBefore: 8000 },
      fromHook: false,
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([{
      entryID: "compact-1",
      summary: "summary",
      tokensBefore: 8000,
      beforeCount: 3,
    }])
  })

  test("uses the existing item delta payload for Pi reasoning and tool output", () => {
    const payload = piItemDeltaPayload({
      itemID: "call-1",
      context: { threadID: "thread", turnID: "turn", agentID: "agent" },
      delta: "partial",
    })

    expect(() => Schema.decodeUnknownSync(EventManifest["reasoning/textDelta"].payload)(payload)).not.toThrow()
    expect(() => Schema.decodeUnknownSync(EventManifest["tool/outputDelta"].payload)(payload)).not.toThrow()
    expect(payload).toEqual({ itemId: "call-1", turnId: "turn", agentId: "agent", delta: "partial" })
  })
})
