import { expect, test } from 'bun:test'
import { createPermissionRequestDecisionEvent } from '@codepilotx/core/agent/workflow.js'
import { deriveWorkflowSessionState } from './workflowReducer.js'
import type { DesktopWorkflowEvent } from './types.js'

const base = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  createdAt: '2026-06-22T00:00:00.000Z',
} as const

test('workflow events derive timeline events and pair same-name tools by id', () => {
  const events: DesktopWorkflowEvent[] = [
    {
      eventId: 'e1',
      sequence: 1,
      type: 'turn.started',
      ...base,
    },
    toolCall('e2', 2, 'tool-a', 'Read', 'read a.ts'),
    toolCall('e3', 3, 'tool-b', 'Read', 'read b.ts'),
    toolResult('e4', 4, 'tool-b', 'Read', 'b ok'),
    toolResult('e5', 5, 'tool-a', 'Read', 'a ok'),
  ]

  const derived = deriveWorkflowSessionState(events, 'thread-1')

  expect(derived.events.map(event => event.type)).toEqual([
    'tool_call',
    'tool_call',
    'tool_result',
    'tool_result',
  ])
  expect(derived.toolRuns).toMatchObject([
    {
      toolUseId: 'tool-a',
      callContent: 'read a.ts',
      resultContent: 'a ok',
      isRunning: false,
    },
    {
      toolUseId: 'tool-b',
      callContent: 'read b.ts',
      resultContent: 'b ok',
      isRunning: false,
    },
  ])
  expect(derived.diagnostics.duplicateEventIds).toEqual([])
  expect(derived.diagnostics.missingToolResults).toEqual([])
  expect(derived.diagnostics.outOfOrderSequences).toEqual([])
})

test('workflow reducer closes pending permissions from terminal request item', () => {
  const request = {
    requestId: 'permission-1',
    toolName: 'Edit',
    input: { file_path: 'a.ts' },
    description: 'Edit a.ts',
  }
  const started: DesktopWorkflowEvent = {
    eventId: 'e1',
    sequence: 1,
    type: 'item.started',
    ...base,
    item: {
      id: 'permission_request-permission-1',
      type: 'permission_request',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      request,
    },
  }
  const denied = createPermissionRequestDecisionEvent({
    ...base,
    request,
    behavior: 'deny',
    sequence: 2,
    eventId: 'e2',
  })

  const derived = deriveWorkflowSessionState([started, denied], 'thread-1')

  expect(derived.pendingPermissions).toEqual([])
  expect(derived.events).toHaveLength(1)
})

test('workflow reducer reports duplicate, missing result, and sequence issues', () => {
  const derived = deriveWorkflowSessionState(
    [
      toolCall('dup', 2, 'tool-a', 'Bash', 'npm test'),
      toolCall('dup', 1, 'tool-b', 'Bash', 'npm build'),
      toolCall('late', 1, 'tool-c', 'Bash', 'npm lint'),
    ],
    'thread-1',
  )

  expect(derived.diagnostics.duplicateEventIds).toEqual(['dup'])
  expect(derived.diagnostics.outOfOrderSequences).toEqual([
    { previous: 2, current: 1 },
  ])
  expect(derived.diagnostics.missingToolResults).toEqual(['tool-a', 'tool-c'])
})

test('workflow reducer carries tool result error state and timestamps', () => {
  const derived = deriveWorkflowSessionState(
    [
      toolCall('e1', 1, 'tool-a', 'Bash', 'bun test'),
      toolResult('e2', 2, 'tool-a', 'Bash', 'failed', true),
    ],
    'thread-1',
  )

  expect(derived.toolRuns).toMatchObject([
    {
      toolUseId: 'tool-a',
      callContent: 'bun test',
      resultContent: 'failed',
      callCreatedAt: base.createdAt,
      resultCreatedAt: base.createdAt,
      isError: true,
      isRunning: false,
    },
  ])
})

function toolCall(
  eventId: string,
  sequence: number,
  toolUseId: string,
  toolName: string,
  summary: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.started',
    ...base,
    item: {
      id: `tool_call-${toolUseId}`,
      type: 'tool_call',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      toolName,
      toolUseId,
      summary,
    },
  }
}

function toolResult(
  eventId: string,
  sequence: number,
  toolUseId: string,
  toolName: string,
  summary: string,
  isError = false,
): DesktopWorkflowEvent {
  return {
    eventId,
    sequence,
    type: 'item.completed',
    ...base,
    item: {
      id: `tool_result-${toolUseId}`,
      type: 'tool_result',
      status: isError ? 'failed' : 'completed',
      createdAt: base.createdAt,
      ...base,
      toolName,
      toolUseId,
      summary,
      isError,
    },
  }
}
