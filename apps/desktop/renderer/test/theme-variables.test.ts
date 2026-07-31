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
    expect(light['--vscode-list-hoverBackground']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--vscode-list-activeSelectionBackground']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--vscode-button-secondaryHoverBackground']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--color-diff-added-line-background']).toBe('#e0f4e8')
    expect(light['--color-diff-added-text-background']).toBe('#c2e9d1')

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
    expect(dark['--vscode-list-hoverBackground']).toBe(
      'rgba(255, 255, 255, 0.08)',
    )
    expect(dark['--vscode-list-activeSelectionBackground']).toBe(
      'rgba(255, 255, 255, 0.05)',
    )
    expect(dark['--vscode-button-secondaryHoverBackground']).toBe(
      'rgba(255, 255, 255, 0.08)',
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
    expect(variables['--color-decoration-deleted']).toBe('#ff5555')
    expect(variables['--color-diff-added-foreground']).toBe('#50fa7b')
    expect(variables['--color-diff-added-indicator']).toBe('#50fa7b')
    expect(variables['--color-diff-added-line-background']).toBe('#3c5b4d')
    expect(variables['--color-diff-added-text-background']).toBe('#407a56')
    expect(variables['--color-diff-removed-indicator']).toBe('#ff5555')
    expect(variables['--color-diff-removed-line-background']).toBe('#5b3d46')
    expect(variables['--color-diff-removed-text-background']).toBe('#7b4249')
    expect(variables['--color-diff-added-line-background']).not.toBe(
      variables['--color-decoration-added'],
    )
    expect(variables['--color-diff-removed-line-background']).not.toBe(
      variables['--color-decoration-deleted'],
    )
    expect(variables['--color-diff-added-line-background']).toMatch(
      /^#[\da-f]{6}$/,
    )
    expect(variables['--color-diff-removed-text-background']).toMatch(
      /^#[\da-f]{6}$/,
    )
  })

  test('keeps semantic foregrounds readable against editor surfaces', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      const editor = variables['--color-background-editor-opaque']

      expect(
        contrastRatio(
          variables['--color-diff-added-foreground'],
          editor,
        ),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrastRatio(
          variables['--color-diff-removed-foreground'],
          editor,
        ),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('moves low-contrast semantic foregrounds toward ink', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        semanticColors: {
          ...DEFAULT_LIGHT_THEME.theme.semanticColors,
          diffAdded: '#ffffff',
          diffRemoved: '#ffffff',
        },
      },
    })
    const editor = variables['--color-background-editor-opaque']

    expect(variables['--color-diff-added-indicator']).toBe('#ffffff')
    expect(variables['--color-diff-added-foreground']).not.toBe('#ffffff')
    expect(
      contrastRatio(variables['--color-diff-added-foreground'], editor),
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('derives independent opaque canvas, chrome, panel, editor, and elevated roles', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      const roleNames = [
        '--color-background-surface',
        '--color-background-surface-under',
        '--color-background-panel',
        '--color-background-editor-opaque',
        '--color-background-elevated-secondary-opaque',
      ] as const
      const roles = roleNames.map(name => variables[name])

      expect(new Set(roleNames).size).toBe(roleNames.length)
      for (const role of roles) {
        expect(role).toBeDefined()
        expect(role).not.toContain('rgba')
      }
    }
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

function contrastRatio(foreground: string, background: string): number {
  const first = parseColor(foreground)
  const second = parseColor(background)
  const brightest = Math.max(luminance(first), luminance(second))
  const darkest = Math.min(luminance(first), luminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

function parseColor(value: string): readonly [number, number, number] {
  if (value.startsWith('#')) {
    return [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ]
  }
  const channels = value.match(/\d+/g)
  if (!channels || channels.length < 3) {
    throw new Error(`Invalid color: ${value}`)
  }
  return [Number(channels[0]), Number(channels[1]), Number(channels[2])]
}

function luminance(color: readonly [number, number, number]): number {
  const channels = color.map(value => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}
