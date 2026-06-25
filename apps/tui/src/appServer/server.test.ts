import { expect, test } from 'bun:test'
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import { JsonRpcAppServer } from './server.js'

test('initialize returns protocol version and supported capabilities', async () => {
  const server = new JsonRpcAppServer(createRegistry())

  await expect(server.initialize()).resolves.toMatchObject({
    protocolVersion: 1,
    capabilities: {
      transports: ['stdio'],
      methods: expect.arrayContaining([
        'thread/start',
        'turn/start',
        'session/getSnapshot',
      ]),
      notifications: ['thread/event', 'session/snapshot.updated'],
    },
  })
})

test('thread/start emits a thread event notification', async () => {
  const notifications: ThreadEvent[] = []
  const server = new JsonRpcAppServer(createRegistry(), {
    onThreadEvent: event => notifications.push(event),
  })

  const result = await server.startThread({
    threadId: 'thread-jsonrpc',
    settings: {},
  } as never)

  expect(result).toEqual({
    threadId: 'thread-jsonrpc',
    status: 'idle',
    createdAt: '2026-06-22T00:00:00.000Z',
  })
  expect(notifications).toHaveLength(1)
  expect(notifications[0]).toMatchObject({
    type: 'thread.started',
    threadId: 'thread-jsonrpc',
  })
})

test('turn/start emits every streamed thread event before resolving', async () => {
  const notifications: ThreadEvent[] = []
  const snapshots: Array<{ threadId: string; eventCount: number }> = []
  const server = new JsonRpcAppServer(createRegistry(), {
    onThreadEvent: event => notifications.push(event),
    onSessionSnapshotUpdated: snapshot => snapshots.push(snapshot),
  })

  const result = await server.startTurn({
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
    input: 'hello',
  })

  expect(result).toEqual({
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
    eventCount: 2,
  })
  expect(notifications.map(event => event.type)).toEqual([
    'turn.started',
    'turn.completed',
  ])
  expect(snapshots).toMatchObject([
    {
      threadId: 'thread-jsonrpc',
      eventCount: 2,
    },
  ])
})

test('session/getSnapshot returns the backend-derived session view', async () => {
  const server = new JsonRpcAppServer(createRegistry())

  await expect(
    server.getSessionSnapshot({ threadId: 'thread-jsonrpc' }),
  ).resolves.toMatchObject({
    threadId: 'thread-jsonrpc',
    eventCount: 2,
    view: {
      turnStatus: 'done',
      messages: [
        {
          role: 'assistant',
          text: 'hi',
        },
      ],
    },
  })
})

test('unknown thread errors include JSON-RPC error data', async () => {
  const server = new JsonRpcAppServer(createRegistry({ throwUnknown: true }))

  await expect(
    server.interruptTurn({ threadId: 'missing-thread' }),
  ).rejects.toMatchObject({
    code: -32004,
    message: 'Unknown thread missing-thread',
    data: {
      threadId: 'missing-thread',
      cause: 'Unknown thread missing-thread',
    },
  })
})

function createRegistry(options: { throwUnknown?: boolean } = {}) {
  return {
    startThread(params: { threadId?: string }) {
      const threadId = params.threadId ?? 'thread-jsonrpc'
      return {
        threadId,
        status: 'idle' as const,
        createdAt: '2026-06-22T00:00:00.000Z',
        event: {
          schemaVersion: 1 as const,
          eventId: 'event-thread-started',
          sequence: 1,
          type: 'thread.started' as const,
          threadId,
          createdAt: '2026-06-22T00:00:00.000Z',
          metadata: { createdAt: '2026-06-22T00:00:00.000Z' },
        },
      }
    },
    async *startTurn(params: { threadId: string; turnId?: string }) {
      const turnId = params.turnId ?? 'turn-jsonrpc'
      yield {
        schemaVersion: 1 as const,
        eventId: 'event-turn-started',
        sequence: 2,
        type: 'turn.started' as const,
        threadId: params.threadId,
        turnId,
        createdAt: '2026-06-22T00:00:01.000Z',
      }
      yield {
        schemaVersion: 1 as const,
        eventId: 'event-turn-completed',
        sequence: 3,
        type: 'turn.completed' as const,
        threadId: params.threadId,
        turnId,
        createdAt: '2026-06-22T00:00:02.000Z',
        finalResponse: 'done',
      }
    },
    interruptTurn(params: { threadId: string }) {
      if (options.throwUnknown) {
        throw new Error(`Unknown thread ${params.threadId}`)
      }
      return {
        schemaVersion: 1 as const,
        eventId: 'event-interrupted',
        sequence: 4,
        type: 'turn.interrupted' as const,
        threadId: params.threadId,
        turnId: 'turn-jsonrpc',
        createdAt: '2026-06-22T00:00:03.000Z',
        reason: 'interruptTurn',
      }
    },
    resumeThread() {
      throw new Error('not used')
    },
    forkThread() {
      throw new Error('not used')
    },
    rollbackTurn() {
      throw new Error('not used')
    },
    injectItem() {
      throw new Error('not used')
    },
    getSessionSnapshot(params: { threadId: string }) {
      return {
        threadId: params.threadId,
        eventCount: 2,
        updatedAt: '2026-06-22T00:00:02.000Z',
        view: {
          messages: [
            {
              id: 'event-agent-message',
              role: 'assistant' as const,
              text: 'hi',
              createdAt: '2026-06-22T00:00:02.000Z',
            },
          ],
          events: [],
          toolRuns: [],
          pendingPermissions: [],
          turnStatus: 'done' as const,
          diagnostics: {
            duplicateEventIds: [],
            missingToolResults: [],
            outOfOrderSequences: [],
          },
        },
      }
    },
  }
}
