import { describe, expect, test } from 'bun:test'

import {
  CODEX_HIGHLIGHT_THEMES,
  getThemesForVariant,
  isThemeCompatibleWithVariant,
  normalizeThemeIdForVariant,
  resolveThemeId,
} from '../src/features/syntax/theme.js'

describe('Codex syntax theme resolution', () => {
  test('uses Codex defaults for automatic and invalid selections', () => {
    expect(resolveThemeId('auto', 'light')).toBe('codex-light')
    expect(resolveThemeId('auto', 'dark')).toBe('codex-dark')
    expect(resolveThemeId('codepilotx', 'light')).toBe('codex-light')
    expect(resolveThemeId('not-a-theme', 'dark')).toBe('codex-dark')
  })

  test('accepts only themes matching the active light or dark mode', () => {
    expect(CODEX_HIGHLIGHT_THEMES).toHaveLength(43)
    for (const theme of CODEX_HIGHLIGHT_THEMES) {
      expect(theme.variant === 'light' || theme.variant === 'dark').toBeTrue()
      expect(isThemeCompatibleWithVariant(theme.slug, theme.variant)).toBeTrue()
      expect(resolveThemeId(theme.slug, theme.variant)).toBe(theme.slug)

      const oppositeVariant = theme.variant === 'light' ? 'dark' : 'light'
      expect(isThemeCompatibleWithVariant(theme.slug, oppositeVariant)).toBeFalse()
      expect(normalizeThemeIdForVariant(theme.slug, oppositeVariant)).toBe(
        'auto',
      )
      expect(resolveThemeId(theme.slug, oppositeVariant)).toBe(
        oppositeVariant === 'light' ? 'codex-light' : 'codex-dark',
      )
    }
  })

  test('filters the selector catalog by the active mode', () => {
    const lightThemes = getThemesForVariant('light')
    const darkThemes = getThemesForVariant('dark')

    expect(lightThemes).toHaveLength(16)
    expect(darkThemes).toHaveLength(27)
    expect(lightThemes.every(theme => theme.variant === 'light')).toBeTrue()
    expect(darkThemes.every(theme => theme.variant === 'dark')).toBeTrue()
    expect(
      lightThemes.some(theme => theme.slug === 'github-light-default'),
    ).toBeTrue()
    expect(lightThemes.some(theme => theme.slug === 'dracula')).toBeFalse()
    expect(darkThemes.some(theme => theme.slug === 'dracula')).toBeTrue()
    expect(
      darkThemes.some(theme => theme.slug === 'github-light-default'),
    ).toBeFalse()
    expect(lightThemes.map(theme => theme.label)).toEqual(
      lightThemes
        .map(theme => theme.label)
        .toSorted(new Intl.Collator().compare),
    )
  })
})
