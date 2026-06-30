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

test('DEFAULT_LIGHT_THEME uses Codex-style tokens', () => {
  expect(DEFAULT_LIGHT_THEME.theme.surface).toBe('#ffffff')
  expect(DEFAULT_LIGHT_THEME.theme.ink).toBe('#0d0d0d')
  expect(DEFAULT_LIGHT_THEME.theme.accent).toBe('#0169cc')
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.diffAdded).toBe('#00a240')
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.diffRemoved).toBe('#e02e2a')
  expect(DEFAULT_LIGHT_THEME.theme.semanticColors.skill).toBe('#751ed9')
  expect(DEFAULT_LIGHT_THEME.variant).toBe('light')
})

test('DEFAULT_DARK_THEME uses Codex-style tokens', () => {
  expect(DEFAULT_DARK_THEME.theme.surface).toBe('#111111')
  expect(DEFAULT_DARK_THEME.theme.ink).toBe('#fcfcfc')
  expect(DEFAULT_DARK_THEME.theme.accent).toBe('#0169cc')
  expect(DEFAULT_DARK_THEME.theme.semanticColors.diffAdded).toBe('#00a240')
  expect(DEFAULT_DARK_THEME.theme.semanticColors.diffRemoved).toBe('#e02e2a')
  expect(DEFAULT_DARK_THEME.theme.semanticColors.skill).toBe('#b06dff')
  expect(DEFAULT_DARK_THEME.variant).toBe('dark')
})

test('DEFAULT_LIGHT_THEME has radix config for internal Radix compat', () => {
  expect(DEFAULT_LIGHT_THEME.theme.radix).toBeDefined()
  expect(DEFAULT_LIGHT_THEME.theme.radix.accentColor).toBe('blue')
})

test('DEFAULT_DARK_THEME has radix config for internal Radix compat', () => {
  expect(DEFAULT_DARK_THEME.theme.radix).toBeDefined()
  expect(DEFAULT_DARK_THEME.theme.radix.accentColor).toBe('blue')
})

test('built-in desktop themes include ten paired Radix suites', () => {
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
    expect(lightTheme?.config.theme.radix).toBeDefined()
    expect(darkTheme?.config.theme.radix).toBeDefined()
    expect(lightTheme?.config.theme.radix.accentColor).toBe(
      darkTheme?.config.theme.radix.accentColor,
    )
    expect(lightTheme?.config.theme.radix.grayColor).toBe(
      darkTheme?.config.theme.radix.grayColor,
    )
  }
})

test('new built-in Radix suites carry valid Radix theme config', () => {
  const expectedConfigs = new Map([
    ['light-raycast', { accentColor: 'red', grayColor: 'slate' }],
    ['dark-raycast', { accentColor: 'red', grayColor: 'slate' }],
    ['light-dracula', { accentColor: 'pink', grayColor: 'mauve' }],
    ['dark-dracula', { accentColor: 'pink', grayColor: 'mauve' }],
    ['light-material', { accentColor: 'cyan', grayColor: 'sage' }],
    ['dark-material', { accentColor: 'cyan', grayColor: 'sage' }],
    ['light-terminal-green', { accentColor: 'green', grayColor: 'sage' }],
    ['dark-terminal-green', { accentColor: 'green', grayColor: 'sage' }],
    ['light-iris-focus', { accentColor: 'iris', grayColor: 'slate' }],
    ['dark-iris-focus', { accentColor: 'iris', grayColor: 'slate' }],
  ])

  for (const [themeId, radix] of expectedConfigs) {
    const preset = DESKTOP_THEME_PRESETS.find(item => item.id === themeId)
    expect(preset?.config.theme.radix).toMatchObject(radix)
    expect(preset?.config.theme.surface).toMatch(/^#[0-9a-f]{6}$/i)
    expect(preset?.config.theme.ink).toMatch(/^#[0-9a-f]{6}$/i)
    expect(preset?.config.theme.accent).toMatch(/^#[0-9a-f]{6}$/i)
  }
})

test('exportDesktopThemeConfig strips theme.radix', () => {
  const exported = exportDesktopThemeConfig(DEFAULT_LIGHT_THEME)
  expect(exported.theme).not.toHaveProperty('radix')
  expect(exported.codeThemeId).toBe('codex')
  expect(exported.variant).toBe('light')
  expect(exported.theme).toHaveProperty('surface')
  expect(exported.theme).toHaveProperty('ink')
  expect(exported.theme).toHaveProperty('accent')
})

test('normalizeDesktopThemeConfig normalizes legacy custom theme with Radix fallback', () => {
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
        surface: '#ffffff',
      },
      variant: 'dark',
    },
    'dark',
  )
  expect(normalized.theme.radix).toBeDefined()
  expect(normalized.theme.radix.accentColor).toBe('blue')
  expect(normalized.theme.radix.panelBackground).toBe('solid')
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
  expect(normalized.theme.radix).toBeDefined()
  expect(normalized.theme.radix.accentColor).toBe('blue')
})
