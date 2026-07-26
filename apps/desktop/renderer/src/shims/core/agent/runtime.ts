export type { AgentPermissionRequest } from './permissions.js'

export type AgentWorkspace = {
  id?: string
  name: string
  path: string
  branch?: string | null
  branchName?: string | null
  branches?: string[]
  isGitRepo?: boolean
  isStandalone?: boolean
  lastOpenedAt?: string | null
}

export type AgentSessionStatus =
  | 'idle'
  | 'queued'
  | 'waiting'
  | 'running'
  | 'done'
  | 'error'
  | 'interrupted'

export type AgentThinkingMode = 'default' | 'enabled' | 'adaptive' | 'disabled'

export type AgentContextUsage = {
  provider?: string
  model?: string
  usedTokens: number
  totalTokens?: number
  contextWindow?: number
  remainingTokens?: number
  usedPercent?: number
  remainingPercent?: number
  promptCacheReadTokens?: number
  promptCacheWriteTokens?: number
  promptUncachedTokens?: number
  reasoningTokens?: number
  percentUsed?: number
}

export type AgentToolLogEntry = {
  id?: string
  kind?: string
  toolName?: string
  summary?: string
  input?: unknown
  output?: unknown
  error?: string
  isError?: boolean
  expanded?: boolean
  createdAt?: string
  [key: string]: any
}

export type AgentSessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt?: string
  streaming?: boolean
  metadata?: Record<string, unknown>
}

export type AgentSessionEventType =
  | 'message'
  | 'assistant_delta'
  | 'tool_call'
  | 'tool_result'
  | 'permission_request'
  | 'file_patch'
  | 'checkpoint'
  | 'error'
  | 'proposed_plan'
  | string

export type AgentSessionEvent = any

export type AgentRuntimeEvent = any
