import type {
  Thread,
  ThreadStartResponse,
  UserInput,
} from './generated/v2/index.js'

export type ThreadResumeParams = {
  threadId: string
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  cwd?: string | null
  approvalPolicy?: string | null
  approvalsReviewer?: string | null
  sandbox?: string | null
  config?: Record<string, unknown> | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  personality?: string | null
}

export type ThreadResumeResponse = ThreadStartResponse

export type ThreadSortKey = 'created_at' | 'updated_at' | 'recency_at'
export type SortDirection = 'asc' | 'desc'
export type ThreadSourceKind = string

export type ThreadListParams = {
  cursor?: string | null
  limit?: number | null
  sortKey?: ThreadSortKey | null
  sortDirection?: SortDirection | null
  modelProviders?: Array<string> | null
  sourceKinds?: Array<ThreadSourceKind> | null
  archived?: boolean | null
  cwd?: string | Array<string> | null
  useStateDbOnly?: boolean
  searchTerm?: string | null
}

export type ThreadListResponse = {
  data: Array<Thread>
  nextCursor: string | null
  backwardsCursor: string | null
}

export type ThreadReadParams = {
  threadId: string
  includeTurns?: boolean
}

export type ThreadReadResponse = { thread: Thread }
export type ThreadArchiveParams = { threadId: string }
export type ThreadArchiveResponse = Record<string, never>
export type ThreadUnarchiveParams = { threadId: string }
export type ThreadUnarchiveResponse = { thread: Thread }
export type ThreadDeleteParams = { threadId: string }
export type ThreadDeleteResponse = Record<string, never>
export type ThreadSetNameParams = { threadId: string; name: string }
export type ThreadSetNameResponse = Record<string, never>

export type ThreadSettingsUpdateParams = {
  threadId: string
  cwd?: string | null
  approvalPolicy?: string | null
  approvalsReviewer?: string | null
  sandboxPolicy?: Record<string, unknown> | null
  permissions?: string | null
  model?: string | null
  serviceTier?: string | null
  effort?: string | null
  summary?: string | null
  collaborationMode?: Record<string, unknown> | null
  multiAgentMode?: 'explicitRequestOnly' | 'proactive' | null
  personality?: string | null
}

export type ThreadSettingsUpdateResponse = Record<string, never>

export type TurnSteerParams = {
  threadId: string
  clientUserMessageId?: string | null
  input: Array<UserInput>
  expectedTurnId: string
}

export type TurnSteerResponse = { turnId: string }
