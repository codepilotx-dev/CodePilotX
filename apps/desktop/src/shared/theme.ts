import {
  blue,
  blueDark,
  cyan,
  cyanDark,
  gray,
  grayDark,
  green,
  greenDark,
  orange,
  orangeDark,
  pink,
  pinkDark,
  purple,
  purpleDark,
  red,
  redDark,
} from '@radix-ui/colors'
import type {
  DesktopThemeConfigV1,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './types.js'

export const CODEX_THEME_PREFIX = 'codex-theme-v1:'

export type DesktopThemePreset = {
  id: string
  label: string
  config: DesktopThemeConfigV1
}

type RadixScale =
  | 'blue'
  | 'cyan'
  | 'gray'
  | 'green'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'

type RadixStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

type RadixThemePresetOptions = {
  accentScale: RadixScale
  accentStep?: RadixStep
  codeThemeId: string
  contrast?: number
  fonts?: DesktopThemeConfigV1['theme']['fonts']
  inkScale?: RadixScale
  inkStep?: RadixStep
  opaqueWindows?: boolean
  skillScale?: RadixScale
  skillStep?: RadixStep
  surfaceScale?: RadixScale
  surfaceStep?: RadixStep
  variant: DesktopThemeVariant
}

const RADIX_LIGHT: Record<RadixScale, Record<string, string>> = {
  blue,
  cyan,
  gray,
  green,
  orange,
  pink,
  purple,
  red,
}

const RADIX_DARK: Record<RadixScale, Record<string, string>> = {
  blue: blueDark,
  cyan: cyanDark,
  gray: grayDark,
  green: greenDark,
  orange: orangeDark,
  pink: pinkDark,
  purple: purpleDark,
  red: redDark,
}

const INTER_FONTS = {
  code: 'JetBrains Mono SemiBold',
  ui: 'Inter',
}

const QUOTED_JETBRAINS_FONTS = {
  code: '"Jetbrains Mono"',
  ui: 'Inter',
}

const DRACULA_PINK = {
  9: '#ff79c6',
  10: '#f36ebb',
  11: '#ffb0e1',
  12: '#fdd1e7',
}

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 =
  createRadixThemePreset({
    accentScale: 'blue',
    codeThemeId: 'codex',
    skillScale: 'purple',
    variant: 'light',
  })

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'dracula',
  theme: {
    accent: DRACULA_PINK[9],
    contrast: 60,
    fonts: INTER_FONTS,
    ink: radixColor('dark', 'gray', 12),
    opaqueWindows: true,
    semanticColors: {
      diffAdded: radixColor('dark', 'green', 11),
      diffRemoved: radixColor('dark', 'red', 11),
      skill: DRACULA_PINK[11],
    },
    surface: radixColor('dark', 'pink', 2),
  },
  variant: 'dark',
}

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings = {
  mode: 'light',
  themes: {
    light: DEFAULT_LIGHT_THEME,
    dark: DEFAULT_DARK_THEME,
  },
}

export const DESKTOP_THEME_PRESETS: DesktopThemePreset[] = [
  {
    id: 'light-codex',
    label: 'CodePilotX',
    config: DEFAULT_LIGHT_THEME,
  },
  {
    id: 'light-absolutely',
    label: 'Absolutely',
    config: createRadixThemePreset({
      accentScale: 'orange',
      codeThemeId: 'absolutely',
      inkScale: 'orange',
      skillScale: 'orange',
      surfaceScale: 'orange',
      variant: 'light',
    }),
  },
  {
    id: 'light-catppuccin',
    label: 'Catppuccin',
    config: createRadixThemePreset({
      accentScale: 'purple',
      codeThemeId: 'catppuccin',
      inkScale: 'purple',
      skillScale: 'purple',
      surfaceScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: 'light-raycast',
    label: 'Raycast',
    config: createRadixThemePreset({
      accentScale: 'red',
      codeThemeId: 'raycast',
      fonts: QUOTED_JETBRAINS_FONTS,
      opaqueWindows: false,
      skillScale: 'pink',
      variant: 'light',
    }),
  },
  {
    id: 'light-github',
    label: 'GitHub',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'github',
      fonts: QUOTED_JETBRAINS_FONTS,
      opaqueWindows: false,
      skillScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: 'dark-dracula',
    label: 'Dracula',
    config: DEFAULT_DARK_THEME,
  },
  {
    id: 'dark-github',
    label: 'GitHub Dark',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'github',
      skillScale: 'purple',
      variant: 'dark',
    }),
  },
  {
    id: 'dark-material',
    label: 'Material',
    config: createRadixThemePreset({
      accentScale: 'cyan',
      codeThemeId: 'material',
      skillScale: 'purple',
      surfaceStep: 2,
      variant: 'dark',
    }),
  },
  {
    id: 'dark-vscode-plus',
    label: 'VSCode Plus',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'vscode-plus',
      skillScale: 'blue',
      skillStep: 11,
      surfaceStep: 2,
      variant: 'dark',
    }),
  },
  {
    id: 'dark-codex',
    label: 'CodePilotX Dark',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'codex',
      skillScale: 'purple',
      variant: 'dark',
    }),
  },
]

function createRadixThemePreset(
  options: RadixThemePresetOptions,
): DesktopThemeConfigV1 {
  const {
    accentScale,
    accentStep = 9,
    codeThemeId,
    contrast = options.variant === 'dark' ? 60 : 40,
    fonts = INTER_FONTS,
    inkScale = 'gray',
    inkStep = 12,
    opaqueWindows = true,
    skillScale = accentScale,
    skillStep = options.variant === 'dark' ? 11 : 9,
    surfaceScale = 'gray',
    surfaceStep = 1,
    variant,
  } = options

  return {
    codeThemeId,
    theme: {
      accent: radixColor(variant, accentScale, accentStep),
      contrast,
      fonts,
      ink: radixColor(variant, inkScale, inkStep),
      opaqueWindows,
      semanticColors: {
        diffAdded: radixColor(variant, 'green', variant === 'dark' ? 11 : 9),
        diffRemoved: radixColor(variant, 'red', variant === 'dark' ? 11 : 9),
        skill: radixColor(variant, skillScale, skillStep),
      },
      surface: radixColor(variant, surfaceScale, surfaceStep),
    },
    variant,
  }
}

function radixColor(
  variant: DesktopThemeVariant,
  scale: RadixScale,
  step: RadixStep,
): string {
  const palette = variant === 'dark' ? RADIX_DARK : RADIX_LIGHT
  return palette[scale][`${scale}${step}`]
}

export function getDesktopThemeForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  return (
    settings.themes[variant] ??
    (variant === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME)
  )
}

export function normalizeDesktopThemeSettings(
  value: unknown,
): DesktopThemeSettings {
  if (!isRecord(value)) {
    return DEFAULT_DESKTOP_THEME_SETTINGS
  }

  const themes = isRecord(value.themes) ? value.themes : {}
  const normalizedThemes: DesktopThemeSettings['themes'] = {
    light: normalizeDesktopThemeConfig(
      themes.light,
      'light',
      DEFAULT_LIGHT_THEME,
    ),
    dark: normalizeDesktopThemeConfig(themes.dark, 'dark', DEFAULT_DARK_THEME),
  }

  return {
    mode: isDesktopThemeMode(value.mode) ? value.mode : 'light',
    themes: normalizedThemes,
  }
}

export function normalizeDesktopThemeConfig(
  value: unknown,
  variant: DesktopThemeVariant,
  fallback: DesktopThemeConfigV1 = variant === 'dark'
    ? DEFAULT_DARK_THEME
    : DEFAULT_LIGHT_THEME,
): DesktopThemeConfigV1 {
  if (!isRecord(value) || !isRecord(value.theme)) {
    return fallback
  }

  const theme = value.theme
  const fonts = isRecord(theme.fonts) ? theme.fonts : {}
  const semanticColors = isRecord(theme.semanticColors)
    ? theme.semanticColors
    : {}

  return {
    codeThemeId: isNonEmptyString(value.codeThemeId)
      ? value.codeThemeId
      : fallback.codeThemeId,
    theme: {
      accent: normalizeHexColor(theme.accent, fallback.theme.accent),
      contrast: normalizeContrast(theme.contrast, fallback.theme.contrast),
      fonts: {
        code: isNonEmptyString(fonts.code)
          ? fonts.code
          : fallback.theme.fonts.code,
        ui: isNonEmptyString(fonts.ui) ? fonts.ui : fallback.theme.fonts.ui,
      },
      ink: normalizeHexColor(theme.ink, fallback.theme.ink),
      opaqueWindows:
        typeof theme.opaqueWindows === 'boolean'
          ? theme.opaqueWindows
          : fallback.theme.opaqueWindows,
      semanticColors: {
        diffAdded: normalizeHexColor(
          semanticColors.diffAdded,
          fallback.theme.semanticColors.diffAdded,
        ),
        diffRemoved: normalizeHexColor(
          semanticColors.diffRemoved,
          fallback.theme.semanticColors.diffRemoved,
        ),
        skill: normalizeHexColor(
          semanticColors.skill,
          fallback.theme.semanticColors.skill,
        ),
      },
      surface: normalizeHexColor(theme.surface, fallback.theme.surface),
    },
    variant,
  }
}

export function isDesktopThemeMode(value: unknown): value is DesktopThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function isDesktopThemeVariant(
  value: unknown,
): value is DesktopThemeVariant {
  return value === 'light' || value === 'dark'
}

function normalizeContrast(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value
    : fallback
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
