import { marked, type Token, type Tokens } from 'marked'
import { LruCache } from './lru.js'
import { segmentStreamingMarkdown } from './streaming.js'
import type {
  MarkdownDirectiveToken,
  MarkdownMathToken,
  MarkdownParseResult,
  MarkdownStreamingCodeToken,
  MarkdownToken,
} from './types.js'
import { normalizeDirectiveName } from './directives.js'

const TOKEN_CACHE = new LruCache<string, MarkdownToken[]>(100)
const BLOCK_START = /^(?: {0,3})(:{1,3}[a-zA-Z][\w-]*|\$\$)[^\r\n]*(?:\r?\n|$)/m

export function parseMarkdown(
  text: string,
  streaming = false,
): MarkdownParseResult {
  const source = text ?? ''
  if (!streaming) {
    return {
      tokens: lexWithCache(source),
      stableText: source,
      pendingText: '',
    }
  }

  const segment = segmentStreamingMarkdown(source)
  const tokens = [...lexWithCache(segment.stableText)]
  if (segment.kind === 'code') {
    const pendingCode: MarkdownStreamingCodeToken = {
      type: 'streaming_code',
      raw: segment.pendingText,
      lang: segment.language,
      text: segment.code,
    }
    tokens.push(pendingCode)
  } else if (segment.pendingText) {
    tokens.push(...lexMarkdown(segment.pendingText))
  }
  return {
    tokens,
    stableText: segment.stableText,
    pendingText: segment.pendingText,
  }
}

export function lexMarkdown(text: string): MarkdownToken[] {
  if (!text) return []
  const tokens: MarkdownToken[] = []
  let remaining = text

  while (remaining) {
    const blockMatch = BLOCK_START.exec(remaining)
    if (!blockMatch || blockMatch.index === undefined) {
      tokens.push(...lexMarked(remaining))
      break
    }
    if (blockMatch.index > 0) {
      tokens.push(...lexMarked(remaining.slice(0, blockMatch.index)))
      remaining = remaining.slice(blockMatch.index)
    }

    if (blockMatch[1] === '$$') {
      const math = readMathBlock(remaining)
      if (!math) {
        tokens.push(...lexMarked(remaining))
        break
      }
      tokens.push(math.token)
      remaining = remaining.slice(math.length)
      continue
    }

    const directive = readDirectiveBlock(remaining)
    if (!directive) {
      tokens.push(...lexMarked(remaining))
      break
    }
    tokens.push(directive.token)
    remaining = remaining.slice(directive.length)
  }

  return tokens
}

function lexWithCache(text: string): MarkdownToken[] {
  if (!text) return []
  const cached = TOKEN_CACHE.get(text)
  if (cached) return cached
  const tokens = lexMarkdown(text)
  TOKEN_CACHE.set(text, tokens)
  return tokens
}

function lexMarked(text: string): MarkdownToken[] {
  const tokens = marked.lexer(text, {
    breaks: true,
    gfm: true,
  }) as Token[]
  return tokens.map(token => addInlineMath(token))
}

function addInlineMath(token: Token): MarkdownToken {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    token.tokens = splitInlineMathTokens(token.tokens)
  }
  if (token.type === 'list') {
    token.items = token.items.map(item => ({
      ...item,
      tokens: item.tokens.map(child => addInlineMath(child) as Token),
    }))
  }
  if (token.type === 'table') {
    token.header = token.header.map(cell => ({
      ...cell,
      tokens: splitInlineMathTokens(cell.tokens),
    }))
    token.rows = token.rows.map(row =>
      row.map(cell => ({
        ...cell,
        tokens: splitInlineMathTokens(cell.tokens),
      })),
    )
  }
  return token
}

function splitInlineMathTokens(tokens: Token[]): Token[] {
  const result: Token[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (
      token.type === 'escape' &&
      (token.raw === '\\(' || token.raw === '\\[')
    ) {
      const closingRaw = token.raw === '\\(' ? '\\)' : '\\]'
      const closingIndex = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          candidate.type === 'escape' &&
          candidate.raw === closingRaw,
      )
      if (closingIndex > index) {
        result.push({
          type: 'math',
          raw: tokens
            .slice(index, closingIndex + 1)
            .map(candidate => candidate.raw)
            .join(''),
          text: tokens
            .slice(index + 1, closingIndex)
            .map(candidate => candidate.raw)
            .join(''),
          display: token.raw === '\\[',
        } as unknown as Token)
        index = closingIndex
        continue
      }
    }

    if (
      token.type !== 'text' ||
      (!token.text.includes('$') &&
        !token.text.includes('\\(') &&
        !token.text.includes('\\['))
    ) {
      result.push(addInlineMath(token) as Token)
      continue
    }
    const pieces = splitInlineMath(token.text)
    for (const piece of pieces) result.push(piece as Token)
  }
  return result
}

function splitInlineMath(text: string): Array<Token | MarkdownMathToken> {
  const result: Array<Token | MarkdownMathToken> = []
  const pattern =
    /(?<!\\)\$(?!\$)(.+?)(?<!\\)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]/gu
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) {
      result.push(textToken(text.slice(cursor, match.index)))
    }
    result.push({
      type: 'math',
      raw: match[0],
      text: match[1] ?? match[2] ?? match[3] ?? '',
      display: match[3] !== undefined,
    })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) result.push(textToken(text.slice(cursor)))
  return result.length > 0 ? result : [textToken(text)]
}

function readMathBlock(
  source: string,
): { length: number; token: MarkdownMathToken } | null {
  const match = /^\$\$[^\S\r\n]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?\$\$[^\S\r\n]*(?:\r?\n|$)/u.exec(
    source,
  )
  if (!match) return null
  return {
    length: match[0].length,
    token: {
      type: 'math',
      raw: match[0],
      text: match[1],
      display: true,
    },
  }
}

function readDirectiveBlock(
  source: string,
): { length: number; token: MarkdownDirectiveToken } | null {
  const inline = /^(:{1,2})([a-zA-Z][\w-]*)(?:\{((?:[^}"']|"[^"]*"|'[^']*')*)\})?(?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n|$)/u.exec(
    source,
  )
  if (inline) {
    const name = normalizeDirectiveName(inline[2])
    return {
      length: inline[0].length,
      token: {
        type: 'directive',
        raw: inline[0],
        name,
        argument: inline[4]?.trim() ?? '',
        attributes: parseDirectiveAttributes(inline[3] ?? ''),
        text: '',
        tokens: [],
      },
    }
  }

  const opener = /^:::([a-zA-Z][\w-]*)(?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n|$)/u.exec(
    source,
  )
  if (!opener) return null
  const bodyStart = opener[0].length
  const closer = /(?:^|\r?\n):::[ \t]*(?:\r?\n|$)/mu
  const bodyAndRest = source.slice(bodyStart)
  const closeMatch = closer.exec(bodyAndRest)
  if (!closeMatch || closeMatch.index === undefined) return null
  const leadingNewline = closeMatch[0].startsWith('\n')
    ? 1
    : closeMatch[0].startsWith('\r\n')
      ? 2
      : 0
  const body = bodyAndRest.slice(0, closeMatch.index + leadingNewline)
  const rawLength = bodyStart + closeMatch.index + closeMatch[0].length
  const name = normalizeDirectiveName(opener[1])
  return {
    length: rawLength,
    token: {
      type: 'directive',
      raw: source.slice(0, rawLength),
      name,
      argument: opener[2]?.trim() ?? '',
      attributes: {},
      text: body,
      tokens: lexMarkdown(body),
    },
  }
}

function parseDirectiveAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const pattern =
    /([a-zA-Z][\w-]*)=(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+))/gu
  for (const match of source.matchAll(pattern)) {
    const key = match[1].toLowerCase()
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    attributes[key] = value.replace(/\\(["'\\])/gu, '$1')
  }
  return attributes
}

function textToken(text: string): Tokens.Text {
  return { type: 'text', raw: text, text }
}

export function clearMarkdownTokenCache(): void {
  TOKEN_CACHE.clear()
}
