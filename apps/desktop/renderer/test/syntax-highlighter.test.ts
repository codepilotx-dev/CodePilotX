import { describe, expect, test } from 'bun:test'
import {
  clearSyntaxHighlightCache,
  highlightCode,
  peekHighlightedCode,
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

  test('returns fresh colors when the selected theme changes', async () => {
    clearSyntaxHighlightCache()
    const code = 'const codexTheme = "ready"'
    const codexDark = await highlightCode({
      code,
      language: 'typescript',
      theme: 'codex-dark',
    })
    const dracula = await highlightCode({
      code,
      language: 'typescript',
      theme: 'dracula',
    })

    expect(codexDark.theme).toBe('codex-dark')
    expect(dracula.theme).toBe('dracula')
    expect(dracula.background).not.toBe(codexDark.background)
    expect(
      dracula.tokens.flat().map(token => token.color),
    ).not.toEqual(codexDark.tokens.flat().map(token => token.color))
  })

  test('does not retain intermediate streaming highlights', async () => {
    clearSyntaxHighlightCache()
    const request = {
      code: 'const streaming = true',
      language: 'typescript',
      theme: 'codex-dark',
    }

    await highlightCode({ ...request, streaming: true })
    expect(peekHighlightedCode(request)).toBeUndefined()

    await highlightCode(request)
    expect(peekHighlightedCode(request)).toBeDefined()
  })
})
