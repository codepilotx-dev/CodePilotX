import type {
  DesktopThemeConfigV1,
  DesktopThemeVariant,
} from '../../../shared/types.js'

export type ThemeVariableName = `--${string}`
export type ThemeVariableMap = Record<ThemeVariableName, string>

type ThemeTokens = DesktopThemeConfigV1['theme']
type ContrastAnchors = readonly [number, number, number]

type SemanticRoles = {
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
}

const DARK_ROLE_ANCHORS = {
  chrome: [7.5, 13, 22],
  panel: [1, 3.5, 10],
  codeBlock: [1.2, 4.2, 11],
  userMessage: [1.5, 5, 13],
  composer: [2.5, 6.8, 17],
  inline: [4.3, 10, 24],
  sidebarActive: [4, 7, 13],
} as const satisfies Record<string, ContrastAnchors>

const LIGHT_ROLE_ANCHORS = {
  chrome: [1, 3.5, 9],
  panel: DARK_ROLE_ANCHORS.panel,
  raised: [10, 20, 35],
  codeBlock: DARK_ROLE_ANCHORS.codeBlock,
  userMessage: DARK_ROLE_ANCHORS.userMessage,
  composer: DARK_ROLE_ANCHORS.composer,
  inline: DARK_ROLE_ANCHORS.inline,
  selected: DARK_ROLE_ANCHORS.sidebarActive,
} as const satisfies Record<string, ContrastAnchors>

const CODEPILOTX_DARK_40_ROLES = {
  canvas: '#181818',
  underlay: '#000000',
  chrome: '#000000',
  panel: '#212121',
  raised: '#282828',
  codeBlock: '#212121',
  codeInline: '#303030',
  userMessage: '#282828',
  composer: '#212121',
  hover: '#212121',
  selected: '#282828',
  borderSubtle: 'color-mix(in srgb, #ffffff 7%, transparent)',
  borderControl: 'color-mix(in srgb, #ffffff 10%, transparent)',
  borderStrong: 'color-mix(in srgb, #ffffff 16%, transparent)',
  separator: 'color-mix(in srgb, #ffffff 8%, transparent)',
  scrollbarRest: '#282828',
  scrollbarHover: '#303030',
} as const satisfies SemanticRoles

const CODEPILOTX_LIGHT_40_ROLES = {
  canvas: '#ffffff',
  underlay: '#f9f9f9',
  chrome: '#f9f9f9',
  panel: '#f9f9f9',
  raised: '#ffffff',
  codeBlock: '#f9f9f9',
  codeInline: '#ededed',
  userMessage: '#f9f9f9',
  composer: '#ffffff',
  hover: '#f9f9f9',
  selected: '#ededed',
  borderSubtle: 'color-mix(in srgb, #1a1c1f 7%, transparent)',
  borderControl: 'color-mix(in srgb, #1a1c1f 10%, transparent)',
  borderStrong: 'color-mix(in srgb, #1a1c1f 16%, transparent)',
  separator: 'color-mix(in srgb, #1a1c1f 8%, transparent)',
  scrollbarRest: '#ededed',
  scrollbarHover: '#d9d9d9',
} as const satisfies SemanticRoles

const DRACULA_DARK_40_ROLES = {
  chrome: '#23252f',
  canvas: '#282a36',
  panel: '#2f313c',
  codeBlock: '#31333e',
  userMessage: '#32343f',
  composer: '#363843',
  inline: '#3d3f48',
  separator: '#43454e',
} as const

type SyntaxPalette = {
  keyword: string
  property: string
  string: string
  number: string
  comment: string
  variable: string
  punctuation: string
}

const FIXED_SYNTAX_PALETTES: Partial<
  Record<string, Partial<Record<DesktopThemeVariant, SyntaxPalette>>>
> = {
  codepilotx: {
    dark: {
      keyword: '#b06dff',
      property: '#ff9f43',
      string: '#7ee787',
      number: '#58c7f3',
      comment: '#7d8590',
      variable: '#a6adb8',
      punctuation: '#a6adb8',
    },
  },
  dracula: {
    dark: {
      keyword: '#ff79c6',
      property: '#50fa7b',
      string: '#f1fa8c',
      number: '#bd93f9',
      comment: '#6272a4',
      variable: '#8be9fd',
      punctuation: '#f8f8f2',
    },
    light: {
      keyword: '#a3144f',
      property: '#087e45',
      string: '#766b00',
      number: '#644ac9',
      comment: '#6272a4',
      variable: '#007b91',
      punctuation: '#282a36',
    },
  },
  catppuccin: {
    dark: {
      keyword: '#cba6f7',
      property: '#89b4fa',
      string: '#a6e3a1',
      number: '#fab387',
      comment: '#6c7086',
      variable: '#89dceb',
      punctuation: '#cdd6f4',
    },
    light: {
      keyword: '#8839ef',
      property: '#1e66f5',
      string: '#40a02b',
      number: '#fe640b',
      comment: '#9ca0b0',
      variable: '#04a5e5',
      punctuation: '#4c4f69',
    },
  },
  github: {
    dark: {
      keyword: '#ff7b72',
      property: '#79c0ff',
      string: '#a5d6ff',
      number: '#79c0ff',
      comment: '#8b949e',
      variable: '#ffa657',
      punctuation: '#c9d1d9',
    },
    light: {
      keyword: '#cf222e',
      property: '#0550ae',
      string: '#0a3069',
      number: '#0550ae',
      comment: '#6e7781',
      variable: '#953800',
      punctuation: '#24292f',
    },
  },
  material: {
    dark: {
      keyword: '#c792ea',
      property: '#82aaff',
      string: '#c3e88d',
      number: '#f78c6c',
      comment: '#676e95',
      variable: '#f07178',
      punctuation: '#89ddff',
    },
    light: {
      keyword: '#7c4dff',
      property: '#6182b8',
      string: '#91b859',
      number: '#f76d47',
      comment: '#90a4ae',
      variable: '#e53935',
      punctuation: '#39adb5',
    },
  },
  'vscode-plus': {
    dark: {
      keyword: '#c586c0',
      property: '#9cdcfe',
      string: '#ce9178',
      number: '#b5cea8',
      comment: '#6a9955',
      variable: '#4fc1ff',
      punctuation: '#d4d4d4',
    },
    light: {
      keyword: '#af00db',
      property: '#001080',
      string: '#a31515',
      number: '#098658',
      comment: '#008000',
      variable: '#0070c1',
      punctuation: '#393a34',
    },
  },
}

export function deriveThemeVariables(
  config: DesktopThemeConfigV1,
): ThemeVariableMap {
  const { theme, variant } = config
  const contrast = clamp(theme.contrast, 0, 100)
  const roles = deriveSemanticRoles(config, contrast)
  const syntax = deriveSyntaxPalette(config)
  const textMeta = surfaceInkMix(theme, contrastAnchor(contrast, [55, 61, 70]))
  const textSoft = surfaceInkMix(theme, contrastAnchor(contrast, [45, 51, 60]))
  const textMute = surfaceInkMix(theme, contrastAnchor(contrast, [35, 41, 50]))
  const textPlaceholder = surfaceInkMix(
    theme,
    contrastAnchor(contrast, [25, 31, 40]),
  )
  const textDisabled = surfaceInkMix(
    theme,
    contrastAnchor(contrast, [15, 19, 25]),
  )
  const hover = roles.hover
  const selected = roles.selected

  return {
    '--contrast': String(contrast),
    '--color-bg': theme.surface,
    '--color-bg-pure': theme.surface,
    '--color-bg-soft': roles.codeInline,
    '--color-bg-subtle': roles.panel,
    '--color-bg-mask': roles.codeBlock,
    '--color-bg-hover': hover,
    '--color-bg-row-hover': roles.composer,
    '--color-bg-chip-hover': hover,
    '--color-bg-card': roles.panel,
    '--color-popover-bg': roles.raised,
    '--color-popover-border': roles.borderStrong,
    '--color-popover-divider': roles.separator,
    '--glass-surface-bg': colorMix(theme.surface, 20, 'transparent'),
    '--glass-surface-border': colorMix(theme.ink, 12, 'transparent'),
    '--glass-surface-highlight': colorMix(theme.ink, 8, 'transparent'),
    '--glass-surface-text': theme.ink,
    '--glass-surface-text-meta': textMeta,
    '--glass-surface-text-disabled': textDisabled,
    '--glass-surface-blur': '14px',
    '--color-surface': theme.surface,
    '--color-ink': theme.ink,
    '--color-border': roles.borderControl,
    '--color-border-soft': roles.borderSubtle,
    '--color-border-faint': roles.borderSubtle,
    '--color-border-row': roles.borderSubtle,
    '--color-danger': theme.semanticColors.diffRemoved,
    '--color-warning': surfaceInkMix(
      theme,
      contrastAnchor(contrast, [65, 70, 78]),
    ),
    '--color-success': theme.semanticColors.diffAdded,
    '--color-text': theme.ink,
    '--color-text-strong': theme.ink,
    '--color-text-meta': textMeta,
    '--color-text-soft': textSoft,
    '--color-text-mute': textMute,
    '--color-text-placeholder': textPlaceholder,
    '--color-text-disabled': textDisabled,
    '--color-text-on-accent': '#ffffff',
    '--color-icon': theme.ink,
    '--color-icon-soft': surfaceInkMix(
      theme,
      contrastAnchor(contrast, [40, 46, 55]),
    ),
    '--color-icon-arrow': surfaceInkMix(
      theme,
      contrastAnchor(contrast, [30, 36, 45]),
    ),
    '--color-accent': theme.accent,
    '--color-accent-a3': colorMix(theme.accent, 30, 'transparent'),
    '--color-accent-11': mixColors(theme.surface, theme.accent, 85),
    '--color-primary-action': theme.accent,
    '--color-primary-action-foreground': '#ffffff',
    '--color-primary-action-hover': mixColors(
      theme.accent,
      theme.ink,
      variant === 'dark' ? 12 : 18,
    ),
    '--color-primary-action-disabled': colorMix(
      theme.accent,
      45,
      'transparent',
    ),
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
    '--state-hover': hover,
    '--state-selected': selected,
    '--state-hover-bg': hover,
    '--state-active-bg': selected,
    '--border-subtle': roles.borderSubtle,
    '--border-muted': roles.borderControl,
    '--border-control': roles.borderControl,
    '--border-strong': roles.borderStrong,
    '--scrollbar-rest': roles.scrollbarRest,
    '--scrollbar-hover': roles.scrollbarHover,
    '--shadow-resting': shadowResting(theme, variant),
    '--shadow-raised': shadowRaised(theme, variant),
    '--shadow-float': shadowFloat(theme, variant),
    '--color-chrome-bg': roles.chrome,
    '--color-sidebar-bg': roles.chrome,
    '--color-sidebar-active-bg': selected,
    '--color-sidebar-hover-bg': hover,
    '--color-workbench-bg': roles.canvas,
    '--color-panel-bg': roles.panel,
    '--color-panel-elevated-bg': roles.raised,
    '--color-panel-border': roles.borderSubtle,
    '--color-panel-shadow': 'var(--shadow-float)',
    '--color-panel-shadow-raised': 'var(--shadow-raised)',
    '--color-panel-shadow-soft': 'var(--shadow-resting)',
    '--font-family-sans': buildFontFamilyStack(theme.fonts.ui),
    '--font-family-mono': buildFontFamilyStack(theme.fonts.code),
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

function deriveSemanticRoles(
  config: DesktopThemeConfigV1,
  contrast: number,
): SemanticRoles {
  const { theme, variant } = config
  const exactCodePilotX = getExactCodePilotXRoles(config, contrast)
  if (exactCodePilotX) return exactCodePilotX

  const exactDracula = getExactDraculaRoles(config, contrast)
  if (variant === 'dark') {
    const chrome = exactDracula?.chrome ?? mixByAnchors(
      theme.surface,
      '#000000',
      contrast,
      DARK_ROLE_ANCHORS.chrome,
    )
    const panel = exactDracula?.panel ?? roleInkMix(theme, contrast, DARK_ROLE_ANCHORS.panel)
    const codeBlock = exactDracula?.codeBlock ?? roleInkMix(
      theme,
      contrast,
      DARK_ROLE_ANCHORS.codeBlock,
    )
    const userMessage = exactDracula?.userMessage ?? roleInkMix(
      theme,
      contrast,
      DARK_ROLE_ANCHORS.userMessage,
    )
    const composer = exactDracula?.composer ?? roleInkMix(
      theme,
      contrast,
      DARK_ROLE_ANCHORS.composer,
    )
    const codeInline = exactDracula?.inline ?? roleInkMix(
      theme,
      contrast,
      DARK_ROLE_ANCHORS.inline,
    )
    const selected = mixByAnchors(
      chrome,
      theme.ink,
      contrast,
      DARK_ROLE_ANCHORS.sidebarActive,
    )
    const separator = exactDracula?.separator ?? roleInkMix(
      theme,
      contrast,
      [6, 12.5, 28],
    )
    return {
      canvas: exactDracula?.canvas ?? theme.surface,
      underlay: chrome,
      chrome,
      panel,
      raised: composer,
      codeBlock,
      codeInline,
      userMessage,
      composer,
      hover: selected,
      selected,
      borderSubtle: codeInline,
      borderControl: codeInline,
      borderStrong: codeInline,
      separator,
      scrollbarRest: composer,
      scrollbarHover: codeInline,
    }
  }

  const chrome = mixByAnchors(
    theme.surface,
    theme.ink,
    contrast,
    LIGHT_ROLE_ANCHORS.chrome,
  )
  const panel = roleInkMix(theme, contrast, LIGHT_ROLE_ANCHORS.panel)
  const raised = mixByAnchors(
    theme.surface,
    '#ffffff',
    contrast,
    LIGHT_ROLE_ANCHORS.raised,
  )
  const codeBlock = roleInkMix(theme, contrast, LIGHT_ROLE_ANCHORS.codeBlock)
  const userMessage = roleInkMix(
    theme,
    contrast,
    LIGHT_ROLE_ANCHORS.userMessage,
  )
  const composer = mixByAnchors(
    theme.surface,
    '#ffffff',
    contrast,
    LIGHT_ROLE_ANCHORS.raised,
  )
  const codeInline = roleInkMix(theme, contrast, LIGHT_ROLE_ANCHORS.inline)
  const selected = roleInkMix(theme, contrast, LIGHT_ROLE_ANCHORS.selected)
  return {
    canvas: theme.surface,
    underlay: chrome,
    chrome,
    panel,
    raised,
    codeBlock,
    codeInline,
    userMessage,
    composer,
    hover: roleInkMix(theme, contrast, LIGHT_ROLE_ANCHORS.codeBlock),
    selected,
    borderSubtle: panel,
    borderControl: selected,
    borderStrong: codeInline,
    separator: codeInline,
    scrollbarRest: selected,
    scrollbarHover: codeInline,
  }
}

function getExactCodePilotXRoles(
  config: DesktopThemeConfigV1,
  contrast: number,
): SemanticRoles | undefined {
  if (
    contrast !== 40 ||
    config.codeThemeId.toLowerCase() !== 'codepilotx'
  ) {
    return undefined
  }

  if (
    config.variant === 'dark' &&
    config.theme.surface.toLowerCase() === '#181818' &&
    config.theme.ink.toLowerCase() === '#ffffff' &&
    config.theme.accent.toLowerCase() === '#339cff'
  ) {
    return CODEPILOTX_DARK_40_ROLES
  }

  if (
    config.variant === 'light' &&
    config.theme.surface.toLowerCase() === '#ffffff' &&
    config.theme.ink.toLowerCase() === '#1a1c1f' &&
    config.theme.accent.toLowerCase() === '#339cff'
  ) {
    return CODEPILOTX_LIGHT_40_ROLES
  }

  return undefined
}

function getExactDraculaRoles(
  config: DesktopThemeConfigV1,
  contrast: number,
): typeof DRACULA_DARK_40_ROLES | undefined {
  if (
    config.variant === 'dark' &&
    config.codeThemeId.toLowerCase() === 'dracula' &&
    contrast === 40 &&
    config.theme.surface.toLowerCase() === '#282a36' &&
    config.theme.ink.toLowerCase() === '#f8f8f2'
  ) {
    return DRACULA_DARK_40_ROLES
  }
  return undefined
}

function deriveSyntaxPalette(
  config: DesktopThemeConfigV1,
): SyntaxPalette {
  const family = config.codeThemeId.trim().toLowerCase()
  const fixed = FIXED_SYNTAX_PALETTES[family]?.[config.variant]
  if (fixed) return fixed

  const { theme } = config
  const fallback: SyntaxPalette = {
    keyword: theme.accent,
    property: theme.accent,
    string: theme.semanticColors.diffAdded,
    number: theme.semanticColors.skill,
    comment: mixColors(theme.surface, theme.ink, 42),
    variable: mixColors(theme.surface, theme.ink, 68),
    punctuation: mixColors(theme.surface, theme.ink, 62),
  }
  if (family === 'absolutely') {
    return {
      ...fallback,
      property: theme.semanticColors.skill,
      number: theme.semanticColors.diffRemoved,
    }
  }
  if (family === 'raycast') {
    return {
      ...fallback,
      keyword: theme.semanticColors.diffRemoved,
      number: theme.accent,
      property: theme.semanticColors.skill,
    }
  }
  // codepilotx is the explicit semantic fallback palette. Unknown imported
  // family ids intentionally use the same stable fallback.
  return fallback
}

function roleInkMix(
  theme: ThemeTokens,
  contrast: number,
  anchors: ContrastAnchors,
): string {
  return mixByAnchors(theme.surface, theme.ink, contrast, anchors)
}

function mixByAnchors(
  first: string,
  second: string,
  contrast: number,
  anchors: ContrastAnchors,
): string {
  return mixColors(first, second, contrastAnchor(contrast, anchors))
}

function contrastAnchor(
  contrast: number,
  [low, standard, high]: ContrastAnchors,
): number {
  const normalized = clamp(contrast, 0, 100)
  if (normalized <= 40) {
    return low + (normalized / 40) * (standard - low)
  }
  return standard + ((normalized - 40) / 60) * (high - standard)
}

function surfaceInkMix(theme: ThemeTokens, inkPercent: number): string {
  return mixColors(theme.surface, theme.ink, inkPercent)
}

function mixColors(first: string, second: string, secondPercent: number): string {
  const firstRgb = parseHexColor(first)
  const secondRgb = parseHexColor(second)
  if (!firstRgb || !secondRgb) {
    return colorMix(first, 100 - secondPercent, second)
  }
  const amount = clamp(secondPercent, 0, 100) / 100
  const channels = firstRgb.map((channel, index) =>
    Math.round(channel + (secondRgb[index] - channel) * amount),
  )
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

function parseHexColor(value: string): [number, number, number] | undefined {
  const normalized = value.trim()
  const short = /^#([\da-f])([\da-f])([\da-f])$/i.exec(normalized)
  if (short) {
    return short.slice(1).map(channel => Number.parseInt(channel + channel, 16)) as [
      number,
      number,
      number,
    ]
  }
  const full = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(normalized)
  if (!full) return undefined
  return full.slice(1).map(channel => Number.parseInt(channel, 16)) as [
    number,
    number,
    number,
  ]
}

function colorMix(first: string, firstPercent: number, second: string): string {
  return `color-mix(in srgb, ${first} ${firstPercent}%, ${second})`
}

function shadowResting(theme: ThemeTokens, variant: DesktopThemeVariant): string {
  return variant === 'dark'
    ? '0 1px 2px rgba(0, 0, 0, 0.24), 0 1px 0 rgba(255, 255, 255, 0.03) inset'
    : `0 1px 2px ${colorMix(theme.ink, 5, 'transparent')}, 0 1px 0 ${colorMix(theme.surface, 70, 'transparent')} inset`
}

function shadowRaised(theme: ThemeTokens, variant: DesktopThemeVariant): string {
  return variant === 'dark'
    ? '0 12px 34px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.22)'
    : `0 10px 28px ${colorMix(theme.ink, 8, 'transparent')}, 0 1px 2px ${colorMix(theme.ink, 5, 'transparent')}`
}

function shadowFloat(theme: ThemeTokens, variant: DesktopThemeVariant): string {
  return variant === 'dark'
    ? '0 24px 64px rgba(0, 0, 0, 0.38), 0 8px 24px rgba(0, 0, 0, 0.28)'
    : `0 22px 60px ${colorMix(theme.ink, 12, 'transparent')}, 0 8px 24px ${colorMix(theme.ink, 8, 'transparent')}`
}

function formatFontFamilyStack(value: string): string {
  return value
    .split(',')
    .map(formatFontFamilyName)
    .filter(Boolean)
    .join(', ')
}

function buildFontFamilyStack(entry: {
  preset: string
  fallback: string
}): string {
  const presetStack = formatFontFamilyStack(entry.preset)
  const fallbackStack = formatFontFamilyStack(entry.fallback)
  if (!presetStack) return fallbackStack
  if (!fallbackStack) return presetStack
  return `${presetStack}, ${fallbackStack}`
}

function formatFontFamilyName(value: string): string {
  const fontName = value.trim()
  if (!fontName) return ''
  if (isQuotedFontFamily(fontName) || isCssFunction(fontName)) return fontName
  if (isGenericFontFamily(fontName)) return fontName
  return `"${fontName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isQuotedFontFamily(value: string): boolean {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
}

function isCssFunction(value: string): boolean {
  return /^[a-z-]+\(/i.test(value)
}

function isGenericFontFamily(value: string): boolean {
  return new Set([
    '-apple-system',
    'BlinkMacSystemFont',
    'cursive',
    'emoji',
    'fangsong',
    'fantasy',
    'math',
    'monospace',
    'sans-serif',
    'serif',
    'system-ui',
    'ui-monospace',
    'ui-rounded',
    'ui-sans-serif',
    'ui-serif',
  ]).has(value)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
