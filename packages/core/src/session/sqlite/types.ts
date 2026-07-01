/** Raw row shape from the `sessions` table. */
export interface SessionRow {
  id: string
  project_path: string
  transcript_path: string
  rollout_path: string | null

  created_at_ms: number
  updated_at_ms: number
  recency_at_ms: number

  title: string
  preview: string
  first_user_message: string
  message_count: number
  file_size: number

  archived: number
  archived_at_ms: number | null
  pinned: number
  status: string
  session_mode: string
  source: string
  is_sidechain: number

  model_provider: string | null
  model: string | null
  thinking_mode: string | null
  approval_mode: string | null

  git_branch: string | null
  git_sha: string | null
  git_origin_url: string | null
  pr_number: number | null
  pr_url: string | null
  pr_repository: string | null

  app_version: string | null
  tags: string | null
  summary: string | null
  parent_session_id: string | null
  subagent_count: number
}

/** Sort key for session listing. */
export type SortKey = 'created_at_ms' | 'updated_at_ms' | 'recency_at_ms'

/** Sort direction. */
export type SortDirection = 'desc' | 'asc'

/** Keyset cursor for pagination. */
export interface Cursor {
  /** Millisecond timestamp of the last-seen row. */
  ts: number
  /** Session id of the last-seen row (tiebreaker for recency sort). */
  id: string
}

/** Parameters for listing sessions. */
export interface ListSessionsParams {
  sortKey?: SortKey
  sortDirection?: SortDirection
  cursor?: Cursor
  pageSize?: number
  archived?: boolean
  projectPath?: string
  searchTerm?: string
  allowedSources?: string[]
  includeEmptyPreview?: boolean
}

/** Result of a paginated list call. */
export interface ListSessionsResult {
  sessions: SessionRow[]
  nextCursor: Cursor | null
  hasMore: boolean
}

/** Fields that can be upserted into the sessions table. */
export interface SessionUpsert {
  id: string
  project_path: string
  transcript_path: string
  rollout_path?: string | null

  created_at_ms: number
  updated_at_ms: number
  recency_at_ms?: number

  title?: string
  preview?: string
  first_user_message?: string
  message_count?: number
  file_size?: number

  archived?: number
  archived_at_ms?: number | null
  pinned?: number
  status?: string
  session_mode?: string
  source?: string
  is_sidechain?: number

  model_provider?: string | null
  model?: string | null
  thinking_mode?: string | null
  approval_mode?: string | null

  git_branch?: string | null
  git_sha?: string | null
  git_origin_url?: string | null
  pr_number?: number | null
  pr_url?: string | null
  pr_repository?: string | null

  app_version?: string | null
  tags?: string | null
  summary?: string | null
  parent_session_id?: string | null
  subagent_count?: number
}
