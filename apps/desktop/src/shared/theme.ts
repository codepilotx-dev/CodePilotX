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
    accent: '#0169cc',
    contrast: 40,
    fonts: {
      code: 'JetBrains Mono SemiBold',
      ui: 'Inter',
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
    ink: '#f8f8f2',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#50fa7b',
      diffRemoved: '#ff5555',
      skill: '#ff79c6',
    },
    surface: '#282a36',
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
    label: 'Codex',
    config: DEFAULT_LIGHT_THEME,
  },
  {
    id: 'light-absolutely',
    label: 'Absolutely',
    config: {
      codeThemeId: 'absolutely',
      theme: {
        accent: '#cc7d5e',
        contrast: 40,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#2d2d2b',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#00c853',
          diffRemoved: '#ff5f38',
          skill: '#cc7d5e',
        },
        surface: '#f9f9f7',
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
        accent: '#8839ef',
        contrast: 40,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#4c4f69',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#40a02b',
          diffRemoved: '#d20f39',
          skill: '#8839ef',
        },
        surface: '#eff1f5',
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
        accent: '#ff6363',
        contrast: 40,
        fonts: {
          code: '"Jetbrains Mono"',
          ui: 'Inter',
        },
        ink: '#030303',
        opaqueWindows: false,
        semanticColors: {
          diffAdded: '#006b4f',
          diffRemoved: '#b12424',
          skill: '#9a1b6e',
        },
        surface: '#ffffff',
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
        accent: '#0969da',
        contrast: 40,
        fonts: {
          code: '"Jetbrains Mono"',
          ui: 'Inter',
        },
        ink: '#1f2328',
        opaqueWindows: false,
        semanticColors: {
          diffAdded: '#1a7f37',
          diffRemoved: '#cf222e',
          skill: '#8250df',
        },
        surface: '#ffffff',
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
        accent: '#1f6feb',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#e6edf3',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#3fb950',
          diffRemoved: '#f85149',
          skill: '#bc8cff',
        },
        surface: '#0d1117',
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
        accent: '#80cbc4',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#eeffff',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#c3e88d',
          diffRemoved: '#f07178',
          skill: '#c792ea',
        },
        surface: '#212121',
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
        accent: '#007acc',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#d4d4d4',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#369432',
          diffRemoved: '#f44747',
          skill: '#000080',
        },
        surface: '#1e1e1e',
      },
      variant: 'dark',
    },
  },
  {
    id: 'dark-codex',
    label: 'Codex Dark',
    config: {
      codeThemeId: 'codex',
      theme: {
        accent: '#0169cc',
        contrast: 60,
        fonts: {
          code: 'JetBrains Mono SemiBold',
          ui: 'Inter',
        },
        ink: '#fcfcfc',
        opaqueWindows: true,
        semanticColors: {
          diffAdded: '#00a240',
          diffRemoved: '#e02e2a',
          skill: '#b06dff',
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
