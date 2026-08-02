import { describe, expect, test } from "bun:test"
import type { AgentHarnessEvent } from "@codepilotx/pi-agent-core"
import { EventManifest } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { PiEventAdapter, piToolResultText } from "../src/orchestration/pi/PiEventAdapter"
import {
  finishedPiToolItem,
  mergeTimelineMutationFiles,
  PiOrchestratorAdapter,
  piCompactionEventPayload,
  piItemDeltaPayload,
  piToolItemPayload,
  piToolMutationFiles,
  piToolTimelineInput,
} from "../src/orchestration/PiOrchestratorAdapter"
import type { PiRuntimeEventSink } from "../src/orchestration/pi/types"

describe("PiEventAdapter", () => {
  test("apply_patch 时间线输入隐藏补丁正文和其中的主机路径", () => {
    const input = piToolTimelineInput("apply_patch", {
      patch: "*** Begin Patch\n*** Update File: C:\\secret\\source.ts\n@@\n-old\n+new\n*** End Patch",
    })
    expect(input).toEqual({
      operation: "apply_patch",
      patchBytes: expect.any(Number),
      hunkCount: 1,
      additions: 1,
      deletions: 1,
      patch: "[补丁正文已隐藏]",
      affectedPaths: [{ path: "source.ts", operation: "update", additions: 1, deletions: 1 }],
    })
    expect(JSON.stringify(input)).not.toContain("C:\\\\secret")
    expect(JSON.stringify(input)).not.toContain("-old")
  })

  test("Write 和 Edit 时间线输入只保留安全文件元数据", () => {
    const write = piToolTimelineInput("Write", {
      file_path: "src/source.ts",
      content: "const secret = 'private'",
    })
    const edit = piToolTimelineInput("workspace.edit", {
      path: "src/source.ts",
      edits: [{ oldText: "secret-old", newText: "secret-new" }],
    })

    expect(write).toEqual({
      operation: "write",
      file_path: "src/source.ts",
      contentBytes: Buffer.byteLength("const secret = 'private'", "utf8"),
      affectedPaths: [{ path: "src/source.ts" }],
    })
    expect(edit).toEqual({
      operation: "edit",
      path: "src/source.ts",
      editCount: 1,
      affectedPaths: [{ path: "src/source.ts" }],
    })
    expect(JSON.stringify(write)).not.toContain("private")
    expect(JSON.stringify(edit)).not.toContain("secret-old")
    expect(JSON.stringify(edit)).not.toContain("secret-new")
  })

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

  test("marks streaming text as process and classifies completed tool-call messages as process", async () => {
    const started: string[] = []
    const completed: string[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      assistantMessageStarted: async (_context, input) => { started.push(input.placement) },
      assistantMessageCompleted: async (_context, input) => { completed.push(input.placement) },
    })
    const assistant = (content: unknown[]) => ({ role: "assistant", content })

    await adapter.handle({ type: "message_start", message: assistant([]) } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: "message_end",
      message: assistant([
        { type: "text", text: "开始检查" },
        { type: "toolCall", id: "call-1", name: "read", arguments: {} },
      ]),
    } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "message_start", message: assistant([]) } as unknown as AgentHarnessEvent)
    await adapter.handle({
      type: "message_end",
      message: assistant([{ type: "text", text: "检查完成" }]),
    } as unknown as AgentHarnessEvent)

    expect(started).toEqual(["process", "process"])
    expect(completed).toEqual(["process", "result"])
  })

  test("keeps the completion placement when building the durable text item", async () => {
    const db = {
      getItem: () => null,
    }
    const orchestrator = new PiOrchestratorAdapter({
      db: db as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: {} as never,
    })
    const sink = (orchestrator as unknown as {
      eventSink(
        storage: unknown,
        runtimeModel: { provider: string; id: string; contextWindow: number },
      ): PiRuntimeEventSink
    }).eventSink({}, {
      provider: "openai",
      id: "model",
      contextWindow: 128_000,
    })

    await sink.assistantMessageCompleted?.(
      { threadID: "thread", turnID: "turn", agentID: "agent" },
      {
        textItemID: "text-1",
        reasoningItemID: "reasoning-1",
        planItemID: "plan-1",
        placement: "process",
        content: [{ type: "text", text: "继续调用工具" }],
        provider: "openai",
        api: "responses",
        model: "model",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
        },
      },
    )

    const pending = (orchestrator as unknown as {
      pending: Map<string, { items: Map<string, { data: Record<string, unknown> }> }>
    }).pending.get("thread")
    expect(pending?.items.get("text-1")?.data.placement).toBe("process")
  })

  test("normalizes standard Pi usage and prefers the actual response model", async () => {
    const completed: unknown[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      assistantMessageCompleted: async (_context, input) => { completed.push(input) },
    })

    await adapter.handle({
      type: "message_end",
      message: {
        role: "assistant",
        provider: "openai",
        api: "openai-responses",
        model: "requested-model",
        responseModel: "actual-model",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 10,
          output: 4,
          cacheRead: 20,
          cacheWrite: 5,
          reasoning: 2,
        },
      },
    } as unknown as AgentHarnessEvent)

    expect(completed).toMatchObject([{
      provider: "openai",
      api: "openai-responses",
      model: "actual-model",
      usage: {
        input: 10,
        output: 4,
        cacheRead: 20,
        cacheWrite: 5,
        reasoning: 2,
      },
    }])
  })

  test("treats missing or invalid Pi usage fields as zero", async () => {
    const completed: Array<{ usage: Record<string, number> }> = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      assistantMessageCompleted: async (_context, input) => { completed.push(input) },
    })

    await adapter.handle({
      type: "message_end",
      message: {
        role: "assistant",
        provider: "anthropic",
        api: "anthropic-messages",
        model: "claude-test",
        content: [{ type: "text", text: "done" }],
        usage: { input: -1, output: Number.NaN, cacheRead: 3.9 },
      },
    } as unknown as AgentHarnessEvent)

    expect(completed[0]?.usage).toEqual({
      input: 0,
      output: 0,
      cacheRead: 3,
      cacheWrite: 0,
      reasoning: 0,
    })
  })

  test("Plan 模式流式输出独立计划且不创建空文本项", async () => {
    const seen: string[] = []
    const completed: Array<{ text?: string; plan?: string | null; planItemID: string }> = []
    const adapter = new PiEventAdapter(
      { threadID: "thread", turnID: "turn", agentID: "agent" },
      {
        assistantMessageStarted: async () => { seen.push("text-start") },
        textDelta: async (_context, input) => { seen.push(`text:${input.delta}`) },
        planStarted: async () => { seen.push("plan-start") },
        planDelta: async (_context, input) => { seen.push(`plan:${input.delta}`) },
        assistantMessageCompleted: async (_context, input) => { completed.push(input) },
      },
      { parseProposedPlan: true },
    )
    const assistant = (text: string) => ({ role: "assistant", content: [{ type: "text", text }] })

    await adapter.handle({ type: "message_start", message: assistant("") } as unknown as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "<proposed_" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "plan>\n# 方案\n" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "</proposed_plan>" } } as AgentHarnessEvent)
    await adapter.handle({ type: "message_end", message: assistant("<proposed_plan>\n# 方案\n</proposed_plan>") } as unknown as AgentHarnessEvent)

    expect(seen).toEqual(["plan-start", "plan:# 方案\n"])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ text: "", plan: "# 方案" })
    expect(completed[0]!.planItemID).toEndWith(":plan")
    expect(adapter.outputText([])).toBe("")
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

  test("routes safe tool text together with structured result details", async () => {
    const seen: unknown[] = []
    const adapter = new PiEventAdapter({ threadID: "thread", turnID: "turn", agentID: "agent" }, {
      toolFinished: async (_context, result) => { seen.push(result) },
    })

    await adapter.handle({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "Edit",
      result: {
        content: [{ type: "text", text: "已编辑 src/source.ts（+2 -1）" }],
        details: {
          operation: "edit",
          path: "src/source.ts",
          additions: 2,
          deletions: 1,
        },
      },
      isError: false,
    } as unknown as AgentHarnessEvent)

    expect(seen).toEqual([{
      toolCallID: "call-1",
      tool: "Edit",
      result: "已编辑 src/source.ts（+2 -1）",
      details: {
        operation: "edit",
        path: "src/source.ts",
        additions: 2,
        deletions: 1,
      },
      isError: false,
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

  test("merges successful mutation details into one idempotent patch item", () => {
    const items = new Map<string, {
      id: string
      turnID: string
      agentID: string
      type: "tool" | "patch"
      status: "running" | "completed" | "interrupted"
      data: Record<string, unknown>
      ordinal?: number
      createdAt: number
      updatedAt: number
    }>()
    items.set("call-1", {
      id: "call-1",
      turnID: "turn",
      agentID: "agent",
      type: "tool",
      status: "running",
      data: {
        tool: "apply_patch",
        input: {
          affectedPaths: [
            { path: "src/source.ts", operation: "update" },
            { path: "src/added.ts", operation: "create" },
          ],
        },
      },
      createdAt: 100,
      updatedAt: 100,
    })
    let transactionCount = 0
    let eventID = 0
    const db = {
      repositories: {
        turnPatches: {
          getByTurn: () => null,
        },
      },
      transaction: <T>(work: () => T) => {
        transactionCount += 1
        return work()
      },
      getItem: (id: string) => items.get(id) ?? null,
      upsertItem: (_threadID: string, item: (typeof items extends Map<string, infer Value> ? Value : never)) => {
        items.set(item.id, item)
      },
      insertEvent: (threadId: string, turnId: string, method: string, params: unknown) => ({
        id: ++eventID,
        threadId,
        turnId,
        method,
        params,
        createdAt: 200,
      }),
    }
    const orchestrator = new PiOrchestratorAdapter({
      db: db as never,
      hub: {} as never,
      models: {} as never,
      toolExecutor: {} as never,
    })
    const persist = (orchestrator as unknown as {
      persistFinishedTool(context: unknown, input: unknown): Array<{ method: string }>
    }).persistFinishedTool.bind(orchestrator)
    const input = {
      toolCallID: "call-1",
      tool: "apply_patch",
      output: "完成",
      details: {
        operation: "apply_patch",
        files: [
          { path: "src/source.ts", additions: 3, deletions: 1 },
          { path: "src/added.ts", additions: 2, deletions: 0 },
        ],
      },
      isError: false,
    }

    expect(persist({ threadID: "thread", turnID: "turn", agentID: "agent" }, input).map((event) => event.method))
      .toEqual(["tool/callCompleted", "item/completed"])
    expect(items.get("call-1")?.data.input).toMatchObject({
      affectedPaths: [
        { path: "src/source.ts", operation: "update", additions: 3, deletions: 1 },
        { path: "src/added.ts", operation: "create", additions: 2, deletions: 0 },
      ],
    })
    expect(items.get("patch:turn")).toMatchObject({
      type: "patch",
      status: "completed",
      data: {
        files: [
          { path: "src/source.ts", additions: 3, deletions: 1 },
          { path: "src/added.ts", additions: 2, deletions: 0 },
        ],
        totalAdditions: 5,
        totalDeletions: 1,
      },
    })
    items.set("call-2", {
      id: "call-2",
      turnID: "turn",
      agentID: "agent",
      type: "tool",
      status: "running",
      data: { tool: "Edit", input: { path: "src/source.ts" } },
      createdAt: 100,
      updatedAt: 100,
    })
    expect(persist(
      { threadID: "thread", turnID: "turn", agentID: "agent" },
      {
        toolCallID: "call-2",
        tool: "Edit",
        output: "失败",
        details: { path: "src/source.ts", additions: 100, deletions: 100 },
        isError: true,
      },
    ).map((event) => event.method)).toEqual(["tool/error"])
    expect(items.get("patch:turn")?.data).toMatchObject({
      totalAdditions: 5,
      totalDeletions: 1,
    })
    items.set("call-3", {
      id: "call-3",
      turnID: "turn",
      agentID: "agent",
      type: "tool",
      status: "interrupted",
      data: { tool: "Write", input: { file_path: "src/other.ts" } },
      createdAt: 100,
      updatedAt: 100,
    })
    expect(persist(
      { threadID: "thread", turnID: "turn", agentID: "agent" },
      {
        toolCallID: "call-3",
        tool: "Write",
        output: "中断",
        details: { path: "src/other.ts", additions: 100, deletions: 0 },
        isError: false,
      },
    )).toEqual([])
    expect(persist({ threadID: "thread", turnID: "turn", agentID: "agent" }, input)).toEqual([])
    expect(transactionCount).toBe(2)
  })

  test("normalizes mutation paths and accumulates repeated edits", () => {
    expect(piToolMutationFiles("Write", {
      path: "src\\source.ts",
      additions: 2.8,
      deletions: -1,
      content: "must-not-survive",
    })).toEqual([{ path: "src/source.ts", additions: 2, deletions: 0 }])
    expect(mergeTimelineMutationFiles(
      [{ path: "src/source.ts", additions: 1, deletions: 2 }],
      [{ path: "src\\source.ts", additions: 3, deletions: 4 }],
    )).toEqual([{ path: "src/source.ts", additions: 4, deletions: 6 }])
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
