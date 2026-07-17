import { describe, expect, test } from 'bun:test'
import { loadCachedSlashCommands } from '../src/features/session/DesktopComposer.js'
import { getActiveComposerMention } from '../src/features/session/ComposerCard.js'

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
})
