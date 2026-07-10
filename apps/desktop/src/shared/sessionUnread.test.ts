import { expect, test } from 'bun:test'
import type { DesktopAgentEvent } from './types.js'
import { shouldMarkSessionUnread } from './sessionUnread.js'

const event = (overrides: Partial<DesktopAgentEvent>): DesktopAgentEvent =>
  ({
    type: 'message',
    sessionId: 'session-2',
    role: 'assistant',
    text: '完成',
    ...overrides,
  }) as DesktopAgentEvent

test('marks inactive assistant messages as unread', () => {
  expect(shouldMarkSessionUnread(event({}), 'session-1')).toBe(true)
})

test('does not mark the active session as unread', () => {
  expect(shouldMarkSessionUnread(event({}), 'session-2')).toBe(false)
})

test('marks inactive errors as unread', () => {
  expect(shouldMarkSessionUnread(event({ type: 'error' }), 'session-1')).toBe(
    true,
  )
})

test('ignores user messages and non-terminal events', () => {
  expect(
    shouldMarkSessionUnread(event({ role: 'user' }), 'session-1'),
  ).toBe(false)
  expect(shouldMarkSessionUnread(event({ type: 'partial_message' }), 'session-1')).toBe(
    false,
  )
})
