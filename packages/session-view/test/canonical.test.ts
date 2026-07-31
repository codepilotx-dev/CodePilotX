import { describe, expect, test } from "bun:test"
import type {
  AgentExecution,
  ApprovalRequest,
  Input,
  Item,
  Thread,
  Turn,
} from "@codepilotx/shared/thread"
import {
  applyThreadEnvelope,
  applyThreadEnvelopes,
  createCanonicalThreadState,
  createRenderTurnEntriesSelector,
  prependOlderThreadPage,
  reconcileLatestThreadPage,
  selectRenderTurnEntries,
  selectVisibleTurnEntries,
  type ThreadEventEnvelopeLike,
  type ThreadHistoryPageLike,
} from "../src/canonical/index"
import { applyThreadEvent, createThreadView } from "../src/thread/index"

const model = { providerID: "openai", id: "gpt-test" }
const permissionConfig = {
  sandboxMode: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
} as const

const thread: Thread = {
  id: "thread-1",
  title: "测试会话",
  projectID: null,
  gitBranch: null,
  settings: { taskMode: "chat", permissionConfig },
  createdAt: 1,
  updatedAt: 2,
}

function turn(id: string, sourceInputID = `input-${id}`): Turn {
  return {
    id,
    threadId: thread.id,
    sourceInputID,
    status: "running",
    mode: "chat",
    model,
    permissionConfig,
    rootAgentId: `agent-${id}`,
    mergedInputIDs: [],
    startedAt: 10,
    finishedAt: null,
    elapsedSeconds: 0,
    error: null,
  }
}

function input(id: string, turnId: string, createdAt: number): Input {
  return {
    id,
    threadId: thread.id,
    turnId,
    content: id,
    delivery: "follow-up",
    mode: "chat",
    model,
    permissionConfig,
    state: "active",
    createdAt,
  }
}

function agent(id: string, turnId: string, runId: string | null = null): AgentExecution {
  return {
    id,
    threadId: thread.id,
    turnId,
    parentAgentId: null,
    profile: "agent",
    task: "task",
    model,
    sessionId: `session-${id}`,
    depth: 0,
    status: "running",
    error: null,
    subagentRunId: runId,
    runSequence: 0,
    createdAt: 10,
    updatedAt: 10,
  }
}

function textItem(id: string, turnId: string, text: string, status: "streaming" | "completed" = "streaming"): Extract<Item, { type: "text" }> {
  return {
    id,
    messageID: `message-${id}`,
    turnId,
    agentId: `agent-${turnId}`,
    type: "text",
    placement: "result",
    text,
    status,
    createdAt: 20,
  }
}

function page(turns: ThreadHistoryPageLike["turns"], sequence = 10): ThreadHistoryPageLike {
  return {
    thread,
    subagents: [],
    turns,
    olderCursor: "older",
    hasOlder: true,
    streamPosition: { streamId: "stream-1", sequence },
  }
}

function durable(sequence: number, type: string, payload: unknown): ThreadEventEnvelopeLike {
  return {
    eventId: `event-${sequence}-${type}`,
    streamId: "stream-1",
    type,
    threadId: thread.id,
    occurredAt: sequence,
    durability: "durable",
    sequence,
    payload,
  }
}

function live(eventId: string, type: string, payload: unknown, afterSequence = 10): ThreadEventEnvelopeLike {
  return {
    eventId,
    streamId: "stream-1",
    type,
    threadId: thread.id,
    occurredAt: afterSequence,
    durability: "live",
    sequence: null,
    afterSequence,
    payload,
  }
}

describe("canonical thread state", () => {
  test("hydrates latest page and prepends older turns without duplicates or cursor rollback", () => {
    const newer = turn("turn-2")
    const state = createCanonicalThreadState(page([{
      turn: newer,
      inputs: [input("input-turn-2", newer.id, 20)],
      messages: [],
      agents: [agent("agent-turn-2", newer.id)],
      items: [],
      approvals: [],
    }], 10))

    const older = turn("turn-1")
    const next = prependOlderThreadPage(state, {
      ...page([
        { turn: older, inputs: [input("input-turn-1", older.id, 10)], messages: [], agents: [], items: [], approvals: [] },
        { turn: newer, inputs: [], messages: [], agents: [], items: [], approvals: [] },
      ], 4),
      olderCursor: null,
      hasOlder: false,
    })

    expect(next.turnOrder).toEqual(["turn-1", "turn-2"])
    expect(next.history).toMatchObject({ olderCursor: null, hasOlder: false })
    expect(next.stream.appliedSequence).toBe(10)
    expect(state.turnOrder).toEqual(["turn-2"])
  })

  test("appends live deltas once and reconciles them with the durable terminal item", () => {
    const activeTurn = turn("turn-1")
    const streaming = textItem("item-1", activeTurn.id, "Hello")
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [],
      messages: [],
      agents: [agent("agent-turn-1", activeTurn.id)],
      items: [streaming],
      approvals: [],
    }]))
    const delta = live("live-1", "item/agentMessage/delta", {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: " world",
    })

    const appended = applyThreadEnvelope(state, delta)
    expect((appended.itemsById.get(streaming.id) as typeof streaming).text).toBe("Hello world")
    expect(applyThreadEnvelope(appended, delta)).toBe(appended)

    const terminal = textItem(streaming.id, activeTurn.id, "Hello world!", "completed")
    const completed = applyThreadEnvelope(appended, durable(11, "item/completed", { item: terminal }))
    expect(completed.itemsById.get(streaming.id)).toEqual(terminal)

    const stale = live("live-stale", "item/agentMessage/delta", {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: " stale",
    }, 10)
    expect(applyThreadEnvelope(completed, stale)).toBe(completed)

    const sameAnchor = live("live-same-anchor", "item/agentMessage/delta", {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: " duplicate",
    }, 11)
    const protectedTerminal = applyThreadEnvelope(completed, sameAnchor)
    expect(protectedTerminal.itemsById.get(streaming.id)).toEqual(terminal)
  })

  test("applies an ordered envelope batch equivalently to individual updates", () => {
    const activeTurn = turn("turn-batch")
    const streaming = textItem("item-batch", activeTurn.id, "")
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [],
      messages: [],
      agents: [agent("agent-turn-batch", activeTurn.id)],
      items: [streaming],
      approvals: [],
    }]))
    const envelopes = [
      live("batch-live-1", "item/agentMessage/delta", {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: "第一段",
      }),
      live("batch-live-2", "item/agentMessage/delta", {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: "第二段",
      }),
      durable(11, "item/completed", {
        item: textItem(streaming.id, activeTurn.id, "第一段第二段", "completed"),
      }),
    ]

    const batched = applyThreadEnvelopes(state, envelopes)
    const individual = envelopes.reduce(applyThreadEnvelope, state)

    expect(batched).toEqual(individual)
    expect(batched.itemsById.get(streaming.id)).toMatchObject({
      text: "第一段第二段",
      status: "completed",
    })
    expect(batched.stream.appliedEventIds).toEqual(new Set(["batch-live-1", "batch-live-2"]))
  })

  test("preserves live order and idempotency while protecting terminal items in a batch", () => {
    const activeTurn = turn("turn-batch-terminal")
    const streaming = textItem("item-batch-terminal", activeTurn.id, "")
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [],
      messages: [],
      agents: [agent("agent-turn-batch-terminal", activeTurn.id)],
      items: [streaming],
      approvals: [],
    }]))
    const first = live("batch-duplicate", "item/agentMessage/delta", {
      itemId: streaming.id,
      turnId: activeTurn.id,
      agentId: streaming.agentId,
      delta: "A",
    })
    const terminal = textItem(streaming.id, activeTurn.id, "AB!", "completed")
    const batched = applyThreadEnvelopes(state, [
      first,
      first,
      live("batch-second", "item/agentMessage/delta", {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: "B",
      }),
      durable(11, "item/completed", { item: terminal }),
      live("batch-stale", "item/agentMessage/delta", {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: " stale",
      }, 10),
      live("batch-terminal", "item/agentMessage/delta", {
        itemId: streaming.id,
        turnId: activeTurn.id,
        agentId: streaming.agentId,
        delta: " ignored",
      }, 11),
    ])

    expect(batched.itemsById.get(streaming.id)).toEqual(terminal)
    expect(batched.stream.appliedSequence).toBe(11)
    expect(batched.stream.appliedEventIds).toEqual(new Set([
      "batch-duplicate",
      "batch-second",
      "batch-terminal",
    ]))
  })

  test("bounds recent live event ids and does not retain durable event ids", () => {
    const state = createCanonicalThreadState(page([]))
    const envelopes: ThreadEventEnvelopeLike[] = [
      durable(11, "thread/updated", { thread: { ...thread, updatedAt: 11 } }),
    ]
    for (let index = 0; index < 5_000; index += 1) {
      envelopes.push(live(`bounded-live-${index}`, "reasoning/summaryPartAdded", {}, 11))
    }

    const next = applyThreadEnvelopes(state, envelopes)

    expect(next.stream.appliedEventIds.size).toBe(2_048)
    expect(next.stream.appliedEventIds.has(envelopes[0]!.eventId)).toBe(false)
    expect(next.stream.appliedEventIds.has("bounded-live-0")).toBe(false)
    expect(next.stream.appliedEventIds.has("bounded-live-2951")).toBe(false)
    expect(next.stream.appliedEventIds.has("bounded-live-2952")).toBe(true)
    expect(next.stream.appliedEventIds.has("bounded-live-4999")).toBe(true)
  })

  test("projects final plans as content and upserts execution plan snapshots by item id", () => {
    const activeTurn = turn("turn-plan")
    const finalPlan: Extract<Item, { type: "plan" }> = {
      id: "plan-1",
      messageID: "message-plan",
      turnId: activeTurn.id,
      agentId: "agent-turn-plan",
      type: "plan",
      title: "实施计划",
      markdown: "第一步",
      status: "streaming",
      createdAt: 20,
    }
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [],
      messages: [],
      agents: [agent("agent-turn-plan", activeTurn.id)],
      items: [finalPlan],
      approvals: [],
    }]))

    const streamed = applyThreadEnvelope(state, live("plan-live", "plan/delta", {
      itemId: finalPlan.id,
      turnId: activeTurn.id,
      agentId: finalPlan.agentId,
      delta: "，第二步",
    }))
    expect(streamed.itemsById.get(finalPlan.id)).toMatchObject({
      markdown: "第一步，第二步",
      status: "streaming",
    })

    const completedPlan = { ...finalPlan, markdown: "权威计划", status: "completed" as const }
    const completed = applyThreadEnvelope(streamed, durable(11, "item/completed", { item: completedPlan }))
    expect(completed.itemsById.get(finalPlan.id)).toEqual(completedPlan)
    expect(selectRenderTurnEntries(completed)[0]?.blockers).toEqual([])

    const executionPlan: Extract<Item, { type: "execution-plan" }> = {
      id: `${activeTurn.id}:execution-plan`,
      messageID: "message-plan",
      turnId: activeTurn.id,
      agentId: finalPlan.agentId,
      type: "execution-plan",
      explanation: "开始执行",
      steps: [{ step: "实现契约", status: "in_progress" }],
      status: "streaming",
      createdAt: 21,
    }
    const firstUpdate = applyThreadEnvelope(completed, durable(12, "turn/plan/updated", { item: executionPlan }))
    const secondUpdate = applyThreadEnvelope(firstUpdate, durable(13, "turn/plan/updated", {
      item: {
        ...executionPlan,
        explanation: "契约已完成",
        steps: [{ step: "实现契约", status: "completed" }],
      },
    }))
    const rendered = selectRenderTurnEntries(secondUpdate)[0]

    expect([...secondUpdate.itemsById.values()].filter((item) => item.type === "execution-plan")).toHaveLength(1)
    expect(secondUpdate.itemsById.get(executionPlan.id)).toMatchObject({
      explanation: "契约已完成",
      steps: [{ step: "实现契约", status: "completed" }],
    })
    expect(rendered?.executionPlanItems.map((item) => item.id)).toEqual([executionPlan.id])
    expect(rendered?.contentBlocks.map((block) => block.kind)).toEqual(["plan", "execution-plan"])

    const snapshot = {
      thread,
      turns: [activeTurn],
      agents: [agent("agent-turn-plan", activeTurn.id)],
      subagents: [],
      inputs: [],
      messages: [],
      items: [completedPlan],
      approvals: [],
    }
    const projectedOnce = applyThreadEvent(snapshot, {
      jsonrpc: "2.0",
      method: "turn/plan/updated",
      params: { item: executionPlan },
    })
    const projectedTwice = applyThreadEvent(projectedOnce, {
      jsonrpc: "2.0",
      method: "turn/plan/updated",
      params: {
        item: {
          ...executionPlan,
          steps: [{ step: "实现契约", status: "completed" }],
        },
      },
    })
    const threadView = createThreadView(projectedTwice)

    expect(threadView.blockers).toEqual([])
    expect(threadView.rows.map((row) => row.kind)).toEqual(["plan", "execution-plan"])
    expect(projectedTwice.items.filter((item) => item.type === "execution-plan")).toHaveLength(1)
  })

  test("upserts a missing turn from turn/started and ignores replayed durable sequences", () => {
    const state = createCanonicalThreadState(page([]))
    const startedTurn = turn("turn-new")
    const startedInput = input("input-new", startedTurn.id, 1)
    const envelope = durable(11, "turn/started", { turn: startedTurn, input: startedInput })
    const next = applyThreadEnvelope(state, envelope)

    expect(next.turnOrder).toEqual([startedTurn.id])
    expect(next.turnsById.get(startedTurn.id)).toEqual(startedTurn)
    expect(next.inputsById.get(startedInput.id)).toEqual(startedInput)
    expect(applyThreadEnvelope(next, { ...envelope, eventId: "different-id" })).toBe(next)
  })

  test("projects affected approval paths and keeps legacy paths derived from the safe scope", () => {
    const activeTurn = turn("turn-approval")
    const rootAgent = agent("agent-approval", activeTurn.id)
    const bundle = {
      turn: activeTurn,
      inputs: [input("input-approval", activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [],
      approvals: [],
    }
    const payload = {
      interactionId: "approval-scoped",
      threadId: thread.id,
      turnId: activeTurn.id,
      agentId: rootAgent.id,
      toolCallId: "tool-scoped",
      tool: "apply_patch",
      risk: "high" as const,
      reason: "需要确认",
      affectedPaths: [
        { path: "src/a.ts", operation: "update" as const },
        { path: "src/b.ts", operation: "create" as const },
      ],
      reviewSummary: {
        fileCount: 2,
        hunkCount: 2,
        additions: 4,
        deletions: 1,
      },
      requestedPermissions: { writePaths: ["legacy-only.ts"] },
      createdAt: 20,
    }
    const state = createCanonicalThreadState(page([bundle]))
    const projected = applyThreadEnvelope(
      state,
      durable(11, "approval/requested", payload),
    )
    expect(projected.approvalsById.get(payload.interactionId)).toMatchObject({
      paths: ["src/a.ts", "src/b.ts"],
      affectedPaths: payload.affectedPaths,
      reviewSummary: payload.reviewSummary,
    })

    const snapshot = {
      thread,
      turns: [activeTurn],
      agents: [rootAgent],
      subagents: [],
      inputs: bundle.inputs,
      messages: [],
      items: [],
      approvals: [],
    }
    const legacyProjected = applyThreadEvent(snapshot, {
      jsonrpc: "2.0",
      method: "approval/requested",
      params: payload,
    })
    expect(legacyProjected.approvals[0]).toMatchObject({
      paths: ["src/a.ts", "src/b.ts"],
      affectedPaths: payload.affectedPaths,
      reviewSummary: payload.reviewSummary,
    })
  })

  test("keeps only the final result text after process items as the assistant result", () => {
    const activeTurn = turn("turn-ordered")
    const rootAgent = agent("agent-ordered", activeTurn.id)
    const first = { ...textItem("text-1", activeTurn.id, "开始检查"), ordinal: 0, createdAt: 30 }
    const tool: Extract<Item, { type: "tool" }> = {
      id: "tool-1", messageID: activeTurn.id, turnId: activeTurn.id, agentId: rootAgent.id,
      type: "tool", callID: "tool-1", tool: "Read", title: "Read", state: "completed",
      input: {}, command: null, output: "ok", error: null, startedAt: 10, finishedAt: 20,
      durationMs: 10, ordinal: 1, createdAt: 10,
    }
    const second = { ...textItem("text-2", activeTurn.id, "读取完成"), ordinal: 2, createdAt: 20 }
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [input("input-ordered", activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [second, tool, first],
      approvals: [],
    }]))

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.items.map((item) => item.id)).toEqual(["text-1", "tool-1", "text-2"])
    expect(entry?.processItems.map((item) => item.id)).toEqual(["text-1", "tool-1"])
    expect(entry?.assistantResultItems.map((item) => item.id)).toEqual(["text-2"])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(["process", "assistant"])
    expect(entry?.contentBlocks.flatMap((block) => block.kind === "process" || block.kind === "assistant"
      ? block.items.map((item) => item.id)
      : [])).toEqual(["text-1", "tool-1", "text-2"])
  })

  test("does not invent an assistant result when legacy result text precedes the final process item", () => {
    const activeTurn = turn("turn-process-only")
    const rootAgent = agent("agent-process-only", activeTurn.id)
    const text = { ...textItem("text-before-tool", activeTurn.id, "开始检查"), ordinal: 0 }
    const tool: Extract<Item, { type: "tool" }> = {
      id: "tool-last", messageID: activeTurn.id, turnId: activeTurn.id, agentId: rootAgent.id,
      type: "tool", callID: "tool-last", tool: "Read", title: "Read", state: "completed",
      input: {}, command: null, output: "ok", error: null, startedAt: 10, finishedAt: 20,
      durationMs: 10, ordinal: 1, createdAt: 21,
    }
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [input("input-process-only", activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [text, tool],
      approvals: [],
    }]))

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.processItems.map((item) => item.id)).toEqual(["text-before-tool", "tool-last"])
    expect(entry?.assistantResultItems).toEqual([])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(["process"])
  })

  test("always projects explicitly placed process text into the process slot", () => {
    const activeTurn = turn("turn-explicit-process")
    const rootAgent = agent("agent-explicit-process", activeTurn.id)
    const processText = {
      ...textItem("process-text", activeTurn.id, "正在检查"),
      placement: "process" as const,
      ordinal: 0,
    }
    const resultText = {
      ...textItem("result-text", activeTurn.id, "检查完成", "completed"),
      ordinal: 1,
    }
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [input("input-explicit-process", activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent],
      items: [processText, resultText],
      approvals: [],
    }]))

    const [entry] = selectRenderTurnEntries(state)
    expect(entry?.processItems.map((item) => item.id)).toEqual(["process-text"])
    expect(entry?.assistantResultItems.map((item) => item.id)).toEqual(["result-text"])
    expect(entry?.contentBlocks.map((block) => block.kind)).toEqual(["process", "assistant"])
  })

  test("projects semantic slots and filters subagent scope by run id", () => {
    const activeTurn = turn("turn-1")
    const rootAgent = agent("agent-turn-1", activeTurn.id)
    const childAgent = agent("agent-child", activeTurn.id, "run-1")
    const process: Extract<Item, { type: "reasoning" }> = {
      id: "reasoning-1", messageID: "m-1", turnId: activeTurn.id, agentId: childAgent.id,
      type: "reasoning", text: "思考", status: "completed", createdAt: 21,
    }
    const result = {
      ...textItem("result-1", activeTurn.id, "完成", "completed"),
      agentId: childAgent.id,
      createdAt: 21.5,
    }
    const patch: Extract<Item, { type: "patch" }> = {
      id: "patch-1", messageID: "m-2", turnId: activeTurn.id, agentId: childAgent.id,
      type: "patch", files: [], totalAdditions: 1, totalDeletions: 0, createdAt: 22,
    }
    const question: Extract<Item, { type: "question" }> = {
      id: "question-1", messageID: "m-3", turnId: activeTurn.id, agentId: childAgent.id,
      type: "question", prompt: "继续？", choices: [], status: "pending", answer: null, createdAt: 23,
    }
    const approval: ApprovalRequest = {
      id: "approval-1", threadId: thread.id, turnId: activeTurn.id, agentId: childAgent.id,
      toolCallID: "tool-1", tool: "shell", command: null, cwd: null, paths: [],
      requestedPermissions: {}, review: null, risk: "low", reason: "确认", status: "pending", createdAt: 24,
    }
    const state = createCanonicalThreadState(page([{
      turn: activeTurn,
      inputs: [input("input-1", activeTurn.id, 1)],
      messages: [],
      agents: [rootAgent, childAgent],
      items: [process, result, patch, question, textItem("root-result", activeTurn.id, "root")],
      approvals: [approval],
    }]))

    const visible = selectVisibleTurnEntries(state, { type: "subagent", runId: "run-1" })
    expect(visible).toHaveLength(1)
    expect(visible[0]?.items.map((item) => item.id)).toEqual(["reasoning-1", "result-1", "patch-1", "question-1"])

    const [rendered] = selectRenderTurnEntries(state, { type: "subagent", runId: "run-1" })
    expect(rendered?.processItems.map((item) => item.id)).toEqual(["reasoning-1"])
    expect(rendered?.assistantResultItems.map((item) => item.id)).toEqual(["result-1"])
    expect(rendered?.patchItems.map((item) => item.id)).toEqual(["patch-1"])
    expect(rendered?.blockers.map((blocker) => blocker.kind)).toEqual(["question", "approval"])
  })

  test("reuses unchanged render turn entries when one turn receives an update", () => {
    const firstTurn = turn("turn-selector-1")
    const secondTurn = turn("turn-selector-2")
    const firstItem = textItem("item-selector-1", firstTurn.id, "first")
    const secondItem = textItem("item-selector-2", secondTurn.id, "second")
    const state = createCanonicalThreadState(page([
      {
        turn: firstTurn,
        inputs: [input("input-selector-1", firstTurn.id, 1)],
        messages: [],
        agents: [agent("agent-turn-selector-1", firstTurn.id)],
        items: [firstItem],
        approvals: [],
      },
      {
        turn: secondTurn,
        inputs: [input("input-selector-2", secondTurn.id, 2)],
        messages: [],
        agents: [agent("agent-turn-selector-2", secondTurn.id)],
        items: [secondItem],
        approvals: [],
      },
    ]))
    const selectEntries = createRenderTurnEntriesSelector()
    const initial = selectEntries(state)
    expect(selectEntries(state)).toBe(initial)

    const updated = applyThreadEnvelope(state, durable(11, "item/completed", {
      item: { ...secondItem, text: "second complete", status: "completed" },
    }))
    const next = selectEntries(updated)

    expect(next).not.toBe(initial)
    expect(next[0]).toBe(initial[0])
    expect(next[1]).not.toBe(initial[1])
    expect(next[1]?.assistantResultItems[0]?.text).toBe("second complete")
  })

  test("reconciles the latest page while preserving loaded older turns", () => {
    const latestTurn = turn("turn-reconcile-2")
    const initial = createCanonicalThreadState(page([{
      turn: latestTurn,
      inputs: [input("input-reconcile-2", latestTurn.id, 2)],
      messages: [],
      agents: [agent("agent-turn-reconcile-2", latestTurn.id)],
      items: [textItem("item-reconcile-2", latestTurn.id, "stale")],
      approvals: [],
    }], 10))
    const olderTurn = turn("turn-reconcile-1")
    const cached = prependOlderThreadPage(initial, {
      ...page([{
        turn: olderTurn,
        inputs: [input("input-reconcile-1", olderTurn.id, 1)],
        messages: [],
        agents: [agent("agent-turn-reconcile-1", olderTurn.id)],
        items: [textItem("item-reconcile-1", olderTurn.id, "older", "completed")],
        approvals: [],
      }], 5),
      olderCursor: null,
      hasOlder: false,
    })
    cached.stream.appliedEventIds.add("old-live-event")
    const refreshedTurn = { ...latestTurn, status: "completed" as const }
    const reconciled = reconcileLatestThreadPage(cached, page([{
      turn: refreshedTurn,
      inputs: [input("input-reconcile-2", refreshedTurn.id, 2)],
      messages: [],
      agents: [agent("agent-turn-reconcile-2", refreshedTurn.id)],
      items: [textItem("item-reconcile-2", refreshedTurn.id, "fresh", "completed")],
      approvals: [],
    }], 20))

    expect(reconciled.turnOrder).toEqual([olderTurn.id, refreshedTurn.id])
    expect(reconciled.turnsById.get(olderTurn.id)).toBe(cached.turnsById.get(olderTurn.id))
    expect(reconciled.turnsById.get(refreshedTurn.id)).toBe(refreshedTurn)
    expect(reconciled.itemsById.get("item-reconcile-2")).toMatchObject({ text: "fresh" })
    expect(reconciled.history).toMatchObject({ olderCursor: null, hasOlder: false })
    expect(reconciled.stream).toMatchObject({ streamId: "stream-1", appliedSequence: 20 })
    expect(reconciled.stream.appliedEventIds.size).toBe(0)
  })

  test("drops cached history when the stream generation changes", () => {
    const cachedTurn = turn("turn-old-stream")
    const cached = createCanonicalThreadState(page([{
      turn: cachedTurn,
      inputs: [],
      messages: [],
      agents: [],
      items: [],
      approvals: [],
    }]))
    const freshTurn = turn("turn-new-stream")
    const reconciled = reconcileLatestThreadPage(cached, {
      ...page([{
        turn: freshTurn,
        inputs: [],
        messages: [],
        agents: [],
        items: [],
        approvals: [],
      }], 1),
      streamPosition: { streamId: "stream-2", sequence: 1 },
    })

    expect(reconciled.turnOrder).toEqual([freshTurn.id])
    expect(reconciled.turnsById.has(cachedTurn.id)).toBe(false)
  })
})
