import { describe, expect, test } from 'bun:test'

import {
  canInlineEditConversationTitle,
  canRegenerateConversationTitle,
  normalizeConversationTitle,
  shouldCloseConversationRenameDialog,
  shouldSubmitConversationRename,
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

  test('normalizes title by trimming outer whitespace', () => {
    expect(normalizeConversationTitle('  hello world  ')).toBe('hello world')
    expect(normalizeConversationTitle('\n\t新标题\t ')).toBe('新标题')
    expect(normalizeConversationTitle('   ')).toBe('')
  })

  test('validates when inline rename should submit', () => {
    const valid = {
      currentTitle: '旧标题',
      nextTitle: '新标题',
    }
    expect(shouldSubmitConversationRename(valid)).toBe(true)
    // Same title with whitespace differences
    expect(
      shouldSubmitConversationRename({
        currentTitle: '旧标题',
        nextTitle: '  旧标题  ',
      }),
    ).toBe(false)
    // Empty next title
    expect(
      shouldSubmitConversationRename({
        currentTitle: '旧标题',
        nextTitle: '   ',
      }),
    ).toBe(false)
    // IME composition active
    expect(
      shouldSubmitConversationRename({
        ...valid,
        isComposing: true,
      }),
    ).toBe(false)
    // Already renaming
    expect(
      shouldSubmitConversationRename({
        ...valid,
        isRenaming: true,
      }),
    ).toBe(false)
  })

  test('enables inline editing only when session is active and not busy', () => {
    const ready = {
      hasActiveSession: true,
      isLoading: false,
      isRegenerating: false,
      isRenaming: false,
    }
    expect(canInlineEditConversationTitle(ready)).toBe(true)
    expect(canInlineEditConversationTitle({ ...ready, hasActiveSession: false })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isLoading: true })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isRegenerating: true })).toBe(false)
    expect(canInlineEditConversationTitle({ ...ready, isRenaming: true })).toBe(false)
  })
})
