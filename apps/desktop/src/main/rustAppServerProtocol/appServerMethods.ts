import type {
  Thread,
  ThreadStartParams as GeneratedThreadStartParams,
  ThreadStartResponse,
  Turn,
  UserInput,
} from './generated/v2/index.js'

export type ThreadStartParams = GeneratedThreadStartParams & {
  permissions?: string | null
}

export type ThreadResumeParams = {
  threadId: string
  model?: string | null
  modelProvider?: string | null
  serviceTier?: string | null
  cwd?: string | null
  approvalPolicy?: string | null
  approvalsReviewer?: string | null
  sandbox?: string | null
  permissions?: string | null
  config?: Record<string, unknown> | null
  baseInstructions?: string | null
  developerInstructions?: string | null
  personality?: string | null
  collaborationMode?: Record<string, unknown> | null
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

export type ThreadCompactStartParams = { threadId: string }
export type ThreadCompactStartResponse = Record<string, never>
export type ThreadRollbackParams = { threadId: string; numTurns: number }
export type ThreadRollbackResponse = { thread: Thread }

export type ThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type ThreadGoal = {
  threadId: string
  objective: string
  status: ThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export type ThreadGoalSetParams = {
  threadId: string
  objective?: string | null
  status?: ThreadGoalStatus | null
  tokenBudget?: number | null
}
export type ThreadGoalSetResponse = { goal: ThreadGoal }
export type ThreadGoalGetParams = { threadId: string }
export type ThreadGoalGetResponse = { goal: ThreadGoal | null }
export type ThreadGoalClearParams = { threadId: string }
export type ThreadGoalClearResponse = { cleared: boolean }
export type ThreadGoalUpdatedNotification = {
  threadId: string
  turnId: string | null
  goal: ThreadGoal
}
export type ThreadGoalClearedNotification = { threadId: string }

export type ThreadSettings = {
  cwd: string
  approvalPolicy: string
  approvalsReviewer: string
  sandboxPolicy: Record<string, unknown>
  activePermissionProfile: { id: string; extends: string | null } | null
  model: string
  modelProvider: string
  serviceTier: string | null
  effort: string | null
  summary: string | null
  collaborationMode: Record<string, unknown>
  multiAgentMode: 'explicitRequestOnly' | 'proactive' | null
  personality: string | null
}
export type ThreadSettingsUpdatedNotification = {
  threadId: string
  threadSettings: ThreadSettings
}

export type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title: string | null }
  | { type: 'custom'; instructions: string }
export type ReviewStartParams = {
  threadId: string
  target: ReviewTarget
  delivery?: 'inline' | 'detached' | null
}
export type ReviewStartResponse = { turn: Turn; reviewThreadId: string }
