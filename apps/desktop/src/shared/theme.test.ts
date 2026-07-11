import { expect, test } from 'bun:test'
import {
  DESKTOP_THEME_PRESETS,
  DEFAULT_DARK_THEME,
  DEFAULT_DESKTOP_THEME_SETTINGS,
  DEFAULT_FONTS,
  DEFAULT_LIGHT_THEME,
  exportDesktopThemeConfig,
  normalizeDesktopThemeConfig,
  normalizeDesktopThemeSettings,
} from './theme.js'

const THEME_SUITE_IDS = [
  'codepilotx',
  'github',
  'raycast',
  'dracula',
  'rose-pine',
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

test('built-in desktop themes include eleven paired suites', () => {
  const pairedPresets = DESKTOP_THEME_PRESETS.filter(preset =>
    THEME_SUITE_IDS.some(
      suiteId => preset.id === `light-${suiteId}` || preset.id === `dark-${suiteId}`,
    ),
  )

  expect(pairedPresets).toHaveLength(THEME_SUITE_IDS.length * 2)

  for (const suiteId of THEME_SUITE_IDS) {
    const lightTheme = DESKTOP_THEME_PRESETS.find(
      preset => preset.id === `light-${suiteId}`,
    )
    const darkTheme = DESKTOP_THEME_PRESETS.find(
      preset => preset.id === `dark-${suiteId}`,
    )

    expect(lightTheme?.config.variant).toBe('light')
    expect(darkTheme?.config.variant).toBe('dark')
    expect(lightTheme?.config.theme.contrast).toBe(suiteId === 'rose-pine' ? 70 : 40)
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

test('dark Dracula theme uses configured desktop tokens', () => {
  const preset = DESKTOP_THEME_PRESETS.find(item => item.id === 'dark-dracula')
  expect(preset?.config).toMatchObject({
    codeThemeId: 'dracula',
    theme: {
      accent: '#ff79c6',
      contrast: 40,
      fonts: DEFAULT_FONTS,
      ink: '#f8f8f2',
      opaqueWindows: false,
      semanticColors: {
        diffAdded: '#50fa7b',
        diffRemoved: '#ff5555',
        skill: '#ff79c6',
      },
      surface: '#282a36',
    },
    variant: 'dark',
  })
})

test('Rose Pine themes use configured desktop tokens', () => {
  const lightPreset = DESKTOP_THEME_PRESETS.find(item => item.id === 'light-rose-pine')
  const darkPreset = DESKTOP_THEME_PRESETS.find(item => item.id === 'dark-rose-pine')

  expect(lightPreset).toMatchObject({
    label: 'Rose Pine',
    config: {
      codeThemeId: 'rose-pine',
      theme: {
        accent: '#d7827e',
        contrast: 70,
        fonts: DEFAULT_FONTS,
        ink: '#575279',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#56949f',
          diffRemoved: '#797593',
          skill: '#907aa9',
        },
        surface: '#faf4ed',
      },
      variant: 'light',
    },
  })
  expect(darkPreset).toMatchObject({
    label: 'Rose Pine',
    config: {
      codeThemeId: 'rose-pine',
      theme: {
        accent: '#ea9a97',
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: '#e0def4',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#9ccfd8',
          diffRemoved: '#908caa',
          skill: '#c4a7e7',
        },
        surface: '#232136',
      },
      variant: 'dark',
    },
  })
})

test('updated dark presets use exact desktop tokens', () => {
  const expected = {
    'dark-raycast': {
      codeThemeId: 'raycast',
      accent: '#ff6363',
      ink: '#fefefe',
      opaqueWindows: false,
      diffAdded: '#59d499',
      diffRemoved: '#ff6363',
      skill: '#cf2f98',
      surface: '#101010',
    },
    'dark-dracula': {
      codeThemeId: 'dracula',
      accent: '#ff79c6',
      ink: '#f8f8f2',
      opaqueWindows: false,
      diffAdded: '#50fa7b',
      diffRemoved: '#ff5555',
      skill: '#ff79c6',
      surface: '#282a36',
    },
    'dark-absolutely': {
      codeThemeId: 'absolutely',
      accent: '#cc7d5e',
      ink: '#f9f9f7',
      opaqueWindows: false,
      diffAdded: '#00c853',
      diffRemoved: '#ff5f38',
      skill: '#cc7d5e',
      surface: '#2d2d2b',
    },
    'dark-material': {
      codeThemeId: 'material',
      accent: '#80cbc4',
      ink: '#eeffff',
      opaqueWindows: true,
      diffAdded: '#c3e88d',
      diffRemoved: '#f07178',
      skill: '#c792ea',
      surface: '#212121',
    },
  } as const

  for (const [id, tokens] of Object.entries(expected)) {
    const preset = DESKTOP_THEME_PRESETS.find(item => item.id === id)
    expect(preset?.config).toMatchObject({
      codeThemeId: tokens.codeThemeId,
      theme: {
        accent: tokens.accent,
        contrast: 40,
        fonts: DEFAULT_FONTS,
        ink: tokens.ink,
        opaqueWindows: tokens.opaqueWindows,
        semanticColors: {
          diffAdded: tokens.diffAdded,
          diffRemoved: tokens.diffRemoved,
          skill: tokens.skill,
        },
        surface: tokens.surface,
      },
      variant: 'dark',
    })
  }
})

test('dark-only presets use exact desktop tokens without light counterparts', () => {
  const expected = {
    'dark-everforest': {
      label: 'Everforest',
      codeThemeId: 'everforest',
      accent: '#a7c080',
      ink: '#d3c6aa',
      opaqueWindows: false,
      diffAdded: '#a7c080',
      diffRemoved: '#e67e80',
      skill: '#d699b6',
      surface: '#2d353b',
    },
    'dark-lobster': {
      label: 'Lobster',
      codeThemeId: 'lobster',
      accent: '#ff5c5c',
      ink: '#e4e4e7',
      opaqueWindows: false,
      diffAdded: '#22c55e',
      diffRemoved: '#ff5c5c',
      skill: '#3b82f6',
      surface: '#111827',
    },
    'dark-linear': {
      label: 'Linear',
      codeThemeId: 'linear',
      accent: '#606acc',
      ink: '#e3e4e6',
      opaqueWindows: true,
      diffAdded: '#69c967',
      diffRemoved: '#ff7e78',
      skill: '#c2a1ff',
      surface: '#0f0f11',
    },
    'dark-night-owl': {
      label: 'Night Owl',
      codeThemeId: 'night-owl',
      accent: '#44596b',
      ink: '#d6deeb',
      opaqueWindows: true,
      diffAdded: '#c5e478',
      diffRemoved: '#ef5350',
      skill: '#c792ea',
      surface: '#011627',
    },
    'dark-tokyo-night': {
      label: 'Tokyo Night',
      codeThemeId: 'tokyo-night',
      accent: '#3d59a1',
      ink: '#a9b1d6',
      opaqueWindows: true,
      diffAdded: '#449dab',
      diffRemoved: '#914c54',
      skill: '#9d7cd8',
      surface: '#1a1b26',
    },
  } as const

  for (const [id, tokens] of Object.entries(expected)) {
    const preset = DESKTOP_THEME_PRESETS.find(item => item.id === id)
    expect(preset).toMatchObject({
      id,
      label: tokens.label,
      config: {
        codeThemeId: tokens.codeThemeId,
        theme: {
          accent: tokens.accent,
          contrast: 40,
          fonts: DEFAULT_FONTS,
          ink: tokens.ink,
          opaqueWindows: tokens.opaqueWindows,
          semanticColors: {
            diffAdded: tokens.diffAdded,
            diffRemoved: tokens.diffRemoved,
            skill: tokens.skill,
          },
          surface: tokens.surface,
        },
        variant: 'dark',
      },
    })
    expect(DESKTOP_THEME_PRESETS.some(item => item.id === id.replace('dark-', 'light-'))).toBe(false)
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
  expect(normalized.theme.fonts.ui.fallback).toBe('MiSans, Inter')
  expect(normalized.theme.fonts.code.preset).toBe('Fira Code')
  expect(normalized.theme.fonts.code.fallback).toBe('Consolas, monospace')
})

test('normalizeDesktopThemeSettings presets font fallback when font is a string', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
  expect(settings.customThemes[0].config.theme.fonts.ui.fallback).toBe('MiSans, Inter')
})

test('normalizeDesktopThemeSettings enables glass surfaces by default', () => {
  const settings = normalizeDesktopThemeSettings({
    mode: 'light',
    activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
    activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
    activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
      activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
      reduceMotion: 'on',
      fontSizes: { code: 12, ui: 14 },
      customThemes: [],
      presetOverrides: {},
    }).reduceMotion,
  ).toBe('on')
  expect(
    normalizeDesktopThemeSettings({
      mode: 'light',
      activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
    activeThemeIds: { light: 'light-codepilotx', dark: 'dark-codepilotx' },
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
