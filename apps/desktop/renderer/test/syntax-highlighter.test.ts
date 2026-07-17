import { describe, expect, test } from 'bun:test'
import {
  clearSyntaxHighlightCache,
  highlightCode,
  resolveThemeId,
} from '../src/features/syntax/index.js'

describe('Shiki highlighter', () => {
  test('lazily loads representative Codex themes and returns token colors', async () => {
    clearSyntaxHighlightCache()
    const themes = [
      resolveThemeId('auto', 'light'),
      resolveThemeId('auto', 'dark'),
      resolveThemeId('absolutely-dark', 'dark'),
      resolveThemeId('dracula', 'dark'),
      resolveThemeId('tokyo-night', 'dark'),
    ]

    for (const theme of themes) {
      const result = await highlightCode({
        code: 'const answer = 42',
        language: 'typescript',
        theme,
      })
      expect(result.theme).toBe(theme)
      expect(result.tokens.flat().some(token => Boolean(token.color))).toBeTrue()
    }
  })

  test('uses plaintext tokens for an unknown language', async () => {
    const result = await highlightCode({
      code: 'plain content',
      language: 'not-a-real-language',
      theme: 'codex-dark',
    })

    expect(result.language).toBe('text')
    expect(result.tokens[0]?.[0]?.content).toBe('plain content')
  })
})
