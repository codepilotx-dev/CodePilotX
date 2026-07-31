import type { DesktopThemeConfigV1 } from '../../../shared/types.js'

export type ThemeVariableName = `--${string}`
export type ThemeVariableMap = Record<ThemeVariableName, string>

type CodexRoles = {
  tokens: ThemeVariableMap
  editorBackground: string
  raised: string
  codeInline: string
  hover: string
  selected: string
  borderControl: string
  borderStrong: string
  textSecondary: string
  textTertiary: string
  textDisabled: string
}

type DerivedSemanticTone = {
  foreground: string
  indicator: string
  lineBackground: string
  textBackground: string
}

const CODEX_LIGHT_SYNTAX = {
  keyword: '#cf222e',
  property: '#0550ae',
  string: '#0a3069',
  number: '#098658',
  comment: '#6e7781',
  variable: '#953800',
  punctuation: '#24292f',
}

const CODEX_DARK_SYNTAX = {
  keyword: '#ff7b72',
  property: '#79c0ff',
  string: '#a5d6ff',
  number: '#79c0ff',
  comment: '#8b949e',
  variable: '#ffa657',
  punctuation: '#c9d1d9',
}

export function deriveThemeVariables(
  config: DesktopThemeConfigV1,
): ThemeVariableMap {
  const { theme, variant } = config
  const dark = variant === 'dark'
  const interactionInk = parseHex(theme.ink)
  const interactionHover = rgba(interactionInk, dark ? 0.08 : 0.05)
  const interactionSelected = rgba(interactionInk, 0.05)
  const roles = deriveCodexRoles(
    theme.surface,
    theme.ink,
    theme.accent,
    dark,
    theme.contrast,
  )
  const added = deriveSemanticTone({
    hue: theme.semanticColors.diffAdded,
    editorBackground: roles.editorBackground,
    ink: theme.ink,
    variant,
  })
  const removed = deriveSemanticTone({
    hue: theme.semanticColors.diffRemoved,
    editorBackground: roles.editorBackground,
    ink: theme.ink,
    variant,
  })
  const syntax = dark ? CODEX_DARK_SYNTAX : CODEX_LIGHT_SYNTAX
  const shadowResting = 'none'
  const shadowRaised = '0 1px 3px -1px rgb(0 0 0 / 14%)'
  const shadowFloat =
    '0 8px 20px -8px rgb(0 0 0 / 28%), 0 2px 6px -3px rgb(0 0 0 / 18%)'

  return {
    '--codex-base-accent': theme.accent,
    '--codex-base-contrast': String(theme.contrast),
    '--codex-base-ink': theme.ink,
    '--codex-base-surface': theme.surface,
    ...roles.tokens,
    '--color-accent-blue': theme.accent,
    '--color-accent-purple': theme.semanticColors.skill,
    '--color-decoration-added': theme.semanticColors.diffAdded,
    '--color-decoration-deleted': theme.semanticColors.diffRemoved,
    '--color-diff-added-foreground': added.foreground,
    '--color-diff-added-indicator': added.indicator,
    '--color-diff-added-line-background': added.lineBackground,
    '--color-diff-added-text-background': added.textBackground,
    '--color-diff-removed-foreground': removed.foreground,
    '--color-diff-removed-indicator': removed.indicator,
    '--color-diff-removed-line-background': removed.lineBackground,
    '--color-diff-removed-text-background': removed.textBackground,
    '--contrast': String(theme.contrast),
    '--color-danger': theme.semanticColors.diffRemoved,
    '--color-warning': dark ? '#f0a33b' : '#a05a00',
    '--codex-base-on-accent': textOnAccent(theme.accent),
    '--shadow-resting': shadowResting,
    '--shadow-raised': shadowRaised,
    '--shadow-float': shadowFloat,
    '--font-family-sans':
      theme.fonts.ui ??
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--font-family-mono':
      theme.fonts.code ??
      '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    '--vscode-font-family':
      theme.fonts.ui ??
      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    '--vscode-editor-font-family':
      theme.fonts.code ??
      '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
    '--vscode-editor-background': theme.surface,
    '--vscode-editor-foreground': theme.ink,
    '--vscode-editorCursor-foreground': theme.accent,
    '--vscode-editor-selectionBackground': mixHex(
      parseHex(theme.surface),
      parseHex(theme.accent),
      0.28,
    ),
    '--vscode-editorWidget-background': roles.raised,
    '--vscode-widget-border': roles.borderControl,
    '--vscode-editor-findMatchBackground': mixHex(
      parseHex(theme.surface),
      parseHex(theme.accent),
      0.32,
    ),
    '--vscode-editor-findMatchHighlightBackground': mixHex(
      parseHex(theme.surface),
      parseHex(theme.accent),
      0.18,
    ),
    '--vscode-editor-findMatchHighlightBorder': roles.borderStrong,
    '--vscode-editor-lineHighlightBackground': roles.hover,
    '--vscode-editor-selectionHighlightBackground': roles.selected,
    '--vscode-editorGutter-background': theme.surface,
    '--vscode-editorLineNumber-foreground': roles.textTertiary,
    '--vscode-editorLineNumber-activeForeground': roles.textSecondary,
    '--vscode-editor-foldPlaceholderForeground': roles.textSecondary,
    '--vscode-editor-foldBackground': roles.codeInline,
    '--vscode-editorSuggestWidget-foreground': theme.ink,
    '--vscode-editorSuggestWidget-background': roles.raised,
    '--vscode-editorSuggestWidget-border': roles.borderControl,
    '--vscode-editorSuggestWidget-selectedForeground': theme.ink,
    '--vscode-editorSuggestWidget-selectedBackground': roles.selected,
    '--vscode-button-secondaryHoverBackground': interactionHover,
    '--vscode-focusBorder': theme.accent,
    '--vscode-list-activeSelectionBackground': interactionSelected,
    '--vscode-list-hoverBackground': interactionHover,
    '--vscode-toolbar-hoverBackground': interactionHover,
    '--syntax-keyword': syntax.keyword,
    '--syntax-type': syntax.keyword,
    '--syntax-property': syntax.property,
    '--syntax-string': syntax.string,
    '--syntax-number': syntax.number,
    '--syntax-operator': syntax.number,
    '--syntax-comment': syntax.comment,
    '--syntax-variable': syntax.variable,
    '--syntax-punctuation': syntax.punctuation,
  }
}

function deriveCodexRoles(
  surface: string,
  ink: string,
  accent: string,
  dark: boolean,
  contrast: number,
): CodexRoles {
  // Ported from Codex Men/Ien/Len/Ren/zen/Ben/Ven
  // (webview bundle byte 2,863,772 onward). Existing names below are aliases.
  const variant = dark ? 'dark' : 'light'
  const surfaceRgb = parseHex(surface)
  const inkRgb = parseHex(ink)
  const accentRgb = parseHex(accent)
  const normalizedContrast = normalizeCodexContrast(contrast, variant)
  const white = { red: 255, green: 255, blue: 255 }
  const black = { red: 0, green: 0, blue: 0 }
  const editorBackground = mixRgb(
    surfaceRgb,
    dark ? inkRgb : white,
    dark ? 0.07 : 0.12,
  )
  const surfaceUnder = mixHex(
    surfaceRgb,
    dark ? black : inkRgb,
    (dark ? 0.16 : 0.04) +
      (contrast - (dark ? 60 : 45)) * (dark ? 0.0015 : 0.0012),
  )
  const panel = mixHex(
    surfaceRgb,
    dark ? inkRgb : white,
    (dark ? 0.03 : 0.18) +
      normalizedContrast * (dark ? 0.03 : 0.008),
  )
  const palette = dark
    ? deriveDarkPalette(
        surfaceRgb,
        inkRgb,
        accentRgb,
        normalizedContrast,
      )
    : deriveLightPalette(
        surfaceRgb,
        inkRgb,
        accentRgb,
        normalizedContrast,
      )

  return {
    tokens: {
      '--color-background-accent': palette.accentBackground,
      '--color-background-accent-active': palette.accentBackgroundActive,
      '--color-background-accent-hover': palette.accentBackgroundHover,
      '--color-background-button-primary': palette.buttonPrimaryBackground,
      '--color-background-button-primary-active':
        palette.buttonPrimaryBackgroundActive,
      '--color-background-button-primary-hover':
        palette.buttonPrimaryBackgroundHover,
      '--color-background-button-primary-inactive':
        palette.buttonPrimaryBackgroundInactive,
      '--color-background-button-secondary': palette.buttonSecondaryBackground,
      '--color-background-button-secondary-active':
        palette.buttonSecondaryBackgroundActive,
      '--color-background-button-secondary-hover':
        palette.buttonSecondaryBackgroundHover,
      '--color-background-button-secondary-inactive':
        palette.buttonSecondaryBackgroundInactive,
      '--color-background-button-tertiary': palette.buttonTertiaryBackground,
      '--color-background-button-tertiary-active':
        palette.buttonTertiaryBackgroundActive,
      '--color-background-button-tertiary-hover':
        palette.buttonTertiaryBackgroundHover,
      '--color-background-control': palette.controlBackground,
      '--color-background-control-opaque': palette.controlBackgroundOpaque,
      '--color-background-editor-opaque': rgbString(editorBackground),
      '--color-background-elevated-primary': palette.elevatedPrimary,
      '--color-background-elevated-primary-opaque':
        palette.elevatedPrimaryOpaque,
      '--color-background-elevated-secondary': palette.elevatedSecondary,
      '--color-background-elevated-secondary-opaque':
        palette.elevatedSecondaryOpaque,
      '--color-background-panel': panel,
      '--color-background-surface': surface,
      '--color-background-surface-under': surfaceUnder,
      '--color-border': palette.border,
      '--color-border-focus': palette.borderFocus,
      '--color-border-heavy': palette.borderHeavy,
      '--color-border-light': palette.borderLight,
      '--color-icon-accent': palette.iconAccent,
      '--color-icon-primary': palette.iconPrimary,
      '--color-icon-secondary': palette.iconSecondary,
      '--color-icon-tertiary': palette.iconTertiary,
      '--color-simple-scrim': palette.simpleScrim,
      '--color-text-accent': palette.textAccent,
      '--color-text-button-primary': palette.textButtonPrimary,
      '--color-text-button-secondary': palette.textButtonSecondary,
      '--color-text-button-tertiary': palette.textButtonTertiary,
      '--color-text-foreground': palette.textForeground,
      '--color-text-foreground-secondary': palette.textForegroundSecondary,
      '--color-text-foreground-tertiary': palette.textForegroundTertiary,
    },
    editorBackground: rgbString(editorBackground),
    raised: palette.elevatedSecondaryOpaque,
    codeInline: palette.buttonSecondaryBackground,
    hover: palette.buttonSecondaryBackgroundHover,
    selected: palette.buttonSecondaryBackgroundActive,
    borderControl: palette.border,
    borderStrong: palette.borderHeavy,
    textSecondary: palette.textForegroundSecondary,
    textTertiary: palette.textForegroundTertiary,
    textDisabled: palette.buttonPrimaryBackgroundInactive,
  }
}

function deriveSemanticTone({
  hue,
  editorBackground,
  ink,
  variant,
}: {
  hue: string
  editorBackground: string
  ink: string
  variant: 'light' | 'dark'
}): DerivedSemanticTone {
  const hueRgb = parseHex(hue)
  const editorRgb = parseColor(editorBackground)
  const inkRgb = parseHex(ink)

  return {
    foreground: ensureContrast(hueRgb, inkRgb, editorRgb, 4.5),
    indicator: hue,
    lineBackground: mixHex(
      editorRgb,
      hueRgb,
      variant === 'dark' ? 0.18 : 0.12,
    ),
    textBackground: mixHex(
      editorRgb,
      hueRgb,
      variant === 'dark' ? 0.34 : 0.24,
    ),
  }
}

type Rgb = { red: number; green: number; blue: number }

type CodexVariantPalette = {
  accentBackground: string
  accentBackgroundActive: string
  accentBackgroundHover: string
  border: string
  borderFocus: string
  borderHeavy: string
  borderLight: string
  buttonPrimaryBackground: string
  buttonPrimaryBackgroundActive: string
  buttonPrimaryBackgroundHover: string
  buttonPrimaryBackgroundInactive: string
  buttonSecondaryBackground: string
  buttonSecondaryBackgroundActive: string
  buttonSecondaryBackgroundHover: string
  buttonSecondaryBackgroundInactive: string
  buttonTertiaryBackground: string
  buttonTertiaryBackgroundActive: string
  buttonTertiaryBackgroundHover: string
  controlBackground: string
  controlBackgroundOpaque: string
  elevatedPrimary: string
  elevatedPrimaryOpaque: string
  elevatedSecondary: string
  elevatedSecondaryOpaque: string
  iconAccent: string
  iconPrimary: string
  iconSecondary: string
  iconTertiary: string
  simpleScrim: string
  textAccent: string
  textButtonPrimary: string
  textButtonSecondary: string
  textButtonTertiary: string
  textForeground: string
  textForegroundSecondary: string
  textForegroundTertiary: string
}

function deriveLightPalette(
  surface: Rgb,
  ink: Rgb,
  accent: Rgb,
  contrast: number,
): CodexVariantPalette {
  const white = { red: 255, green: 255, blue: 255 }
  const black = { red: 0, green: 0, blue: 0 }
  const control = mixRgb(surface, white, 0.09 + contrast * 0.04)
  const elevatedSecondary = mixRgb(
    surface,
    white,
    0.08 + contrast * 0.08,
  )
  const elevatedPrimary = mixRgb(
    surface,
    white,
    0.16 + contrast * 0.12,
  )
  return {
    accentBackground: mixHex(surface, accent, 0.11 + contrast * 0.04),
    accentBackgroundActive: mixHex(
      surface,
      accent,
      0.13 + contrast * 0.05,
    ),
    accentBackgroundHover: mixHex(
      surface,
      accent,
      0.12 + contrast * 0.045,
    ),
    border: rgba(ink, 0.06 + contrast * 0.04),
    borderFocus: hexString(accent),
    borderHeavy: rgba(ink, 0.09 + contrast * 0.06),
    borderLight: rgba(ink, 0.04 + contrast * 0.02),
    buttonPrimaryBackground: hexString(ink),
    buttonPrimaryBackgroundActive: rgba(ink, 0.1 + contrast * 0.12),
    buttonPrimaryBackgroundHover: rgba(ink, 0.05 + contrast * 0.06),
    buttonPrimaryBackgroundInactive: rgba(ink, 0.18 + contrast * 0.14),
    buttonSecondaryBackground: rgba(ink, 0.04 + contrast * 0.02),
    buttonSecondaryBackgroundActive: rgba(ink, 0.03 + contrast * 0.02),
    buttonSecondaryBackgroundHover: rgba(ink, 0.04 + contrast * 0.03),
    buttonSecondaryBackgroundInactive: rgba(ink, 0.01 + contrast * 0.02),
    buttonTertiaryBackground: rgba(ink, 0),
    buttonTertiaryBackgroundActive: rgba(ink, 0.16 + contrast * 0.08),
    buttonTertiaryBackgroundHover: rgba(ink, 0.08 + contrast * 0.04),
    controlBackground: rgba(control, 0.96),
    controlBackgroundOpaque: rgbString(control),
    elevatedPrimary: rgba(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgbString(elevatedPrimary),
    elevatedSecondary: rgba(elevatedSecondary, 0.96),
    elevatedSecondaryOpaque: rgbString(elevatedSecondary),
    iconAccent: hexString(accent),
    iconPrimary: hexString(ink),
    iconSecondary: rgba(ink, 0.65 + contrast * 0.1),
    iconTertiary: rgba(ink, 0.45 + contrast * 0.1),
    simpleScrim: rgba(black, 0.08 + contrast * 0.04),
    textAccent: hexString(accent),
    textButtonPrimary: hexString(surface),
    textButtonSecondary: hexString(ink),
    textButtonTertiary: rgba(ink, 0.45 + contrast * 0.1),
    textForeground: hexString(ink),
    textForegroundSecondary: rgba(ink, 0.65 + contrast * 0.1),
    textForegroundTertiary: rgba(ink, 0.45 + contrast * 0.1),
  }
}

function deriveDarkPalette(
  surface: Rgb,
  ink: Rgb,
  accent: Rgb,
  contrast: number,
): CodexVariantPalette {
  const white = { red: 255, green: 255, blue: 255 }
  const black = { red: 0, green: 0, blue: 0 }
  const control = mixRgb(surface, ink, 0.06 + contrast * 0.05)
  const accentOnDark = mixRgb(accent, white, 0.3 + contrast * 0.15)
  const primaryText = mixRgb(surface, black, 0.38 + contrast * 0.12)
  const elevatedPrimary = mixRgb(surface, ink, 0.08 + contrast * 0.08)
  return {
    accentBackground: mixHex(black, accent, 0.2 + contrast * 0.08),
    accentBackgroundActive: mixHex(
      black,
      accent,
      0.22 + contrast * 0.12,
    ),
    accentBackgroundHover: mixHex(
      black,
      accent,
      0.21 + contrast * 0.1,
    ),
    border: rgba(ink, 0.06 + contrast * 0.04),
    borderFocus: rgba(accentOnDark, 0.7 + contrast * 0.1),
    borderHeavy: rgba(ink, 0.12 + contrast * 0.06),
    borderLight: rgba(ink, 0.03 + contrast * 0.02),
    buttonPrimaryBackground: rgbString(primaryText),
    buttonPrimaryBackgroundActive: rgba(ink, 0.07 + contrast * 0.05),
    buttonPrimaryBackgroundHover: rgba(ink, 0.04 + contrast * 0.03),
    buttonPrimaryBackgroundInactive: rgba(ink, 0.02 + contrast * 0.02),
    buttonSecondaryBackground: rgba(ink, 0.04 + contrast * 0.02),
    buttonSecondaryBackgroundActive: rgba(ink, 0.09 + contrast * 0.05),
    buttonSecondaryBackgroundHover: rgba(ink, 0.06 + contrast * 0.03),
    buttonSecondaryBackgroundInactive: rgba(ink, 0.02 + contrast * 0.03),
    buttonTertiaryBackground: rgba(ink, 0.02 + contrast * 0.015),
    buttonTertiaryBackgroundActive: rgba(ink, 0.07 + contrast * 0.05),
    buttonTertiaryBackgroundHover: rgba(ink, 0.05 + contrast * 0.03),
    controlBackground: rgba(control, 0.96),
    controlBackgroundOpaque: rgbString(control),
    elevatedPrimary: rgba(elevatedPrimary, 0.96),
    elevatedPrimaryOpaque: rgbString(elevatedPrimary),
    elevatedSecondary: rgba(ink, 0.02 + contrast * 0.02),
    elevatedSecondaryOpaque: mixHex(
      surface,
      ink,
      0.04 + contrast * 0.05,
    ),
    iconAccent: rgbString(accentOnDark),
    iconPrimary: rgba(ink, 0.82 + contrast * 0.14),
    iconSecondary: rgba(ink, 0.65 + contrast * 0.1),
    iconTertiary: rgba(ink, 0.45 + contrast * 0.1),
    simpleScrim: rgba(ink, 0.08 + contrast * 0.04),
    textAccent: rgbString(accentOnDark),
    textButtonPrimary: rgbString(primaryText),
    textButtonSecondary: mixHex(
      ink,
      surface,
      0.7 + contrast * 0.1,
    ),
    textButtonTertiary: rgba(ink, 0.45 + contrast * 0.1),
    textForeground: hexString(ink),
    textForegroundSecondary: rgba(ink, 0.65 + contrast * 0.1),
    textForegroundTertiary: rgba(ink, 0.42 + contrast * 0.13),
  }
}

function normalizeCodexContrast(
  value: number,
  variant: 'light' | 'dark',
): number {
  const base = variant === 'dark' ? 60 : 45
  const baseRatio = base / 100
  const adjusted = value / 100 + ((value - base) / 60) * 0.7
  return value <= base
    ? adjusted
    : baseRatio + (adjusted - baseRatio) * 2
}

function parseHex(value: string): Rgb {
  const hex = value.slice(1)
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  }
}

function parseColor(value: string): Rgb {
  if (value.startsWith('#')) return parseHex(value)
  const channels = value.match(/\d+/g)
  if (!channels || channels.length < 3) {
    throw new Error(`Unsupported theme color: ${value}`)
  }
  return {
    red: Number(channels[0]),
    green: Number(channels[1]),
    blue: Number(channels[2]),
  }
}

function ensureContrast(
  color: Rgb,
  ink: Rgb,
  background: Rgb,
  minimumRatio: number,
): string {
  if (contrastRatio(color, background) >= minimumRatio) {
    return hexString(color)
  }

  if (contrastRatio(ink, background) >= minimumRatio) {
    let low = 0
    let high = 1
    for (let iteration = 0; iteration < 16; iteration += 1) {
      const amount = (low + high) / 2
      if (
        contrastRatio(mixRgb(color, ink, amount), background) >=
        minimumRatio
      ) {
        high = amount
      } else {
        low = amount
      }
    }
    return mixHex(color, ink, high)
  }

  const black = { red: 0, green: 0, blue: 0 }
  const white = { red: 255, green: 255, blue: 255 }
  return contrastRatio(black, background) >=
    contrastRatio(white, background)
    ? hexString(black)
    : hexString(white)
}

function contrastRatio(first: Rgb, second: Rgb): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

function relativeLuminance(color: Rgb): number {
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return (
    channel(color.red) * 0.2126 +
    channel(color.green) * 0.7152 +
    channel(color.blue) * 0.0722
  )
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.min(1, Math.max(0, amount))
  return {
    red: Math.round(from.red + (to.red - from.red) * ratio),
    green: Math.round(from.green + (to.green - from.green) * ratio),
    blue: Math.round(from.blue + (to.blue - from.blue) * ratio),
  }
}

function mixHex(from: Rgb, to: Rgb, amount: number): string {
  return hexString(mixRgb(from, to, amount))
}

function rgba(color: Rgb, alpha: number): string {
  const normalized = Math.min(1, Math.max(0, alpha))
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${normalized})`
}

function rgbString(color: Rgb): string {
  return `rgb(${color.red}, ${color.green}, ${color.blue})`
}

function hexString(color: Rgb): string {
  return `#${[color.red, color.green, color.blue]
    .map(channel => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

function textOnAccent(accent: string): string {
  if (accent.toLowerCase() === '#339cff') return '#ffffff'
  const color = parseHex(accent)
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    channel(color.red) * 0.2126 +
    channel(color.green) * 0.7152 +
    channel(color.blue) * 0.0722
  return luminance > 0.179 ? '#000000' : '#ffffff'
}
