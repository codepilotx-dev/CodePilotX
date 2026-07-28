import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME,
  getCodeThemeSelectionForVariant,
  normalizeDesktopThemeSettings,
} from '../shared/theme.js'
import { deriveThemeVariables } from '../src/features/theme/themeVariables.js'

describe('fixed Codex UI themes', () => {
  test('locks the Codex light and dark semantic surfaces', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    expect(DEFAULT_LIGHT_THEME.codeThemeId).toBe('codex-light')
    expect(light['--color-background-surface-under']).toBe('#f6f6f6')
    expect(light['--color-background-surface']).toBe('#ffffff')
    expect(light['--color-text-foreground']).toBe('#1a1c1f')
    expect(light['--color-text-foreground-secondary']).toBe(
      'rgba(26, 28, 31, 0.695)',
    )
    expect(light['--color-text-foreground-tertiary']).toBe(
      'rgba(26, 28, 31, 0.495)',
    )
    expect(light['--color-border-light']).toBe('rgba(26, 28, 31, 0.049)')
    expect(light['--color-border']).toBe('rgba(26, 28, 31, 0.078)')
    expect(light['--color-border-heavy']).toBe('rgba(26, 28, 31, 0.117)')

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-dark')
    expect(dark['--color-background-surface-under']).toBe('#141414')
    expect(dark['--color-background-surface']).toBe('#181818')
    expect(dark['--color-text-foreground']).toBe('#ffffff')
    expect(dark['--color-background-panel']).toBe('#232323')
    expect(dark['--color-text-foreground-secondary']).toBe(
      'rgba(255, 255, 255, 0.71)',
    )
    expect(dark['--color-text-foreground-tertiary']).toBe(
      'rgba(255, 255, 255, 0.498)',
    )
    expect(dark['--color-border-light']).toBe(
      'rgba(255, 255, 255, 0.042)',
    )
    expect(dark['--color-border']).toBe(
      'rgba(255, 255, 255, 0.084)',
    )
    expect(dark['--color-border-heavy']).toBe(
      'rgba(255, 255, 255, 0.156)',
    )
    expect(dark['--codex-base-on-accent']).toBe('#ffffff')
  })

  test('uses the recovered Codex runtime formulas for Dracula', () => {
    const variables = deriveThemeVariables({
      codeThemeId: 'dracula',
      variant: 'dark',
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        accent: '#ff79c6',
        surface: '#282a36',
        ink: '#f8f8f2',
        semanticColors: {
          diffAdded: '#50fa7b',
          diffRemoved: '#ff5555',
          skill: '#ff79c6',
        },
      },
    })

    expect(variables['--color-background-surface']).toBe('#282a36')
    expect(variables['--color-background-surface-under']).toBe('#22232d')
    expect(variables['--color-background-panel']).toBe('#32343f')
    expect(variables['--color-background-elevated-secondary-opaque']).toBe(
      '#373843',
    )
    expect(variables['--color-background-editor-opaque']).toBe(
      'rgb(55, 56, 67)',
    )
    expect(variables['--color-text-accent']).toBe('rgb(255, 173, 220)')
    expect(variables['--color-decoration-added']).toBe('#50fa7b')
  })

  test('keeps the recovered contrast boundary palette deterministic', () => {
    const expected = [
      [0, 'rgba(26, 28, 31, 0.039)', '#ffffff'],
      [45, 'rgba(26, 28, 31, 0.078)', '#f6f6f6'],
      [60, 'rgba(26, 28, 31, 0.104)', '#f2f2f2'],
      [100, 'rgba(26, 28, 31, 0.173)', '#e7e7e7'],
    ] as const

    for (const [contrast, border, surfaceUnder] of expected) {
      const variables = deriveThemeVariables({
        ...DEFAULT_LIGHT_THEME,
        theme: {
          ...DEFAULT_LIGHT_THEME.theme,
          contrast,
        },
      })

      expect(variables['--color-border']).toBe(border)
      expect(variables['--color-background-surface-under']).toBe(
        surfaceUnder,
      )
      expect(deriveThemeVariables({
        ...DEFAULT_LIGHT_THEME,
        theme: {
          ...DEFAULT_LIGHT_THEME.theme,
          contrast,
        },
      })).toEqual(variables)
    }
  })

  test('migrates legacy settings without retaining old theme data', () => {
    const migrated = normalizeDesktopThemeSettings({
      mode: 'dark',
      codeThemeId: 'dracula',
      activeThemeIds: { light: 'light-codepilotx', dark: 'dark-dracula' },
      customThemes: [{ id: 'custom-theme' }],
      presetOverrides: { 'dark-dracula': {} },
      reduceMotion: 'on',
      pointerCursorEnabled: false,
      fontSizes: { ui: 17, code: 15 },
    })

    expect(migrated).toMatchObject({
      version: 6,
      mode: 'system',
      codeThemeIds: {
        light: 'codex-light',
        dark: 'codex-dark',
      },
      reduceMotion: 'system',
      pointerCursorEnabled: false,
      fontSizes: { ui: 14, code: 12 },
    })
    expect(migrated.chromeThemes.light).not.toHaveProperty('opaqueWindows')
    expect(migrated.chromeThemes.dark).not.toHaveProperty('opaqueWindows')
  })

  test('keeps separate light and dark selections and rejects mismatches', () => {
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeIds: {
          light: 'github-light-default',
          dark: 'dracula',
        },
      }).codeThemeIds,
    ).toEqual({
      light: 'github-light-default',
      dark: 'dracula',
    })
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeIds: {
          light: 'dracula',
          dark: 'github-light',
        },
      }).codeThemeIds,
    ).toEqual({
      light: 'codex-light',
      dark: 'codex-dark',
    })
  })

  test('resets a previous V2 single selection to V6 defaults', () => {
    expect(
      normalizeDesktopThemeSettings({
        version: 2,
        mode: 'system',
        codeThemeId: 'dracula',
      }).codeThemeIds,
    ).toEqual({
      light: 'codex-light',
      dark: 'codex-dark',
    })
  })

  test('keeps both System selections and resolves the system variant slot', () => {
    const settings = normalizeDesktopThemeSettings({
      ...DEFAULT_DESKTOP_THEME_SETTINGS,
      mode: 'system',
      codeThemeIds: {
        light: 'proof-light',
        dark: 'dracula',
      },
    })

    expect(getCodeThemeSelectionForVariant(settings, 'light')).toBe(
      'proof-light',
    )
    expect(getCodeThemeSelectionForVariant(settings, 'dark')).toBe('dracula')
  })
})
