import { describe, expect, test } from 'bun:test'
import { loadCachedSlashCommands } from '../src/features/session/composer/DesktopComposer.js'
import {
  getActiveComposerMention,
  shouldSubmitComposerKey,
} from '../src/features/session/composer/ComposerCard.js'
import {
  removeGeneratedSuggestionStarter,
  selectNewSessionSuggestionCategory,
  syncNewSessionSuggestionState,
} from '../src/features/session/newSessionSuggestionState.js'

describe('composer suggestions', () => {
  test('loads slash commands once per workspace', async () => {
    let calls = 0
    const loader = async () => {
      calls += 1
      return [{ name: 'review', title: '审查', description: '审查代码', category: 'command' as const }]
    }
    const workspace = `workspace-${crypto.randomUUID()}`

    const [first, second] = await Promise.all([
      loadCachedSlashCommands(workspace, loader),
      loadCachedSlashCommands(workspace, loader),
    ])

    expect(calls).toBe(1)
    expect(second).toEqual(first)
  })

  test('recognizes only the mention under the cursor', () => {
    expect(getActiveComposerMention('检查 @review', 10)).toEqual({
      start: 3,
      end: 10,
      query: 'review',
    })
    expect(getActiveComposerMention('检查 @review-more', 10)).toBeNull()
    expect(getActiveComposerMention('email@example.com', 9)).toBeNull()
  })

  test('keeps category suggestions while editing and only removes generated starter text', () => {
    const category = selectNewSessionSuggestionCategory('codex-explore')
    expect(syncNewSessionSuggestionState(category, '继续补充细节')).toEqual(category)
    expect(removeGeneratedSuggestionStarter('Explore repository tests', 'Explore ')).toBe('repository tests')
    expect(removeGeneratedSuggestionStarter('用户自己的内容', 'Explore ')).toBe('用户自己的内容')
  })

  test('supports Enter and both Ctrl+Enter submission modes without breaking IME', () => {
    const event = {
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      isComposing: false,
      keyCode: 13,
    }
    expect(shouldSubmitComposerKey(event, 'enter', '单行')).toBe(true)
    expect(shouldSubmitComposerKey(event, 'multiline-ctrl-enter', '一\n二')).toBe(false)
    expect(
      shouldSubmitComposerKey(
        { ...event, ctrlKey: true },
        'multiline-ctrl-enter',
        '一\n二',
      ),
    ).toBe(true)
    expect(shouldSubmitComposerKey(event, 'ctrl-enter', '单行')).toBe(false)
    expect(
      shouldSubmitComposerKey({ ...event, isComposing: true }, 'enter', '输入中'),
    ).toBe(false)
  })
})
