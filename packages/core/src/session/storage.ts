import { appendFileSync, mkdirSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../config/env.js'
import type { LogOption, SerializedMessage } from './logs.js'

export type LoadAllProjectsMessageLogsOptions = {
  skipIndex?: boolean
  initialEnrichCount?: number
}

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const maxSanitizedLength = 200

export function getCodePilotXConfigHomeDir(): string {
  return (
    process.env[CODEPILOTX_CONFIG_DIR_ENV] ??
    process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] ??
    join(homedir(), CODEPILOTX_CONFIG_DIR_NAME)
  ).normalize('NFC')
}

export function getProjectsDir(): string {
  return join(getCodePilotXConfigHomeDir(), 'projects')
}

export function getProjectDir(workspacePath: string): string {
  return join(getProjectsDir(), sanitizePath(workspacePath))
}

export async function loadAllProjectsMessageLogs(
  limit?: number,
  _options?: LoadAllProjectsMessageLogsOptions,
): Promise<LogOption[]> {
  let projectDirs
  try {
    projectDirs = await readdir(getProjectsDir(), { withFileTypes: true })
  } catch {
    return []
  }

  const logs: LogOption[] = []
  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue
    const dirPath = join(getProjectsDir(), projectDir.name)
    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      continue
    }

    const files = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => join(dirPath, entry.name))

    const boundedFiles =
      limit && files.length > limit
        ? (await fileStats(files))
            .sort((a, b) => b.modified - a.modified)
            .slice(0, limit)
            .map(file => file.path)
        : files

    for (const filePath of boundedFiles) {
      const log = await loadLogFromTranscript(filePath)
      if (log) logs.push(log)
    }
  }

  return sortLogs(logs).map((log, value) => ({ ...log, value }))
}

export async function loadFullLog(log: LogOption): Promise<LogOption> {
  if (!log.isLite || !log.fullPath) return log
  const full = await loadLogFromTranscript(log.fullPath, log.projectPath)
  if (!full) return log
  return { ...log, ...full, value: log.value }
}

export function saveAiGeneratedTitle(
  sessionId: `${string}-${string}-${string}-${string}-${string}`,
  title: string,
  transcriptPath = join(getProjectDir(process.cwd()), `${sessionId}.jsonl`),
): void {
  mkdirSync(dirname(transcriptPath), { recursive: true })
  appendFileSync(
    transcriptPath,
    `${JSON.stringify({ type: 'ai-title', sessionId, aiTitle: title })}\n`,
    'utf8',
  )
}

async function loadLogFromTranscript(
  filePath: string,
  projectPathOverride?: string,
): Promise<LogOption | null> {
  let fileStat
  let raw
  try {
    fileStat = await stat(filePath)
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }

  const messages: SerializedMessage[] = []
  let sessionId = validateUuid(basename(filePath, '.jsonl')) ?? undefined
  let projectPath = projectPathOverride
  let firstPrompt = ''
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let summary: string | undefined
  let tag: string | undefined
  let gitBranch: string | undefined
  let prNumber: number | undefined
  let prUrl: string | undefined
  let prRepository: string | undefined
  let isSidechain = false
  let created: Date | undefined
  let modified: Date | undefined

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (typeof entry.sessionId === 'string') sessionId = entry.sessionId
    if (typeof entry.cwd === 'string' && !projectPath) projectPath = entry.cwd
    if (typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch
    if (typeof entry.timestamp === 'string') {
      const timestamp = new Date(entry.timestamp)
      if (!Number.isNaN(timestamp.getTime())) {
        created ??= timestamp
        modified = timestamp
      }
    }

    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
      customTitle = entry.customTitle
      continue
    }
    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      aiTitle = entry.aiTitle
      continue
    }
    if (entry.type === 'summary' && typeof entry.summary === 'string') {
      summary = entry.summary
      continue
    }
    if (entry.type === 'tag' && typeof entry.tag === 'string') {
      tag = entry.tag
      continue
    }
    if (entry.type === 'pr-link') {
      if (typeof entry.prNumber === 'number') prNumber = entry.prNumber
      if (typeof entry.prUrl === 'string') prUrl = entry.prUrl
      if (typeof entry.prRepository === 'string') {
        prRepository = entry.prRepository
      }
      continue
    }

    if (!isTranscriptMessage(entry)) continue
    const message = entry as SerializedMessage
    messages.push(message)
    isSidechain ||= Boolean(message.isSidechain)
    if (!firstPrompt && message.type === 'user') {
      firstPrompt = extractUserPrompt(message)
    }
  }

  if (!sessionId || !projectPath) return null
  const fallbackDate = fileStat.mtime
  return {
    date: (modified ?? fallbackDate).toISOString(),
    messages,
    fullPath: filePath,
    value: 0,
    created: created ?? fileStat.birthtime ?? fallbackDate,
    modified: modified ?? fallbackDate,
    firstPrompt: firstPrompt || customTitle || aiTitle || '(session)',
    messageCount: messages.length,
    fileSize: fileStat.size,
    isSidechain,
    sessionId,
    projectPath,
    gitBranch,
    prNumber,
    prUrl,
    prRepository,
    customTitle: customTitle ?? aiTitle,
    tag,
    summary,
  }
}

function isTranscriptMessage(entry: Record<string, unknown>): boolean {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

function extractUserPrompt(message: SerializedMessage): string {
  const content = readMessageContent(message)
  const texts: string[] = []
  if (typeof content === 'string') {
    texts.push(content)
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        'type' in block &&
        block.type === 'text' &&
        'text' in block &&
        typeof block.text === 'string'
      ) {
        texts.push(block.text)
      }
    }
  }

  for (const text of texts) {
    const normalized = text.replace(/\n/g, ' ').trim()
    if (normalized) return truncatePrompt(normalized)
  }
  return ''
}

function readMessageContent(message: SerializedMessage): unknown {
  if (!message.message || typeof message.message !== 'object') return undefined
  return (message.message as { content?: unknown }).content
}

function truncatePrompt(value: string): string {
  return value.length > 200 ? `${value.slice(0, 200).trim()}\u2026` : value
}

function sortLogs(logs: LogOption[]): LogOption[] {
  return logs.sort((a, b) => {
    const modifiedDiff = b.modified.getTime() - a.modified.getTime()
    return modifiedDiff !== 0
      ? modifiedDiff
      : b.created.getTime() - a.created.getTime()
  })
}

async function fileStats(
  files: string[],
): Promise<Array<{ path: string; modified: number }>> {
  const results = await Promise.all(
    files.map(async path => {
      try {
        return { path, modified: (await stat(path)).mtime.getTime() }
      } catch {
        return null
      }
    }),
  )
  return results.filter(
    (result): result is { path: string; modified: number } => result !== null,
  )
}

function validateUuid(value: unknown): string | null {
  return typeof value === 'string' && uuidRegex.test(value) ? value : null
}

function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= maxSanitizedLength) return sanitized
  return `${sanitized.slice(0, maxSanitizedLength)}-${hashString(name)}`
}

function hashString(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return Math.abs(hash).toString(36)
}
