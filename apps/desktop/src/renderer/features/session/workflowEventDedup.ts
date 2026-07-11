import type { DesktopWorkflowEvent } from '../../../shared/types.js'

const MAX_WORKFLOW_EVENTS = 100

export function workflowEventKey(event: DesktopWorkflowEvent): string {
  if (event.eventId) return `event:${event.eventId}`
  const turnId = 'turnId' in event ? event.turnId : 'thread'
  const itemId = 'item' in event ? event.item.id : 'no-item'
  return [
    'fallback',
    event.threadId,
    turnId,
    event.type,
    event.createdAt,
    itemId,
  ].join(':')
}

export function appendUniqueWorkflowEvent(
  events: DesktopWorkflowEvent[],
  event: DesktopWorkflowEvent,
): DesktopWorkflowEvent[] {
  const streamKey = agentMessageStreamKey(event)
  if (streamKey) {
    const streaming = isStreamingAgentMessage(event)
    if (
      streaming &&
      events.some(
        existing =>
          agentMessageStreamKey(existing) === streamKey &&
          !isStreamingAgentMessage(existing),
      )
    ) {
      return events
    }
    events = events.filter(
      existing =>
        agentMessageStreamKey(existing) !== streamKey ||
        !isStreamingAgentMessage(existing),
    )
  }
  const key = workflowEventKey(event)
  if (events.some(existing => workflowEventKey(existing) === key)) {
    return events
  }
  return [...events, event].slice(-MAX_WORKFLOW_EVENTS)
}

function agentMessageStreamKey(event: DesktopWorkflowEvent): string | null {
  if (!('item' in event) || event.item.type !== 'agent_message') return null
  return `${event.threadId}:${event.turnId}`
}

function isStreamingAgentMessage(event: DesktopWorkflowEvent): boolean {
  return (
    'item' in event &&
    event.item.type === 'agent_message' &&
    event.item.streaming === true
  )
}

export function dedupeWorkflowEvents(
  events: DesktopWorkflowEvent[],
): DesktopWorkflowEvent[] {
  const seen = new Set<string>()
  const uniqueEvents: DesktopWorkflowEvent[] = []
  for (const event of events) {
    const key = workflowEventKey(event)
    if (seen.has(key)) continue
    seen.add(key)
    uniqueEvents.push(event)
  }
  return uniqueEvents
}
