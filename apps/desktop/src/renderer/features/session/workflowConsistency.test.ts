import { expect, test } from 'bun:test'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import {
  deriveWorkflowConsistencyDiagnostics,
  workflowConsistencyIssueCount,
} from './workflowConsistency.js'

test('deriveWorkflowConsistencyDiagnostics reports incomplete turns and unpaired tools', () => {
  const diagnostics = deriveWorkflowConsistencyDiagnostics({
    activeSessionId: 'session-1',
    currentView: { messages: [] },
    workflowEvents: [
      turnStarted('event-1', 'session-1', 'turn-1'),
      toolCall('event-2', 'session-1', 'turn-1', 'tool-1'),
      toolResult('event-3', 'session-1', 'turn-1', 'tool-orphan'),
    ],
  })

  expect(diagnostics).toMatchObject({
    missingTurnCompletions: ['turn-1'],
    unpairedToolCalls: ['tool-1'],
    unpairedToolResults: ['tool-orphan'],
  })
  expect(workflowConsistencyIssueCount(diagnostics)).toBe(3)
})

test('deriveWorkflowConsistencyDiagnostics reports pending permissions without decisions', () => {
  const diagnostics = deriveWorkflowConsistencyDiagnostics({
    activeSessionId: 'session-1',
    currentView: { messages: [] },
    workflowEvents: [
      turnStarted('event-1', 'session-1', 'turn-1'),
      {
        eventId: 'event-2',
        schemaVersion: 1,
        sequence: 2,
        type: 'item.started',
        threadId: 'session-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:01.000Z',
        item: {
          id: 'permission-1',
          type: 'permission_request',
          threadId: 'session-1',
          turnId: 'turn-1',
          status: 'in_progress',
          createdAt: '2026-06-22T00:00:01.000Z',
          request: {
            requestId: 'permission-1',
            toolName: 'Edit',
            input: { file_path: 'a.ts' },
            description: 'Edit a.ts',
          },
        },
      },
      turnCompleted('event-3', 'session-1', 'turn-1', ''),
    ],
  })

  expect(diagnostics.pendingPermissionRequests).toEqual(['permission-1'])
})

test('deriveWorkflowConsistencyDiagnostics compares workflow final response with transcript', () => {
  const diagnostics = deriveWorkflowConsistencyDiagnostics({
    activeSessionId: 'session-1',
    currentView: {
      messages: [
        {
          id: 'message-1',
          role: 'assistant',
          text: 'Transcript final',
          createdAt: '2026-06-22T00:00:03.000Z',
        },
      ],
    },
    workflowEvents: [
      turnStarted('event-1', 'session-1', 'turn-1'),
      turnCompleted('event-2', 'session-1', 'turn-1', 'Workflow final'),
    ],
  })

  expect(diagnostics.finalResponseMismatches).toEqual([
    { workflow: 'Workflow final', transcript: 'Transcript final' },
  ])
})

test('deriveWorkflowConsistencyDiagnostics reports workflow events from other threads', () => {
  const diagnostics = deriveWorkflowConsistencyDiagnostics({
    activeSessionId: 'session-1',
    currentView: { messages: [] },
    workflowEvents: [
      turnStarted('event-1', 'session-1', 'turn-1'),
      turnStarted('event-2', 'session-2', 'turn-1'),
      turnStarted('event-3', 'session-2', 'turn-2'),
    ],
  })

  expect(diagnostics.mixedThreadIds).toEqual(['session-2'])
})

function turnStarted(
  eventId: string,
  threadId: string,
  turnId: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    schemaVersion: 1,
    sequence: Number(eventId.replace('event-', '')),
    type: 'turn.started',
    threadId,
    turnId,
    createdAt: '2026-06-22T00:00:00.000Z',
  }
}

function turnCompleted(
  eventId: string,
  threadId: string,
  turnId: string,
  finalResponse: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    schemaVersion: 1,
    sequence: Number(eventId.replace('event-', '')),
    type: 'turn.completed',
    threadId,
    turnId,
    createdAt: '2026-06-22T00:00:02.000Z',
    finalResponse,
    stopReason: 'fixture',
  }
}

function toolCall(
  eventId: string,
  threadId: string,
  turnId: string,
  toolUseId: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    schemaVersion: 1,
    sequence: Number(eventId.replace('event-', '')),
    type: 'item.started',
    threadId,
    turnId,
    createdAt: '2026-06-22T00:00:01.000Z',
    item: {
      id: `call-${toolUseId}`,
      type: 'tool_call',
      threadId,
      turnId,
      status: 'in_progress',
      createdAt: '2026-06-22T00:00:01.000Z',
      toolName: 'Read',
      summary: 'Read file',
      toolUseId,
    },
  }
}

function toolResult(
  eventId: string,
  threadId: string,
  turnId: string,
  toolUseId: string,
): DesktopWorkflowEvent {
  return {
    eventId,
    schemaVersion: 1,
    sequence: Number(eventId.replace('event-', '')),
    type: 'item.completed',
    threadId,
    turnId,
    createdAt: '2026-06-22T00:00:02.000Z',
    item: {
      id: `result-${toolUseId}`,
      type: 'tool_result',
      threadId,
      turnId,
      status: 'completed',
      createdAt: '2026-06-22T00:00:02.000Z',
      toolName: 'Read',
      summary: 'Read complete',
      toolUseId,
    },
  }
}
