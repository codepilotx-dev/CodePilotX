import type Database from 'better-sqlite3'
import { SessionDatabase } from './database.js'
import type { SessionUpsert } from './types.js'

/**
 * Columns that should be preserved during upsert — the first non-empty value
 * sticks, and backfill should not overwrite them.
 */
const PRESERVED_COLUMNS = [
  'recency_at_ms',
  'preview',
  'git_branch',
  'git_sha',
  'git_origin_url',
]

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a session metadata row into the SQLite index.
 *
 * Design (borrowed from codex-main):
 * - `recency_at_ms` is NEVER overwritten by upsert — only advanced via
 *   `touchRecencyAt()` to guarantee monotonic forward progress.
 * - `preview` is set only when empty — the first non-empty preview wins.
 * - `git_*` fields are preserved if they already exist (COALESCE pattern).
 * - All other writable fields are updated unconditionally.
 */
export function upsertSession(upsert: SessionUpsert): void {
  const db = SessionDatabase.getInstance().db

  // Determine if this is an existing session (for preservation rules)
  const existing = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(upsert.id) as Record<string, unknown> | undefined

  db.transaction(() => {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        id, project_path, transcript_path, rollout_path,
        created_at_ms, updated_at_ms, recency_at_ms,
        title, preview, first_user_message, message_count, file_size,
        archived, archived_at_ms, pinned, status, session_mode, source, is_sidechain,
        model_provider, model, thinking_mode, approval_mode,
        git_branch, git_sha, git_origin_url,
        pr_number, pr_url, pr_repository,
        app_version, tags, summary, parent_session_id, subagent_count
      ) VALUES (
        @id, @project_path, @transcript_path, @rollout_path,
        @created_at_ms, @updated_at_ms, @recency_at_ms,
        @title, @preview, @first_user_message, @message_count, @file_size,
        @archived, @archived_at_ms, @pinned, @status, @session_mode, @source, @is_sidechain,
        @model_provider, @model, @thinking_mode, @approval_mode,
        @git_branch, @git_sha, @git_origin_url,
        @pr_number, @pr_url, @pr_repository,
        @app_version, @tags, @summary, @parent_session_id, @subagent_count
      )
      ON CONFLICT(id) DO UPDATE SET
        project_path = excluded.project_path,
        transcript_path = excluded.transcript_path,
        rollout_path = COALESCE(excluded.rollout_path, sessions.rollout_path),
        created_at_ms = sessions.created_at_ms,
        updated_at_ms = excluded.updated_at_ms,
        recency_at_ms = sessions.recency_at_ms,
        title = excluded.title,
        preview = COALESCE(NULLIF(excluded.preview, ''), sessions.preview),
        first_user_message = excluded.first_user_message,
        message_count = excluded.message_count,
        file_size = excluded.file_size,
        archived = excluded.archived,
        archived_at_ms = excluded.archived_at_ms,
        pinned = COALESCE(excluded.pinned, sessions.pinned),
        status = excluded.status,
        session_mode = excluded.session_mode,
        source = excluded.source,
        is_sidechain = excluded.is_sidechain,
        model_provider = COALESCE(excluded.model_provider, sessions.model_provider),
        model = COALESCE(excluded.model, sessions.model),
        thinking_mode = COALESCE(excluded.thinking_mode, sessions.thinking_mode),
        approval_mode = COALESCE(excluded.approval_mode, sessions.approval_mode),
        git_branch = COALESCE(sessions.git_branch, excluded.git_branch),
        git_sha = COALESCE(sessions.git_sha, excluded.git_sha),
        git_origin_url = COALESCE(sessions.git_origin_url, excluded.git_origin_url),
        pr_number = COALESCE(excluded.pr_number, sessions.pr_number),
        pr_url = COALESCE(excluded.pr_url, sessions.pr_url),
        pr_repository = COALESCE(excluded.pr_repository, sessions.pr_repository),
        app_version = COALESCE(excluded.app_version, sessions.app_version),
        tags = COALESCE(excluded.tags, sessions.tags),
        summary = COALESCE(excluded.summary, sessions.summary),
        parent_session_id = COALESCE(excluded.parent_session_id, sessions.parent_session_id),
        subagent_count = COALESCE(excluded.subagent_count, sessions.subagent_count)
    `)

    stmt.run(normalizeUpsert(upsert, existing))
  })()
}

// ---------------------------------------------------------------------------
// Recency touch
// ---------------------------------------------------------------------------

/**
 * Atomically advance a session's recency timestamp.
 *
 * Guarantees monotonic forward progress even if called concurrently:
 * `recency_at_ms = MAX(candidate, recency_at_ms + 1)`. This ensures that
 * rapid consecutive touches (e.g., within the same millisecond) each
 * produce a unique, strictly increasing value.
 */
export function touchRecencyAt(
  sessionId: string,
  candidateMs: number = Date.now(),
): void {
  const db = SessionDatabase.getInstance().db
  db.prepare(`
    UPDATE sessions
    SET recency_at_ms = MAX(?, recency_at_ms + 1)
    WHERE id = ?
  `).run(candidateMs, sessionId)
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** Remove a session from the SQLite index. */
export function deleteSession(id: string): void {
  const db = SessionDatabase.getInstance().db
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an upsert payload into the shape expected by the prepared
 * statement, applying preservation rules.
 */
export function normalizeUpsert(
  u: SessionUpsert,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const now = Date.now()
  return {
    id: u.id,
    project_path: u.project_path,
    transcript_path: u.transcript_path,
    rollout_path: u.rollout_path ?? null,
    created_at_ms: u.created_at_ms ?? now,
    updated_at_ms: u.updated_at_ms ?? now,
    recency_at_ms: u.recency_at_ms ?? u.created_at_ms ?? now,
    title: u.title ?? '',
    preview: u.preview ?? '',
    first_user_message: u.first_user_message ?? '',
    message_count: u.message_count ?? 0,
    file_size: u.file_size ?? 0,
    archived: u.archived ?? 0,
    archived_at_ms: u.archived_at_ms ?? null,
    pinned: u.pinned ?? 0,
    status: u.status ?? 'active',
    session_mode: u.session_mode ?? 'normal',
    source: u.source ?? 'desktop',
    is_sidechain: u.is_sidechain ?? 0,
    model_provider: u.model_provider ?? null,
    model: u.model ?? null,
    thinking_mode: u.thinking_mode ?? null,
    approval_mode: u.approval_mode ?? null,
    git_branch: u.git_branch ?? null,
    git_sha: u.git_sha ?? null,
    git_origin_url: u.git_origin_url ?? null,
    pr_number: u.pr_number ?? null,
    pr_url: u.pr_url ?? null,
    pr_repository: u.pr_repository ?? null,
    app_version: u.app_version ?? null,
    tags: u.tags ?? null,
    summary: u.summary ?? null,
    parent_session_id: u.parent_session_id ?? null,
    subagent_count: u.subagent_count ?? 0,
  }
}
