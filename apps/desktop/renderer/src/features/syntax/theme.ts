import {
  CODEX_HIGHLIGHT_THEMES,
  isCodexHighlightThemeSlug,
} from '../../../shared/codexThemes/manifest.js'
import type {
  CodexHighlightThemeSlug,
} from '../../../shared/codexThemes/manifest.js'

export type SyntaxThemeVariant = 'light' | 'dark'

export const DEFAULT_CODEX_SYNTAX_THEMES: Readonly<
  Record<SyntaxThemeVariant, CodexHighlightThemeSlug>
> = {
  light: 'codex-light',
  dark: 'codex-dark',
}

export { CODEX_HIGHLIGHT_THEMES }
export type { CodexHighlightThemeSlug }

export function getThemesForVariant(variant: SyntaxThemeVariant) {
  return CODEX_HIGHLIGHT_THEMES.filter(theme => theme.variant === variant)
}

export function isThemeCompatibleWithVariant(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): codeThemeId is CodexHighlightThemeSlug {
  const normalized = codeThemeId?.trim().toLowerCase()
  if (
    !normalized ||
    codeThemeId !== normalized ||
    !isCodexHighlightThemeSlug(normalized)
  ) {
    return false
  }
  return getThemesForVariant(variant).some(
    theme => theme.slug === normalized && theme.variant === variant,
  )
}

export function normalizeThemeIdForVariant(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): 'auto' | CodexHighlightThemeSlug {
  if (codeThemeId === 'auto') return 'auto'
  return isThemeCompatibleWithVariant(codeThemeId, variant)
    ? codeThemeId
    : 'auto'
}

export function resolveThemeId(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): CodexHighlightThemeSlug {
  if (isThemeCompatibleWithVariant(codeThemeId, variant)) {
    return codeThemeId
  }
  return DEFAULT_CODEX_SYNTAX_THEMES[variant]
}
