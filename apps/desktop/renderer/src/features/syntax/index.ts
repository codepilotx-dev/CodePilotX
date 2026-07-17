export { CodeBlock, syntaxTokenStyle } from './CodeBlock.js'
export type { CodeBlockProps } from './CodeBlock.js'
export {
  clearSyntaxHighlightCache,
  highlightCode,
  peekHighlightedCode,
  presentHighlightedCode,
  SYNTAX_HIGHLIGHT_CACHE_CAPACITY,
} from './highlighter.js'
export {
  formatSyntaxLanguageLabel,
  normalizeSyntaxLanguage,
  resolveLanguageFromPath,
} from './language.js'
export {
  SyntaxHighlighterService,
  syntaxHighlighter,
  syntaxHighlighterService,
} from './service.js'
export {
  SyntaxThemeRegistry,
  resolveThemeId,
} from './theme.js'
export type { SyntaxThemeVariant } from './theme.js'
export type {
  HighlightCodeOptions,
  SyntaxHighlightPresentation,
  SyntaxHighlightResult,
  SyntaxToken,
} from './types.js'
export {
  STREAMING_HIGHLIGHT_INTERVAL_MS,
  useHighlightedCode,
} from './useHighlightedCode.js'
export {
  CODE_WRAP_STORAGE_KEY,
  readCodeWrapPreference,
  setCodeWrapPreference,
  useCodeWrapPreference,
} from './wrapPreference.js'
