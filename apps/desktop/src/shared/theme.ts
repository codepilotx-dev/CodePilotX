import * as radixColors from '@radix-ui/colors'
import type {
  DesktopThemeCustomTheme,
  DesktopThemeConfigV1,
  DesktopThemeFontEntry,
  DesktopThemeMode,
  DesktopThemeRadixAccentColor,
  DesktopThemeRadixConfig,
  DesktopThemeRadixGrayColor,
  DesktopThemeRadixPanelBackground,
  DesktopThemeRadixRadius,
  DesktopThemeRadixScaling,
  DesktopThemeSettings,
  DesktopThemeVariant,
} from './types.js'

export const CODEX_THEME_PREFIX = 'codex-theme-v1:'
export const DEFAULT_LIGHT_THEME_ID = 'light-codex'
export const DEFAULT_DARK_THEME_ID = 'dark-codex'

export const DEFAULT_UI_FONT: DesktopThemeFontEntry = {
  preset: 'MiSans VF',
  fallback:
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, "Microsoft YaHei", system-ui, sans-serif',
}

export const DEFAULT_CODE_FONT: DesktopThemeFontEntry = {
  preset: 'JetBrains Mono VF',
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
  | 'iris'
  | 'mauve'
  | 'olive'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'sage'
  | 'sand'
  | 'slate'

type RadixAccentScale = Extract<RadixScale, DesktopThemeRadixAccentColor>

type RadixStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

type RadixThemePresetOptions = {
  accentScale: RadixAccentScale
  accentStep?: RadixStep
  codeThemeId: string
  contrast?: number
  fonts?: DesktopThemeConfigV1['theme']['fonts']
  grayScale?: Exclude<DesktopThemeRadixGrayColor, 'auto'>
  inkScale?: RadixScale
  inkStep?: RadixStep
  opaqueWindows?: boolean
  skillScale?: RadixAccentScale
  skillStep?: RadixStep
  surfaceScale?: RadixScale
  surfaceStep?: RadixStep
  radix?: Partial<DesktopThemeRadixConfig>
  variant: DesktopThemeVariant
}

const RADIX_ACCENT_COLORS: readonly DesktopThemeRadixAccentColor[] = [
  'gray',
  'gold',
  'bronze',
  'brown',
  'yellow',
  'amber',
  'orange',
  'tomato',
  'red',
  'ruby',
  'crimson',
  'pink',
  'plum',
  'purple',
  'violet',
  'iris',
  'indigo',
  'blue',
  'cyan',
  'teal',
  'jade',
  'green',
  'grass',
  'lime',
  'mint',
  'sky',
]

const RADIX_GRAY_COLORS: readonly DesktopThemeRadixGrayColor[] = [
  'auto',
  'gray',
  'mauve',
  'slate',
  'sage',
  'olive',
  'sand',
]

const RADIX_PANEL_BACKGROUNDS: readonly DesktopThemeRadixPanelBackground[] = [
  'solid',
  'translucent',
]

const RADIX_RADII: readonly DesktopThemeRadixRadius[] = [
  'none',
  'small',
  'medium',
  'large',
  'full',
]

const RADIX_SCALINGS: readonly DesktopThemeRadixScaling[] = [
  '90%',
  '95%',
  '100%',
  '105%',
  '110%',
]

const DEFAULT_RADIX_THEME: DesktopThemeRadixConfig = {
  accentColor: 'blue',
  grayColor: 'slate',
  panelBackground: 'solid',
  radius: 'medium',
  scaling: '100%',
}

const RADIX_LIGHT: Record<RadixScale, Record<string, string>> = {
  blue: radixColors.blue,
  cyan: radixColors.cyan,
  gray: radixColors.gray,
  green: radixColors.green,
  iris: radixColors.iris,
  mauve: radixColors.mauve,
  olive: radixColors.olive,
  orange: radixColors.orange,
  pink: radixColors.pink,
  purple: radixColors.purple,
  red: radixColors.red,
  sage: radixColors.sage,
  sand: radixColors.sand,
  slate: radixColors.slate,
}

const RADIX_DARK: Record<RadixScale, Record<string, string>> = {
  blue: radixColors.blueDark,
  cyan: radixColors.cyanDark,
  gray: radixColors.grayDark,
  green: radixColors.greenDark,
  iris: radixColors.irisDark,
  mauve: radixColors.mauveDark,
  olive: radixColors.oliveDark,
  orange: radixColors.orangeDark,
  pink: radixColors.pinkDark,
  purple: radixColors.purpleDark,
  red: radixColors.redDark,
  sage: radixColors.sageDark,
  sand: radixColors.sandDark,
  slate: radixColors.slateDark,
}

const RADIX_ACCENT_SCALES: readonly RadixAccentScale[] = [
  'blue',
  'cyan',
  'gray',
  'green',
  'iris',
  'orange',
  'pink',
  'purple',
  'red',
]

const DRACULA_PINK = {
  9: '#ff79c6',
  10: '#f36ebb',
  11: '#ffb0e1',
  12: '#fdd1e7',
}

export const DEFAULT_LIGHT_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex',
  theme: {
    accent: '#cc785c',
    contrast: 40,
    fonts: DEFAULT_FONTS,
    ink: '#141413',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#5db872',
      diffRemoved: '#c64545',
      skill: '#cc785c',
    },
    radix: {
      ...DEFAULT_RADIX_THEME,
      accentColor: 'orange',
      grayColor: 'sand',
    },
    surface: '#faf9f5',
  },
  variant: 'light',
}

export const DEFAULT_DARK_THEME: DesktopThemeConfigV1 = {
  codeThemeId: 'codex',
  theme: {
    accent: '#d98568',
    contrast: 60,
    fonts: DEFAULT_FONTS,
    ink: '#faf9f5',
    opaqueWindows: true,
    semanticColors: {
      diffAdded: '#73c987',
      diffRemoved: '#d96a65',
      skill: '#d98568',
    },
    radix: {
      ...DEFAULT_RADIX_THEME,
      accentColor: 'orange',
      grayColor: 'sand',
    },
    surface: '#181715',
  },
  variant: 'dark',
}

export const DEFAULT_DESKTOP_THEME_SETTINGS: DesktopThemeSettings = {
  mode: 'light',
  activeThemeIds: {
    light: DEFAULT_LIGHT_THEME_ID,
    dark: DEFAULT_DARK_THEME_ID,
  },
  glassmorphismEnabled: true,
  pointerCursorEnabled: true,
  reduceMotion: 'system',
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
      grayScale: 'sand',
      skillScale: 'orange',
      variant: 'light',
    }),
  },
  {
    id: 'dark-absolutely',
    label: 'Absolutely Dark',
    config: createRadixThemePreset({
      accentScale: 'orange',
      codeThemeId: 'absolutely',
      grayScale: 'sand',
      skillScale: 'orange',
      variant: 'dark',
    }),
  },
  {
    id: 'light-catppuccin',
    label: 'Catppuccin',
    config: createRadixThemePreset({
      accentScale: 'purple',
      codeThemeId: 'catppuccin',
      grayScale: 'mauve',
      skillScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: 'dark-catppuccin',
    label: 'Catppuccin Dark',
    config: createRadixThemePreset({
      accentScale: 'purple',
      codeThemeId: 'catppuccin',
      grayScale: 'mauve',
      skillScale: 'purple',
      variant: 'dark',
    }),
  },
  {
    id: 'light-raycast',
    label: 'Raycast',
    config: createRadixThemePreset({
      accentScale: 'red',
      codeThemeId: 'raycast',
      fonts: DEFAULT_FONTS,
      grayScale: 'slate',
      skillScale: 'pink',
      variant: 'light',
    }),
  },
  {
    id: 'dark-raycast',
    label: 'Raycast Dark',
    config: createRadixThemePreset({
      accentScale: 'red',
      codeThemeId: 'raycast',
      fonts: DEFAULT_FONTS,
      grayScale: 'slate',
      skillScale: 'pink',
      variant: 'dark',
    }),
  },
  {
    id: 'light-github',
    label: 'GitHub',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'github',
      fonts: DEFAULT_FONTS,
      grayScale: 'gray',
      skillScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: 'dark-github',
    label: 'GitHub Dark',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'github',
      fonts: DEFAULT_FONTS,
      grayScale: 'gray',
      skillScale: 'purple',
      variant: 'dark',
    }),
  },
  {
    id: 'light-dracula',
    label: 'Dracula',
    config: createRadixThemePreset({
      accentScale: 'pink',
      codeThemeId: 'dracula',
      grayScale: 'mauve',
      skillScale: 'pink',
      variant: 'light',
    }),
  },
  {
    id: 'dark-dracula',
    label: 'Dracula',
    config: createRadixThemePreset({
      accentScale: 'pink',
      codeThemeId: 'dracula',
      grayScale: 'mauve',
      skillScale: 'pink',
      variant: 'dark',
    }),
  },
  {
    id: DEFAULT_DARK_THEME_ID,
    label: 'CodePilotX Dark',
    config: DEFAULT_DARK_THEME,
  },
  {
    id: 'light-material',
    label: 'Material',
    config: createRadixThemePreset({
      accentScale: 'cyan',
      codeThemeId: 'material',
      grayScale: 'sage',
      skillScale: 'purple',
      variant: 'light',
    }),
  },
  {
    id: 'dark-material',
    label: 'Material',
    config: createRadixThemePreset({
      accentScale: 'cyan',
      codeThemeId: 'material',
      grayScale: 'sage',
      skillScale: 'purple',
      surfaceStep: 2,
      variant: 'dark',
    }),
  },
  {
    id: 'light-vscode-plus',
    label: 'VSCode Plus',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'vscode-plus',
      grayScale: 'slate',
      skillScale: 'blue',
      variant: 'light',
    }),
  },
  {
    id: 'dark-vscode-plus',
    label: 'VSCode Plus',
    config: createRadixThemePreset({
      accentScale: 'blue',
      codeThemeId: 'vscode-plus',
      grayScale: 'slate',
      skillScale: 'blue',
      skillStep: 11,
      surfaceStep: 2,
      variant: 'dark',
    }),
  },
  {
    id: 'light-terminal-green',
    label: 'Terminal Green',
    config: createRadixThemePreset({
      accentScale: 'green',
      codeThemeId: 'codex',
      grayScale: 'sage',
      skillScale: 'green',
      variant: 'light',
    }),
  },
  {
    id: 'dark-terminal-green',
    label: 'Terminal Green Dark',
    config: createRadixThemePreset({
      accentScale: 'green',
      codeThemeId: 'codex',
      grayScale: 'sage',
      skillScale: 'green',
      surfaceStep: 2,
      variant: 'dark',
    }),
  },
  {
    id: 'light-iris-focus',
    label: 'Iris Focus',
    config: createRadixThemePreset({
      accentScale: 'iris',
      codeThemeId: 'catppuccin',
      grayScale: 'slate',
      skillScale: 'iris',
      variant: 'light',
    }),
  },
  {
    id: 'dark-iris-focus',
    label: 'Iris Focus Dark',
    config: createRadixThemePreset({
      accentScale: 'iris',
      codeThemeId: 'catppuccin',
      grayScale: 'slate',
      skillScale: 'iris',
      surfaceStep: 2,
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
    grayScale = 'slate',
    inkScale = grayScale,
    inkStep = 12,
    opaqueWindows = true,
    skillScale = accentScale,
    skillStep = options.variant === 'dark' ? 11 : 9,
    surfaceScale = grayScale,
    surfaceStep = 1,
    radix,
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
      radix: {
        ...DEFAULT_RADIX_THEME,
        accentColor: accentScale,
        grayColor: grayScale,
        ...radix,
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
    glassmorphismEnabled:
      typeof value.glassmorphismEnabled === 'boolean'
        ? value.glassmorphismEnabled
        : true,
    pointerCursorEnabled:
      typeof value.pointerCursorEnabled === 'boolean'
        ? value.pointerCursorEnabled
        : true,
    reduceMotion: normalizeDesktopReduceMotion(value.reduceMotion),
    fontSizes: normalizeDesktopThemeFontSizes(value.fontSizes),
    customThemes,
    presetOverrides,
  }
}

function normalizeDesktopReduceMotion(
  value: unknown,
): DesktopThemeSettings['reduceMotion'] {
  return value === 'system' || value === 'on' || value === 'off'
    ? value
    : DEFAULT_DESKTOP_THEME_SETTINGS.reduceMotion
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
  const accent = normalizeHexColor(theme.accent, fallback.theme.accent)

  return {
    codeThemeId: isNonEmptyString(value.codeThemeId)
      ? value.codeThemeId
      : fallback.codeThemeId,
    theme: {
      accent,
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
      radix: normalizeDesktopThemeRadixConfig(
        theme.radix,
        fallback.theme.radix,
        variant,
        accent,
      ),
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
  if (typeof value === 'string') {
    return {
      preset: value.trim(),
      fallback: fallback.fallback,
    }
  }
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

export function exportDesktopThemeConfig(
  config: DesktopThemeConfigV1,
): { codeThemeId: string; theme: Record<string, unknown>; variant: string } {
  const { radix: _radix, ...themeWithoutRadix } = config.theme
  return {
    codeThemeId: config.codeThemeId,
    theme: themeWithoutRadix,
    variant: config.variant,
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

function normalizeDesktopThemeRadixConfig(
  value: unknown,
  fallback: DesktopThemeRadixConfig,
  variant: DesktopThemeVariant,
  accent: string,
): DesktopThemeRadixConfig {
  const radix = isRecord(value) ? value : {}
  const fallbackAccent = fallback.accentColor ?? defaultRadixAccentColor(variant)
  return {
    accentColor: isRadixAccentColor(radix.accentColor)
      ? radix.accentColor
      : inferRadixAccentColor(accent, variant, fallbackAccent),
    grayColor: isRadixGrayColor(radix.grayColor)
      ? radix.grayColor
      : fallback.grayColor,
    panelBackground: isRadixPanelBackground(radix.panelBackground)
      ? radix.panelBackground
      : fallback.panelBackground,
    radius: isRadixRadius(radix.radius) ? radix.radius : fallback.radius,
    scaling: isRadixScaling(radix.scaling)
      ? radix.scaling
      : fallback.scaling,
  }
}

function inferRadixAccentColor(
  accent: string,
  variant: DesktopThemeVariant,
  fallback: DesktopThemeRadixAccentColor,
): DesktopThemeRadixAccentColor {
  const normalizedAccent = accent.toLowerCase()
  if (normalizedAccent === '#0169cc') return 'blue'
  if (normalizedAccent === '#00a240') return 'green'
  if (normalizedAccent === '#e02e2a') return 'red'
  if (normalizedAccent === '#751ed9' || normalizedAccent === '#b06dff') return 'purple'
  if (normalizedAccent === DRACULA_PINK[9].toLowerCase()) return 'pink'
  for (const scale of RADIX_ACCENT_SCALES) {
    if (normalizedAccent === radixColor(variant, scale, 9).toLowerCase()) {
      return scale
    }
  }
  const parsedAccent = parseHexColor(normalizedAccent)
  if (!parsedAccent) return fallback || defaultRadixAccentColor(variant)

  let bestScale: RadixAccentScale | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const scale of RADIX_ACCENT_SCALES) {
    const parsedScale = parseHexColor(radixColor(variant, scale, 9))
    if (!parsedScale) continue
    const distance = colorDistance(parsedAccent, parsedScale)
    if (distance < bestDistance) {
      bestDistance = distance
      bestScale = scale
    }
  }
  return bestScale ?? fallback ?? defaultRadixAccentColor(variant)
}

function defaultRadixAccentColor(
  variant: DesktopThemeVariant,
): DesktopThemeRadixAccentColor {
  return variant === 'dark' ? 'pink' : 'blue'
}

function isRadixAccentColor(
  value: unknown,
): value is DesktopThemeRadixAccentColor {
  return (
    typeof value === 'string' &&
    (RADIX_ACCENT_COLORS as readonly string[]).includes(value)
  )
}

function isRadixGrayColor(
  value: unknown,
): value is DesktopThemeRadixGrayColor {
  return (
    typeof value === 'string' &&
    (RADIX_GRAY_COLORS as readonly string[]).includes(value)
  )
}

function isRadixPanelBackground(
  value: unknown,
): value is DesktopThemeRadixPanelBackground {
  return (
    typeof value === 'string' &&
    (RADIX_PANEL_BACKGROUNDS as readonly string[]).includes(value)
  )
}

function isRadixRadius(value: unknown): value is DesktopThemeRadixRadius {
  return (
    typeof value === 'string' &&
    (RADIX_RADII as readonly string[]).includes(value)
  )
}

function isRadixScaling(value: unknown): value is DesktopThemeRadixScaling {
  return (
    typeof value === 'string' &&
    (RADIX_SCALINGS as readonly string[]).includes(value)
  )
}

function parseHexColor(
  value: string,
): { red: number; green: number; blue: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(value)
  if (!match) return null
  const hex = match[1]
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function colorDistance(
  left: { red: number; green: number; blue: number },
  right: { red: number; green: number; blue: number },
): number {
  return (
    (left.red - right.red) ** 2 +
    (left.green - right.green) ** 2 +
    (left.blue - right.blue) ** 2
  )
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
