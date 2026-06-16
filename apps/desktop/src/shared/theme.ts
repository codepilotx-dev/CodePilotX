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

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex',
  theme: {
    accent: '#0090ff',
    contrast: 40,
    fonts: {
      code: 'JetBrains Mono SemiBold',
      ui: 'Inter',
    },
    ink: '#202020',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#30a46c',
      diffRemoved: '#e5484d',
      skill: '#8e4ec6',
    },
    surface: '#fcfcfc',
  },
  variant: 'light',
}

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'dracula',
  theme: {
    accent: '#ff79c6',
    contrast: 60,
    fonts: {
      code: 'JetBrains Mono SemiBold',
      ui: 'Inter',
    },
    ink: '#eeeeee',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#3dd68c',
      diffRemoved: '#ff9592',
      skill: '#ffb0e1',
    },
    surface: '#21121d',
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
    config: {
      codeThemeId: 'absolutely',
      theme: {
        accent: '#f76b15',
        contrast: 40,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#582d1d',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#f76b15',
        },
        surface: '#fefcfb',
      },
      variant: 'light',
    },
  },
  {
    id: 'light-catppuccin',
    label: 'Catppuccin',
    config: {
      codeThemeId: 'catppuccin',
      theme: {
        accent: '#8e4ec6',
        contrast: 40,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#402060',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#8e4ec6',
        },
        surface: '#fefcfe',
      },
      variant: 'light',
    },
  },
  {
    id: 'light-raycast',
    label: 'Raycast',
    config: {
      codeThemeId: 'raycast',
      theme: {
        accent: '#e5484d',
        contrast: 40,
        fonts: {
          code: '"Jetbrains Mono"',
          ui: 'Inter',
        },
        ink: '#202020',
        opaqueWindows: false,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#d6409f',
        },
        surface: '#fcfcfc',
      },
      variant: 'light',
    },
  },
  {
    id: 'light-github',
    label: 'GitHub',
    config: {
      codeThemeId: 'github',
      theme: {
        accent: '#0090ff',
        contrast: 40,
        fonts: {
          code: '"Jetbrains Mono"',
          ui: 'Inter',
        },
        ink: '#202020',
        opaqueWindows: false,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#8e4ec6',
        },
        surface: '#fcfcfc',
      },
      variant: 'light',
    },
  },
  {
    id: 'dark-dracula',
    label: 'Dracula',
    config: DEFAULT_DARK_THEME,
  },
  {
    id: 'dark-github',
    label: 'GitHub Dark',
    config: {
      codeThemeId: 'github',
      theme: {
        accent: '#0090ff',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#eeeeee',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#d19dff',
        },
        surface: '#111111',
      },
      variant: 'dark',
    },
  },
  {
    id: 'dark-material',
    label: 'Material',
    config: {
      codeThemeId: 'material',
      theme: {
        accent: '#00a2c7',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#eeeeee',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#3dd68c',
          diffRemoved: '#ff9592',
          skill: '#d19dff',
        },
        surface: '#191919',
      },
      variant: 'dark',
    },
  },
  {
    id: 'dark-vscode-plus',
    label: 'VSCode Plus',
    config: {
      codeThemeId: 'vscode-plus',
      theme: {
        accent: '#0090ff',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#eeeeee',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#70b8ff',
        },
        surface: '#191919',
      },
      variant: 'dark',
    },
  },
  {
    id: 'dark-codex',
    label: 'CodePilotX Dark',
    config: {
      codeThemeId: 'codex',
      theme: {
        accent: '#0090ff',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#eeeeee',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#30a46c',
          diffRemoved: '#e5484d',
          skill: '#d19dff',
        },
        surface: '#111111',
      },
      variant: 'dark',
    },
  },
]

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
