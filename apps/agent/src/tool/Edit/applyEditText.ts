import { AgentError } from "../../domain"

type MatchRange = {
  start: number
  end: number
}

type NormalizedText = {
  text: string
  rawOffsets: number[]
}

const normalizeLineEndings = (value: string): NormalizedText => {
  let text = ""
  const rawOffsets = [0]
  for (let index = 0; index < value.length;) {
    if (value[index] === "\r" && value[index + 1] === "\n") {
      text += "\n"
      index += 2
    } else {
      text += value[index]
      index += 1
    }
    rawOffsets.push(index)
  }
  return { text, rawOffsets }
}

const findMatchRanges = (
  content: string,
  oldString: string,
  replaceAll: boolean,
): MatchRange[] => {
  const findNext = (offset: number) => {
    let index = content.indexOf(oldString, offset)
    while (index >= 0 && oldString.startsWith("\n") && index > 0 && content[index - 1] === "\r") {
      index = content.indexOf(oldString, index + 1)
    }
    return index
  }

  const first = findNext(0)
  if (first < 0) return []
  if (!replaceAll) {
    if (findNext(first + 1) >= 0) {
      throw new AgentError("PATCH_CONTEXT_AMBIGUOUS", "编辑上下文不唯一；如需全部替换请设置 replace_all", 409)
    }
    return [{ start: first, end: first + oldString.length }]
  }

  const ranges: MatchRange[] = []
  for (let offset = 0; offset <= content.length - oldString.length;) {
    const index = findNext(offset)
    if (index < 0) break
    ranges.push({ start: index, end: index + oldString.length })
    offset = index + oldString.length
  }
  return ranges
}

const resolveMatchRanges = (
  content: string,
  oldString: string,
  replaceAll: boolean,
): MatchRange[] => {
  const exact = findMatchRanges(content, oldString, replaceAll)
  if (exact.length > 0) return exact

  const normalizedContent = normalizeLineEndings(content)
  const normalizedOldString = normalizeLineEndings(oldString).text
  const normalizedRanges = findMatchRanges(normalizedContent.text, normalizedOldString, replaceAll)
  if (normalizedRanges.length === 0) {
    throw new AgentError("PATCH_CONTEXT_NOT_FOUND", "编辑上下文未找到", 409)
  }
  return normalizedRanges.map(({ start, end }) => ({
    start: normalizedContent.rawOffsets[start]!,
    end: normalizedContent.rawOffsets[end]!,
  }))
}

const lineEndingAt = (content: string, lineFeedIndex: number): "\r\n" | "\n" =>
  lineFeedIndex > 0 && content[lineFeedIndex - 1] === "\r" ? "\r\n" : "\n"

const lineEndingInside = (content: string, range: MatchRange) => {
  const index = content.indexOf("\n", range.start)
  return index >= 0 && index < range.end ? lineEndingAt(content, index) : null
}

const nearestLineEnding = (content: string, range: MatchRange): "\r\n" | "\n" | null => {
  const before = content.lastIndexOf("\n", Math.max(0, range.start - 1))
  const after = content.indexOf("\n", range.end)
  if (before < 0 && after < 0) return null
  if (before < 0) return lineEndingAt(content, after)
  if (after < 0) return lineEndingAt(content, before)
  return range.start - before <= after - range.end
    ? lineEndingAt(content, before)
    : lineEndingAt(content, after)
}

const adaptReplacementLineEndings = (
  content: string,
  range: MatchRange,
  replacement: string,
) => {
  const lineEnding = lineEndingInside(content, range)
    ?? nearestLineEnding(content, range)
    ?? "\n"
  return replacement.replace(/\r\n|\n/g, lineEnding)
}

export const applyEditText = (
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
) => {
  if (!oldString) throw new AgentError("INVALID_TOOL_INPUT", "old_string 必须是非空字符串", 400)
  const ranges = resolveMatchRanges(content, oldString, replaceAll)
  let updated = content
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]!
    const replacement = adaptReplacementLineEndings(content, range, newString)
    updated = `${updated.slice(0, range.start)}${replacement}${updated.slice(range.end)}`
  }
  return updated
}
