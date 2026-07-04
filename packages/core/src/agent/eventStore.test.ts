import { expect, test } from 'bun:test'
import { InMemoryEventStore } from './eventStore.js'
import type { ThreadEvent } from './workflow.js'

function makeEvent(threadId: string, sequence: number, type = 'thread.started'): ThreadEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${threadId}-${sequence}`,
    sequence,
    type: type as ThreadEvent['type'],
    threadId,
    createdAt: '2026-07-03T00:00:00.000Z',
    metadata: {},
  } as ThreadEvent
}

test('InMemoryEventStore.append stores events per thread', () => {
  const store = new InMemoryEventStore()
  store.append(makeEvent('t1', 1))
  store.append(makeEvent('t1', 2))
  store.append(makeEvent('t2', 1))

  expect(store.getEventCount('t1')).toBe(2)
  expect(store.getEventCount('t2')).toBe(1)
  expect(store.getEvents('t1')).toHaveLength(2)
  expect(store.getEvents('t3')).toHaveLength(0)
})

test('InMemoryEventStore.clear removes thread events', () => {
  const store = new InMemoryEventStore()
  store.append(makeEvent('t1', 1))
  store.append(makeEvent('t1', 2))
  expect(store.getEventCount('t1')).toBe(2)

  store.clear('t1')
  expect(store.getEventCount('t1')).toBe(0)
})

test('InMemoryEventStore.totalEventCount aggregates across threads', () => {
  const store = new InMemoryEventStore()
  expect(store.totalEventCount).toBe(0)

  store.append(makeEvent('t1', 1))
  store.append(makeEvent('t1', 2))
  store.append(makeEvent('t2', 1))

  expect(store.totalEventCount).toBe(3)
})
