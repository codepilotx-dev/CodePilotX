import type {
  DesktopThemeConfigV1,
  DesktopThemeFontEntry,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './types.js'
import {
  CODEX_HIGHLIGHT_THEMES,
  isCodexHighlightThemeSlug,
} from './codexThemes/manifest.js'

export const DEFAULT_LIGHT_THEME_ID = 'light-codex'
export const DEFAULT_DARK_THEME_ID = 'dark-codex'

export const DEFAULT_UI_FONT: DesktopThemeFontEntry = {
  preset: '-apple-system',
  fallback: 'BlinkMacSystemFont, "Segoe UI", sans-serif',
}

export const DEFAULT_CODE_FONT: DesktopThemeFontEntry = {
  preset: 'JetBrains Mono',
  fallback: 'Consolas, monospace',
}

const DEFAULT_FONTS: DesktopThemeConfigV1['theme']['fonts'] = {
  ui: DEFAULT_UI_FONT,
  code: DEFAULT_CODE_FONT,
}

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-light',
  theme: {
    accent: '#339cff',
    contrast: 40,
    fonts: DEFAULT_FONTS,
    ink: '#1a1c1f',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#00a240',
      diffRemoved: '#e02e2a',
      skill: '#924ff7',
    },
    surface: '#ffffff',
  },
  variant: 'light',
}

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex-dark',
  theme: {
    accent: '#339cff',
    contrast: 40,
    fonts: DEFAULT_FONTS,
    ink: '#ffffff',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#00a240',
      diffRemoved: '#e02e2a',
      skill: '#ad7bf9',
    },
    surface: '#181818',
  },
  variant: 'dark',
}

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings = {
  version: 2,
  mode: 'system',
  codeThemeIds: {
    light: 'auto',
    dark: 'auto',
  },
  glassmorphismEnabled: true,
  pointerCursorEnabled: true,
  reduceMotion: 'system',
  fontSizes: {
    code: 12,
    ui: 14,
  },
}

export function getDesktopThemeForSelection(
  _settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  return variant === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME
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
): DesktopThemeSettings['codeThemeIds'][DesktopThemeVariant] {
  return settings.codeThemeIds[variant]
}

export function normalizeDesktopThemeSettings(
  value: unknown,
): DesktopThemeSettings {
  if (!isRecord(value)) return { ...DEFAULT_DESKTOP_THEME_SETTINGS }

  const isVersion2 = value.version === 2
  return {
    version: 2,
    mode:
      value.mode === 'light' ||
      value.mode === 'dark' ||
      value.mode === 'system'
        ? value.mode
        : DEFAULT_DESKTOP_THEME_SETTINGS.mode,
    codeThemeIds: normalizeCodeThemeIds(value, isVersion2),
    glassmorphismEnabled:
      typeof value.glassmorphismEnabled === 'boolean'
        ? value.glassmorphismEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.glassmorphismEnabled,
    pointerCursorEnabled:
      typeof value.pointerCursorEnabled === 'boolean'
        ? value.pointerCursorEnabled
        : DEFAULT_DESKTOP_THEME_SETTINGS.pointerCursorEnabled,
    reduceMotion:
      value.reduceMotion === 'on' ||
      value.reduceMotion === 'off' ||
      value.reduceMotion === 'system'
        ? value.reduceMotion
        : DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion,
    fontSizes: normalizeFontSizes(value.fontSizes),
  }
}

function normalizeCodeThemeIds(
  value: Record<string, unknown>,
  isVersion2: boolean,
): DesktopThemeSettings['codeThemeIds'] {
  const selections = isRecord(value.codeThemeIds) ? value.codeThemeIds : {}
  const normalized = {
    light: normalizeCodeThemeIdForVariant(selections.light, 'light'),
    dark: normalizeCodeThemeIdForVariant(selections.dark, 'dark'),
  } satisfies DesktopThemeSettings['codeThemeIds']

  if (
    normalized.light !== 'auto' ||
    normalized.dark !== 'auto' ||
    !isVersion2 ||
    !isCodexHighlightThemeSlug(value.codeThemeId)
  ) {
    return normalized
  }

  const legacyTheme = CODEX_HIGHLIGHT_THEMES.find(
    theme => theme.slug === value.codeThemeId,
  )
  if (!legacyTheme) return normalized
  return {
    ...normalized,
    [legacyTheme.variant]: legacyTheme.slug,
  }
}

function normalizeCodeThemeIdForVariant(
  value: unknown,
  variant: DesktopThemeVariant,
): DesktopThemeSettings['codeThemeIds'][DesktopThemeVariant] {
  if (value === 'auto') return 'auto'
  if (!isCodexHighlightThemeSlug(value)) return 'auto'
  return CODEX_HIGHLIGHT_THEMES.some(
    theme => theme.slug === value && theme.variant === variant,
  )
    ? value
    : 'auto'
}

function normalizeFontSizes(
  value: unknown,
): DesktopThemeSettings['fontSizes'] {
  const record = isRecord(value) ? value : {}
  return {
    code: clampNumber(
      record.code,
      10,
      20,
      DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.code,
    ),
    ui: clampNumber(
      record.ui,
      11,
      20,
      DEFAULT_DESKTOP_THEME_SETTINGS.fontSizes.ui,
    ),
  }
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
