import { describe, expect, test } from 'bun:test'

import {
  CODEX_HIGHLIGHT_THEMES,
  resolveThemeId,
} from '../src/features/syntax/theme.js'

describe('Codex syntax theme resolution', () => {
  test('uses Codex defaults for automatic and invalid selections', () => {
    expect(resolveThemeId('auto', 'light')).toBe('codex-light')
    expect(resolveThemeId('auto', 'dark')).toBe('codex-dark')
    expect(resolveThemeId('codepilotx', 'light')).toBe('codex-light')
    expect(resolveThemeId('not-a-theme', 'dark')).toBe('codex-dark')
  })

  test('accepts only the 91 generated Codex theme slugs', () => {
    expect(CODEX_HIGHLIGHT_THEMES).toHaveLength(91)
    for (const theme of CODEX_HIGHLIGHT_THEMES) {
      expect(resolveThemeId(theme.slug, 'light')).toBe(theme.slug)
      expect(resolveThemeId(theme.slug, 'dark')).toBe(theme.slug)
    }
  })
})
