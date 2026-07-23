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
  createCanonicalThreadState,
  prependOlderThreadPage,
  selectRenderTurnEntries,
  selectVisibleTurnEntries,
  type ThreadEventEnvelopeLike,
  type ThreadHistoryPageLike,
} from "../src/canonical"

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
    canContinueFromPlan: false,
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
    strategy: "queue",
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

  test("upserts a missing turn from turn/started and ignores replayed durable sequences", () => {
    const state = createCanonicalThreadState(page([]))
    const startedTurn = turn("turn-new")
    const envelope = durable(11, "turn/started", { turn: startedTurn })
    const next = applyThreadEnvelope(state, envelope)

    expect(next.turnOrder).toEqual([startedTurn.id])
    expect(next.turnsById.get(startedTurn.id)).toEqual(startedTurn)
    expect(applyThreadEnvelope(next, { ...envelope, eventId: "different-id" })).toBe(next)
  })

  test("projects semantic slots and filters subagent scope by run id", () => {
    const activeTurn = turn("turn-1")
    const rootAgent = agent("agent-turn-1", activeTurn.id)
    const childAgent = agent("agent-child", activeTurn.id, "run-1")
    const process: Extract<Item, { type: "reasoning" }> = {
      id: "reasoning-1", messageID: "m-1", turnId: activeTurn.id, agentId: childAgent.id,
      type: "reasoning", text: "思考", status: "completed", createdAt: 21,
    }
    const result = { ...textItem("result-1", activeTurn.id, "完成", "completed"), agentId: childAgent.id }
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
    expect(visible[0]?.items.map((item) => item.id)).toEqual(["result-1", "reasoning-1", "patch-1", "question-1"])

    const [rendered] = selectRenderTurnEntries(state, { type: "subagent", runId: "run-1" })
    expect(rendered?.processItems.map((item) => item.id)).toEqual(["reasoning-1"])
    expect(rendered?.assistantResultItems.map((item) => item.id)).toEqual(["result-1"])
    expect(rendered?.patchItems.map((item) => item.id)).toEqual(["patch-1"])
    expect(rendered?.blockers.map((blocker) => blocker.kind)).toEqual(["question", "approval"])
  })
})
