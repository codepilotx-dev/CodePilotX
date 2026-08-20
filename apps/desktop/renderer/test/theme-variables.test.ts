import { describe, expect, test } from 'bun:test'

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
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-regular: 445;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-medium: 500;')
    expect(normalizedStylesheet).toContain('--cpx-sys-font-weight-bold: 600;')
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-normal: calc(var(--cpx-sys-font-size-md) + 6px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-tight: calc(var(--cpx-sys-font-size-sm) + 5px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-relaxed: calc(var(--cpx-sys-font-size-lg) + 6px);',
    )
    expect(normalizedStylesheet).toContain(
      '--cpx-sys-line-height-code: calc(var(--cpx-sys-font-size-sm) * 1.55);',
    )

    const tailwind = await Bun.file(
      new URL('../src/styles/tailwind.css', import.meta.url),
    ).text()
    const normalizedTailwind = tailwind.replace(/\s+/g, ' ')
    expect(normalizedTailwind).toContain(
      '--text-base--line-height: var(--cpx-sys-line-height-normal);',
    )
    expect(normalizedTailwind).toContain(
      '--text-sm--line-height: var(--cpx-sys-line-height-tight);',
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
    expect(light['--cpx-sys-color-surface-under']).toBe('#f6f6f6')
    expect(light['--cpx-sys-color-surface']).toBe('#ffffff')
    expect(light['--cpx-sys-color-fg-primary']).toBe('#1a1c1f')
    expect(light['--cpx-sys-color-fg-secondary']).toBe(
      'rgba(26, 28, 31, 0.695)',
    )
    expect(light['--cpx-sys-color-fg-tertiary']).toBe(
      'rgba(26, 28, 31, 0.495)',
    )
    expect(light['--cpx-sys-color-border-subtle']).toBe('rgba(26, 28, 31, 0.049)')
    expect(light['--cpx-sys-color-border-default']).toBe('rgba(26, 28, 31, 0.078)')
    expect(light['--cpx-sys-color-border-strong']).toBe('rgba(26, 28, 31, 0.117)')
    expect(light['--cpx-sys-color-hover']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--cpx-sys-color-selected']).toBe(
      'rgba(26, 28, 31, 0.05)',
    )
    expect(light['--cpx-sys-color-diff-added-line']).toBe('#fafdfb')
    expect(light['--cpx-sys-color-diff-added-text']).toBe('#f5fbf7')

    expect(DEFAULT_DARK_THEME.codeThemeId).toBe('codex-dark')
    expect(dark['--cpx-sys-color-surface-under']).toBe('#141414')
    expect(dark['--cpx-sys-color-surface']).toBe('#181818')
    expect(dark['--cpx-sys-color-fg-primary']).toBe('#ffffff')
    expect(dark['--cpx-sys-color-panel']).toBe('#232323')
    expect(dark['--cpx-sys-color-fg-secondary']).toBe(
      'rgba(255, 255, 255, 0.71)',
    )
    expect(dark['--cpx-sys-color-fg-tertiary']).toBe(
      'rgba(255, 255, 255, 0.498)',
    )
    expect(dark['--cpx-sys-color-border-subtle']).toBe(
      'rgba(255, 255, 255, 0.042)',
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

    expect(variables['--cpx-sys-color-surface']).toBe('#282a36')
    expect(variables['--cpx-sys-color-surface-under']).toBe('#22232d')
    expect(variables['--cpx-sys-color-panel']).toBe('#32343f')
    expect(variables['--cpx-sys-color-elevated-secondary']).toBe(
      '#373843',
    )
    expect(variables['--cpx-sys-color-editor']).toBe(
      'rgb(55, 56, 67)',
    )
    expect(variables['--cpx-sys-color-success']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-danger']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-added-fg']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#50fa7b')
    expect(variables['--cpx-sys-color-diff-added-line']).toBe('#383c44')
    expect(variables['--cpx-sys-color-diff-added-text']).toBe('#384045')
    expect(variables['--cpx-sys-color-diff-removed-indicator']).toBe('#ff5555')
    expect(variables['--cpx-sys-color-diff-removed-line']).toBe('#3b3943')
    expect(variables['--cpx-sys-color-diff-removed-text']).toBe('#3f3944')
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
          variables['--cpx-sys-color-editor'],
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
    const editor = variables['--cpx-sys-color-editor']

    expect(variables['--cpx-sys-color-diff-added-indicator']).toBe('#ffffff')
    expect(variables['--cpx-sys-color-diff-added-fg']).not.toBe('#ffffff')
    expect(
      contrastRatio(variables['--cpx-sys-color-diff-added-fg'], editor),
    ).toBeGreaterThanOrEqual(4.5)
  })

  test('derives independent opaque canvas, chrome, panel, editor, and elevated roles', () => {
    for (const config of [DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME]) {
      const variables = deriveThemeVariables(config)
      const roleNames = [
        '--cpx-sys-color-surface',
        '--cpx-sys-color-surface-under',
        '--cpx-sys-color-panel',
        '--cpx-sys-color-editor',
        '--cpx-sys-color-elevated-secondary',
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

      expect(variables['--cpx-sys-color-border-default']).toBe(border)
      expect(variables['--cpx-sys-color-surface-under']).toBe(
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
      version: 7,
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
      expect(vars['--cpx-comp-glass-bg']).toBeDefined()

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

      // Semantic chips
      expect(vars['--cpx-comp-chip-success-bg']).toBeDefined()
      expect(vars['--cpx-comp-chip-danger-bg']).toBeDefined()
      expect(vars['--cpx-comp-chip-warning-bg']).toBeDefined()
      expect(vars['--cpx-comp-chip-skill-bg']).toBeDefined()
      expect(vars['--cpx-comp-chip-info-bg']).toBeDefined()
      expect(vars['--cpx-comp-chip-accent-bg']).toBeDefined()
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
