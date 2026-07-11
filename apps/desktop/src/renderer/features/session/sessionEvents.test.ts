import { expect, test } from 'bun:test'
import { isDurableSessionAgentEvent } from './sessionEvents.js'
import type { DesktopAgentEvent } from '../../../shared/types.js'

test('partial assistant updates stay outside renderer event history', () => {
  const partial: DesktopAgentEvent = {
    type: 'partial_message',
    sessionId: 'session-1',
    text: 'streaming',
  }
  const final: DesktopAgentEvent = {
    type: 'message',
    sessionId: 'session-1',
    role: 'assistant',
    text: 'final',
  }

  expect(isDurableSessionAgentEvent(partial)).toBe(false)
  expect(isDurableSessionAgentEvent(final)).toBe(true)
})
