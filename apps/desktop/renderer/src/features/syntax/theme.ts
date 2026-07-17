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

export function resolveThemeId(
  codeThemeId: string | null | undefined,
  variant: SyntaxThemeVariant,
): CodexHighlightThemeSlug {
  const normalized = codeThemeId?.trim().toLowerCase() ?? ''
  if (normalized !== 'auto' && isCodexHighlightThemeSlug(normalized)) {
    return normalized
  }
  return DEFAULT_CODEX_SYNTAX_THEMES[variant]
}
