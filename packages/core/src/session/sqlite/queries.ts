import type Database from 'better-sqlite3'
import { SessionDatabase } from './database.js'
import type {
  SessionRow,
  ListSessionsParams,
  ListSessionsResult,
  Cursor,
} from './types.js'

// ---------------------------------------------------------------------------
// List sessions with keyset pagination
// ---------------------------------------------------------------------------

const SORT_COLUMNS: Record<string, string> = {
  created_at_ms: 'created_at_ms',
  updated_at_ms: 'updated_at_ms',
  recency_at_ms: 'recency_at_ms',
}

/**
 * List sessions stored in the SQLite index.
 *
 * Uses keyset (cursor) pagination rather than OFFSET for stable, efficient
 * paging — each cursor encodes the last-seen (sortKey, id) pair, so adding
 * or removing rows between pages does not shift results.
 *
 * Filters:
 * - `archived` — 1 = archived, 0 (default) = active
 * - `projectPath` — narrows to one workspace
 * - `searchTerm` — case-insensitive `instr()` substring match on title + preview
 * - `allowedSources` — e.g. ['desktop', 'tui']
 * - `includeEmptyPreview` — if true, does not filter by preview presence
 */
export function listSessions(
  params: ListSessionsParams,
): ListSessionsResult {
  const db = SessionDatabase.getInstance().db

  const sortKey = SORT_COLUMNS[params.sortKey ?? 'recency_at_ms']
  const sortDir = params.sortDirection ?? 'desc'
  const pageSize = params.pageSize ?? 50
  const archived = params.archived ? 1 : 0

  const conditions: string[] = ['s.archived = ?']
  const bindings: unknown[] = [archived]

  // Visibility gate — only sessions with a preview by default
  if (!params.includeEmptyPreview) {
    conditions.push("s.preview <> ''")
  }

  // Project filter
  if (params.projectPath) {
    conditions.push('s.project_path = ?')
    bindings.push(params.projectPath)
  }

  // Source filter
  if (params.allowedSources && params.allowedSources.length > 0) {
    const placeholders = params.allowedSources.map(() => '?').join(', ')
    conditions.push(`s.source IN (${placeholders})`)
    bindings.push(...params.allowedSources)
  }

  // Search — substring match on title and preview
  if (params.searchTerm) {
    conditions.push(
      '(instr(s.title, ?) > 0 OR instr(s.preview, ?) > 0)',
    )
    bindings.push(params.searchTerm, params.searchTerm)
  }

  // Keyset cursor
  if (params.cursor) {
    const { ts, id } = params.cursor
    const op = sortDir === 'desc' ? '<' : '>'
    // For recency sort, include id as tiebreaker since many rows may share
    // the same recency timestamp. For others, the ms timestamp is sufficiently
    // unique (monotonically allocated), but include id for safety anyway.
    conditions.push(
      `(s.${sortKey} ${op} ? OR (s.${sortKey} = ? AND s.id ${op} ?))`,
    )
    bindings.push(ts, ts, id)
  }

  const whereClause = conditions.join(' AND ')
  const orderClause = `ORDER BY s.${sortKey} ${sortDir}, s.id ${sortDir}`
  const limitClause = `LIMIT ?` // pageSize + 1 for "hasMore" detection
  bindings.push(pageSize + 1)

  const sql = `SELECT s.* FROM sessions s WHERE ${whereClause} ${orderClause} ${limitClause}`

  const rows = db.prepare(sql).all(...bindings) as SessionRow[]

  // Detect whether there are more results by checking if we got pageSize + 1 rows
  let hasMore = false
  let nextCursor: Cursor | null = null

  if (rows.length > pageSize) {
    hasMore = true
    rows.pop() // remove the extra row
  }

  // Build cursor from the last row
  if (rows.length > 0) {
    const last = rows[rows.length - 1]
    nextCursor = {
      ts: last[sortKey as keyof SessionRow] as number,
      id: last.id,
    }
  }

  return { sessions: rows, nextCursor, hasMore }
}

// ---------------------------------------------------------------------------
// Single session lookup
// ---------------------------------------------------------------------------

/** Fetch a single session by id. */
export function getSession(id: string): SessionRow | undefined {
  const db = SessionDatabase.getInstance().db
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | SessionRow
    | undefined
}

// ---------------------------------------------------------------------------
// Count
// ---------------------------------------------------------------------------

/** Count sessions matching the given archived filter. */
export function countSessions(archived: boolean = false): number {
  const db = SessionDatabase.getInstance().db
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM sessions WHERE archived = ?')
    .get(archived ? 1 : 0) as { count: number }
  return row.count
}

// ---------------------------------------------------------------------------
// Session existence check
// ---------------------------------------------------------------------------

/** Check whether a session exists in the index. */
export function sessionExists(id: string): boolean {
  const db = SessionDatabase.getInstance().db
  const row = db
    .prepare('SELECT 1 FROM sessions WHERE id = ?')
    .get(id) as { id: string } | undefined
  return row !== undefined
}
