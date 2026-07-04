import { expect, test } from 'bun:test'
import { SequenceTracker } from './sequence.js'
import type { ThreadEvent } from './workflow.js'

test('SequenceTracker starts at 0 and increments on next()', () => {
  const tracker = new SequenceTracker()
  expect(tracker.current('thread-1')).toBe(0)
  expect(tracker.next('thread-1')).toBe(1)
  expect(tracker.next('thread-1')).toBe(2)
  expect(tracker.current('thread-1')).toBe(2)
})

test('SequenceTracker maintains separate sequences per thread', () => {
  const tracker = new SequenceTracker()
  expect(tracker.next('thread-a')).toBe(1)
  expect(tracker.next('thread-b')).toBe(1)
  expect(tracker.next('thread-a')).toBe(2)
  expect(tracker.next('thread-b')).toBe(2)
  expect(tracker.next('thread-a')).toBe(3)
})

test('SequenceTracker.reset() clears thread sequence', () => {
  const tracker = new SequenceTracker()
  tracker.next('thread-1')
  tracker.next('thread-1')
  expect(tracker.current('thread-1')).toBe(2)
  tracker.reset('thread-1')
  expect(tracker.current('thread-1')).toBe(0)
  expect(tracker.next('thread-1')).toBe(1)
})

test('SequenceTracker.createEventIds() returns factories for WorkflowEventIds', () => {
  const tracker = new SequenceTracker()
  const ids = tracker.createEventIds('thread-1')

  expect(typeof ids.eventId).toBe('function')
  expect(typeof ids.sequence).toBe('function')

  const seq1 = ids.sequence()
  expect(seq1).toBe(1)

  const fakeEvent = { threadId: 'thread-1' } as ThreadEvent
  const eid = ids.eventId(fakeEvent, 2)
  expect(eid).toContain('event')
  expect(eid).toContain('thread-1')
})
