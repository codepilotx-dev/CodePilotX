import { describe, expect, test } from 'bun:test'
import type { DurableEventEnvelope } from '@codepilotx/agent-protocol'
import type { Thread, Turn } from '@codepilotx/shared/thread'

import { CanonicalThreadIngestionCoordinator } from '../src/features/session/timeline/CanonicalThreadIngestionCoordinator.js'
import {
  deliverCanonicalBatch,
  hasTerminalTurnEvent,
  isTerminalTurnEnvelope,
} from '../src/features/session/timeline/useCanonicalThreadConversation.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const thread: Thread = {
  id: 'thread-1',
  title: '测试会话',
  projectID: null,
  gitBranch: null,
  settings: { taskMode: 'chat', permissionConfig },
  createdAt: 1,
  updatedAt: 1,
}

const turn: Turn = {
  id: 'turn-1',
  threadId: thread.id,
  sourceInputID: 'input-1',
  status: 'running',
  mode: 'chat',
  model: { providerID: 'openai', id: 'gpt-test' },
  permissionConfig,
  rootAgentId: 'agent-1',
  mergedInputIDs: [],
  startedAt: 1,
  finishedAt: null,
  elapsedSeconds: 0,
  error: null,
}

function historyPage() {
  return {
    thread,
    subagents: [],
    turns: [{
      turn,
      inputs: [],
      messages: [],
      agents: [],
      items: [],
      approvals: [],
      attachments: [],
    }],
    queue: {
      version: 0,
      pauseReason: null,
      turns: [],
      inputs: [],
    },
    olderCursor: null,
    hasOlder: false,
    streamPosition: { streamId: thread.id, sequence: 0 },
  }
}

function statusEvent(
  eventId = 'event-1',
  streamId = thread.id,
): DurableEventEnvelope<'turn/statusChanged'> {
  return {
    eventId,
    streamId,
    type: 'turn/statusChanged',
    version: 1,
    occurredAt: 2,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'durable',
    sequence: 1,
    payload: {
      turnId: turn.id,
      status: 'completed',
      changedAt: 2,
    },
  }
}

function completedEvent(sequence = 2): DurableEventEnvelope<'turn/completed'> {
  return {
    eventId: `event-completed-${sequence}`,
    streamId: thread.id,
    type: 'turn/completed',
    version: 2,
    occurredAt: sequence,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'durable',
    sequence,
    payload: { turn: { ...turn, status: 'completed', finishedAt: sequence } },
  }
}

function failedEvent(sequence = 3): DurableEventEnvelope<'turn/failed'> {
  return {
    eventId: `event-failed-${sequence}`,
    streamId: thread.id,
    type: 'turn/failed',
    version: 2,
    occurredAt: sequence,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'durable',
    sequence,
    payload: {
      turn: { ...turn, status: 'failed', finishedAt: sequence },
      error: { code: 'TURN_FAILED', message: '执行失败', retryable: false },
    },
  }
}

function interruptedEvent(sequence = 4): DurableEventEnvelope<'turn/interrupted'> {
  return {
    eventId: `event-interrupted-${sequence}`,
    streamId: thread.id,
    type: 'turn/interrupted',
    version: 2,
    occurredAt: sequence,
    threadId: thread.id,
    turnId: turn.id,
    durability: 'durable',
    sequence,
    payload: {
      turn: { ...turn, status: 'interrupted', finishedAt: sequence },
      reason: '用户中断',
      recoveryAvailable: false,
    },
  }
}

describe('CanonicalThreadIngestionCoordinator', () => {
  test('批次提交后同步发布 canonical snapshot，并幂等忽略 replay', async () => {
    const committedStatuses: string[] = []
    let notifications = 0
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
      onCommit: state => {
        committedStatuses.push(state.turnsById.get(turn.id)?.status ?? 'missing')
      },
    })
    coordinator.subscribe(() => {
      notifications += 1
    })
    coordinator.rehydrate(historyPage())

    await coordinator.deliverBatch([statusEvent()])
    await coordinator.deliverBatch([statusEvent()])

    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.status)
      .toBe('completed')
    expect(committedStatuses).toEqual(['running', 'completed'])
    expect(notifications).toBe(2)
  })

  test('拒绝 wrong-scope 批次且不会修改 canonical state', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())

    await expect(coordinator.deliverBatch([statusEvent('event-wrong', 'thread-2')]))
      .rejects.toThrow('stream')
    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.status)
      .toBe('running')
  })
})

describe('canonical batch terminal reconciliation', () => {
  test('识别终态 turn 事件', () => {
    expect(isTerminalTurnEnvelope(completedEvent())).toBe(true)
    expect(isTerminalTurnEnvelope(failedEvent())).toBe(true)
    expect(isTerminalTurnEnvelope(interruptedEvent())).toBe(true)
    expect(hasTerminalTurnEvent([completedEvent(), interruptedEvent()])).toBe(true)
    expect(hasTerminalTurnEvent([statusEvent()])).toBe(false)
    expect(hasTerminalTurnEvent([])).toBe(false)
  })

  test('终态批次先 deliver 再读取一次最新历史并 rehydrate 显示最终 item', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    let readCalls = 0
    const reconciled = historyPage()
    reconciled.turns[0] = {
      ...reconciled.turns[0],
      turn: { ...turn, status: 'completed', finishedAt: 9 },
      items: [{
        id: 'assistant-final',
        messageID: 'message-final',
        turnId: turn.id,
        agentId: 'agent-1',
        type: 'text' as const,
        placement: 'result' as const,
        text: '当前页实时更新正常',
        status: 'completed' as const,
        createdAt: 9,
      }],
    }

    const performed = await deliverCanonicalBatch([completedEvent()], {
      coordinator,
      readLatest: async () => {
        readCalls += 1
        return reconciled
      },
      isCurrent: () => true,
    })

    expect(performed).toBe(true)
    expect(readCalls).toBe(1)
    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.status).toBe('completed')
    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.finishedAt).toBe(9)
    expect(coordinator.getSnapshot()?.itemsById.get('assistant-final')).toMatchObject({
      text: '当前页实时更新正常',
      status: 'completed',
    })
  })

  test('同一批含多个终态事件仍只读取一次历史', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    let readCalls = 0

    await deliverCanonicalBatch([
      completedEvent(2),
      failedEvent(3),
      interruptedEvent(4),
    ], {
      coordinator,
      readLatest: async () => {
        readCalls += 1
        return historyPage()
      },
      isCurrent: () => true,
    })

    expect(readCalls).toBe(1)
  })

  test('非终态批次不读取历史', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    let readCalls = 0

    const performed = await deliverCanonicalBatch([statusEvent()], {
      coordinator,
      readLatest: async () => {
        readCalls += 1
        return historyPage()
      },
      isCurrent: () => true,
    })

    expect(performed).toBe(false)
    expect(readCalls).toBe(0)
  })

  test('旧 generation 结果被 threadId + generation 双校验拒绝', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    let readCalls = 0
    let current = true
    const stale = historyPage()
    stale.turns[0] = {
      ...stale.turns[0],
      turn: { ...turn, status: 'running', finishedAt: null },
    }

    const performed = await deliverCanonicalBatch([completedEvent()], {
      coordinator,
      readLatest: async () => {
        readCalls += 1
        current = false
        return stale
      },
      isCurrent: () => current,
    })

    expect(readCalls).toBe(1)
    expect(performed).toBe(false)
    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.status).toBe('completed')
  })

  test('对账失败保留实时投影，仅安全诊断且不抛错', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    const diagnostics: unknown[] = []

    const performed = await deliverCanonicalBatch([completedEvent()], {
      coordinator,
      readLatest: async () => {
        throw new Error('历史读取失败')
      },
      isCurrent: () => true,
      onReconciliationError: cause => diagnostics.push(cause),
    })

    expect(performed).toBe(true)
    expect(diagnostics).toHaveLength(1)
    expect((diagnostics[0] as Error).message).toBe('历史读取失败')
    expect(coordinator.getSnapshot()?.turnsById.get(turn.id)?.status).toBe('completed')
  })

  test('旧 generation 批次在 deliver 前被拒绝且不读历史', async () => {
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: thread.id,
    })
    coordinator.rehydrate(historyPage())
    let readCalls = 0

    const performed = await deliverCanonicalBatch([completedEvent()], {
      coordinator,
      readLatest: async () => {
        readCalls += 1
        return historyPage()
      },
      isCurrent: () => false,
    })

    expect(performed).toBe(false)
    expect(readCalls).toBe(0)
  })
})
