import { describe, expect, test } from 'bun:test'
import type { DesktopThemeConfigV1 } from '../shared/types.js'
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  DESKTOP_THEME_PRESETS,
} from '../shared/theme.js'
import { deriveThemeVariables } from '../src/features/theme/themeVariables.js'

const ROLE_KEYS = [
  '--surface-chrome',
  '--surface-panel',
  '--surface-raised',
  '--surface-code-block',
  '--surface-code-inline',
  '--surface-user-message',
  '--surface-composer',
  '--state-hover',
  '--state-selected',
  '--border-subtle',
  '--border-control',
  '--border-strong',
  '--scrollbar-rest',
  '--scrollbar-hover',
] as const

const DARK_40_THEMES = [
  ['Codex', DEFAULT_DARK_THEME],
  ['Rose Pine', theme('dark', '#191724', '#e0def4', 'codepilotx')],
  ['Matrix', theme('dark', '#071a0d', '#d1ffd9', 'codepilotx')],
  ['Absolutely', preset('dark-absolutely')],
] as const

const LIGHT_40_THEMES = [
  ['Codex', DEFAULT_LIGHT_THEME],
  ['Linear', theme('light', '#f7f8fa', '#1f2328', 'codepilotx')],
  ['Rose Pine', theme('light', '#faf4ed', '#575279', 'codepilotx')],
] as const

describe('theme variable derivation', () => {
  test('locks Dracula dark semantic anchors at contrast 0/40/100', () => {
    const base = preset('dark-dracula')
    const expectedByContrast = {
      0: {
        chrome: mixHex(base.theme.surface, '#000000', 7.5),
        panel: mixHex(base.theme.surface, base.theme.ink, 1),
        codeBlock: mixHex(base.theme.surface, base.theme.ink, 1.2),
        userMessage: mixHex(base.theme.surface, base.theme.ink, 1.5),
        composer: mixHex(base.theme.surface, base.theme.ink, 2.5),
        codeInline: mixHex(base.theme.surface, base.theme.ink, 4.3),
      },
      40: {
        chrome: '#23252f',
        panel: '#2f313c',
        codeBlock: '#31333e',
        userMessage: '#32343f',
        composer: '#363843',
        codeInline: '#3d3f48',
      },
      100: {
        chrome: mixHex(base.theme.surface, '#000000', 22),
        panel: mixHex(base.theme.surface, base.theme.ink, 10),
        codeBlock: mixHex(base.theme.surface, base.theme.ink, 11),
        userMessage: mixHex(base.theme.surface, base.theme.ink, 13),
        composer: mixHex(base.theme.surface, base.theme.ink, 17),
        codeInline: mixHex(base.theme.surface, base.theme.ink, 24),
      },
    } as const

    for (const contrast of [0, 40, 100] as const) {
      const variables = deriveThemeVariables(withContrast(base, contrast))
      expect({
        chrome: variables['--surface-chrome'],
        panel: variables['--surface-panel'],
        codeBlock: variables['--surface-code-block'],
        userMessage: variables['--surface-user-message'],
        composer: variables['--surface-composer'],
        codeInline: variables['--surface-code-inline'],
      }).toEqual(expectedByContrast[contrast])
      expect(variables['--surface-canvas']).toBe('#282a36')
    }
    expect(
      deriveThemeVariables(base)['--color-popover-divider'],
    ).toBe('#43454e')
  })

  test('uses the same dark contrast-40 proportions across theme surfaces', () => {
    for (const [name, config] of DARK_40_THEMES) {
      const variables = deriveThemeVariables(withContrast(config, 40))
      expect(variables['--surface-chrome'], name).toBe(
        mixHex(config.theme.surface, '#000000', 13),
      )
      expect(variables['--surface-panel'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 3.5),
      )
      expect(variables['--surface-code-block'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 4.2),
      )
      expect(variables['--surface-user-message'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 5),
      )
      expect(variables['--surface-composer'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 6.8),
      )
      expect(variables['--surface-code-inline'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 10),
      )
    }
  })

  test('uses light contrast-40 canvas, raised, and ink role anchors', () => {
    for (const [name, config] of LIGHT_40_THEMES) {
      const variables = deriveThemeVariables(withContrast(config, 40))
      expect(variables['--surface-canvas'], name).toBe(config.theme.surface)
      expect(variables['--surface-chrome'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 3.5),
      )
      expect(variables['--surface-panel'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 3.5),
      )
      expect(variables['--surface-raised'], name).toBe(
        mixHex(config.theme.surface, '#ffffff', 20),
      )
      expect(variables['--surface-code-block'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 4.2),
      )
      expect(variables['--surface-user-message'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 5),
      )
      expect(variables['--surface-composer'], name).toBe(
        mixHex(config.theme.surface, '#ffffff', 20),
      )
      expect(variables['--surface-code-inline'], name).toBe(
        mixHex(config.theme.surface, config.theme.ink, 10),
      )
    }
  })

  test('keeps every contrast-controlled role monotonic from 0 to 40 to 100', () => {
    for (const [, config] of [...DARK_40_THEMES, ...LIGHT_40_THEMES]) {
      const gears = [0, 40, 100].map(contrast =>
        deriveThemeVariables(withContrast(config, contrast)),
      )
      for (const role of ROLE_KEYS) {
        const distances = gears.map(variables =>
          colorDistance(config.theme.surface, variables[role]),
        )
        expect(distances[1] + 0.001, role).toBeGreaterThanOrEqual(distances[0])
        expect(distances[2] + 0.001, role).toBeGreaterThanOrEqual(distances[1])
      }
    }
  })

  test('does not alter source, accent, or diff colors at any contrast gear', () => {
    for (const [, config] of [...DARK_40_THEMES, ...LIGHT_40_THEMES]) {
      for (const contrast of [0, 40, 100]) {
        const variables = deriveThemeVariables(withContrast(config, contrast))
        expect(variables['--color-bg']).toBe(config.theme.surface)
        expect(variables['--color-ink']).toBe(config.theme.ink)
        expect(variables['--color-accent']).toBe(config.theme.accent)
        expect(variables['--color-diff-added']).toBe(
          config.theme.semanticColors.diffAdded,
        )
        expect(variables['--color-diff-removed']).toBe(
          config.theme.semanticColors.diffRemoved,
        )
      }
    }
  })

  test('maps every known code theme family to a syntax palette', () => {
    const ids = [
      'absolutely',
      'catppuccin',
      'raycast',
      'github',
      'dracula',
      'material',
      'vscode-plus',
      'codepilotx',
    ]
    const signatures = ids.map(codeThemeId => {
      const variables = deriveThemeVariables({
        ...DEFAULT_DARK_THEME,
        codeThemeId,
      })
      return [
        variables['--syntax-keyword'],
        variables['--syntax-property'],
        variables['--syntax-string'],
        variables['--syntax-number'],
      ].join('|')
    })
    expect(new Set(signatures).size).toBe(ids.length)
  })
})

function preset(id: string): DesktopThemeConfigV1 {
  const match = DESKTOP_THEME_PRESETS.find(entry => entry.id === id)
  if (!match) throw new Error(`Missing theme preset: ${id}`)
  return match.config
}

function theme(
  variant: DesktopThemeConfigV1['variant'],
  surface: string,
  ink: string,
  codeThemeId: string,
): DesktopThemeConfigV1 {
  return {
    codeThemeId,
    variant,
    theme: {
      accent: '#5e6ad2',
      contrast: 40,
      fonts: DEFAULT_LIGHT_THEME.theme.fonts,
      ink,
      opaqueWindows: true,
      semanticColors: {
        diffAdded: '#2da44e',
        diffRemoved: '#cf222e',
        skill: '#8250df',
      },
      surface,
    },
  }
}

function withContrast(
  config: DesktopThemeConfigV1,
  contrast: number,
): DesktopThemeConfigV1 {
  return { ...config, theme: { ...config.theme, contrast } }
}

function mixHex(first: string, second: string, secondPercent: number): string {
  const left = parseHex(first)
  const right = parseHex(second)
  const amount = secondPercent / 100
  return `#${left
    .map((channel, index) =>
      Math.round(channel + (right[index] - channel) * amount),
    )
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function colorDistance(first: string, second: string): number {
  const left = parseHex(first)
  const right = parseHex(second)
  return Math.hypot(...left.map((channel, index) => channel - right[index]))
}

function parseHex(value: string): [number, number, number] {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(value)
  if (!match) throw new Error(`Expected a hex color, received ${value}`)
  return match.slice(1).map(channel => Number.parseInt(channel, 16)) as [
    number,
    number,
    number,
  ]
}
