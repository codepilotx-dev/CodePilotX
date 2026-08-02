import type {
  DesktopChromeTheme,
  DesktopThemeConfigV1,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './types.js'
import {
  CODEX_HIGHLIGHT_THEMES,
  type CodexHighlightThemeSlug,
  isCodexHighlightThemeSlug,
} from './codexThemes/manifest.js'

export const DEFAULT_LIGHT_THEME_ID = 'light-codex'
export const DEFAULT_DARK_THEME_ID = 'dark-codex'
export const DEFAULT_UI_FONT =
  'ui-sans-serif, system-ui, "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"'
export const DEFAULT_CODE_FONT =
  '"JetBrains Mono", "SFMono-Regular", Consolas, monospace'

export const DEFAULT_LIGHT_CHROME_THEME: DesktopChromeTheme = {
  accent: '#339cff',
  contrast: 45,
  fonts: { code: null, ui: null },
  ink: '#1a1c1f',
  semanticColors: {
    diffAdded: '#00a240',
    diffRemoved: '#ba2623',
    skill: '#924ff7',
  },
  surface: '#ffffff',
}

export const DEFAULT_DARK_CHROME_THEME: DesktopChromeTheme = {
  accent: '#339cff',
  contrast: 60,
  fonts: { code: null, ui: null },
  ink: '#ffffff',
  semanticColors: {
    diffAdded: '#40c977',
    diffRemoved: '#fa423e',
    skill: '#ad7bf9',
  },
  surface: '#181818',
}

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-light',
  theme: DEFAULT_LIGHT_CHROME_THEME,
  variant: 'light',
}

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-dark',
  theme: DEFAULT_DARK_CHROME_THEME,
  variant: 'dark',
}

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings = {
  version: 6,
  mode: 'system',
  chromeThemes: {
    light: DEFAULT_LIGHT_CHROME_THEME,
    dark: DEFAULT_DARK_CHROME_THEME,
  },
  codeThemeIds: {
    light: 'codex-light',
    dark: 'codex-dark',
  },
  pointerCursorEnabled: false,
  reduceMotion: 'system',
  fontSmoothingEnabled: true,
  fontSizes: {
    code: 12,
    ui: 14,
  },
}

export function getDesktopThemeForSelection(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  return {
    codeThemeId: settings.codeThemeIds[variant],
    theme: settings.chromeThemes[variant],
    variant,
  }
}

export function getDesktopThemeIdForVariant(
  _settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): string {
  return variant === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
}

export function getCodeThemeSelectionForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): CodexHighlightThemeSlug {
  return settings.codeThemeIds[variant]
}

export function normalizeDesktopThemeSettings(
  value: unknown,
): DesktopThemeSettings {
  const record = isRecord(value) ? value : {}
  if (record.version !== 6) {
    return cloneDefaultDesktopThemeSettings()
  }
  const chromeThemes = isRecord(record.chromeThemes)
    ? record.chromeThemes
    : {}

  return {
    version: 6,
    mode: normalizeMode(record.mode),
    chromeThemes: {
      light: normalizeChromeTheme(
        chromeThemes.light,
        DEFAULT_LIGHT_CHROME_THEME,
      ),
      dark: normalizeChromeTheme(
        chromeThemes.dark,
        DEFAULT_DARK_CHROME_THEME,
      ),
    },
    codeThemeIds: normalizeCodeThemeIds(record),
    pointerCursorEnabled:
      typeof record.pointerCursorEnabled === 'boolean'
        ? record.pointerCursorEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.pointerCursorEnabled,
    reduceMotion: normalizeReducedMotion(record.reduceMotion),
    fontSmoothingEnabled:
      typeof record.fontSmoothingEnabled === 'boolean'
        ? record.fontSmoothingEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.fontSmoothingEnabled,
    fontSizes: normalizeFontSizes(record.fontSizes),
  }
}

function cloneDefaultDesktopThemeSettings(): DesktopThemeSettings {
  return {
    ...DEFAULT_DESKTOP_THEME_SETTINGS,
    chromeThemes: {
      light: {
        ...DEFAULT_LIGHT_CHROME_THEME,
        fonts: { ...DEFAULT_LIGHT_CHROME_THEME.fonts },
        semanticColors: { ...DEFAULT_LIGHT_CHROME_THEME.semanticColors },
      },
      dark: {
        ...DEFAULT_DARK_CHROME_THEME,
        fonts: { ...DEFAULT_DARK_CHROME_THEME.fonts },
        semanticColors: { ...DEFAULT_DARK_CHROME_THEME.semanticColors },
      },
    },
    codeThemeIds: { ...DEFAULT_DESKTOP_THEME_SETTINGS.codeThemeIds },
    fontSizes: { ...DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes },
  }
}

function normalizeMode(value: unknown): DesktopThemeSettings['mode'] {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.mode
}

function normalizeReducedMotion(
  value: unknown,
): DesktopThemeSettings['reduceMotion'] {
  return value === 'on' || value === 'off' || value === 'system'
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion
}

function normalizeChromeTheme(
  value: unknown,
  fallback: DesktopChromeTheme,
): DesktopChromeTheme {
  const record = isRecord(value) ? value : {}
  const fonts = isRecord(record.fonts) ? record.fonts : {}
  const semanticColors = isRecord(record.semanticColors)
    ? record.semanticColors
    : {}
  return {
    accent: normalizeHex(record.accent, fallback.accent),
    contrast: clampNumber(record.contrast, 0, 100, fallback.contrast),
    fonts: {
      code: normalizeOptionalFont(fonts.code),
      ui: normalizeOptionalFont(fonts.ui),
    },
    ink: normalizeHex(record.ink, fallback.ink),
    semanticColors: {
      diffAdded: normalizeHex(
        semanticColors.diffAdded,
        fallback.semanticColors.diffAdded,
      ),
      diffRemoved: normalizeHex(
        semanticColors.diffRemoved,
        fallback.semanticColors.diffRemoved,
      ),
      skill: normalizeHex(
        semanticColors.skill,
        fallback.semanticColors.skill,
      ),
    },
    surface: normalizeHex(record.surface, fallback.surface),
  }
}

function normalizeCodeThemeIds(
  value: Record<string, unknown>,
): DesktopThemeSettings['codeThemeIds'] {
  const selections = isRecord(value.codeThemeIds) ? value.codeThemeIds : {}
  const legacyTheme = isCodexHighlightThemeSlug(value.codeThemeId)
    ? CODEX_HIGHLIGHT_THEMES.find(theme => theme.slug === value.codeThemeId)
    : undefined

  return {
    light: normalizeCodeThemeIdForVariant(
      selections.light ??
        (legacyTheme?.variant === 'light' ? legacyTheme.slug : undefined),
      'light',
    ),
    dark: normalizeCodeThemeIdForVariant(
      selections.dark ??
        (legacyTheme?.variant === 'dark' ? legacyTheme.slug : undefined),
      'dark',
    ),
  }
}

function normalizeCodeThemeIdForVariant(
  value: unknown,
  variant: DesktopThemeVariant,
): CodexHighlightThemeSlug {
  if (value === 'auto' || !isCodexHighlightThemeSlug(value)) {
    return variant === 'light' ? 'codex-light' : 'codex-dark'
  }
  return CODEX_HIGHLIGHT_THEMES.some(
    theme => theme.slug === value && theme.variant === variant,
  )
    ? value
    : variant === 'light'
      ? 'codex-light'
      : 'codex-dark'
}

function normalizeFontSizes(
  value: unknown,
): DesktopThemeSettings['fontSizes'] {
  const record = isRecord(value) ? value : {}
  return {
    code: clampNumber(
      record.code,
      8,
      24,
      DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.code,
    ),
    ui: clampNumber(
      record.ui,
      11,
      16,
      DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.ui,
    ),
  }
}

function normalizeHex(
  value: unknown,
  fallback: `#${string}`,
): `#${string}` {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? (value.toLowerCase() as `#${string}`)
    : fallback
}

function normalizeOptionalFont(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 512) : null
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
