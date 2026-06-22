import { expect, test } from 'bun:test'
import type { TurnItem } from '@codepilotx/core/agent/workflow.js'
import type { QueryEngineConfig } from '../QueryEngine.js'
import { AppServerThreadRegistry } from './registry.js'
import type { JsonRpcThreadStartParams } from './protocol.js'

test('thread/start creates a runtime thread and returns its started event', () => {
  const registry = new AppServerThreadRegistry(createRuntime())

  const result = registry.startThread({
    threadId: 'thread-jsonrpc',
    settings: createSettings(),
  })

  expect(result.threadId).toBe('thread-jsonrpc')
  expect(result.event).toMatchObject({
    type: 'thread.started',
    threadId: 'thread-jsonrpc',
    sequence: 1,
  })
})

test('turn/start streams runtime events to the caller', async () => {
  const registry = new AppServerThreadRegistry(createRuntime())
  registry.startThread({
    threadId: 'thread-jsonrpc',
    settings: createSettings(),
  })

  const events = []
  for await (const event of registry.startTurn({
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
    input: 'hello',
  })) {
    events.push(event)
  }

  expect(events.map(event => event.type)).toEqual([
    'turn.started',
    'item.completed',
    'turn.completed',
  ])
  expect(events[0]).toMatchObject({
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
  })
})

test('interrupting an unknown thread returns a JSON-RPC app error', () => {
  const registry = new AppServerThreadRegistry(createRuntime())

  expect(() =>
    registry.interruptTurn({ threadId: 'missing-thread' }),
  ).toThrow('Unknown thread missing-thread')
})

test('item/inject emits client-facing item events through the registry', () => {
  const registry = new AppServerThreadRegistry(createRuntime())
  registry.startThread({
    threadId: 'thread-jsonrpc',
    settings: createSettings(),
  })
  const item: TurnItem = {
    id: 'item-debug',
    type: 'reasoning',
    threadId: 'ignored',
    turnId: 'ignored',
    status: 'completed',
    createdAt: '2026-06-22T00:00:00.000Z',
    text: 'debug item',
  }

  const event = registry.injectItem({
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
    item,
  })

  expect(event).toMatchObject({
    type: 'item.completed',
    threadId: 'thread-jsonrpc',
    turnId: 'turn-jsonrpc',
    item: {
      threadId: 'thread-jsonrpc',
      turnId: 'turn-jsonrpc',
      text: 'debug item',
    },
  })
})

function createRuntime() {
  let sequence = 0
  const threads = new Set<string>()
  return {
    startThread(params: JsonRpcThreadStartParams['settings'] & { threadId?: string }) {
      sequence += 1
      const threadId = params.threadId ?? 'thread-generated'
      threads.add(threadId)
      return {
        threadId,
        status: 'idle' as const,
        createdAt: '2026-06-22T00:00:00.000Z',
        event: {
          schemaVersion: 1 as const,
          eventId: `event-${sequence}`,
          sequence,
          type: 'thread.started' as const,
          threadId,
          createdAt: '2026-06-22T00:00:00.000Z',
          metadata: { createdAt: '2026-06-22T00:00:00.000Z' },
        },
      }
    },
    resumeThread(threadId: string) {
      sequence += 1
      threads.add(threadId)
      return {
        threadId,
        state: {
          threadId,
          status: 'idle' as const,
          createdAt: '2026-06-22T00:00:00.000Z',
        },
        event: {
          schemaVersion: 1 as const,
          eventId: `event-${sequence}`,
          sequence,
          type: 'thread.started' as const,
          threadId,
          createdAt: '2026-06-22T00:00:00.000Z',
          metadata: { resumed: true },
        },
      }
    },
    forkThread(sourceThreadId: string) {
      if (!threads.has(sourceThreadId)) {
        throw new Error(`Unknown thread ${sourceThreadId}`)
      }
      sequence += 1
      threads.add('thread-fork')
      return {
        threadId: 'thread-fork',
        state: {
          threadId: 'thread-fork',
          status: 'idle' as const,
          createdAt: '2026-06-22T00:00:00.000Z',
        },
        event: {
          schemaVersion: 1 as const,
          eventId: `event-${sequence}`,
          sequence,
          type: 'thread.started' as const,
          threadId: 'thread-fork',
          createdAt: '2026-06-22T00:00:00.000Z',
          metadata: { forkedFromThreadId: sourceThreadId },
        },
      }
    },
    async *sendTurn(threadId: string, _input: unknown, options: { turnId?: string }) {
      if (!threads.has(threadId)) {
        throw new Error(`Unknown thread ${threadId}`)
      }
      const turnId = options.turnId ?? 'turn-generated'
      yield {
        schemaVersion: 1 as const,
        eventId: 'event-turn-started',
        sequence: 2,
        type: 'turn.started' as const,
        threadId,
        turnId,
        createdAt: '2026-06-22T00:00:01.000Z',
        input: 'hello',
      }
      yield {
        schemaVersion: 1 as const,
        eventId: 'event-item-completed',
        sequence: 3,
        type: 'item.completed' as const,
        threadId,
        turnId,
        createdAt: '2026-06-22T00:00:02.000Z',
        item: {
          id: 'item-agent',
          type: 'agent_message' as const,
          threadId,
          turnId,
          status: 'completed' as const,
          createdAt: '2026-06-22T00:00:02.000Z',
          text: 'hi',
        },
      }
      yield {
        schemaVersion: 1 as const,
        eventId: 'event-turn-completed',
        sequence: 4,
        type: 'turn.completed' as const,
        threadId,
        turnId,
        createdAt: '2026-06-22T00:00:03.000Z',
        finalResponse: 'hi',
      }
    },
    interruptTurn(threadId: string, turnId?: string) {
      if (!threads.has(threadId)) {
        throw new Error(`Unknown thread ${threadId}`)
      }
      return {
        schemaVersion: 1 as const,
        eventId: 'event-interrupted',
        sequence: 5,
        type: 'turn.interrupted' as const,
        threadId,
        turnId: turnId ?? 'turn-generated',
        createdAt: '2026-06-22T00:00:04.000Z',
        reason: 'interruptTurn',
      }
    },
    rollbackTurn(threadId: string, turnId: string) {
      if (!threads.has(threadId)) {
        throw new Error(`Unknown thread ${threadId}`)
      }
      return {
        schemaVersion: 1 as const,
        eventId: 'event-rollback',
        sequence: 6,
        type: 'turn.interrupted' as const,
        threadId,
        turnId,
        createdAt: '2026-06-22T00:00:05.000Z',
        reason: 'rollbackTurn',
      }
    },
    injectItem(threadId: string, turnId: string, item: TurnItem) {
      if (!threads.has(threadId)) {
        throw new Error(`Unknown thread ${threadId}`)
      }
      return {
        schemaVersion: 1 as const,
        eventId: 'event-inject',
        sequence: 7,
        type: 'item.completed' as const,
        threadId,
        turnId,
        createdAt: '2026-06-22T00:00:06.000Z',
        item: { ...item, threadId, turnId },
      }
    },
  }
}

function createSettings(): JsonRpcThreadStartParams['settings'] {
  return {
    cwd: 'D:\\VueProject\\ClaudeCode',
    tools: [] as QueryEngineConfig['tools'],
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
    getAppState: () => ({}) as QueryEngineConfig['getAppState'] extends () => infer T ? T : never,
    setAppState: () => {},
    readFileCache: {} as QueryEngineConfig['readFileCache'],
  }
}
