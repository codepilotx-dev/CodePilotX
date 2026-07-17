import { describe, expect, test } from 'bun:test'
import { bundledLanguages, getSingletonHighlighter } from 'shiki'

import {
  CODEX_HIGHLIGHT_THEMES,
  loadCodexHighlightTheme,
} from '../shared/codexThemes/manifest.js'

describe('Codex Shiki theme catalog', () => {
  test('contains exactly 91 logical themes backed by 151 physical modules', () => {
    expect(CODEX_HIGHLIGHT_THEMES).toHaveLength(91)
    expect(new Set(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).size).toBe(
      91,
    )
    expect(
      new Set(
        CODEX_HIGHLIGHT_THEMES.flatMap(theme =>
          theme.physicalFiles.map(file => file.path),
        ),
      ).size,
    ).toBe(151)
    expect(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).toContain(
      'codex-light',
    )
    expect(CODEX_HIGHLIGHT_THEMES.map(theme => theme.slug)).toContain(
      'codex-dark',
    )
  })

  test('loads and highlights with every generated theme', async () => {
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
