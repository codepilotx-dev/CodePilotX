/**
 * Desktop SQLite session index adapter.
 *
 * Bridges the core SQLite session index with the desktop's
 * `DesktopSessionSnapshot` format. SQLite is the authoritative source
 * for session listing (sort, pagination, metadata). Desktop SQLite overlay
 * rows supply desktop-only UI state (pending permissions,
 * workflow events, review comments, settings overrides).
 *
 * Design:
 * - `listDesktopSessionRows()` reads all active sessions from SQLite,
 *   sorted by `recency_at_ms DESC, id DESC`.
 * - `snapshotFromSessionRow(row, overlay)` converts a SQLite row plus
 *   optional overlay into a `DesktopSessionSnapshot`.
 * - `syncDesktopSnapshotToSqlite(snapshot)` pushes a single session's
 *   metadata to SQLite (called after create, events, title, patch,
 *   delete).
 * - `ensureDesktopSessionIndex()` opens SQLite, runs backfill if needed.
 *
 * Stale path handling:
 *   If a SQLite row's transcript_path or rollout_path no longer exists
 *   on disk, it is removed from the index and a filesystem repair pass
 *   re-scans the project directory to restore valid rows.
 */

import { statSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { SessionDatabase } from '@codepilotx/core/session/sqlite/index.js'
import { listSessions, getSession } from '@codepilotx/core/session/sqlite/index.js'
import { upsertSession, touchRecencyAt, deleteSession } from '@codepilotx/core/session/sqlite/index.js'
import { backfillSessions, isBackfillComplete } from '@codepilotx/core/session/sqlite/index.js'
import type { SessionRow } from '@codepilotx/core/session/sqlite/index.js'
import { getProjectsDir, getProjectDir } from '@codepilotx/core/session/storage.js'
import type {
  DesktopSessionListItem,
  DesktopSessionSnapshot,
  DesktopWorkspace,
  DesktopSessionSettingsSnapshot,
} from '../shared/types.js'
import type { DesktopSessionOverlay } from './desktopSessionOverlayStore.js'
import { isStandaloneWorkspacePath } from './standaloneWorkspace.js'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the SQLite session index is open and populated.
 *
 * Opens the database, runs migrations, and starts backfill if it hasn't
 * completed yet. The overlays map is passed through
 * so backfill can merge desktop-only title/status/pin fields.
 */
export function ensureDesktopSessionIndex(
  overlaysById?: Map<string, DesktopSessionOverlay>,
): void {
  SessionDatabase.getInstance().open()

  if (isBackfillComplete()) return

  // Convert overlays to the SessionOverlay format expected by backfill
  const coreOverlays = overlaysById
    ? overlayMapForBackfill(overlaysById)
    : undefined
  void backfillSessions(coreOverlays).catch(() => {
    /* best-effort */
  })
}

/**
 * List all active (non-archived) desktop sessions, sorted by recency DESC.
 *
 * Returns a flat array of `DesktopSessionSnapshot` assembled from SQLite
 * rows with overlay merge. Overlay-only orphan sessions (present in
 * desktop overlays but absent from SQLite) are appended at the end.
 *
 * Stale-path cleanup is performed inline: if a SQLite row points at a
 * transcript file that no longer exists, the row is deleted and the
 * project directory is re-scanned.
 */
export function listDesktopSessionRows(
  overlaysById?: Map<string, DesktopSessionOverlay>,
): DesktopSessionSnapshot[] {
  const db = SessionDatabase.getInstance().db

  // 1. List active (non-archived) sessions from SQLite
  const sqliteResult = listSessions({
    sortKey: 'recency_at_ms',
    sortDirection: 'desc',
    pageSize: 500,
    includeEmptyPreview: true,
    archived: false,
  })

  const snapshots: DesktopSessionSnapshot[] = []
  const seenIds = new Set<string>()
  const staleIds: string[] = []

  for (const row of sqliteResult.sessions) {
    // Check for stale paths
    if (isStaleSessionRow(row)) {
      staleIds.push(row.id)
      continue
    }

    const overlay = overlaysById?.get(row.id)
    const snapshot = snapshotFromSessionRow(row, overlay)
    snapshots.push(snapshot)
    seenIds.add(row.id)
  }

  // Clean up stale rows from SQLite
  for (const staleId of staleIds) {
    deleteSession(staleId)
  }

  // 2. Repair stale paths: re-scan affected project directories
  if (staleIds.length > 0) {
    repairStaleProjects(staleIds)
  }

  // 3. Append overlay-only orphans (desktop state has them but SQLite
  //    didn't, either because backfill is still running or they are
  //    ephemeral desktop overlays).
  if (overlaysById) {
    for (const [id, overlay] of overlaysById) {
      if (seenIds.has(id)) continue
      // Skip archived overlays — don't show them in active list
      if (overlay.archivedAt) continue
      snapshots.push(snapshotFromSessionRow(null, overlay))
    }
  }

  return snapshots
}

/**
 * Convert a SQLite `SessionRow` (and optional overlay) into a
 * `DesktopSessionSnapshot`.
 *
 * Overlay fields take priority for desktop-specific metadata that isn't
 * stored in SQLite (sessionName, customTitle, workflowEvents, reviewComments,
 * settings overrides, pending permission recovery, etc.).
 *
 * If `row` is null, the snapshot is built from the overlay alone
 * (orphan path: desktop state has it, SQLite backfill hasn't caught up).
 */
export function snapshotFromSessionRow(
  row: SessionRow | null,
  overlay?: DesktopSessionOverlay,
): DesktopSessionSnapshot {
  const now = new Date().toISOString()

  // Build workspace from the available source
  const workspace: DesktopWorkspace = overlay?.workspace ?? {
    path: row?.project_path ?? '',
    name: row?.project_path
      ? basename(row.project_path)
      : overlay?.workspace?.name ?? 'Unknown',
    branchName: row?.git_branch ?? null,
    isGitRepo: row?.git_branch ? true : undefined,
  }

  const standalone = isStandaloneWorkspacePath(workspace.path)

  // Derive timestamps
  const lastMessageAt = row
    ? new Date(row.recency_at_ms).toISOString()
    : overlay?.lastMessageAt ?? now
  const createdAt = row
    ? new Date(row.created_at_ms).toISOString()
    : overlay?.createdAt ?? now
  const updatedAt = row
    ? new Date(row.updated_at_ms).toISOString()
    : overlay?.updatedAt ?? now

  // Build settings from overlay (desktop settings) or minimal defaults
  const settings: DesktopSessionSettingsSnapshot = overlay?.settings ?? {
    permissionMode: 'default',
    thinkingMode: 'default',
    additionalDirectories: [],
    enableMemory: true,
    installCodePilotXDependencies: true,
  }

  // Title priority: overlay sessionName > overlay customTitle > overlay aiTitle > SQLite title
  const sessionName = overlay?.sessionName ?? null
  const customTitle = overlay?.customTitle ?? null
  const aiTitle =
    overlay?.aiTitle ?? (row?.title ? row.title : null) ?? null

  // Build transcript/rollout paths
  const transcriptPath =
    (row?.transcript_path) ||
    (overlay?.legacyTranscriptPath) ||
    (workspace.path ? getTranscriptPath(workspace.path, overlay?.id ?? '') : '')
  const rolloutPath =
    row?.rollout_path ||
    overlay?.rolloutPath ||
    null

  // Status: overlay status takes priority (it knows about pending permissions)
  const status =
    overlay?.status === 'running' || overlay?.status === 'waiting'
      ? 'done'
      : overlay?.status ?? row?.status ?? 'idle'

  const item: DesktopSessionListItem = {
    id: row?.id ?? overlay?.id ?? '',
    appServerThreadId: overlay?.appServerThreadId ?? null,
    sessionName,
    aiTitle,
    customTitle,
    tag: null,
    summary: row?.summary ?? null,
    gitBranch: row?.git_branch ?? null,
    firstPrompt: row?.first_user_message || overlay?.firstPrompt || null,
    prNumber: row?.pr_number ?? null,
    prUrl: row?.pr_url ?? null,
    prRepository: row?.pr_repository ?? null,
    transcriptPath,
    rolloutPath: rolloutPath ?? '',
    legacyTranscriptPath: overlay?.legacyTranscriptPath ?? transcriptPath,
    source: overlay?.source ?? row?.source ?? 'user',
    parentSessionId: overlay?.parentSessionId ?? row?.parent_session_id ?? null,
    guardianRolloutPath: overlay?.guardianRolloutPath ?? null,
    fileSize: row?.file_size ?? null,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    standalone,
    pinnedAt: overlay?.pinnedAt ?? null,
    archivedAt: overlay?.archivedAt ?? null,
    unreadAt: overlay?.unreadAt ?? null,
    permissionProfile: settings.permissionProfile ?? ':workspace',
    approvalPolicy: settings.approvalPolicy ?? 'on-request',
    approvalsReviewer: settings.approvalsReviewer ?? 'user',
    permissionMode: settings.permissionMode ?? 'default',
    localRouterMode: settings.localRouterMode ?? 'off',
    collaborationMode: settings.collaborationMode,
    planModeActive: settings.planModeActive === true,
    model: row?.model ?? settings.model ?? null,
    reviewModel: settings.reviewModel ?? null,
    thinkingMode: settings.thinkingMode ?? 'default',
    hasSystemPrompt: Boolean(settings.systemPrompt),
    hasAppendSystemPrompt: Boolean(settings.appendSystemPrompt),
    additionalDirectoryCount: settings.additionalDirectories?.length ?? 0,
    status,
    lastMessageAt,
    createdAt,
  }

  return {
    appServerThreadId: item.appServerThreadId ?? null,
    item,
    workspace,
    settings,
    view: {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      contextUsage: null,
    },
    events: [],
    eventModelVersion: 1,
    workflowEvents: overlay?.workflowEvents ? [...overlay.workflowEvents] : [],
    workflowEventModelVersion: overlay?.workflowEventModelVersion ?? 1,
    reviewComments: overlay?.reviewComments ? [...overlay.reviewComments] : [],
    updatedAt,
  }
}

/**
 * Push one session's metadata to the SQLite index.
 *
 * Called after session creation, agent events, title updates, metadata
 * patches (pin/archive), and deletion. Advances `recency_at_ms`
 * monotonically via `touchRecencyAt`.
 */
export function syncDesktopSnapshotToSqlite(
  snapshot: DesktopSessionSnapshot,
): void {
  try {
    const { item, workspace, settings } = snapshot
    const now = Date.now()

    const updatedAtMs = item.lastMessageAt
      ? new Date(item.lastMessageAt).getTime()
      : now

    upsertSession({
      id: item.id,
      project_path: workspace.path,
      transcript_path: item.transcriptPath || item.rolloutPath || '',
      rollout_path: item.rolloutPath || null,
      created_at_ms: item.createdAt
        ? new Date(item.createdAt).getTime()
        : now,
      updated_at_ms: updatedAtMs,
      title: item.customTitle ?? item.aiTitle ?? item.sessionName ?? '',
      preview: item.firstPrompt ?? '',
      first_user_message: item.firstPrompt ?? '',
      source: 'desktop',
      status: item.status ?? 'active',
      pinned: item.pinnedAt ? 1 : 0,
      archived: item.archivedAt ? 1 : 0,
      session_mode: 'normal',
      model_provider: settings?.providerID,
      model: item.model ?? undefined,
      thinking_mode: item.thinkingMode,
      git_branch: item.gitBranch ?? undefined,
      message_count: 0,
      file_size: item.fileSize ?? 0,
    })
    touchRecencyAt(item.id, updatedAtMs)
  } catch {
    // SQLite not available — best-effort sync
  }
}

/**
 * Remove a session from the SQLite index entirely.
 */
export function removeSessionFromIndex(sessionId: string): void {
  try {
    deleteSession(sessionId)
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a SQLite row's transcript (or rollout) file still exists.
 */
function isStaleSessionRow(row: SessionRow): boolean {
  const paths = [row.transcript_path]
  if (row.rollout_path) paths.push(row.rollout_path)

  for (const filePath of paths) {
    if (!filePath) continue
    try {
      statSync(filePath)
      return false // at least one path exists
    } catch {
      // file doesn't exist — continue checking others
    }
  }

  // None of the paths exist
  return true
}

/**
 * Re-scan project directories that had stale sessions, looking for
 * transcript files that may have been restored or recreated.
 */
function repairStaleProjects(staleIds: string[]): void {
  const db = SessionDatabase.getInstance().db
  const projectsDir = getProjectsDir()

  // Collect unique project directories from stale IDs
  for (const id of staleIds) {
    // Look for the transcript file by scanning all project dirs
    try {
      const projectDirs = readdirSync(projectsDir, { withFileTypes: true })
      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) continue
        const dirPath = join(projectsDir, projectDir.name)
        const entries = readdirSync(dirPath, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile()) continue
          if (entry.name.startsWith(id) && entry.name.endsWith('.jsonl')) {
            // Found the transcript file — re-add it to SQLite
            const filePath = join(dirPath, entry.name)
            try {
              const { loadLogFromTranscript } =
                require('@codepilotx/core/session/storage.js') as {
                  loadLogFromTranscript: (path: string) => Promise<unknown>
                }
              // Re-add via backfill will pick it up on next sync
              // For now, just upsert with the file metadata
              const stat = statSync(filePath)
              upsertSession({
                id,
                project_path: dirPath,
                transcript_path: filePath,
                created_at_ms: stat.birthtimeMs || stat.mtimeMs,
                updated_at_ms: stat.mtimeMs,
                recency_at_ms: stat.mtimeMs,
                source: 'desktop',
                status: 'active',
                file_size: stat.size,
              })
            } catch {
              // skip
            }
            break
          }
        }
      }
    } catch {
      // skip
    }
  }
}

/**
 * Convert desktop `DesktopSessionOverlay` map to the core `SessionOverlay`
 * format expected by the backfill orchestrator.
 */
function overlayMapForBackfill(
  overlaysById: Map<string, DesktopSessionOverlay>,
): Map<string, import('@codepilotx/core/session/sqlite/index.js').SessionOverlay> {
  const result = new Map<
    string,
    import('@codepilotx/core/session/sqlite/index.js').SessionOverlay
  >()
  for (const [id, overlay] of overlaysById) {
    result.set(id, {
      id,
      title: overlay.sessionName ?? overlay.aiTitle ?? undefined,
      status: overlay.status ?? undefined,
      pinned: Boolean(overlay.pinnedAt),
      archived: Boolean(overlay.archivedAt),
      source: overlay.source ?? undefined,
      sessionMode: 'normal',
      modelProvider: overlay.settings?.providerID,
      model: overlay.settings?.model,
      thinkingMode: overlay.settings?.thinkingMode,
    })
  }
  return result
}

/**
 * Get the transcript path for a session within a workspace project.
 */
function getTranscriptPath(workspacePath: string, sessionId: string): string {
  return join(getProjectDir(workspacePath), `${sessionId}.jsonl`)
}
