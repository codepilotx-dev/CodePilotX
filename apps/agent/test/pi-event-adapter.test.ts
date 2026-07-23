import { describe, expect, test } from "bun:test"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import { EventManifest } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { PiEventAdapter, piToolResultText } from "../src/orchestration/pi/PiEventAdapter"
import { finishedPiToolItem, piCompactionEventPayload, piItemDeltaPayload, piToolItemPayload } from "../src/orchestration/PiOrchestratorAdapter"

describe("PiEventAdapter", () => {
  test("routes live text and reasoning deltas without inventing durable events", async () => {
    const seen: string[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      textDelta: async (_context, input) => { seen.push(`text:${input.delta}`) },
      reasoningDelta: async (_context, input) => { seen.push(`reasoning:${input.delta}`) },
    })

    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "why" } } as AgentHarnessEvent)

    expect(seen).toEqual(["text:hello", "reasoning:why"])
  })

  test("allocates a unique stable item identity for each assistant message", async () => {
    const started: string[] = []
    const deltas: string[] = []
    const completed: string[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      assistantMessageStarted: async (_context, input) => { started.push(input.textItemID) },
      textDelta: async (_context, input) => { deltas.push(input.itemID) },
      assistantMessageCompleted: async (_context, input) => { completed.push(input.textItemID) },
    })
    const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] })

    await adapter.handle({ type: "message_start", message: assistant("") } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "开始检查" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_end", message: assistant("开始检查") } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "message_start", message: assistant("") } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "检查完成" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_end", message: assistant("检查完成") } as unknown as AgentHarnessEvent)

    expect(new Set(started).size).toBe(2)
    expect(deltas).toEqual(started)
    expect(completed).toEqual(started)
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
      update: "partial",
    }])
  })

  test("unwraps semantic progress and shell output instead of displaying AgentToolResult JSON", () => {
    expect(piToolResultText({
      content: [{ type: "text", text: "fallback" }],
      details: { message: "正在执行 Bash" },
    }, { tool: "shell", progress: true })).toBe("正在执行 Bash")
    expect(piToolResultText({
      content: [{ type: "text", text: "fallback" }],
      details: { stdout: "out", stderr: "warning" },
    }, { tool: "shell" })).toBe("out\nwarning")
    expect(piToolResultText({
      content: [{ type: "text", text: "fallback" }],
      details: { stdout: "pwsh output", stderr: "" },
    }, { tool: "PowerShell" })).toBe("pwsh output")
  })

  test("builds protocol-valid public tool items", () => {
    const item = piToolItemPayload({
      id: "call-1", turnID: "turn", agentID: "agent", type: "tool", status: "completed",
      data: { callID: "call-1", tool: "shell", title: "shell", input: { command: "pwd" }, command: "pwd", output: "ok", error: null, startedAt: 100, finishedAt: 125, durationMs: 25 },
      createdAt: 100, updatedAt: 125,
    })
    expect(() => Schema.decodeUnknownSync(EventManifest["tool/callStarted"].payload)({ item: { ...item, state: "running", output: null, finishedAt: null, durationMs: null }, inputSummary: "pwd" })).not.toThrow()
    expect(() => Schema.decodeUnknownSync(EventManifest["tool/callCompleted"].payload)({ item })).not.toThrow()
    expect(() => Schema.decodeUnknownSync(EventManifest["tool/error"].payload)({
      item: { ...item, state: "error", output: null, error: "failed" },
      error: { code: "TOOL_EXECUTION_ERROR", message: "failed", retryable: false },
    })).not.toThrow()
  })

  test("finalizes a resumed tool once and stops its elapsed timer", () => {
    const running = {
      id: "call-1", turnID: "turn", agentID: "agent", type: "tool" as const, status: "running" as const,
      data: { callID: "call-1", tool: "PowerShell", input: { command: "bun test" }, command: "bun test", startedAt: 100 },
      createdAt: 100, updatedAt: 100,
    }
    const finished = finishedPiToolItem({
      current: running,
      turnID: "turn",
      agentID: "agent",
      toolCallID: "call-1",
      tool: "PowerShell",
      output: "用户拒绝了此工具调用，请改用其他方案。",
      isError: true,
      timestamp: 125,
    })

    expect(finished).toMatchObject({
      id: "call-1",
      status: "error",
      data: { state: "error", finishedAt: 125, durationMs: 25 },
    })
    expect(finishedPiToolItem({
      current: finished!,
      turnID: "turn",
      agentID: "agent",
      toolCallID: "call-1",
      tool: "PowerShell",
      output: "duplicate",
      isError: true,
      timestamp: 150,
    })).toBeNull()
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
