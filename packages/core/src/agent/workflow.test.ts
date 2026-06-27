import { expect, test } from 'bun:test'
import {
  WorkflowEventSchemaVersion,
  agentRuntimeEventToThreadEvents,
  createPermissionRequestDecisionEvent,
  createWorkflowContractFixture,
} from './workflow.js'
import type { ThreadEvent, WorkflowEventIds } from './workflow.js'

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

test('proposed plan runtime event maps to a proposed_plan item', () => {
  const events = agentRuntimeEventToThreadEvents(
    {
      type: 'proposed_plan',
      sessionId: 'session-1',
      text: '# Plan\n\n- Step',
      streaming: false,
    },
    ids,
  )

  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'proposed_plan-final',
      type: 'proposed_plan',
      status: 'completed',
      text: '# Plan\n\n- Step',
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

test('runtime tool events preserve upstream tool use ids', () => {
  const started = agentRuntimeEventToThreadEvents(
    {
      type: 'tool_start',
      sessionId: 'session-1',
      toolName: 'AskUserQuestion',
      summary: 'AskUserQuestion',
      toolUseId: 'call-question-1',
    },
    ids,
  )
  const completed = agentRuntimeEventToThreadEvents(
    {
      type: 'tool_result',
      sessionId: 'session-1',
      toolName: 'AskUserQuestion',
      summary: 'InputValidationError',
      toolUseId: 'call-question-1',
      isError: true,
    },
    ids,
  )

  expect(started[0]).toMatchObject({
    type: 'item.started',
    item: {
      id: 'tool_call-call-question-1',
      toolUseId: 'call-question-1',
      metadata: { toolUseId: 'call-question-1' },
    },
  })
  expect(completed[0]).toMatchObject({
    type: 'item.completed',
    item: {
      id: 'tool_result-call-question-1',
      toolUseId: 'call-question-1',
      isError: true,
      metadata: { toolUseId: 'call-question-1' },
    },
  })
})

test('failed runtime tool result preserves readable metadata', () => {
  const events = agentRuntimeEventToThreadEvents(
    {
      type: 'tool_result',
      sessionId: 'session-1',
      toolName: 'Glob',
      summary: 'Glob',
      isError: true,
      metadata: {
        stderr: 'ripgrep executable not found',
        output: 'Install rg or configure bundled path',
      },
    },
    ids,
  )

  expect(events[0]).toMatchObject({
    type: 'item.completed',
    item: {
      type: 'tool_result',
      status: 'failed',
      isError: true,
      metadata: {
        stderr: 'ripgrep executable not found',
        output: 'Install rg or configure bundled path',
      },
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

test('workflow contract fixture normalizes the minimal successful turn chain', () => {
  const events = createWorkflowContractFixture('minimal_success', {
    threadId: 'thread-fixture',
    turnId: 'turn-fixture',
  })

  expect(events.map(event => event.type)).toEqual([
    'thread.started',
    'turn.started',
    'item.completed',
    'turn.completed',
  ])
  expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4])
  expect(events.map(event => event.schemaVersion)).toEqual([
    WorkflowEventSchemaVersion,
    WorkflowEventSchemaVersion,
    WorkflowEventSchemaVersion,
    WorkflowEventSchemaVersion,
  ])
  expect(events.map(event => event.eventId)).toEqual([
    'event-contract-minimal_success-1',
    'event-contract-minimal_success-2',
    'event-contract-minimal_success-3',
    'event-contract-minimal_success-4',
  ])
  expect(events[2]).toMatchObject({
    threadId: 'thread-fixture',
    turnId: 'turn-fixture',
    item: {
      id: 'item-agent-message',
      threadId: 'thread-fixture',
      turnId: 'turn-fixture',
      type: 'agent_message',
      status: 'completed',
    },
  })
})

test('workflow contract fixtures cover item update and terminal turn states', () => {
  const streaming = createWorkflowContractFixture('streaming_message')
  const failed = createWorkflowContractFixture('turn_failure')

  expect(streaming.map(event => event.type)).toEqual([
    'thread.started',
    'turn.started',
    'item.updated',
    'item.completed',
    'turn.completed',
  ])
  expect(streaming[2]).toMatchObject({
    type: 'item.updated',
    item: {
      type: 'agent_message',
      status: 'in_progress',
      streaming: true,
    },
  })
  expect(failed.at(-1)).toMatchObject({
    type: 'turn.failed',
    error: { message: 'Fixture failure', code: 'fixture_error' },
  })
})

test('workflow contract fixtures cover tool permission file and error item shapes', () => {
  const toolItem = itemEvents(createWorkflowContractFixture('tool_lifecycle'))
  const permissionItem = itemEvents(
    createWorkflowContractFixture('permission_lifecycle'),
  )
  const fileItem = itemEvents(createWorkflowContractFixture('file_change'))
  const errorItem = itemEvents(createWorkflowContractFixture('turn_failure'))

  expect(toolItem).toEqual([
    expect.objectContaining({
      type: 'tool_call',
      status: 'in_progress',
      toolName: 'Read',
      toolUseId: 'tool-use-contract',
    }),
    expect.objectContaining({
      type: 'tool_result',
      status: 'completed',
      toolName: 'Read',
      toolUseId: 'tool-use-contract',
      metadata: { content: 'file contents' },
    }),
  ])
  expect(permissionItem).toEqual([
    expect.objectContaining({
      type: 'permission_request',
      status: 'in_progress',
      request: expect.objectContaining({ requestId: 'permission-contract' }),
    }),
    expect.objectContaining({
      type: 'permission_request',
      status: 'completed',
      metadata: { decision: 'allow' },
    }),
  ])
  expect(fileItem).toEqual([
    expect.objectContaining({
      type: 'file_change',
      status: 'completed',
      filePath: 'a.ts',
      patch: '@@ -1 +1 @@',
    }),
  ])
  expect(errorItem).toEqual([
    expect.objectContaining({
      type: 'error',
      status: 'failed',
      message: 'Fixture failure',
      code: 'fixture_error',
    }),
  ])
})

function itemEvents(events: ThreadEvent[]) {
  return events
    .filter(event => 'item' in event)
    .map(event => ('item' in event ? event.item : null))
}
