import { expect, test } from 'bun:test'
import {
  DESKTOP_THEME_PRESETS,
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME,
  exportDesktopThemeConfig,
  normalizeDesktopThemeConfig,
  normalizeDesktopThemeSettings,
} from './theme.js'

const THEME_SUITE_IDS = [
  'codex',
  'github',
  'raycast',
  'dracula',
  'catppuccin',
  'material',
  'vscode-plus',
  'absolutely',
  'terminal-green',
  'iris-focus',
] as const

test('DEFAULT_LIGHT_THEME uses CodePilotX desktop tokens', () => {
  expect(DEFAULT_LIGHT_THEME.theme.surface).toBe('#ffffff')
  expect(DEFAULT_LIGHT_THEME.theme.ink).toBe('#0d0d0d')
  expect(DEFAULT_LIGHT_THEME.theme.accent).toBe('#0169cc')
  expect(DEFAULT_LIGHT_THEME.theme.contrast).toBe(40)
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.diffAdded).toBe('#00a240')
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.diffRemoved).toBe('#e02e2a')
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.skill).toBe('#751ed9')
  expect(DEFAULT_LIGHT_THEME.variant).toBe('light')
})

test('DEFAULT_DARK_THEME uses CodePilotX desktop tokens', () => {
  expect(DEFAULT_DARK_THEME.codeThemeId).toBe('CodePilotX')
  expect(DEFAULT_DARK_THEME.theme.surface).toBe('#111111')
  expect(DEFAULT_DARK_THEME.theme.ink).toBe('#fcfcfc')
  expect(DEFAULT_DARK_THEME.theme.accent).toBe('#0169cc')
  expect(DEFAULT_DARK_THEME.theme.contrast).toBe(40)
  expect(DEFAULT_DARK_THEME.theme.semanticColors.diffAdded).toBe('#00a240')
  expect(DEFAULT_DARK_THEME.theme.semanticColors.diffRemoved).toBe('#e02e2a')
  expect(DEFAULT_DARK_THEME.theme.semanticColors.skill).toBe('#b06dff')
  expect(DEFAULT_DARK_THEME.variant).toBe('dark')
})

test('built-in desktop themes include ten paired suites', () => {
  expect(DESKTOP_THEME_PRESETS).toHaveLength(THEME_SUITE_IDS.length * 2)

  for (const suiteId of THEME_SUITE_IDS) {
    const lightTheme = DESKTOP_THEME_PRESETS.find(
      preset => preset.id === `light-${suiteId}`,
    )
    const darkTheme = DESKTOP_THEME_PRESETS.find(
      preset => preset.id === `dark-${suiteId}`,
    )

    expect(lightTheme?.config.variant).toBe('light')
    expect(darkTheme?.config.variant).toBe('dark')
    expect(lightTheme?.config.theme.contrast).toBe(40)
    expect(darkTheme?.config.theme.contrast).toBe(40)
    expect(lightTheme?.config.theme.surface).toMatch(/^#[0-9a-f]{6}$/i)
    expect(darkTheme?.config.theme.surface).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('built-in theme presets carry valid hex color values', () => {
  const extraIds = [
    'light-raycast',
    'dark-raycast',
    'light-dracula',
    'dark-dracula',
    'light-material',
    'dark-material',
    'light-terminal-green',
    'dark-terminal-green',
    'light-iris-focus',
    'dark-iris-focus',
  ]

  for (const themeId of extraIds) {
    const preset = DESKTOP_THEME_PRESETS.find(item => item.id === themeId)
    expect(preset?.config.theme.surface).toMatch(/^#[0-9a-f]{6}$/i)
    expect(preset?.config.theme.ink).toMatch(/^#[0-9a-f]{6}$/i)
    expect(preset?.config.theme.accent).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('exportDesktopThemeConfig returns clean theme config', () => {
  const exported = exportDesktopThemeConfig(DEFAULT_LIGHT_THEME)
  expect(exported.codeThemeId).toBe('codepilotx')
  expect(exported.variant).toBe('light')
  expect(exported.theme.surface).toBe('#ffffff')
  expect(exported.theme.ink).toBe('#0d0d0d')
  expect(exported.theme.accent).toBe('#0169cc')
  expect(exported.theme.semanticColors.diffAdded).toBe('#00a240')
  expect(exported.theme.semanticColors.diffRemoved).toBe('#e02e2a')
  expect(exported.theme.semanticColors.skill).toBe('#751ed9')
})

test('normalizeDesktopThemeConfig ignores radix from legacy custom theme', () => {
  const normalized = normalizeDesktopThemeConfig(
    {
      codeThemeId: 'legacy-custom',
      theme: {
        accent: '#0169cc',
        contrast: 60,
        fonts: {},
        ink: '#0d0d0d',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#00a240',
          diffRemoved: '#e02e2a',
          skill: '#751ed9',
        },
        radix: { accentColor: 'red', grayColor: 'mauve' },
        surface: '#ffffff',
      },
      variant: 'dark',
    },
    'dark',
  )
  expect(normalized.theme).not.toHaveProperty('radix')
  expect(normalized.theme.accent).toBe('#0169cc')
  expect(normalized.theme.surface).toBe('#ffffff')
  expect(normalized.theme.semanticColors.skill).toBe('#751ed9')
})

test('normalizeDesktopThemeConfig accepts string fonts entries as preset', () => {
  const normalized = normalizeDesktopThemeConfig(
    {
      codeThemeId: 'custom',
      theme: {
        accent: '#0169cc',
        contrast: 40,
        fonts: {
          ui: 'Inter',
          code: 'Fira Code',
        },
        ink: '#0d0d0d',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#00a240',
          diffRemoved: '#e02e2a',
          skill: '#751ed9',
        },
        surface: '#ffffff',
      },
      variant: 'light',
    },
    'light',
  )
  expect(normalized.theme.fonts.ui.preset).toBe('Inter')
  expect(normalized.theme.fonts.ui.fallback).toBe(
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, "Microsoft YaHei", system-ui, sans-serif',
  )
  expect(normalized.theme.fonts.code.preset).toBe('Fira Code')
  expect(normalized.theme.fonts.code.fallback).toBe(
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  )
})

test('normalizeDesktopThemeSettings presets font fallback when font is a string', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
    fontSizes: { code: 12, ui: 14 },
    customThemes: [
      {
        id: 'custom:light:test',
        label: 'Test',
        config: {
          codeThemeId: 'test',
          theme: {
            accent: '#0169cc',
            contrast: 40,
            fonts: {
              ui: 'Inter',
              code: 'Fira Code',
            },
            ink: '#0d0d0d',
            opaqueWindows: true,
            semanticColors: {
              diffAdded: '#00a240',
              diffRemoved: '#e02e2a',
              skill: '#751ed9',
            },
            surface: '#ffffff',
          },
          variant: 'light',
        },
      },
    ],
    presetOverrides: {},
  })
  expect(settings.customThemes[0].config.theme.fonts.ui.preset).toBe('Inter')
  expect(settings.customThemes[0].config.theme.fonts.ui.fallback).toBe(
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, "Microsoft YaHei", system-ui, sans-serif',
  )
})

test('normalizeDesktopThemeSettings enables glass surfaces by default', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
    fontSizes: { code: 12, ui: 14 },
    customThemes: [],
    presetOverrides: {},
  })

  expect(DEFAULT_DESKTOP_THEME_SETTINGS.glassmorphismEnabled).toBe(true)
  expect(settings.glassmorphismEnabled).toBe(true)
})

test('normalizeDesktopThemeSettings preserves disabled glass surfaces', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
    glassmorphismEnabled: false,
    fontSizes: { code: 12, ui: 14 },
    customThemes: [],
    presetOverrides: {},
  })

  expect(settings.glassmorphismEnabled).toBe(false)
})

test('normalizeDesktopThemeSettings defaults reduce motion to system', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
    fontSizes: { code: 12, ui: 14 },
    customThemes: [],
    presetOverrides: {},
  })

  expect(DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion).toBe('system')
  expect(settings.reduceMotion).toBe('system')
})

test('normalizeDesktopThemeSettings preserves reduce motion modes', () => {
  expect(
    normalizeDesktopThemeSettings({
      mode: 'light',
      activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
      reduceMotion: 'on',
      fontSizes: { code: 12, ui: 14 },
      customThemes: [],
      presetOverrides: {},
    }).reduceMotion,
  ).toBe('on')
  expect(
    normalizeDesktopThemeSettings({
      mode: 'light',
      activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
      reduceMotion: 'off',
      fontSizes: { code: 12, ui: 14 },
      customThemes: [],
      presetOverrides: {},
    }).reduceMotion,
  ).toBe('off')
})

test('normalizeDesktopThemeSettings falls back for invalid reduce motion', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codex', dark: 'dark-codex' },
    reduceMotion: 'fast',
    fontSizes: { code: 12, ui: 14 },
    customThemes: [],
    presetOverrides: {},
  })

  expect(settings.reduceMotion).toBe('system')
})

test('legacy custom theme without radix still renders', () => {
  const normalized = normalizeDesktopThemeConfig(
    {
      codeThemeId: 'legacy-minimal',
      theme: {
        accent: '#0169cc',
        contrast: 40,
        fonts: DEFAULT_LIGHT_THEME.theme.fonts,
        ink: '#0d0d0d',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#00a240',
          diffRemoved: '#e02e2a',
          skill: '#751ed9',
        },
        surface: '#ffffff',
      },
      variant: 'light',
    },
    'light',
  )
  expect(normalized.theme).not.toHaveProperty('radix')
  expect(normalized.theme.accent).toBe('#0169cc')
  expect(normalized.theme.surface).toBe('#ffffff')
})
