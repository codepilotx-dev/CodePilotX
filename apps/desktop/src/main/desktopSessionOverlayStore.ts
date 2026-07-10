import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import type {
  DesktopReviewComment,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
  DesktopWorkspace,
} from '../shared/types.js'

const require = createRequire(import.meta.url)

type SqliteStatement = {
  get(...bindings: unknown[]): unknown
  all(...bindings: unknown[]): unknown[]
  run(...bindings: unknown[]): unknown
}

type SqliteDatabaseHandle = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
}

export type PersistedDesktopSessionOverlayStore = {
  activeSessionId: string | null
  sessions: DesktopSessionOverlay[]
}

export type DesktopSessionOverlay = {
  id: string
  appServerThreadId?: string | null
  appServerThreadPending?: boolean
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  standalone?: boolean
  pinnedAt?: string | null
  archivedAt?: string | null
  unreadAt?: string | null
  sessionName?: string | null
  aiTitle?: string | null
  customTitle?: string | null
  status?: DesktopSessionStatus
  firstPrompt?: string | null
  createdAt?: string
  lastMessageAt?: string | null
  updatedAt?: string
  rolloutPath?: string | null
  legacyTranscriptPath?: string | null
  source?: 'user' | 'internal_guardian' | 'subagent' | null
  parentSessionId?: string | null
  guardianRolloutPath?: string | null
  workflowEvents?: DesktopWorkflowEvent[]
  workflowEventModelVersion?: 1
  reviewComments?: DesktopReviewComment[]
  legacySnapshot?: DesktopSessionSnapshot
}

export type LegacyOverlayStoreReader = (
  filePath: string,
) => Promise<PersistedDesktopSessionOverlayStore>

const DESKTOP_STATE_ID = 1

export function ensureDesktopSessionOverlayTables(): void {
  const db = getSessionDatabase().getInstance().db
  db.exec(`
    CREATE TABLE IF NOT EXISTS desktop_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_session_id TEXT,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS desktop_session_overlays (
      session_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_desktop_session_overlays_updated
      ON desktop_session_overlays(updated_at_ms DESC, session_id DESC);
  `)
}

export function readDesktopSessionOverlayStoreFromSqlite(): PersistedDesktopSessionOverlayStore {
  ensureDesktopSessionOverlayTables()
  const db = getSessionDatabase().getInstance().db
  const state = db
    .prepare('SELECT active_session_id FROM desktop_state WHERE id = ?')
    .get(DESKTOP_STATE_ID) as { active_session_id: string | null } | undefined
  const rows = db
    .prepare(
      'SELECT payload FROM desktop_session_overlays ORDER BY updated_at_ms DESC, session_id DESC',
    )
    .all() as Array<{ payload: string }>

  return {
    activeSessionId:
      typeof state?.active_session_id === 'string'
        ? state.active_session_id
        : null,
    sessions: rows.flatMap(row => {
      try {
        const parsed = JSON.parse(row.payload) as DesktopSessionOverlay
        return parsed && typeof parsed.id === 'string' ? [parsed] : []
      } catch {
        return []
      }
    }),
  }
}

export function saveDesktopSessionOverlayStoreToSqlite(
  store: PersistedDesktopSessionOverlayStore,
): void {
  ensureDesktopSessionOverlayTables()
  const db = getSessionDatabase().getInstance().db
  const now = Date.now()

  db.transaction(() => {
    db.prepare(
      `INSERT INTO desktop_state (id, active_session_id, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         active_session_id = excluded.active_session_id,
         updated_at_ms = excluded.updated_at_ms`,
    ).run(DESKTOP_STATE_ID, store.activeSessionId, now)

    const seenIds = new Set(store.sessions.map(session => session.id))
    const existingRows = db
      .prepare('SELECT session_id FROM desktop_session_overlays')
      .all() as Array<{ session_id: string }>
    const deleteStmt = db.prepare(
      'DELETE FROM desktop_session_overlays WHERE session_id = ?',
    )
    for (const row of existingRows) {
      if (!seenIds.has(row.session_id)) {
        deleteStmt.run(row.session_id)
      }
    }

    const upsertStmt = db.prepare(
      `INSERT INTO desktop_session_overlays (session_id, payload, updated_at_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         payload = excluded.payload,
         updated_at_ms = excluded.updated_at_ms`,
    )
    for (const session of store.sessions) {
      upsertStmt.run(session.id, JSON.stringify(session), now)
    }
  })()
}

export async function readDesktopSessionOverlayStoreWithLegacyImport(
  legacyPath: string,
  readLegacyStore: LegacyOverlayStoreReader,
): Promise<PersistedDesktopSessionOverlayStore> {
  try {
    const sqliteStore = readDesktopSessionOverlayStoreFromSqlite()
    if (sqliteStore.sessions.length > 0 || sqliteStore.activeSessionId) {
      return sqliteStore
    }

    const legacyStore = await readLegacyStore(legacyPath)
    if (legacyStore.sessions.length > 0 || legacyStore.activeSessionId) {
      saveDesktopSessionOverlayStoreToSqlite(legacyStore)
      return legacyStore
    }
    return sqliteStore
  } catch {
    return readLegacyStore(legacyPath)
  }
}

export async function readRawLegacyDesktopSessionOverlayStore(
  legacyPath: string,
): Promise<unknown> {
  const raw = await readFile(legacyPath, 'utf8')
  return JSON.parse(raw)
}

function getSessionDatabase(): {
  getInstance(): { db: SqliteDatabaseHandle }
} {
  return (
    require('@codepilotx/core/session/sqlite/index.js') as {
      SessionDatabase: {
        getInstance(): {
          db: SqliteDatabaseHandle
        }
      }
    }
  ).SessionDatabase
}
