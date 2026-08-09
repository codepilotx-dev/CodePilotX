import { describe, expect, test } from 'bun:test'
import type { DurableEventEnvelope } from '@codepilotx/agent-protocol'
import type { Thread, Turn } from '@codepilotx/shared/thread'

import { CanonicalThreadIngestionCoordinator } from '../src/features/session/timeline/CanonicalThreadIngestionCoordinator.js'

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
