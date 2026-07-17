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
    expect(light['--surface-underlay']).toBe('#f6f6f6')
    expect(light['--surface-canvas']).toBe('#ffffff')
    expect(light['--color-text']).toBe('#1a1c1f')
    expect(light['--color-text-meta']).toBe('rgba(26, 28, 31, 0.695)')
    expect(light['--color-text-soft']).toBe('rgba(26, 28, 31, 0.495)')
    expect(light['--border-subtle']).toBe('rgba(26, 28, 31, 0.049)')
    expect(light['--border-control']).toBe('rgba(26, 28, 31, 0.078)')
    expect(light['--border-strong']).toBe('rgba(26, 28, 31, 0.117)')

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-dark')
    expect(dark['--surface-underlay']).toBe('#141414')
    expect(dark['--surface-canvas']).toBe('#181818')
    expect(dark['--color-text']).toBe('#ffffff')
    expect(dark['--surface-panel']).toBe('#232323')
    expect(dark['--color-text-meta']).toBe(
      'rgba(255, 255, 255, 0.71)',
    )
    expect(dark['--color-text-soft']).toBe(
      'rgba(255, 255, 255, 0.498)',
    )
    expect(dark['--border-subtle']).toBe(
      'rgba(255, 255, 255, 0.042)',
    )
    expect(dark['--border-control']).toBe(
      'rgba(255, 255, 255, 0.084)',
    )
    expect(dark['--border-strong']).toBe(
      'rgba(255, 255, 255, 0.156)',
    )
    expect(dark['--color-accent-a3']).toBe('#339cffb3')
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

    expect(variables['--surface-canvas']).toBe('#282a36')
    expect(variables['--surface-chrome']).toBe('#22232d')
    expect(variables['--surface-panel']).toBe('#32343f')
    expect(variables['--surface-composer']).toBe('#373843')
    expect(variables['--surface-code-block']).toBe('rgb(55, 56, 67)')
    expect(variables['--color-text-accent']).toBe('rgb(255, 173, 220)')
    expect(variables['--color-decoration-added']).toBe('#50fa7b')
  })

  test('migrates legacy settings without retaining old theme data', () => {
    const migrated = normalizeDesktopThemeSettings({
      mode: 'dark',
      codeThemeId: 'dracula',
      activeThemeIds: { light: 'light-codepilotx', dark: 'dark-dracula' },
      customThemes: [{ id: 'custom-theme' }],
      presetOverrides: { 'dark-dracula': {} },
      reduceMotion: 'on',
      glassmorphismEnabled: false,
      pointerCursorEnabled: false,
      fontSizes: { ui: 17, code: 15 },
    })

    expect(migrated).toMatchObject({
      version: 3,
      mode: 'dark',
      codeThemeIds: {
        light: 'codex-light',
        dark: 'dracula',
      },
      reduceMotion: 'on',
      pointerCursorEnabled: false,
      fontSizes: { ui: 16, code: 15 },
    })
    expect(migrated.chromeThemes.light.opaqueWindows).toBeTrue()
    expect(migrated.chromeThemes.dark.opaqueWindows).toBeTrue()
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

  test('migrates a previous V2 single selection into its matching slot', () => {
    expect(
      normalizeDesktopThemeSettings({
        version: 2,
        mode: 'system',
        codeThemeId: 'dracula',
      }).codeThemeIds,
    ).toEqual({
      light: 'codex-light',
      dark: 'dracula',
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
