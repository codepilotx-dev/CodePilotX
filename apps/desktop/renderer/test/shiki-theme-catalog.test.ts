import { describe, expect, test } from 'bun:test'
import { bundledLanguages, getSingletonHighlighter } from 'shiki'

import {
  CODEX_HIGHLIGHT_THEME_FAMILIES,
  CODEX_HIGHLIGHT_THEMES,
  loadCodexHighlightTheme,
} from '../shared/codexThemes/manifest.js'

describe('Codex Shiki theme catalog', () => {
  test('matches the 28 Codex selector families and 43 registered variants', () => {
    expect(CODEX_HIGHLIGHT_THEME_FAMILIES).toHaveLength(28)
    expect(CODEX_HIGHLIGHT_THEMES).toHaveLength(43)
    expect(new Set(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).size).toBe(
      43,
    )
    expect(
      new Set(
        CODEX_HIGHLIGHT_THEME_FAMILIES.flatMap(family =>
          [family.themes.light, family.themes.dark].filter(Boolean),
        ),
      ).size,
    ).toBe(43)
    expect(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).toContain(
      'codex-light',
    )
    expect(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).toContain(
      'codex-dark',
    )
    expect(
      CODEX_HIGHLIGHT_THEME_FAMILIES.find(family => family.id === 'github')
        ?.themes,
    ).toEqual({
      light: 'github-light-default',
      dark: 'github-dark-default',
    })
    expect(
      CODEX_HIGHLIGHT_THEME_FAMILIES.find(family => family.id === 'proof')
        ?.themes,
    ).toEqual({ light: 'proof-light', dark: null })
  })

  test('loads and highlights with every registered selector theme', async () => {
    const highlighter = await getSingletonHighlighter({
      langs: [bundledLanguages.typescript],
      themes: [],
    })

    for (const metadata of CODEX_HIGHLIGHT_THEMES) {
      const theme = await loadCodexHighlightTheme(metadata.slug)
      expect(theme.name).toBe(metadata.slug)
      await highlighter.loadTheme(theme)
      const result = highlighter.codeToTokens('const answer = 42', {
        lang: 'typescript',
        theme: metadata.slug,
      })
      expect(result.tokens.flat().some(token => Boolean(token.color))).toBeTrue()
    }
  })
})
