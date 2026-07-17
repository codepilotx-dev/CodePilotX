import { describe, expect, test } from 'bun:test'

import { resolveThemeId } from '../src/features/syntax/theme.js'

describe('syntax theme resolution', () => {
  test('maps product theme families by variant', () => {
    expect(resolveThemeId('CodePilotX', 'light')).toBe(
      'github-light-default',
    )
    expect(resolveThemeId('catppuccin', 'dark')).toBe('catppuccin-mocha')
    expect(resolveThemeId('material', 'light')).toBe(
      'material-theme-lighter',
    )
    expect(resolveThemeId('vscode-plus', 'dark')).toBe('dark-plus')
  })

  test('keeps native Shiki themes and falls back unknown product themes', () => {
    expect(resolveThemeId('tokyo-night', 'dark')).toBe('tokyo-night')
    expect(resolveThemeId('nord', 'light')).toBe('nord')
    expect(resolveThemeId('raycast', 'dark')).toBe('github-dark-default')
    expect(resolveThemeId('absolutely', 'light')).toBe(
      'github-light-default',
    )
  })
})
