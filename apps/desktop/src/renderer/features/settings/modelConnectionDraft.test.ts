import { describe, expect, test } from 'bun:test'
import {
  createModelConnectionDraft,
  isModelConnectionDraftDirty,
  restoreModelConnectionDraft,
} from './modelConnectionDraft.js'

describe('model connection draft', () => {
  const saved = {
    providerID: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  }

  test('creates an independent draft from the saved connection', () => {
    const draft = createModelConnectionDraft(saved)

    expect(draft).toEqual(saved)
    expect(draft).not.toBe(saved)
  })

  test('only provider, Base URL, and model changes make the draft dirty', () => {
    const draft = createModelConnectionDraft(saved)

    expect(isModelConnectionDraftDirty(draft, saved)).toBe(false)
    expect(isModelConnectionDraftDirty({ ...draft, providerID: 'openai' }, saved)).toBe(true)
    expect(isModelConnectionDraftDirty({ ...draft, baseURL: 'https://example.com/v1' }, saved)).toBe(true)
    expect(
      isModelConnectionDraftDirty({ ...draft, model: 'deepseek-reasoner' }, saved),
    ).toBe(true)
  })

  test('restores a fresh draft from the last saved connection', () => {
    const restored = restoreModelConnectionDraft(saved)

    expect(restored).toEqual(saved)
    expect(restored).not.toBe(saved)
    expect(isModelConnectionDraftDirty(restored, saved)).toBe(false)
  })
})
