import { expect, test } from 'bun:test'
import type { DesktopWorkflowEvent } from '../../../shared/types.js'
import {
  appendUniqueWorkflowEvent,
  dedupeWorkflowEvents,
} from './workflowEventDedup.js'

const base = {
  threadId: 'thread-1',
  turnId: 'turn-1',
  createdAt: '2026-06-22T00:00:00.000Z',
} as const

type ItemWorkflowEvent = DesktopWorkflowEvent & {
  type: 'item.started'
  item: {
    id: string
    toolUseId?: string
  }
}

test('appendUniqueWorkflowEvent ignores duplicate event ids', () => {
  const event = turnStarted('event-1')

  const events = appendUniqueWorkflowEvent(
    appendUniqueWorkflowEvent([], event),
    { ...event, createdAt: '2026-06-22T00:00:01.000Z' },
  )

  expect(events).toHaveLength(1)
  expect(events[0]?.createdAt).toBe(base.createdAt)
})

test('appendUniqueWorkflowEvent keeps only the recent event window', () => {
  const events = Array.from({ length: 130 }, (_, index) =>
    turnStarted(`event-${index}`),
  ).reduce(
    (current, event) => appendUniqueWorkflowEvent(current, event),
    [] as DesktopWorkflowEvent[],
  )

  expect(events).toHaveLength(100)
  expect(events[0]?.eventId).toBe('event-30')
  expect(events.at(-1)?.eventId).toBe('event-129')
})

test('dedupeWorkflowEvents uses a fallback key for events without event ids', () => {
  const event = toolCall(undefined)
  const duplicate = toolCall(undefined)
  const distinctBase = toolCall(undefined)
  const distinct: DesktopWorkflowEvent = {
    ...distinctBase,
    item: {
      ...distinctBase.item,
      id: 'tool_call-tool-2',
      toolUseId: 'tool-2',
    },
  }

  const events = dedupeWorkflowEvents([event, duplicate, distinct])

  expect(events).toHaveLength(2)
  expect(events.map(workflowEvent => workflowEvent.eventId)).toEqual([
    undefined,
    undefined,
  ])
})

test('streaming workflow messages keep one transient event and final replaces it', () => {
  let events: DesktopWorkflowEvent[] = []
  for (let index = 0; index < 10_000; index += 1) {
    events = appendUniqueWorkflowEvent(events, agentMessage(`partial-${index}`, true))
  }
  expect(events).toHaveLength(1)
  expect('item' in events[0]! ? events[0].item.text : '').toBe('partial-9999')

  events = appendUniqueWorkflowEvent(events, agentMessage('final', false))
  expect(events).toHaveLength(1)
  expect('item' in events[0]! ? events[0].item.text : '').toBe('final')
})

function turnStarted(eventId: string): DesktopWorkflowEvent {
  return {
    eventId,
    type: 'turn.started',
    ...base,
  }
}

function toolCall(eventId: string | undefined): ItemWorkflowEvent {
  return {
    ...(eventId ? { eventId } : {}),
    type: 'item.started',
    ...base,
    item: {
      id: 'tool_call-tool-1',
      type: 'tool_call',
      status: 'in_progress',
      createdAt: base.createdAt,
      ...base,
      toolName: 'Read',
      toolUseId: 'tool-1',
      summary: 'read file',
    },
  } as ItemWorkflowEvent
}

function agentMessage(text: string, streaming: boolean): DesktopWorkflowEvent {
  return {
    eventId: `event-${text}`,
    type: streaming ? 'item.updated' : 'item.completed',
    ...base,
    item: {
      id: streaming ? 'agent_message-partial' : 'agent_message-final',
      type: 'agent_message',
      status: streaming ? 'in_progress' : 'completed',
      createdAt: base.createdAt,
      ...base,
      text,
      streaming,
    },
  } as DesktopWorkflowEvent
}
