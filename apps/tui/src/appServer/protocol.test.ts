import { expect, test } from 'bun:test'
import {
  APP_SERVER_METHODS,
  APP_SERVER_PROTOCOL_VERSION,
  THREAD_EVENT_NOTIFICATION,
  createJsonRpcProtocolFixtures,
} from './protocol.js'

test('initialize fixture exposes app-server protocol capabilities', () => {
  const fixtures = createJsonRpcProtocolFixtures()

  expect(APP_SERVER_PROTOCOL_VERSION).toBe(1)
  expect(fixtures.initializeRequest).toEqual({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {},
  })
  expect(fixtures.initializeResponse).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: 1,
      capabilities: {
        transports: ['stdio'],
        methods: APP_SERVER_METHODS,
        notifications: [THREAD_EVENT_NOTIFICATION],
      },
    },
  })
})

test('thread event fixture keeps ThreadEvent payload unchanged', () => {
  const fixtures = createJsonRpcProtocolFixtures()

  expect(fixtures.threadEventNotification).toEqual({
    jsonrpc: '2.0',
    method: THREAD_EVENT_NOTIFICATION,
    params: {
      event: {
        schemaVersion: 1,
        eventId: 'event-thread-1',
        sequence: 1,
        type: 'thread.started',
        threadId: 'thread-1',
        createdAt: '2026-06-22T00:00:00.000Z',
        metadata: { createdAt: '2026-06-22T00:00:00.000Z' },
      },
    },
  })
})
