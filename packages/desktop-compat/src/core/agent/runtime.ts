import type {
  AgentPermissionDecision,
  AgentPermissionPolicy,
  AgentPermissionRequest,
} from './permissions.js'

export type AgentSessionStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type AgentThinkingMode = 'default' | 'enabled' | 'adaptive' | 'disabled'

export type AgentWorkspace = {
  path: string
  name: string
  branchName?: string | null
  branches?: string[]
  isGitRepo?: boolean
  isStandalone?: boolean
}

export type AgentContextUsage = {
  model: string
  provider?: string
  contextWindow: number
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  reasoningTokens: number
  promptCacheHitTokens: number
  promptCacheMissTokens: number
  usedTokens: number
  remainingTokens: number
  usedPercent: number
  remainingPercent: number
}

export type AgentSessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
  streaming?: boolean
}

export type AgentToolLogEntry = {
  id: string
  toolName: string
  summary: string
  kind: 'start' | 'result'
  isError?: boolean
  expanded: boolean
  createdAt: string
}

export type AgentSessionEventType =
  | 'message'
  | 'assistant_delta'
  | 'proposed_plan'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'permission_request'
  | 'context_usage'
  | 'file_patch'
  | 'error'
  | 'checkpoint'

export type AgentSessionEvent = {
  id: string
  sessionId: string
  type: AgentSessionEventType
  createdAt: string
  role?: 'user' | 'assistant' | 'system'
  content?: string
  metadata?: Record<string, unknown>
  sourceThreadId?: string
  sourceLabel?: string
}

export type AgentRuntimeEvent =
  | {
      type: 'message'
      sessionId: string
      role: 'user' | 'assistant' | 'system'
      text: string
      createdAt?: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | {
      type: 'partial_message'
      sessionId: string
      text: string
      createdAt?: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | {
      type: 'proposed_plan'
      sessionId: string
      text: string
      streaming?: boolean
      createdAt?: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | { type: 'context_usage'; sessionId: string; usage: AgentContextUsage }
  | {
      type: 'thread_goal_updated'
      sessionId: string
      goal: {
        threadId: string
        objective: string
        status:
          | 'active'
          | 'paused'
          | 'blocked'
          | 'usageLimited'
          | 'budgetLimited'
          | 'complete'
        tokenBudget: number | null
        tokensUsed: number
        timeUsedSeconds: number
        createdAt: number
        updatedAt: number
      }
    }
  | { type: 'thread_goal_cleared'; sessionId: string; threadId: string }
  | {
      type: 'thread_status_changed'
      sessionId: string
      threadId: string
      status: 'running' | 'waiting' | 'idle' | 'closed'
    }
  | { type: 'session_title'; sessionId: string; title: string }
  | {
      type: 'tool_start'
      sessionId: string
      toolName: string
      summary: string
      toolUseId?: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | {
      type: 'tool_result'
      sessionId: string
      toolName: string
      summary: string
      toolUseId?: string
      isError?: boolean
      metadata?: Record<string, unknown>
      sourceThreadId?: string
      sourceLabel?: string
    }
  | {
      type: 'permission_request'
      sessionId: string
      request: AgentPermissionRequest
      sourceThreadId?: string
      sourceLabel?: string
    }
  | { type: 'status'; sessionId: string; status: AgentSessionStatus }
  | {
      type: 'diff'
      sessionId: string
      filePath: string
      patch: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }

export type AgentSessionSettings = {
  workspacePath?: string
  permissionPolicy?: AgentPermissionPolicy
  model?: string
  sessionName?: string
  thinkingMode?: AgentThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
}

export type CreateAgentSessionResult = {
  sessionId: string
  workspace: AgentWorkspace
  standalone: boolean
}

export type AgentRuntime = {
  createSession(
    settings: AgentSessionSettings,
  ): Promise<CreateAgentSessionResult>
  sendMessage(sessionId: string, content: string, model?: string): Promise<void>
  cancelSession(sessionId: string): Promise<void>
  respondToPermission(
    sessionId: string,
    requestId: string,
    decision: AgentPermissionDecision,
  ): Promise<void>
  subscribeEvents(callback: (event: AgentRuntimeEvent) => void): () => void
}
