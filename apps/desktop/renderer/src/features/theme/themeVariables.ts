import type { DesktopThemeConfigV1 } from '../../../shared/types.js'

export type ThemeVariableName = `--${string}`
export type ThemeVariableMap = Record<ThemeVariableName, string>

type CodexRoles = {
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

const CODEX_LIGHT_ROLES: CodexRoles = {
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
  borderSubtle: 'color-mix(in srgb, #1a1c1f 5%, transparent)',
  borderControl: 'color-mix(in srgb, #1a1c1f 8%, transparent)',
  borderStrong: 'color-mix(in srgb, #1a1c1f 12%, transparent)',
  separator: 'color-mix(in srgb, #1a1c1f 8%, transparent)',
  scrollbarRest: '#ededed',
  scrollbarHover: '#d9d9d9',
  textSecondary: '#5f6062',
  textTertiary: '#8d8e8f',
  textPlaceholder: '#8d8e8f',
  textDisabled: '#b9babb',
}

const CODEX_DARK_ROLES: CodexRoles = {
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
  borderSubtle: 'color-mix(in srgb, #ffffff 4%, transparent)',
  borderControl: 'color-mix(in srgb, #ffffff 8%, transparent)',
  borderStrong: 'color-mix(in srgb, #ffffff 16%, transparent)',
  separator: 'color-mix(in srgb, #ffffff 8%, transparent)',
  scrollbarRest: '#282828',
  scrollbarHover: '#303030',
  textSecondary: '#bababa',
  textTertiary: '#8c8c8c',
  textPlaceholder: '#8c8c8c',
  textDisabled: '#5e5e5e',
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
  const roles = dark ? CODEX_DARK_ROLES : CODEX_LIGHT_ROLES
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
    '--contrast': '40',
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
    '--glass-surface-bg': dark
      ? 'color-mix(in srgb, #181818 20%, transparent)'
      : 'color-mix(in srgb, #ffffff 20%, transparent)',
    '--glass-surface-border': dark
      ? 'color-mix(in srgb, #ffffff 12%, transparent)'
      : 'color-mix(in srgb, #1a1c1f 12%, transparent)',
    '--glass-surface-highlight': dark
      ? 'color-mix(in srgb, #ffffff 8%, transparent)'
      : 'color-mix(in srgb, #1a1c1f 8%, transparent)',
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
    '--color-text-on-accent': '#ffffff',
    '--color-icon': theme.ink,
    '--color-icon-soft': roles.textSecondary,
    '--color-icon-arrow': roles.textTertiary,
    '--color-accent': '#339cff',
    '--color-accent-a3': '#339cffb3',
    '--color-accent-11': '#339cff',
    '--color-primary-action': '#339cff',
    '--color-primary-action-foreground': '#ffffff',
    '--color-primary-action-hover': dark ? '#5aafff' : '#168cf8',
    '--color-primary-action-disabled': 'color-mix(in srgb, #339cff 45%, transparent)',
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

function buildFontFamilyStack(
  entry: DesktopThemeConfigV1['theme']['fonts']['ui'],
): string {
  return [entry.preset, entry.fallback]
    .flatMap(value => value.split(','))
    .map(formatFontFamilyName)
    .filter(Boolean)
    .join(', ')
}

function formatFontFamilyName(value: string): string {
  const name = value.trim()
  if (!name) return ''
  if (
    /^(['"]).*\1$/.test(name) ||
    /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|-apple-system)$/i.test(
      name,
    )
  ) {
    return name
  }
  return /\s/.test(name) ? `"${name.replaceAll('"', '\\"')}"` : name
}
