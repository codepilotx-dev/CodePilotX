import { describe, expect, test } from 'bun:test'
import type { ThreadEvent } from './workflow.js'
import { deriveWorkflowSessionView } from './workflowView.js'

describe('deriveWorkflowSessionView', () => {
  test('replays workflow events into messages, tool runs, permissions, and status', () => {
    const events: ThreadEvent[] = [
      {
        eventId: 'event-1',
        sequence: 1,
        type: 'thread.started',
        threadId: 'thread-1',
        createdAt: '2026-06-22T00:00:00.000Z',
      },
      {
        eventId: 'event-2',
        sequence: 2,
        type: 'turn.started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:01.000Z',
      },
      {
        eventId: 'event-3',
        sequence: 3,
        type: 'item.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:02.000Z',
        item: {
          id: 'item-user',
          type: 'user_message',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          createdAt: '2026-06-22T00:00:02.000Z',
          text: 'hello',
        },
      },
      {
        eventId: 'event-4',
        sequence: 4,
        type: 'item.started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:03.000Z',
        item: {
          id: 'item-tool-call',
          type: 'tool_call',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'in_progress',
          createdAt: '2026-06-22T00:00:03.000Z',
          toolName: 'Read',
          summary: 'Read: a.ts',
          toolUseId: 'tool-1',
        },
      },
      {
        eventId: 'event-5',
        sequence: 5,
        type: 'item.started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:04.000Z',
        item: {
          id: 'item-permission',
          type: 'permission_request',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'in_progress',
          createdAt: '2026-06-22T00:00:04.000Z',
          request: {
            requestId: 'permission-1',
            toolName: 'Edit',
            input: { file_path: 'a.ts' },
            description: 'Edit a.ts',
          },
        },
      },
      {
        eventId: 'event-6',
        sequence: 6,
        type: 'item.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:05.000Z',
        item: {
          id: 'item-permission',
          type: 'permission_request',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          createdAt: '2026-06-22T00:00:04.000Z',
          request: {
            requestId: 'permission-1',
            toolName: 'Edit',
            input: { file_path: 'a.ts' },
            description: 'Edit a.ts',
          },
          metadata: { decision: 'allow' },
        },
      },
      {
        eventId: 'event-7',
        sequence: 7,
        type: 'item.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:06.000Z',
        item: {
          id: 'item-tool-result',
          type: 'tool_result',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          createdAt: '2026-06-22T00:00:06.000Z',
          toolName: 'Read',
          summary: 'done',
          toolUseId: 'tool-1',
        },
      },
      {
        eventId: 'event-8',
        sequence: 8,
        type: 'turn.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:07.000Z',
        finalResponse: 'done',
      },
    ]

    const view = deriveWorkflowSessionView(events, 'thread-1')

    expect(view.turnStatus).toBe('done')
    expect(view.messages).toEqual([
      {
        id: 'event-3',
        role: 'user',
        text: 'hello',
        createdAt: '2026-06-22T00:00:02.000Z',
      },
    ])
    expect(view.toolRuns).toEqual([
      {
        id: 'item-tool-call',
        toolUseId: 'tool-1',
        toolName: 'Read',
        callContent: 'Read: a.ts',
        resultContent: 'done',
        callCreatedAt: '2026-06-22T00:00:03.000Z',
        resultCreatedAt: '2026-06-22T00:00:06.000Z',
        isError: false,
        isRunning: false,
      },
    ])
    expect(view.pendingPermissions).toEqual([])
    expect(view.diagnostics).toEqual({
      duplicateEventIds: [],
      missingToolResults: [],
      outOfOrderSequences: [],
    })
  })

  test('replays proposed plan items into session events without adding chat messages', () => {
    const events: ThreadEvent[] = [
      {
        eventId: 'event-1',
        sequence: 1,
        type: 'thread.started',
        threadId: 'thread-1',
        createdAt: '2026-06-22T00:00:00.000Z',
      },
      {
        eventId: 'event-2',
        sequence: 2,
        type: 'turn.started',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:01.000Z',
      },
      {
        eventId: 'event-3',
        sequence: 3,
        type: 'item.completed',
        threadId: 'thread-1',
        turnId: 'turn-1',
        createdAt: '2026-06-22T00:00:02.000Z',
        item: {
          id: 'item-plan',
          type: 'proposed_plan',
          threadId: 'thread-1',
          turnId: 'turn-1',
          status: 'completed',
          createdAt: '2026-06-22T00:00:02.000Z',
          text: '# Plan',
        },
      },
    ]

    const view = deriveWorkflowSessionView(events, 'thread-1')

    expect(view.messages).toEqual([])
    expect(view.events).toEqual([
      expect.objectContaining({
        id: 'event-3',
        sessionId: 'thread-1',
        type: 'proposed_plan',
        content: '# Plan',
      }),
    ])
  })
})
