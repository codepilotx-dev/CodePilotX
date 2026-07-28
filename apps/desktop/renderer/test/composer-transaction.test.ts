import { describe, expect, test } from 'bun:test'
import {
  buildDesktopUserMessageContent,
  desktopUserMessageInputToPreviewText,
} from '../shared/desktopUserMessage.js'
import { ComposerDraftStore } from '../src/features/session/composer/composerDraftStore.js'
import {
  executeComposerSubmitTransaction,
  prepareComposerSubmission,
} from '../src/features/session/composer/composerSubmitTransaction.js'
import type { ComposerDraft } from '../src/features/session/composer/composerTypes.js'
import { createComposerDocument } from '../src/features/session/composer/composerTypes.js'

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

  test('publishes an externally selected skill invocation to the active composer', () => {
    const store = new ComposerDraftStore(() => 'draft-1')
    let updates = 0
    const unsubscribe = store.subscribe(() => {
      updates += 1
    })

    store.setSkillInvocation('home', {
      name: 'review',
      path: 'skills/review/SKILL.md',
    })

    expect(store.get('home').skillInvocation).toEqual({
      name: 'review',
      path: 'skills/review/SKILL.md',
    })
    expect(updates).toBe(1)
    unsubscribe()
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

  test('serializes skill submissions with the canonical $name prefix only', () => {
    const input = {
      text: '检查当前改动',
      attachments: [],
      skillInvocation: {
        name: 'review',
        skillPath: 'F:\\skills\\review\\SKILL.md',
      },
    }

    expect(desktopUserMessageInputToPreviewText(input)).toBe(
      '$review\n\n检查当前改动',
    )
    expect(buildDesktopUserMessageContent(input).text).toBe(
      '$review\n\n检查当前改动',
    )
    expect(buildDesktopUserMessageContent(input).text).not.toContain(
      'SKILL.md',
    )
  })

  test('allows a skill-only submission', () => {
    const prepared = prepareComposerSubmission(
      draft({
        document: createComposerDocument(''),
        skillInvocation: { name: 'review', path: 'skills/review' },
      }),
    )

    expect('input' in prepared && prepared.input.skillInvocation?.name).toBe(
      'review',
    )
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

  test('passes the first submitted text when creating a new session', async () => {
    const calls: Array<{ name?: string; prompt?: string }> = []
    const outcome = await executeComposerSubmitTransaction({
      draft: draft({ skillInvocation: { name: 'review', path: 'skills/review' } }),
      createSession: async (name, prompt) => {
        calls.push({ name, prompt })
        return 'session-projectless'
      },
      submitToSession: async () => 'sent',
    })

    expect(calls).toEqual([{
      name: '$review 检查当前改动',
      prompt: '检查当前改动',
    }])
    expect(outcome).toEqual({ status: 'sent', sessionId: 'session-projectless' })
  })

  test('keeps a new-session draft on the source route when creation fails', async () => {
    const events: string[] = []
    const source = draft()
    const outcome = await executeComposerSubmitTransaction({
      draft: source,
      createSession: async () => {
        throw new Error('无法创建无项目工作区')
      },
      navigateToSession: sessionId => events.push(`navigate:${sessionId}`),
      submitToSession: async sessionId => {
        events.push(`send:${sessionId}`)
        return 'sent'
      },
    })

    expect(events).toEqual([])
    expect(outcome).toEqual({
      status: 'failed',
      phase: 'create',
      message: '无法创建无项目工作区',
      sessionId: undefined,
    })
    expect(source.document.text).toBe('检查当前改动')
  })

  test('preserves the queued delivery outcome', async () => {
    let submittedInputId: string | null = null
    const outcome = await executeComposerSubmitTransaction({
      draft: draft(),
      targetSessionId: 'session-running',
      submitToSession: async (_sessionId, _input, metadata) => {
        submittedInputId = metadata.inputId
        return 'queued'
      },
    })

    expect(submittedInputId).toBe('draft-1')
    expect(outcome).toEqual({
      status: 'queued',
      sessionId: 'session-running',
    })
  })
})
