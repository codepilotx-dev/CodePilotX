import { expect, test } from 'bun:test'
import {
  isDurableSessionAgentEvent,
  transientStreamRetainedChars,
  appendTransientStreamChunk,
} from './sessionEvents.js'
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

test('renderer retains time-spread deltas as linear chunks without cumulative text copies', () => {
  let chunks: string[] = []
  for (let tick = 0; tick < 250; tick += 1) {
    for (let index = 0; index < 40; index += 1) {
      chunks = appendTransientStreamChunk(
        chunks,
        '12345678901234567890',
        true,
      )
    }
  }
  expect(chunks).toHaveLength(10_000)
  expect(transientStreamRetainedChars(chunks)).toBe(200_000)
  expect(chunks.every(chunk => chunk.length === 20)).toBe(true)
})
