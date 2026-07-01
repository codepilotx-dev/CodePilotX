import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { SessionDatabase } from './database.js'
import { upsertSession } from './sync.js'
import { getProjectsDir } from '../storage.js'
import type { SessionUpsert } from './types.js'

// ---------------------------------------------------------------------------
// Session index overlay type (for migrating from sessions.json)
// ---------------------------------------------------------------------------

/**
 * Shape of the desktop overlay store. When migrating from sessions.json,
 * these fields take priority over transcript-derived metadata.
 */
export interface SessionOverlay {
  id: string
  title?: string
  status?: string
  pinned?: boolean
  archived?: boolean
  source?: string
  sessionMode?: string
  modelProvider?: string
  model?: string
  thinkingMode?: string
  approvalMode?: string
  gitBranch?: string
}

// ---------------------------------------------------------------------------
// Lite transcript scan (reuses extraction patterns from sessionStoragePortable)
// ---------------------------------------------------------------------------

/** Minimum metadata extracted from a transcript file's head. */
interface TranscriptLiteMeta {
  sessionId: string
  projectPath: string
  createdTs: number
  updatedTs: number
  firstPrompt: string
  title?: string
  summary?: string
  messageCount: number
  fileSize: number
  gitBranch?: string
}

/**
 * Read just enough of a JSONL transcript to extract session metadata.
 *
 * Reads the full file for small transcripts (<5 KB), or the head region
 * (~64 KB) for larger ones, then parses the first few session fields
 * without loading the entire conversation.
 */
function extractTranscriptMeta(
  filePath: string,
): TranscriptLiteMeta | null {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(filePath)
  } catch {
    return null
  }
  if (stat.size === 0) return null

  const content = readTranscriptHead(filePath, Math.min(stat.size, 64 * 1024))
  const tail =
    stat.size > 64 * 1024
      ? readTranscriptTail(filePath, Math.min(stat.size, 64 * 1024), stat.size)
      : content
  const lines = content.split(/\r?\n/)
  const tailLines = tail.split(/\r?\n/)

  let sessionId = basename(filePath, extname(filePath))
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(sessionId)) sessionId = ''

  let projectPath = ''
  let createdTs: number | undefined
  let updatedTs: number | undefined
  let firstPrompt = ''
  let messageCount = 0
  let gitBranch: string | undefined
  let foundFirstUser = false
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let lastPrompt: string | undefined
  let summary: string | undefined

  for (const line of lines) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (typeof entry.sessionId === 'string') sessionId = entry.sessionId
    if (typeof entry.cwd === 'string' && !projectPath) {
      projectPath = entry.cwd
    }
    if (typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch

    if (typeof entry.timestamp === 'string') {
      const ts = new Date(entry.timestamp).getTime()
      if (!Number.isNaN(ts)) {
        if (createdTs === undefined) createdTs = ts
        updatedTs = ts
      }
    }

    if (
      !foundFirstUser &&
      entry.type === 'user' &&
      (entry as { isMeta?: boolean }).isMeta !== true
    ) {
      const message = entry.message as Record<string, unknown> | undefined
      if (message) {
        const content = message.content
        const texts: string[] = []
        if (typeof content === 'string') {
          texts.push(content)
        } else if (Array.isArray(content)) {
          for (const block of content as Record<string, unknown>[]) {
            if (block.type === 'text' && typeof block.text === 'string') {
              texts.push(block.text as string)
            }
          }
        }
        for (const text of texts) {
          const normalized = text.replace(/\n/g, ' ').trim()
          if (normalized) {
            firstPrompt =
              normalized.length > 200
                ? normalized.slice(0, 200).trim() + '\u2026'
                : normalized
            break
          }
        }
      }
      foundFirstUser = true
    }

    if (
      entry.type === 'user' ||
      entry.type === 'assistant' ||
      entry.type === 'attachment' ||
      entry.type === 'system'
    ) {
      messageCount++
    }
  }

  for (const line of tailLines) {
    if (!line.trim()) continue
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (entry.type === 'custom-title' && typeof entry.customTitle === 'string') {
      customTitle = entry.customTitle
    } else if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string') {
      aiTitle = entry.aiTitle
    } else if (entry.type === 'last-prompt' && typeof entry.lastPrompt === 'string') {
      lastPrompt = entry.lastPrompt
    } else if (entry.type === 'summary' && typeof entry.summary === 'string') {
      summary = entry.summary
    }
    if (typeof entry.gitBranch === 'string') gitBranch = entry.gitBranch
  }

  if (!sessionId || !projectPath) return null

  const fileMs = stat.mtime.getTime()
  return {
    sessionId,
    projectPath,
    createdTs: createdTs ?? fileMs,
    updatedTs: updatedTs ?? fileMs,
    firstPrompt: lastPrompt || firstPrompt || '(session)',
    title: customTitle ?? aiTitle,
    summary,
    messageCount,
    fileSize: stat.size,
    gitBranch,
  }
}

// ---------------------------------------------------------------------------
// Backfill orchestrator
// ---------------------------------------------------------------------------

/** Backfill state stored in SQLite for crash-resume. */
interface BackfillState {
  status: 'idle' | 'running' | 'complete'
  last_watermark: string | null
  updated_at: number
}

/**
 * Scan all existing JSONL transcript files and populate the SQLite index.
 *
 * Uses a simple singleton lease: if backfill is already `running` and the
 * lease hasn't expired (30s), this call is a no-op. This prevents two
 * processes from backfilling concurrently.
 *
 * @param overlays Optional overlay data to merge (from sessions.json).
 *   Keyed by session id.
 */
export async function backfillSessions(
  overlays?: Map<string, SessionOverlay>,
): Promise<void> {
  await Promise.resolve()
  const db = SessionDatabase.getInstance().db

  // Ensure backfill_state table
  db.exec(`
    CREATE TABLE IF NOT EXISTS backfill_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      last_watermark TEXT,
      updated_at INTEGER NOT NULL
    )
  `)

  // Try to claim the backfill lease (30s timeout)
  const now = Date.now()
  const leaseSec = 30

  const existingState = db
    .prepare('SELECT * FROM backfill_state WHERE id = 1')
    .get() as BackfillState | undefined

  if (existingState?.status === 'complete') return

  if (existingState?.status === 'running') {
    const ageSec = (now - existingState.updated_at) / 1000
    if (ageSec < leaseSec) return // another process is actively running
  }

  // Claim lease
  db.prepare(
    `INSERT INTO backfill_state (id, status, last_watermark, updated_at)
     VALUES (1, 'running', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = 'running',
       last_watermark = COALESCE(?, backfill_state.last_watermark),
       updated_at = ?`,
  ).run(null, now, null, now)

  try {
    const projectsDir = getProjectsDir()
    let projectDirs: string[]
    try {
      projectDirs = readdirSync(projectsDir)
    } catch {
      // No projects directory yet
      db.prepare(
        `UPDATE backfill_state SET status = 'complete', updated_at = ? WHERE id = 1`,
      ).run(Date.now())
      return
    }

    let processed = 0
    const BATCH_SIZE = 100

    // Load overlays from sessions.json if available
    const overlayMap = overlays ?? new Map()

    for (const projectName of projectDirs) {
      const projectDirPath = join(projectsDir, projectName)
      let files: string[]
      try {
        files = readdirSync(projectDirPath)
      } catch {
        continue
      }

      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
      // Sort by mtime for deterministic ordering (newest first)
      jsonlFiles.sort((a, b) => {
        const ma = statSync(join(projectDirPath, a)).mtimeMs
        const mb = statSync(join(projectDirPath, b)).mtimeMs
        return mb - ma
      })

      for (const file of jsonlFiles) {
        const filePath = join(projectDirPath, file)
        const meta = extractTranscriptMeta(filePath)
        if (!meta) continue

        const overlay = overlayMap.get(meta.sessionId)
        const upsert: SessionUpsert = {
          id: meta.sessionId,
          project_path: meta.projectPath,
          transcript_path: filePath,
          rollout_path: file.endsWith('.rollout.jsonl') ? filePath : null,
          created_at_ms: meta.createdTs,
          updated_at_ms: meta.updatedTs,
          recency_at_ms: meta.updatedTs,
          first_user_message: meta.firstPrompt,
          preview: meta.firstPrompt,
          message_count: meta.messageCount,
          file_size: meta.fileSize,
          source: overlay?.source ?? 'unknown',
          title: overlay?.title ?? meta.title ?? meta.firstPrompt,
          git_branch: overlay?.gitBranch ?? meta.gitBranch,
          summary: meta.summary,
          status: overlay?.status ?? 'active',
          pinned: overlay?.pinned ? 1 : 0,
          archived: overlay?.archived ? 1 : 0,
          session_mode: overlay?.sessionMode,
          model_provider: overlay?.modelProvider,
          model: overlay?.model,
          thinking_mode: overlay?.thinkingMode,
          approval_mode: overlay?.approvalMode,
        }

        upsertSession(upsert)
        processed++

        // Checkpoint every BATCH_SIZE
        if (processed % BATCH_SIZE === 0) {
          db.prepare(
            `UPDATE backfill_state SET last_watermark = ?, updated_at = ? WHERE id = 1`,
          ).run(filePath, Date.now())
          await Promise.resolve()
        }
      }
    }

    // Mark complete
    db.prepare(
      `UPDATE backfill_state SET status = 'complete', last_watermark = NULL, updated_at = ? WHERE id = 1`,
    ).run(Date.now())
  } catch (err) {
    // Mark failed so it can be retried
    db.prepare(
      `UPDATE backfill_state SET status = 'idle', updated_at = ? WHERE id = 1`,
    ).run(Date.now())
    throw err
  }
}

function readTranscriptHead(filePath: string, bytesToRead: number): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

function readTranscriptTail(
  filePath: string,
  bytesToRead: number,
  fileSize: number,
): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const start = Math.max(0, fileSize - bytesToRead)
    const bytesRead = readSync(fd, buffer, 0, bytesToRead, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Check whether backfill has completed. */
export function isBackfillComplete(): boolean {
  const db = SessionDatabase.getInstance().db
  // Ensure table exists
  try {
    const row = db
      .prepare("SELECT status FROM backfill_state WHERE id = 1 AND status = 'complete'")
      .get() as { status: string } | undefined
    return row !== undefined
  } catch {
    return false
  }
}
