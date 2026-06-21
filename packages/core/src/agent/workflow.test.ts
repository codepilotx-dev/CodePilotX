import { expect, test } from 'bun:test'
import {
  WorkflowEventSchemaVersion,
  agentRuntimeEventToThreadEvents,
  createPermissionRequestDecisionEvent,
} from './workflow.js'
import type { WorkflowEventIds } from './workflow.js'

const ids: WorkflowEventIds = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  now: () => '2026-06-22T00:00:00.000Z',
  itemId: (kind, seed) => `${kind}-${seed ?? '1'}`,
}

test('assistant runtime message maps to a completed agent_message item', () => {
  const events = agentRuntimeEventToThreadEvents(
    {
      type: 'message',
      sessionId: 'session-1',
      role: 'assistant',
      text: 'Done',
    },
    ids,
  )

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    schemaVersion: WorkflowEventSchemaVersion,
    eventId: expect.any(String),
    type: 'item.completed',
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: {
      type: 'agent_message',
      status: 'completed',
      text: 'Done',
    },
  })
})

test('permission decision maps request to a terminal item state', () => {
  const event = createPermissionRequestDecisionEvent({
    threadId: 'thread-1',
    turnId: 'turn-1',
    behavior: 'deny',
    createdAt: '2026-06-22T00:00:00.000Z',
    sequence: 7,
    request: {
      requestId: 'permission-123',
      toolName: 'Edit',
      input: { file_path: 'a.ts' },
      description: 'Edit a.ts',
    },
  })

  expect(event).toMatchObject({
    schemaVersion: WorkflowEventSchemaVersion,
    sequence: 7,
    type: 'item.completed',
    item: {
      type: 'permission_request',
      status: 'failed',
      request: { requestId: 'permission-123' },
      metadata: { decision: 'deny' },
    },
  })
})

test('partial runtime message maps to an updated streaming agent_message item', () => {
  const events = agentRuntimeEventToThreadEvents(
    {
      type: 'partial_message',
      sessionId: 'session-1',
      text: 'stream',
    },
    ids,
  )

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: 'item.updated',
    item: {
      id: 'agent_message-partial',
      type: 'agent_message',
      status: 'in_progress',
      text: 'stream',
      streaming: true,
    },
  })
})

test('tool start and result map to tool item lifecycle events', () => {
  const started = agentRuntimeEventToThreadEvents(
    {
      type: 'tool_start',
      sessionId: 'session-1',
      toolName: 'Read',
      summary: 'Reading file',
    },
    ids,
  )
  const completed = agentRuntimeEventToThreadEvents(
    {
      type: 'tool_result',
      sessionId: 'session-1',
      toolName: 'Read',
      summary: 'Read file',
    },
    ids,
  )

  expect(started[0]).toMatchObject({
    type: 'item.started',
    item: {
      id: 'tool_call-Read-start',
      type: 'tool_call',
      status: 'in_progress',
      toolName: 'Read',
    },
  })
  expect(completed[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'tool_result-Read-result',
      type: 'tool_result',
      status: 'completed',
      toolName: 'Read',
    },
  })
})

test('permission request preserves the existing request id', () => {
  const events = agentRuntimeEventToThreadEvents(
    {
      type: 'permission_request',
      sessionId: 'session-1',
      request: {
        requestId: 'permission-123',
        toolName: 'Edit',
        input: { file_path: 'a.ts' },
        description: 'Edit a.ts',
      },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.started',
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: {
      id: 'permission_request-permission-123',
      type: 'permission_request',
      request: { requestId: 'permission-123' },
    },
  })
})

test('done and error runtime events map to terminal turn events', () => {
  expect(
    agentRuntimeEventToThreadEvents(
      { type: 'done', sessionId: 'session-1' },
      ids,
    )[0],
  ).toMatchObject({
    type: 'turn.completed',
    finalResponse: '',
  })

  const errorEvents = agentRuntimeEventToThreadEvents(
    { type: 'error', sessionId: 'session-1', message: 'Failed' },
    ids,
  )

  expect(errorEvents.at(-1)).toMatchObject({
    type: 'turn.failed',
    error: { message: 'Failed' },
  })
})
