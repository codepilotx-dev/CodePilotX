export type StreamingMarkdownSegment =
  | {
      kind: 'complete'
      stableText: string
      pendingText: ''
    }
  | {
      kind: 'text'
      stableText: string
      pendingText: string
    }
  | {
      kind: 'code'
      stableText: string
      pendingText: string
      language: string
      code: string
      marker: string
    }

type OpenFence = {
  character: '`' | '~'
  length: number
  lineEnd: number
  marker: string
  start: number
  language: string
}

const FENCE_LINE = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)/

export function segmentStreamingMarkdown(
  text: string,
): StreamingMarkdownSegment {
  const source = text ?? ''
  const openFence = findUnclosedFence(source)
  if (openFence) {
    return {
      kind: 'code',
      stableText: source.slice(0, openFence.start),
      pendingText: source.slice(openFence.start),
      language: normalizeFenceLanguage(openFence.language),
      code: source.slice(openFence.lineEnd).replace(/^\r?\n/, ''),
      marker: openFence.marker,
    }
  }

  if (endsWithClosedFence(source)) {
    return { kind: 'complete', stableText: source, pendingText: '' }
  }

  const lastParagraphBoundary = findLastParagraphBoundary(source)
  if (lastParagraphBoundary < 0) {
    return {
      kind: 'text',
      stableText: '',
      pendingText: source,
    }
  }
  if (lastParagraphBoundary >= source.length) {
    return { kind: 'complete', stableText: source, pendingText: '' }
  }
  return {
    kind: 'text',
    stableText: source.slice(0, lastParagraphBoundary),
    pendingText: source.slice(lastParagraphBoundary),
  }
}

function findUnclosedFence(source: string): OpenFence | null {
  let open: OpenFence | null = null
  let offset = 0

  for (const line of source.split(/\n/)) {
    const match = FENCE_LINE.exec(line)
    const nextOffset = offset + line.length + 1
    if (!match) {
      offset = nextOffset
      continue
    }

    const marker = match[2]
    const character = marker[0] as '`' | '~'
    if (!open) {
      open = {
        character,
        length: marker.length,
        lineEnd: offset + line.length,
        marker,
        start: offset,
        language: match[3].trim(),
      }
    } else if (
      character === open.character &&
      marker.length >= open.length &&
      match[3].trim().length === 0
    ) {
      open = null
    }
    offset = nextOffset
  }

  return open
}

function findLastParagraphBoundary(source: string): number {
  const match = /(?:\r?\n[ \t]*){2,}$/u.exec(source)
  if (match?.index !== undefined) return source.length

  let boundary = -1
  const pattern = /(?:\r?\n[ \t]*){2,}/gu
  for (const candidate of source.matchAll(pattern)) {
    if (candidate.index === undefined) continue
    boundary = candidate.index + candidate[0].length
  }
  return boundary
}

function endsWithClosedFence(source: string): boolean {
  const lines = source.split(/\r?\n/u)
  while (lines.at(-1)?.trim() === '') lines.pop()
  const finalLine = lines.at(-1)
  if (!finalLine) return false
  const closing = /^( {0,3})(`{3,}|~{3,})[ \t]*$/u.exec(finalLine)
  if (!closing) return false
  const markerCharacter = closing[2][0]
  return lines
    .slice(0, -1)
    .some(line => {
      const opener = FENCE_LINE.exec(line)
      return (
        opener?.[2]?.[0] === markerCharacter &&
        opener[2].length <= closing[2].length
      )
    })
}

function normalizeFenceLanguage(info: string): string {
  return info.trim().split(/\s+/u)[0]?.toLowerCase() ?? ''
}
