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
  DesktopThemeCustomTheme,
  DesktopThemeConfigV1,
  DesktopThemeFontEntry,
  DesktopThemeMode,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './types.js'

export const CODEX_THEME_PREFIX = 'codex-theme-v1:'
export const DEFAULT_LIGHT_THEME_ID = 'light-codex'
export const DEFAULT_DARK_THEME_ID = 'dark-dracula'

export const DEFAULT_UI_FONT: DesktopThemeFontEntry = {
  preset: 'MiSans',
  fallback:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, "Microsoft YaHei", system-ui, sans-serif',
}

export const DEFAULT_CODE_FONT: DesktopThemeFontEntry = {
  preset: 'JetBrains Mono',
  fallback:
    'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
}

export const DEFAULT_FONTS: DesktopThemeConfigV1['theme']['fonts'] = {
  ui: DEFAULT_UI_FONT,
  code: DEFAULT_CODE_FONT,
}

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
    fonts: DEFAULT_FONTS,
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
  activeThemeIds: {
    light: DEFAULT_LIGHT_THEME_ID,
    dark: DEFAULT_DARK_THEME_ID,
  },
  fontSizes: {
    code: 12,
    ui: 14,
  },
  customThemes: [],
  presetOverrides: {},
}

export const DESKTOP_THEME_PRESETS: DesktopThemePreset[] = [
  {
    id: DEFAULT_LIGHT_THEME_ID,
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
      fonts: DEFAULT_FONTS,
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
      fonts: DEFAULT_FONTS,
      skillScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: DEFAULT_DARK_THEME_ID,
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
    fonts = DEFAULT_FONTS,
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
  return getDesktopThemeForSelection(settings, variant)
}

export function getDesktopThemeForSelection(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): DesktopThemeConfigV1 {
  const themeId = getDesktopThemeIdForVariant(settings, variant)
  return getDesktopThemeEntry(settings, themeId)?.config ?? getDefaultTheme(variant)
}

export function getDesktopThemeIdForVariant(
  settings: DesktopThemeSettings,
  variant: DesktopThemeVariant,
): string {
  const candidateId = settings.activeThemeIds[variant]
  const candidate = getDesktopThemeEntry(settings, candidateId)
  if (candidate?.config.variant === variant) {
    return candidate.id
  }
  return getDefaultThemeId(variant)
}

export function getDesktopThemeEntry(
  settings: DesktopThemeSettings,
  themeId: string,
): DesktopThemePreset | DesktopThemeCustomTheme | null {
  const preset = DESKTOP_THEME_PRESETS.find(item => item.id === themeId)
  if (preset) {
    return {
      ...preset,
      config: settings.presetOverrides[preset.id] ?? preset.config,
    }
  }
  return settings.customThemes.find(item => item.id === themeId) ?? null
}

export function isBuiltinDesktopThemeId(themeId: string): boolean {
  return DESKTOP_THEME_PRESETS.some(item => item.id === themeId)
}

export function createDesktopCustomTheme(
  config: DesktopThemeConfigV1,
  label: string,
  existingThemes: DesktopThemeCustomTheme[],
  sourcePresetId?: string,
): DesktopThemeCustomTheme {
  const normalizedLabel = label.trim() || config.codeThemeId || 'Custom Theme'
  const baseId = `custom:${config.variant}:${slugifyThemeId(normalizedLabel)}`
  return {
    id: uniqueCustomThemeId(baseId, existingThemes),
    label: normalizedLabel,
    config,
    ...(sourcePresetId ? { sourcePresetId } : {}),
  }
}

export function normalizeDesktopThemeSettings(
  value: unknown,
): DesktopThemeSettings {
  if (!isRecord(value)) {
    return DEFAULT_DESKTOP_THEME_SETTINGS
  }

  const customThemes = normalizeDesktopCustomThemes(value.customThemes)
  const presetOverrides = normalizeDesktopPresetOverrides(value.presetOverrides)
  const activeThemeIds = isRecord(value.activeThemeIds)
    ? normalizeActiveThemeIds(value.activeThemeIds, customThemes)
    : migrateLegacyActiveThemeIds(value.themes, presetOverrides)

  return {
    mode: isDesktopThemeMode(value.mode) ? value.mode : 'light',
    activeThemeIds,
    fontSizes: normalizeDesktopThemeFontSizes(value.fontSizes),
    customThemes,
    presetOverrides,
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
        code: normalizeDesktopThemeFontEntry(
          fonts.code,
          fallback.theme.fonts.code,
        ),
        ui: normalizeDesktopThemeFontEntry(
          fonts.ui,
          fallback.theme.fonts.ui,
        ),
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

function normalizeDesktopCustomThemes(value: unknown): DesktopThemeCustomTheme[] {
  if (!Array.isArray(value)) return []

  const normalizedThemes: DesktopThemeCustomTheme[] = []
  for (const item of value) {
    if (!isRecord(item) || !isRecord(item.config)) continue
    const configValue = item.config
    if (!isDesktopThemeVariant(configValue.variant)) continue

    const config = normalizeDesktopThemeConfig(
      configValue,
      configValue.variant,
      getDefaultTheme(configValue.variant),
    )
    const label = isNonEmptyString(item.label)
      ? item.label.trim()
      : config.codeThemeId
    const sourcePresetId =
      isNonEmptyString(item.sourcePresetId) &&
      isBuiltinDesktopThemeId(item.sourcePresetId)
        ? item.sourcePresetId
        : undefined
    const rawId = isNonEmptyString(item.id)
      ? item.id.trim()
      : `custom:${config.variant}:${slugifyThemeId(label)}`
    const baseId = rawId.startsWith(`custom:${config.variant}:`)
      ? rawId
      : `custom:${config.variant}:${slugifyThemeId(rawId)}`

    normalizedThemes.push({
      id: uniqueCustomThemeId(baseId, normalizedThemes),
      label,
      config,
      ...(sourcePresetId ? { sourcePresetId } : {}),
    })
  }

  return normalizedThemes
}

function normalizeDesktopPresetOverrides(
  value: unknown,
): Record<string, DesktopThemeConfigV1> {
  if (!isRecord(value)) return {}

  const overrides: Record<string, DesktopThemeConfigV1> = {}
  for (const preset of DESKTOP_THEME_PRESETS) {
    const overrideValue = value[preset.id]
    if (!isRecord(overrideValue)) continue
    overrides[preset.id] = normalizeDesktopThemeConfig(
      overrideValue,
      preset.config.variant,
      preset.config,
    )
  }
  return overrides
}

function normalizeActiveThemeIds(
  value: Record<string, unknown>,
  customThemes: DesktopThemeCustomTheme[],
): Record<DesktopThemeVariant, string> {
  return {
    light: normalizeActiveThemeId(value.light, 'light', customThemes),
    dark: normalizeActiveThemeId(value.dark, 'dark', customThemes),
  }
}

function normalizeActiveThemeId(
  value: unknown,
  variant: DesktopThemeVariant,
  customThemes: DesktopThemeCustomTheme[],
): string {
  if (typeof value !== 'string') return getDefaultThemeId(variant)
  const preset = DESKTOP_THEME_PRESETS.find(
    item => item.id === value && item.config.variant === variant,
  )
  if (preset) return preset.id
  const customTheme = customThemes.find(
    item => item.id === value && item.config.variant === variant,
  )
  return customTheme?.id ?? getDefaultThemeId(variant)
}

function migrateLegacyActiveThemeIds(
  value: unknown,
  presetOverrides: Record<string, DesktopThemeConfigV1>,
): Record<DesktopThemeVariant, string> {
  const themes = isRecord(value) ? value : {}
  return {
    light: migrateLegacyThemeId(themes.light, 'light', presetOverrides),
    dark: migrateLegacyThemeId(themes.dark, 'dark', presetOverrides),
  }
}

function migrateLegacyThemeId(
  value: unknown,
  variant: DesktopThemeVariant,
  presetOverrides: Record<string, DesktopThemeConfigV1>,
): string {
  if (!isRecord(value)) return getDefaultThemeId(variant)
  const config = normalizeDesktopThemeConfig(value, variant, getDefaultTheme(variant))
  const matchingPreset = DESKTOP_THEME_PRESETS.find(
    preset => preset.config.variant === variant && themesEqual(preset.config, config),
  )
  if (matchingPreset) return matchingPreset.id

  const themeId = getDefaultThemeId(variant)
  presetOverrides[themeId] = config
  return themeId
}

function getDefaultThemeId(variant: DesktopThemeVariant): string {
  return variant === 'dark' ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
}

function getDefaultTheme(variant: DesktopThemeVariant): DesktopThemeConfigV1 {
  return variant === 'dark' ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME
}

function themesEqual(
  left: DesktopThemeConfigV1,
  right: DesktopThemeConfigV1,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function uniqueCustomThemeId(
  baseId: string,
  existingThemes: DesktopThemeCustomTheme[],
): string {
  const usedIds = new Set([
    ...DESKTOP_THEME_PRESETS.map(item => item.id),
    ...existingThemes.map(item => item.id),
  ])
  if (!usedIds.has(baseId)) return baseId

  let index = 2
  let candidate = `${baseId}-${index}`
  while (usedIds.has(candidate)) {
    index += 1
    candidate = `${baseId}-${index}`
  }
  return candidate
}

function slugifyThemeId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'theme'
}

function normalizeContrast(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizeDesktopThemeFontEntry(
  value: unknown,
  fallback: DesktopThemeFontEntry,
): DesktopThemeFontEntry {
  if (!isRecord(value)) {
    return fallback
  }
  return {
    preset: isNonEmptyString(value.preset)
      ? value.preset.trim()
      : fallback.preset,
    fallback: isNonEmptyString(value.fallback)
      ? value.fallback.trim()
      : fallback.fallback,
  }
}

function normalizeDesktopThemeFontSizes(
  value: unknown,
): DesktopThemeSettings['fontSizes'] {
  const fontSizes = isRecord(value) ? value : {}
  return {
    code: normalizeFontSize(fontSizes.code, 12, 10, 20),
    ui: normalizeFontSize(fontSizes.ui, 14, 11, 20),
  }
}

function normalizeFontSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(value)))
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
