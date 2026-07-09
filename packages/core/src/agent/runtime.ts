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

export type AgentGuardianRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AgentGuardianUserAuthorization = 'unknown' | 'low' | 'medium' | 'high'
export type AgentGuardianReviewStatus =
  | 'in_progress'
  | 'approved'
  | 'denied'
  | 'timed_out'
  | 'aborted'
export type AgentGuardianReviewAction =
  | {
      type: 'command'
      source: string
      command: string
      cwd?: string
    }
  | {
      type: 'apply_patch'
      cwd?: string
      files: string[]
    }
  | {
      type: 'mcp_tool_call'
      server?: string
      toolName: string
      arguments?: unknown
    }
  | {
      type: 'request_permissions'
      permissions: unknown
      reason?: string
    }
  | {
      type: 'toolCall'
      toolName: string
      input?: Record<string, unknown>
    }

export type AgentSessionEventType =
  | 'message'
  | 'assistant_delta'
  | 'proposed_plan'
  | 'tool_call'
  | 'tool_result'
  | 'status'
  | 'permission_request'
  | 'guardian_review'
  | 'context_usage'
  | 'file_patch'
  | 'error'
  | 'checkpoint'
  | 'tool_output_delta'

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
  | {
      type: 'guardian_review'
      sessionId: string
      reviewId: string
      targetRequestId?: string
      status: AgentGuardianReviewStatus
      riskLevel?: AgentGuardianRiskLevel
      userAuthorization?: AgentGuardianUserAuthorization
      rationale?: string
      action: AgentGuardianReviewAction
      guardianRolloutPath?: string
      sourceThreadId?: string
      sourceLabel?: string
    }
  | { type: 'status'; sessionId: string; status: AgentSessionStatus }
  | {
      type: 'diff'
      sessionId: string
      filePath: string
      patch: string
      metadata?: Record<string, unknown>
      sourceThreadId?: string
      sourceLabel?: string
    }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }
  | {
      type: 'tool_output_delta'
      sessionId: string
      toolUseId: string
      toolName: string
      delta: string
    }

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
