import type { DesktopThemeConfigV1 } from '../../../shared/types.js'

export type ThemeVariableName = `--${string}`
export type ThemeVariableMap = Record<ThemeVariableName, string>

type CodexRoles = {
  tokens: ThemeVariableMap
  canvas: string
  underlay: string
  chrome: string
  panel: string
  raised: string
  codeBlock: string
  codeInline: string
  userMessage: string
  composer: string
  hover: string
  selected: string
  borderSubtle: string
  borderControl: string
  borderStrong: string
  separator: string
  scrollbarRest: string
  scrollbarHover: string
  textSecondary: string
  textTertiary: string
  textPlaceholder: string
  textDisabled: string
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
  const roles = deriveCodexRoles(
    theme.surface,
    theme.ink,
    theme.accent,
    dark,
    theme.contrast,
  )
  const syntax = dark ? CODEX_DARK_SYNTAX : CODEX_LIGHT_SYNTAX
  const shadowResting = dark
    ? '0 1px 2px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.03) inset'
    : '0 1px 2px color-mix(in srgb, #1a1c1f 5%, transparent), 0 1px 0 rgba(255, 255, 255, 0.7) inset'
  const shadowRaised = dark
    ? '0 12px 34px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.22)'
    : '0 10px 28px color-mix(in srgb, #1a1c1f 8%, transparent), 0 1px 2px color-mix(in srgb, #1a1c1f 5%, transparent)'
  const shadowFloat = dark
    ? '0 24px 64px rgba(0, 0, 0, 0.38), 0 8px 24px rgba(0, 0, 0, 0.28)'
    : '0 22px 60px color-mix(in srgb, #1a1c1f 12%, transparent), 0 8px 24px color-mix(in srgb, #1a1c1f 8%, transparent)'

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
    '--color-editor-added': rgba(
      parseHex(theme.semanticColors.diffAdded),
      dark ? 0.23 : 0.15,
    ),
    '--color-editor-deleted': rgba(
      parseHex(theme.semanticColors.diffRemoved),
      dark ? 0.23 : 0.15,
    ),
    '--contrast': String(theme.contrast),
    '--color-bg': roles.canvas,
    '--color-bg-pure': roles.canvas,
    '--color-bg-soft': roles.codeInline,
    '--color-bg-subtle': roles.panel,
    '--color-bg-mask': roles.codeBlock,
    '--color-bg-hover': roles.hover,
    '--color-bg-row-hover': roles.composer,
    '--color-bg-chip-hover': roles.hover,
    '--color-bg-card': roles.panel,
    '--color-popover-bg': roles.raised,
    '--color-popover-border': roles.borderStrong,
    '--color-popover-divider': roles.separator,
    '--glass-surface-bg': rgba(parseHex(theme.surface), 0.2),
    '--glass-surface-border': rgba(parseHex(theme.ink), 0.12),
    '--glass-surface-highlight': rgba(parseHex(theme.ink), 0.08),
    '--glass-surface-text': theme.ink,
    '--glass-surface-text-meta': roles.textSecondary,
    '--glass-surface-text-disabled': roles.textDisabled,
    '--glass-surface-blur': '14px',
    '--color-surface': roles.canvas,
    '--color-ink': theme.ink,
    '--color-border': roles.borderControl,
    '--color-border-soft': roles.borderSubtle,
    '--color-border-faint': roles.borderSubtle,
    '--color-border-row': roles.borderSubtle,
    '--color-danger': theme.semanticColors.diffRemoved,
    '--color-warning': dark ? '#f0a33b' : '#a05a00',
    '--color-success': theme.semanticColors.diffAdded,
    '--color-text': theme.ink,
    '--color-text-strong': theme.ink,
    '--color-text-meta': roles.textSecondary,
    '--color-text-soft': roles.textTertiary,
    '--color-text-mute': roles.textTertiary,
    '--color-text-placeholder': roles.textPlaceholder,
    '--color-text-disabled': roles.textDisabled,
    '--color-text-on-accent': textOnAccent(theme.accent),
    '--color-icon': theme.ink,
    '--color-icon-soft': roles.textSecondary,
    '--color-icon-arrow': roles.textTertiary,
    '--color-accent': theme.accent,
    '--color-accent-a3': `${theme.accent}b3`,
    '--color-accent-11': theme.accent,
    '--color-primary-action':
      roles.tokens['--color-background-button-primary'],
    '--color-primary-action-foreground':
      roles.tokens['--color-text-button-primary'],
    '--color-primary-action-hover':
      roles.tokens['--color-background-button-primary-hover'],
    '--color-primary-action-disabled':
      roles.tokens['--color-background-button-primary-inactive'],
    '--color-send-bg': 'var(--color-primary-action)',
    '--color-send-bg-hover': 'var(--color-primary-action-hover)',
    '--color-send-bg-disabled': 'var(--color-primary-action-disabled)',
    '--color-user-bubble-bg': roles.userMessage,
    '--color-scrollbar': roles.scrollbarRest,
    '--color-scrollbar-hover': roles.scrollbarHover,
    '--color-diff-added': theme.semanticColors.diffAdded,
    '--color-diff-removed': theme.semanticColors.diffRemoved,
    '--color-skill': theme.semanticColors.skill,
    '--surface-base': roles.canvas,
    '--surface-canvas': roles.canvas,
    '--surface-underlay': roles.underlay,
    '--surface-chrome': roles.chrome,
    '--surface-panel': roles.panel,
    '--surface-raised': roles.raised,
    '--surface-code-block': roles.codeBlock,
    '--surface-code-inline': roles.codeInline,
    '--surface-user-message': roles.userMessage,
    '--surface-composer': roles.composer,
    '--surface-subtle': roles.panel,
    '--surface-product': roles.codeBlock,
    '--surface-product-raised': roles.codeInline,
    '--state-hover': roles.hover,
    '--state-selected': roles.selected,
    '--state-hover-bg': roles.hover,
    '--state-active-bg': roles.selected,
    '--border-subtle': roles.borderSubtle,
    '--border-muted': roles.borderControl,
    '--border-control': roles.borderControl,
    '--border-strong': roles.borderStrong,
    '--scrollbar-rest': roles.scrollbarRest,
    '--scrollbar-hover': roles.scrollbarHover,
    '--shadow-resting': shadowResting,
    '--shadow-raised': shadowRaised,
    '--shadow-float': shadowFloat,
    '--color-chrome-bg': roles.chrome,
    '--color-sidebar-bg': roles.chrome,
    '--color-sidebar-active-bg': roles.selected,
    '--color-sidebar-hover-bg': roles.hover,
    '--color-workbench-bg': roles.canvas,
    '--color-panel-bg': roles.panel,
    '--color-panel-elevated-bg': roles.raised,
    '--color-panel-border': roles.borderSubtle,
    '--color-panel-shadow': 'var(--shadow-float)',
    '--color-panel-shadow-raised': 'var(--shadow-raised)',
    '--color-panel-shadow-soft': 'var(--shadow-resting)',
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
    '--vscode-focusBorder': theme.accent,
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
    canvas: surface,
    underlay: surfaceUnder,
    chrome: surfaceUnder,
    panel,
    raised: palette.elevatedSecondaryOpaque,
    codeBlock: rgbString(editorBackground),
    codeInline: palette.buttonSecondaryBackground,
    userMessage: palette.elevatedSecondaryOpaque,
    composer: palette.elevatedSecondaryOpaque,
    hover: palette.buttonSecondaryBackgroundHover,
    selected: palette.buttonSecondaryBackgroundActive,
    borderSubtle: palette.borderLight,
    borderControl: palette.border,
    borderStrong: palette.borderHeavy,
    separator: palette.border,
    scrollbarRest: palette.buttonSecondaryBackground,
    scrollbarHover: palette.buttonSecondaryBackgroundHover,
    textSecondary: palette.textForegroundSecondary,
    textTertiary: palette.textForegroundTertiary,
    textPlaceholder: palette.textForegroundTertiary,
    textDisabled: palette.buttonPrimaryBackgroundInactive,
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
