export type SerializedMessage = {
  type?: string
  message?: unknown
  cwd?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  parentUuid?: string | null
  isSidechain?: boolean
  userType?: string
  version?: string
  gitBranch?: string
  [key: string]: unknown
}

export type LogOption = {
  date: string
  messages: SerializedMessage[]
  fullPath?: string
  value: number
  created: Date
  modified: Date
  firstPrompt: string
  messageCount: number
  fileSize?: number
  isSidechain: boolean
  isLite?: boolean
  sessionId?: string
  teamName?: string
  agentName?: string
  agentColor?: string
  agentSetting?: string
  isTeammate?: boolean
  leafUuid?: string
  summary?: string
  customTitle?: string
  tag?: string
  gitBranch?: string
  projectPath?: string
  prNumber?: number
  prUrl?: string
  prRepository?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  contentReplacements?: unknown[]
  fileHistorySnapshots?: unknown[]
  attributionSnapshots?: unknown[]
  contextCollapseCommits?: unknown[]
  contextCollapseSnapshot?: unknown
}

export type PersistedWorktreeSession = {
  originalCwd: string
  worktreePath: string
  worktreeName: string
  worktreeBranch?: string
  originalBranch?: string
  originalHeadCommit?: string
  sessionId: string
  tmuxSessionName?: string
  hookBased?: boolean
}
