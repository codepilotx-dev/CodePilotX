import { describe, expect, test } from 'bun:test'
import { deriveDesktopSurfaceUnder } from '@codepilotx/shared/desktop-theme'

import {
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME,
  DEFAULT_UI_FONT,
  getCodeThemeSelectionForVariant,
  normalizeDesktopThemeSettings,
} from '../shared/theme.js'
import {
  deriveThemeVariables,
  ensureThemePreviewContrast,
} from '../src/features/theme/themeVariables.js'

describe('fixed Codex UI themes', () => {
  test('keeps code-theme seed labels readable on light, dark, and custom surfaces', () => {
    const seeds = [
      { accent: '#339cff', ink: '#1a1c1f', surface: '#ffffff' },
      { accent: '#339cff', ink: '#ffffff', surface: '#181818' },
      { accent: '#ffffff', ink: '#ffffff', surface: '#ffffff' },
      { accent: '#000000', ink: '#000000', surface: '#000000' },
    ]

    for (const seed of seeds) {
      expect(
        contrastRatio(ensureThemePreviewContrast(seed), seed.surface),
      ).toBeGreaterThanOrEqual(4.5)
    }
    expect(ensureThemePreviewContrast(seeds[0]!)).not.toBe('#339cff')
    expect(ensureThemePreviewContrast(seeds[1]!)).toBe('#339cff')
  })

  test('uses the Codex system font stack with canonical semantic weights', async () => {
    const variables = deriveThemeVariables(DEFAULT_DARK_THEME)
    const customFont = 'Inter, sans-serif'
    const customVariables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        fonts: {
          ...DEFAULT_DARK_THEME.theme.fonts,
          ui: customFont,
        },
      },
    })

    expect(variables['--cpx-sys-font-family-sans']).toBe(DEFAULT_UI_FONT)
    expect(customVariables['--cpx-sys-font-family-sans']).toBe(customFont)

    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/tokens.scss',
        import.meta.url,
      ),
    ).text()
    const normalizedStylesheet = stylesheet.replace(/\s+/g, ' ')

    expect(normalizedStylesheet).toContain(
      `--cpx-sys-font-family-sans: ${DEFAULT_UI_FONT};`,
    )
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-regular: 400;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-body: 445;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-medium: 500;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-bold: 600;')
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-body: calc(var(--cpx-sys-font-size-md) + 6px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-caption: calc(var(--cpx-sys-font-size-xs) + 4px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-body-lg: calc(var(--cpx-sys-font-size-lg) + 8px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-code: calc(var(--cpx-sys-font-size-code) * 1.55);',
    )

    const tailwind = await Bun.file(
      new URL('../src/styles/tailwind.css', import.meta.url),
    ).text()
    const normalizedTailwind = tailwind.replace(/\s+/g, ' ')
    expect(normalizedTailwind).toContain(
      '--text-base--line-height: var(--cpx-sys-line-height-body);',
    )
    expect(normalizedTailwind).toContain(
      '--text-sm--line-height: var(--cpx-sys-line-height-body-sm);',
    )
    expect(normalizedTailwind).toContain(
      '--text-code: var(--cpx-sys-font-size-code);',
    )
    expect(normalizedTailwind).toContain(
      '--text-code--line-height: var(--cpx-sys-line-height-code);',
    )
  })

  test('locks the Codex light and dark semantic surfaces', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    expect(DEFAULT_LIGHT_THEME.codeThemeId).toBe('codex-light')
    expect(light['--cpx-sys-color-surface-canvas']).toBe('#ffffff')
    expect(light['--cpx-sys-color-surface-recessed']).not.toBe(
      light['--cpx-sys-color-surface-canvas'],
    )
    expect(light['--cpx-sys-color-fg-primary']).toBe('#1a1c1f')
    expect(light['--cpx-sys-color-fg-secondary']).toBe('#606163')
    expect(light['--cpx-sys-color-fg-tertiary']).toBe('#8e8f90')
    expect(light['--cpx-sys-color-border-subtle']).toBe('rgba(26, 28, 31, 0.049)')
    expect(light['--cpx-sys-color-border-default']).toBe('rgba(26, 28, 31, 0.078)')
    expect(light['--cpx-sys-color-border-strong']).toBe('rgba(26, 28, 31, 0.117)')
    expect(light['--cpx-sys-color-hover']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--cpx-sys-color-selected']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--cpx-sys-color-diff-added-line']).not.toBe(
      light['--cpx-sys-color-surface-editor'],
    )
    expect(light['--cpx-sys-color-diff-added-text']).not.toBe(
      light['--cpx-sys-color-diff-added-line'],
    )

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-dark')
    expect(dark['--cpx-sys-color-surface-canvas']).toBe('#181818')
    expect(dark['--cpx-sys-color-surface-recessed']).not.toBe(
      dark['--cpx-sys-color-surface-canvas'],
    )
    expect(dark['--cpx-sys-color-fg-primary']).toBe('#ffffff')
    expect(dark['--cpx-sys-color-surface-panel']).not.toBe(
      dark['--cpx-sys-color-surface-canvas'],
    )
    expect(dark['--cpx-sys-color-fg-secondary']).toBe('#bcbcbc')
    expect(dark['--cpx-sys-color-fg-tertiary']).toBe('#8b8b8b')
    expect(dark['--cpx-sys-color-border-subtle']).toBe(
      'rgba(255, 255, 255, 0.056)',
    )
    expect(dark['--cpx-sys-color-border-default']).toBe(
      'rgba(255, 255, 255, 0.084)',
    )
    expect(dark['--cpx-sys-color-border-strong']).toBe(
      'rgba(255, 255, 255, 0.156)',
    )
    expect(dark['--cpx-sys-color-hover']).toBe(
      'rgba(255, 255, 255, 0.08)',
    )
    expect(dark['--cpx-sys-color-selected']).toBe(
      'rgba(255, 255, 255, 0.05)',
    )
    expect(dark['--cpx-sys-color-fg-on-accent']).toBe('#ffffff')
  })

  test('keeps control thumbs white in light and dark themes', () => {
    const light = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        accent: '#d7827e',
        contrast: 40,
        ink: '#575279',
        surface: '#faf4ed',
      },
    })
    const dark = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        accent: '#a7c080',
        contrast: 41,
        ink: '#d3c6aa',
        surface: '#2d353b',
      },
    })

    expect(light['--cpx-comp-switch-thumb-fill']).toBe('#ffffff')
    expect(dark['--cpx-comp-switch-thumb-fill']).toBe('#ffffff')
  })

  test('keeps resting surfaces flat and delegates floating elevation to the theme token', async () => {
    const expectedRaised = 'none'
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    for (const variables of [light, dark]) {
      expect(variables['--cpx-sys-shadow-raised']).toBe(expectedRaised)
      expect(variables['--cpx-sys-shadow-resting']).toBe('none')
    }
    expect(dark['--cpx-sys-shadow-raised']).toBe(light['--cpx-sys-shadow-raised'])

    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/tokens.scss',
        import.meta.url,
      ),
    ).text()
    const normalizedStylesheet = stylesheet.replace(/\s+/g, ' ')

    expect(normalizedStylesheet).toContain(
      `--cpx-sys-shadow-raised: ${expectedRaised};`,
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-shadow-resting: none;',
    )
    expect(normalizedStylesheet).toContain('--cpx-sys-shadow-floating')
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

    expect(variables['--cpx-sys-color-surface-canvas']).toBe('#282a36')
    expect(variables['--cpx-sys-color-surface-recessed']).not.toBe(
      variables['--cpx-sys-color-surface-canvas'],
    )
    expect(variables['--cpx-sys-color-success']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-danger']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-added-fg']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-removed-indicator']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-added-line']).not.toBe(
      variables['--cpx-sys-color-success'],
    )
    expect(variables['--cpx-sys-color-diff-removed-line']).not.toBe(
      variables['--cpx-sys-color-danger'],
    )
    expect(variables['--cpx-sys-color-diff-added-line']).toMatch(
      /^#[\da-f]{6}$/,
    )
    expect(variables['--cpx-sys-color-diff-removed-text']).toMatch(
      /^#[\da-f]{6}$/,
    )
  })

  test('keeps semantic foregrounds readable against editor surfaces', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      for (const tone of ['added', 'removed'] as const) {
        const foreground = variables[`--cpx-sys-color-diff-${tone}-fg`]
        const backgrounds = [
          variables['--cpx-sys-color-surface-editor'],
          variables[`--cpx-sys-color-diff-${tone}-line`],
          variables[`--cpx-sys-color-diff-${tone}-text`],
        ]
        for (const background of backgrounds) {
          expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
        }
      }
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
    const editor = variables['--cpx-sys-color-surface-editor']

    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#ffffff')
    expect(variables['--cpx-sys-color-diff-added-fg']).not.toBe('#ffffff')
    expect(
      contrastRatio(variables['--cpx-sys-color-diff-added-fg'], editor),
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('derives opaque canvas, chrome, panel, editor, and elevated roles', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      const roleNames = [
        '--cpx-sys-color-surface-canvas',
        '--cpx-sys-color-surface-recessed',
        '--cpx-sys-color-surface-panel',
        '--cpx-sys-color-surface-control',
        '--cpx-sys-color-surface-raised',
        '--cpx-sys-color-surface-editor',
      ] as const
      for (const role of roleNames.map(name => variables[name])) {
        expect(role).toBeDefined()
        expect(role).not.toContain('rgba')
      }
    }
  })

  test('preserves the complete surface hierarchy on near-white custom themes', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_LIGHT_THEME,
      theme: {
        ...DEFAULT_LIGHT_THEME.theme,
        accent: '#5d755d',
        surface: '#f5f3ed',
        ink: '#2f312d',
        contrast: 40,
      },
    })
    const canvas = variables['--cpx-sys-color-surface-canvas']
    const recessed = variables['--cpx-sys-color-surface-recessed']
    const control = variables['--cpx-sys-color-surface-control']
    const raised = variables['--cpx-sys-color-surface-raised']

    expect(recessed).toBe(
      deriveDesktopSurfaceUnder('#f5f3ed', '#2f312d', 'light', 40),
    )
    expect(luminance(parseColor(recessed))).toBeLessThan(
      luminance(parseColor(canvas)),
    )
    expect(luminance(parseColor(control))).toBeGreaterThan(
      luminance(parseColor(canvas)),
    )
    expect(luminance(parseColor(raised))).toBeGreaterThan(
      luminance(parseColor(canvas)),
    )
  })

  test('keeps dark chrome recessed while control and raised surfaces lift', () => {
    const variables = deriveThemeVariables({
      ...DEFAULT_DARK_THEME,
      theme: {
        ...DEFAULT_DARK_THEME.theme,
        surface: '#282a36',
        ink: '#f8f8f2',
        contrast: 60,
      },
    })
    const canvasLuminance = luminance(
      parseColor(variables['--cpx-sys-color-surface-canvas']),
    )

    expect(variables['--cpx-sys-color-surface-recessed']).toBe(
      deriveDesktopSurfaceUnder('#282a36', '#f8f8f2', 'dark', 60),
    )
    expect(luminance(
      parseColor(variables['--cpx-sys-color-surface-recessed']),
    )).toBeLessThan(canvasLuminance)
    expect(luminance(
      parseColor(variables['--cpx-sys-color-surface-control']),
    )).toBeGreaterThan(canvasLuminance)
    expect(luminance(
      parseColor(variables['--cpx-sys-color-surface-raised']),
    )).toBeGreaterThan(canvasLuminance)
  })

  test('keeps every semantic foreground readable on its subtle background', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      for (const tone of [
        'accent',
        'danger',
        'warning',
        'success',
        'skill',
        'info',
      ] as const) {
        expect(contrastRatio(
          variables[`--cpx-sys-color-${tone}-fg`],
          variables[`--cpx-sys-color-${tone}-subtle-bg`],
        )).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  test('keeps the recovered contrast boundary palette deterministic', () => {
    const expected = [
      [0, 'rgba(26, 28, 31, 0.06)'],
      [45, 'rgba(26, 28, 31, 0.078)'],
      [60, 'rgba(26, 28, 31, 0.1)'],
      [100, 'rgba(26, 28, 31, 0.1)'],
    ] as const

    for (const [contrast, border] of expected) {
      const variables = deriveThemeVariables({
        ...DEFAULT_LIGHT_THEME,
        theme: {
          ...DEFAULT_LIGHT_THEME.theme,
          contrast,
        },
      })

      expect(variables['--cpx-sys-color-border-default']).toBe(border)
      expect(deriveThemeVariables({
        ...DEFAULT_LIGHT_THEME,
        theme: {
          ...DEFAULT_LIGHT_THEME.theme,
          contrast,
        },
      })).toEqual(variables)
    }
  })

  test('keeps dark subtle borders near the Codex five-percent baseline', () => {
    const expected = [
      [0, 'rgba(255, 255, 255, 0.05)'],
      [60, 'rgba(255, 255, 255, 0.056)'],
      [100, 'rgba(255, 255, 255, 0.06)'],
    ] as const

    for (const [contrast, border] of expected) {
      const variables = deriveThemeVariables({
        ...DEFAULT_DARK_THEME,
        theme: {
          ...DEFAULT_DARK_THEME.theme,
          contrast,
        },
      })

      expect(variables['--cpx-sys-color-border-subtle']).toBe(border)
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
      version: 7,
      mode: 'system',
      codeThemeIds: {
        light: 'codex-light',
        dark: 'codex-dark',
      },
      reduceMotion: 'system',
      pointerCursorEnabled: false,
      fontSizes: { ui: 14, code: 13 },
    })
    expect(migrated.chromeThemes.light).not.toHaveProperty('opaqueWindows')
    expect(migrated.chromeThemes.dark).not.toHaveProperty('opaqueWindows')
  })

  test('uses code size 13 for new settings without migrating a saved size 12', () => {
    expect(DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.code).toBe(13)
    expect(
      normalizeDesktopThemeSettings({
        ...DEFAULT_DESKTOP_THEME_SETTINGS,
        fontSizes: { ui: 14, code: 12 },
      }).fontSizes,
    ).toEqual({ ui: 14, code: 12 })
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

  test('resets a previous V2 single selection to V7 defaults', () => {
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

  test('derives harmonized multi-hue semantic tones and frosted glass tokens', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    for (const vars of [light, dark]) {
      // Blur & Glass tokens
      expect(vars['--cpx-sys-blur-sm']).toBe('8px')
      expect(vars['--cpx-sys-blur-md']).toBe('16px')
      expect(vars['--cpx-sys-blur-lg']).toBe('24px')
      expect(vars['--cpx-sys-glass-filter']).toBe('blur(16px)')
      expect(vars['--cpx-comp-glass-filter']).toBe('blur(16px)')

      // Multi-hue semantic subtle backgrounds & borders
      expect(vars['--cpx-sys-color-success-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-success-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-danger-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-danger-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-warning-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-warning-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-skill-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-skill-subtle-border']).toBeDefined()
      expect(vars['--cpx-sys-color-info-subtle-bg']).toBeDefined()
      expect(vars['--cpx-sys-color-info-subtle-border']).toBeDefined()

      expect(vars['--cpx-sys-color-accent-subtle-bg']).toBeDefined()
    }
  })

  test('derives pure black subtle floating shadows and dark scrims across light and dark modes', () => {
    const light = deriveThemeVariables(DEFAULT_LIGHT_THEME)
    const dark = deriveThemeVariables(DEFAULT_DARK_THEME)

    // Floating shadow must strictly use pure black (rgb(0 0 0 / ...)) and never use ink or white halos
    expect(light['--cpx-sys-shadow-floating']).toContain('rgb(0 0 0 /')
    expect(dark['--cpx-sys-shadow-floating']).toContain('rgb(0 0 0 /')
    expect(dark['--cpx-sys-shadow-floating']).not.toContain('255')

    // Scrim / backdrop must be pure black alpha
    expect(light['--cpx-sys-color-scrim']).toMatch(/^rgba\(0, 0, 0, 0\.\d+\)$/)
    expect(dark['--cpx-sys-color-scrim']).toMatch(/^rgba\(0, 0, 0, 0\.\d+\)$/)
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
