import type {
  BundledLanguage,
  Highlighter,
  ThemedToken,
} from 'shiki'
import {
  isCodexHighlightThemeSlug,
  loadCodexHighlightTheme,
} from '../../../shared/codexThemes/manifest.js'
import type {
  CodexHighlightThemeSlug,
} from '../../../shared/codexThemes/manifest.js'

import { LruCache } from './LruCache.js'
import { normalizeSyntaxLanguage } from './language.js'
import type {
  HighlightCodeOptions,
  SyntaxHighlightPresentation,
  SyntaxHighlightResult,
  SyntaxToken,
} from './types.js'

export const SYNTAX_HIGHLIGHT_CACHE_CAPACITY = 96

const resultCache = new LruCache<string, SyntaxHighlightResult>(
  SYNTAX_HIGHLIGHT_CACHE_CAPACITY,
)
const pendingHighlights = new Map<string, Promise<SyntaxHighlightResult>>()

type ShikiModule = typeof import('shiki')

let shikiModulePromise: Promise<ShikiModule> | null = null
let highlighterPromise: Promise<Highlighter> | null = null

function loadShiki(): Promise<ShikiModule> {
  shikiModulePromise ??= import('shiki')
  return shikiModulePromise
}

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise) return highlighterPromise

  highlighterPromise = loadShiki().then(shiki =>
    shiki.getSingletonHighlighter({ langs: [], themes: [] }),
  )
  return highlighterPromise
}

export async function highlightCode(
  options: HighlightCodeOptions,
): Promise<SyntaxHighlightResult> {
  const requestedLanguage = normalizeSyntaxLanguage(options.language)
  const requestedTheme = options.theme.trim()
  const cacheKey = highlightCacheKey(
    options.code,
    requestedLanguage,
    requestedTheme,
  )
  const cached = resultCache.get(cacheKey)
  if (cached) return cached

  const pending = pendingHighlights.get(cacheKey)
  if (pending) return pending

  const request = highlightCodeUncached({
    code: options.code,
    requestedLanguage,
    requestedTheme,
  })
  pendingHighlights.set(cacheKey, request)

  try {
    const result = await request
    resultCache.set(cacheKey, result)
    return result
  } finally {
    if (pendingHighlights.get(cacheKey) === request) {
      pendingHighlights.delete(cacheKey)
    }
  }
}

export function peekHighlightedCode(
  options: HighlightCodeOptions,
): SyntaxHighlightResult | undefined {
  return resultCache.peek(
    highlightCacheKey(
      options.code,
      normalizeSyntaxLanguage(options.language),
      options.theme.trim(),
    ),
  )
}

export function clearSyntaxHighlightCache(): void {
  resultCache.clear()
}

export function presentHighlightedCode(
  result: SyntaxHighlightResult | null,
  currentCode: string,
  requestedLanguage: string,
  requestedTheme: string,
): SyntaxHighlightPresentation {
  const isCompatible =
    result?.requestedLanguage === requestedLanguage &&
    result.requestedTheme === requestedTheme

  if (!result || !isCompatible) {
    return { highlighted: null, plainText: currentCode }
  }
  if (result.code === currentCode) {
    return { highlighted: result, plainText: '' }
  }
  if (currentCode.startsWith(result.code)) {
    return {
      highlighted: result,
      plainText: currentCode.slice(result.code.length),
    }
  }
  return { highlighted: null, plainText: currentCode }
}

async function highlightCodeUncached({
  code,
  requestedLanguage,
  requestedTheme,
}: {
  code: string
  requestedLanguage: string
  requestedTheme: string
}): Promise<SyntaxHighlightResult> {
  const shiki = await loadShiki()
  const language = resolveBundledLanguage(shiki, requestedLanguage)
  const theme = resolveCodexTheme(requestedTheme)

  if (language === 'text') {
    return plainTextResult({
      code,
      requestedLanguage,
      requestedTheme,
      theme,
    })
  }

  try {
    const highlighter = await getHighlighter()
    await Promise.all([
      highlighter.getLoadedLanguages().includes(language)
        ? undefined
        : highlighter.loadLanguage(shiki.bundledLanguages[language]),
      highlighter.getLoadedThemes().includes(theme)
        ? undefined
        : loadCodexHighlightTheme(theme).then(registration =>
            highlighter.loadTheme(registration),
          ),
    ])
    const highlighted = highlighter.codeToTokens(code, {
      lang: language,
      theme,
    })

    return {
      code,
      foreground: highlighted.fg,
      background: highlighted.bg,
      language,
      requestedLanguage,
      requestedTheme,
      theme: highlighted.themeName ?? theme,
      tokens: highlighted.tokens.map(line => line.map(toSyntaxToken)),
    }
  } catch {
    return plainTextResult({
      code,
      requestedLanguage,
      requestedTheme,
      theme,
    })
  }
}

function resolveBundledLanguage(
  shiki: ShikiModule,
  requestedLanguage: string,
): BundledLanguage | 'text' {
  if (requestedLanguage === 'text') return 'text'
  if (Object.hasOwn(shiki.bundledLanguages, requestedLanguage)) {
    return requestedLanguage as BundledLanguage
  }
  return 'text'
}

function resolveCodexTheme(
  requestedTheme: string,
): CodexHighlightThemeSlug {
  return isCodexHighlightThemeSlug(requestedTheme)
    ? requestedTheme
    : 'codex-dark'
}

function toSyntaxToken(token: ThemedToken): SyntaxToken {
  return {
    content: token.content,
    color: token.color,
    backgroundColor: token.bgColor,
    fontStyle: token.fontStyle,
  }
}

function plainTextResult({
  code,
  requestedLanguage,
  requestedTheme,
  theme,
}: {
  code: string
  requestedLanguage: string
  requestedTheme: string
  theme: string
}): SyntaxHighlightResult {
  return {
    code,
    language: 'text',
    requestedLanguage,
    requestedTheme,
    theme,
    tokens: code.split('\n').map(line => [
      {
        content: line,
      },
    ]),
  }
}

function highlightCacheKey(
  code: string,
  language: string,
  theme: string,
): string {
  return JSON.stringify([language, theme, code])
}
