import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import { parseMemoryType, type MemoryType } from '../memdir/memoryTypes.js'

const RECALL_LOG_NAME = '.recall-events.jsonl'
const QUERY_SUMMARY_MAX_LENGTH = 120

export type MemoryRecallInput = {
  memoryDir: string
  sessionId: string
  query: string
  consumedOnIteration: number
  status?: 'injected' | 'viewed'
  memories: Array<{
    path: string
    content: string
    mtimeMs: number
    header?: string
    limit?: number
  }>
}

export async function appendMemoryRecallEvent(
  input: MemoryRecallInput,
): Promise<void> {
  if (input.memories.length === 0) return
  const logPath = `${input.memoryDir.replace(/[\\\/]+$/, '')}/${RECALL_LOG_NAME}`
  const event = {
    sessionId: input.sessionId,
    createdAt: new Date().toISOString(),
    querySummary: summarizeQuery(input.query),
    status: input.status ?? 'injected',
    consumedOnIteration: input.consumedOnIteration,
    memories: input.memories.map(memory => {
      const frontmatter = parseFrontmatter(memory.content)
      return {
        relativePath: relative(input.memoryDir, memory.path),
        ...(parseMemoryType(frontmatter.type)
          ? { type: parseMemoryType(frontmatter.type) as MemoryType }
          : {}),
        ...(typeof frontmatter.description === 'string'
          ? { description: frontmatter.description }
          : {}),
        mtimeMs: memory.mtimeMs,
        truncated: memory.limit !== undefined,
      }
    }),
  }
  await mkdir(dirname(logPath), { recursive: true })
  await appendFile(logPath, `${JSON.stringify(event)}\n`, 'utf8')
}

function summarizeQuery(query: string): string {
  return query
    .replace(/\b(?=[A-Za-z0-9_-]{6,}\b)[A-Za-z0-9_-]*\d[A-Za-z0-9_-]*\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUERY_SUMMARY_MAX_LENGTH)
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end < 0) return {}
  const values: Record<string, string> = {}
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
  }
  return values
}
