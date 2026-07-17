import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME,
  normalizeDesktopThemeSettings,
} from '../shared/theme.js'
import { deriveThemeVariables } from '../src/features/theme/themeVariables.js'

describe('fixed Codex UI themes', () => {
  test('locks the Codex light and dark semantic surfaces', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    expect(DEFAULT_LIGHT_THEME.codeThemeId).toBe('codex-light')
    expect(light['--surface-underlay']).toBe('#f9f9f9')
    expect(light['--surface-canvas']).toBe('#ffffff')
    expect(light['--color-text']).toBe('#1a1c1f')
    expect(light['--color-text-meta']).toBe('#5f6062')
    expect(light['--color-text-soft']).toBe('#8d8e8f')
    expect(light['--border-subtle']).toBe(
      'color-mix(in srgb, #1a1c1f 5%, transparent)',
    )
    expect(light['--border-control']).toBe(
      'color-mix(in srgb, #1a1c1f 8%, transparent)',
    )
    expect(light['--border-strong']).toBe(
      'color-mix(in srgb, #1a1c1f 12%, transparent)',
    )

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-dark')
    expect(dark['--surface-underlay']).toBe('#000000')
    expect(dark['--surface-canvas']).toBe('#181818')
    expect(dark['--color-text']).toBe('#ffffff')
    expect(dark['--color-text-meta']).toBe('#bababa')
    expect(dark['--color-text-soft']).toBe('#8c8c8c')
    expect(dark['--border-subtle']).toBe(
      'color-mix(in srgb, #ffffff 4%, transparent)',
    )
    expect(dark['--border-control']).toBe(
      'color-mix(in srgb, #ffffff 8%, transparent)',
    )
    expect(dark['--border-strong']).toBe(
      'color-mix(in srgb, #ffffff 16%, transparent)',
    )
    expect(dark['--color-accent-a3']).toBe('#339cffb3')
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

    expect(migrated).toEqual({
      version: 2,
      mode: 'dark',
      codeThemeId: 'auto',
      reduceMotion: 'on',
      glassmorphismEnabled: false,
      pointerCursorEnabled: false,
      fontSizes: { ui: 17, code: 15 },
    })
  })

  test('keeps valid V2 Codex selections and rejects unknown slugs', () => {
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeId: 'dracula',
      }).codeThemeId,
    ).toBe('dracula')
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        codeThemeId: 'not-in-codex',
      }).codeThemeId,
    ).toBe('auto')
  })
})
