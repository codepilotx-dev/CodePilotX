import { describe, expect, test } from 'bun:test'

import {
  canRegenerateConversationTitle,
  shouldCloseConversationRenameDialog,
} from '../src/features/session/conversation/conversationTitleActions.js'

describe('conversation title actions', () => {
  test('only enables regeneration for a completed session with a first prompt', () => {
    const ready = {
      hasActiveSession: true,
      hasFirstMessage: true,
      pending: false,
      status: 'done' as const,
    }

    expect(canRegenerateConversationTitle(ready)).toBe(true)
    expect(canRegenerateConversationTitle({ ...ready, pending: true })).toBe(false)
    expect(canRegenerateConversationTitle({ ...ready, hasFirstMessage: false })).toBe(false)
    for (const status of [
      'idle',
      'queued',
      'waiting',
      'running',
      'error',
      'interrupted',
    ] as const) {
      expect(canRegenerateConversationTitle({ ...ready, status })).toBe(false)
    }
  })

  test('closes rename only after a successful request for the active session', () => {
    const completed = {
      activeSessionId: 'session-1',
      requestedSessionId: 'session-1',
      succeeded: true,
    }

    expect(shouldCloseConversationRenameDialog(completed)).toBe(true)
    expect(
      shouldCloseConversationRenameDialog({ ...completed, succeeded: false }),
    ).toBe(false)
    expect(
      shouldCloseConversationRenameDialog({
        ...completed,
        activeSessionId: 'session-2',
      }),
    ).toBe(false)
  })
})
