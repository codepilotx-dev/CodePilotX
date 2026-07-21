import { describe, expect, test } from 'bun:test'
import { ComposerDraftStore } from '../src/features/session/composerDraftStore.js'
import {
  executeComposerSubmitTransaction,
  prepareComposerSubmission,
} from '../src/features/session/composerSubmitTransaction.js'
import type { ComposerDraft } from '../src/features/session/composerTypes.js'
import { createComposerDocument } from '../src/features/session/composerTypes.js'

function draft(overrides: Partial<ComposerDraft> = {}): ComposerDraft {
  return {
    clientId: 'draft-1',
    document: createComposerDocument('检查当前改动'),
    attachments: [],
    collaborationMode: 'default',
    ...overrides,
  }
}

describe('composer submit transaction', () => {
  test('keeps draft buckets isolated and preserves the id when moving HOME', () => {
    let nextId = 0
    const store = new ComposerDraftStore(() => `draft-${++nextId}`)
    store.update('home', current => ({
      ...current,
      document: createComposerDocument('首页草稿'),
    }))

    expect(store.get('session:existing').document.text).toBe('')
    const moved = store.move('home', 'session:created')
    expect(moved?.clientId).toBe('draft-1')
    expect(moved?.document.text).toBe('首页草稿')
    expect(store.peek('home')).toBeUndefined()
  })

  test('prepares a structured skill invocation without rewriting text', () => {
    const prepared = prepareComposerSubmission(
      draft({ skillInvocation: { name: 'review', path: 'skills/review' } }),
    )

    expect('input' in prepared && prepared.input).toEqual({
      text: '检查当前改动',
      attachments: [],
      skillInvocation: {
        name: 'review',
        skillPath: 'skills/review',
      },
    })
  })

  test('navigates before the first send and reports a recoverable send failure', async () => {
    const events: string[] = []
    const source = draft()
    const outcome = await executeComposerSubmitTransaction({
      draft: source,
      createSession: async () => {
        events.push('create')
        return 'session-1'
      },
      navigateToSession: sessionId => events.push(`navigate:${sessionId}`),
      submitToSession: async sessionId => {
        events.push(`send:${sessionId}`)
        throw new Error('发送失败')
      },
    })

    expect(events).toEqual([
      'create',
      'navigate:session-1',
      'send:session-1',
    ])
    expect(outcome).toEqual({
      status: 'failed',
      phase: 'send',
      message: '发送失败',
      sessionId: 'session-1',
    })
    expect(source.document.text).toBe('检查当前改动')
  })

  test('preserves the queued delivery outcome', async () => {
    const outcome = await executeComposerSubmitTransaction({
      draft: draft(),
      targetSessionId: 'session-running',
      submitToSession: async () => 'queued',
    })

    expect(outcome).toEqual({
      status: 'queued',
      sessionId: 'session-running',
    })
  })
})
