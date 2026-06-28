import { expect, test } from 'bun:test'
import type { TurnItem } from '@codepilotx/core/agent/workflow.js'
import { ThreadRuntime } from './ThreadRuntime.js'
import type { ThreadRuntimeSettings } from './ThreadRuntime.js'
import type { QueryEngineConfig } from '../QueryEngine.js'

const nowValues = [
  '2026-06-22T00:00:00.000Z',
  '2026-06-22T00:00:01.000Z',
  '2026-06-22T00:00:02.000Z',
  '2026-06-22T00:00:03.000Z',
  '2026-06-22T00:00:04.000Z',
]

test('resumeThread restores facade state and emits a resumed thread event', () => {
  const runtime = createRuntime()

  const result = runtime.resumeThread('thread-resume', createSettings(), {
    status: 'waiting',
    createdAt: '2026-06-21T00:00:00.000Z',
    currentTurnId: 'turn-resume',
    nextSequence: 4,
    metadata: { source: 'snapshot' },
  })

  expect(result.state).toEqual({
    threadId: 'thread-resume',
    status: 'waiting',
    createdAt: '2026-06-21T00:00:00.000Z',
    currentTurnId: 'turn-resume',
  })
  expect(result.event).toMatchObject({
    type: 'thread.started',
    threadId: 'thread-resume',
    sequence: 5,
    metadata: {
      source: 'snapshot',
      resumed: true,
      createdAt: '2026-06-21T00:00:00.000Z',
    },
  })
})

test('forkThread creates an idle child thread with fork metadata', () => {
  const runtime = createRuntime()
  runtime.startThread({ ...createSettings(), threadId: 'thread-source' })

  const result = runtime.forkThread('thread-source', {
    threadId: 'thread-child',
    metadata: { reason: 'test' },
  })

  expect(result.threadId).toBe('thread-child')
  expect(result.state).toEqual({
    threadId: 'thread-child',
    status: 'idle',
    createdAt: '2026-06-22T00:00:01.000Z',
  })
  expect(result.event).toMatchObject({
    type: 'thread.started',
    threadId: 'thread-child',
    sequence: 1,
    metadata: {
      reason: 'test',
      forkedFromThreadId: 'thread-source',
      createdAt: '2026-06-22T00:00:01.000Z',
    },
  })
})

test('startThread returns a thread started event for protocol clients', () => {
  const runtime = createRuntime()

  const result = runtime.startThread({
    ...createSettings(),
    threadId: 'thread-start',
  })

  expect(result.event).toMatchObject({
    type: 'thread.started',
    threadId: 'thread-start',
    sequence: 1,
    metadata: {
      createdAt: '2026-06-22T00:00:00.000Z',
    },
  })
})

test('rollbackTurn resets active facade state and emits an interrupted turn event', () => {
  const runtime = createRuntime()
  runtime.resumeThread('thread-rollback', createSettings(), {
    status: 'running',
    currentTurnId: 'turn-active',
  })

  const event = runtime.rollbackTurn('thread-rollback', 'turn-active')

  expect(runtime.getThreadState('thread-rollback')).toEqual({
    threadId: 'thread-rollback',
    status: 'idle',
    createdAt: '2026-06-22T00:00:00.000Z',
  })
  expect(event).toMatchObject({
    type: 'turn.interrupted',
    threadId: 'thread-rollback',
    turnId: 'turn-active',
    reason: 'rollbackTurn',
  })
})

test('injectItem emits a client-facing item event without changing schema', () => {
  const runtime = createRuntime()
  runtime.startThread({ ...createSettings(), threadId: 'thread-inject' })
  const item: TurnItem = {
    id: 'item-debug',
    type: 'reasoning',
    threadId: 'wrong-thread',
    turnId: 'wrong-turn',
    status: 'completed',
    createdAt: '2026-06-22T00:00:00.000Z',
    text: 'Injected diagnostic',
  }

  const event = runtime.injectItem('thread-inject', 'turn-inject', item)

  expect(event).toMatchObject({
    type: 'item.completed',
    threadId: 'thread-inject',
    turnId: 'turn-inject',
    item: {
      id: 'item-debug',
      type: 'reasoning',
      threadId: 'thread-inject',
      turnId: 'turn-inject',
      status: 'completed',
      text: 'Injected diagnostic',
    },
  })
})

function createRuntime(): ThreadRuntime {
  let nowIndex = 0
  return new ThreadRuntime(
    prefix => `${prefix}-test`,
    () => nowValues[nowIndex++] ?? nowValues.at(-1)!,
  )
}

function createSettings(): ThreadRuntimeSettings {
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
