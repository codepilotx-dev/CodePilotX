import { describe, expect, test } from 'bun:test'

import {
  canRegenerateConversationTitle,
  isRenameConversationShortcut,
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

  test('recognizes only Ctrl+Alt+R as the rename shortcut', () => {
    const shortcut = {
      altKey: true,
      ctrlKey: true,
      key: 'R',
      metaKey: false,
      repeat: false,
      shiftKey: false,
    }

    expect(isRenameConversationShortcut(shortcut)).toBe(true)
    expect(isRenameConversationShortcut({ ...shortcut, altKey: false })).toBe(false)
    expect(isRenameConversationShortcut({ ...shortcut, shiftKey: true })).toBe(false)
    expect(isRenameConversationShortcut({ ...shortcut, repeat: true })).toBe(false)
    expect(isRenameConversationShortcut({ ...shortcut, key: 'P' })).toBe(false)
  })
})
