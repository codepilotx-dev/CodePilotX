import { expect, test } from 'bun:test'
import type { DesktopWorkflowEvent } from '../shared/types.js'
import {
  createDesktopJsonRpcAppServerBridge,
  isDesktopJsonRpcAppServerBridgeEnabled,
} from './desktopJsonRpcAppServerBridge.js'

test('isDesktopJsonRpcAppServerBridgeEnabled only enables explicit experiment flag', () => {
  expect(isDesktopJsonRpcAppServerBridgeEnabled({})).toBe(false)
  expect(
    isDesktopJsonRpcAppServerBridgeEnabled({
      CODEPILOTX_JSON_RPC_APP_SERVER: '0',
    }),
  ).toBe(false)
  expect(
    isDesktopJsonRpcAppServerBridgeEnabled({
      CODEPILOTX_JSON_RPC_APP_SERVER: '1',
    }),
  ).toBe(true)
})

test('createDesktopJsonRpcAppServerBridge keeps desktop fallback when disabled', () => {
  expect(
    createDesktopJsonRpcAppServerBridge({
      env: {},
      onWorkflowEvent: () => {},
    }),
  ).toBe(null)
})

test('desktop JSON-RPC app-server bridge emits thread lifecycle notifications when enabled', async () => {
  const events: DesktopWorkflowEvent[] = []
  const bridge = createDesktopJsonRpcAppServerBridge({
    env: {
      CODEPILOTX_JSON_RPC_APP_SERVER: '1',
    },
    onWorkflowEvent: event => {
      events.push(event)
    },
    now: () => '2026-06-22T00:00:00.000Z',
    createId: (prefix, seed) => `${prefix}-${seed ?? 'generated'}`,
  })

  expect(bridge).not.toBe(null)

  await bridge?.startThread('thread-desktop')
  const turn = await bridge?.startTurn('thread-desktop', 'hello')

  expect(turn).toEqual({
    threadId: 'thread-desktop',
    turnId: 'turn-thread-desktop',
    eventCount: 2,
  })
  expect(events.map(event => event.type)).toEqual([
    'thread.started',
    'turn.started',
    'turn.completed',
  ])
  expect(events.map(event => event.threadId)).toEqual([
    'thread-desktop',
    'thread-desktop',
    'thread-desktop',
  ])
})
