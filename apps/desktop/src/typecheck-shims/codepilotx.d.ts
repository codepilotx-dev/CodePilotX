declare module '@codepilotx/core/runtime/appRuntime.js' {
  export type AuthRuntime = {
    hasProfileScope(): boolean
    isClaudeAISubscriber(): boolean
    saveApiKey(apiKey: string): Promise<void>
    getAnthropicApiKey(): string | null
    getAuthTokenSource(): { source: string; hasToken: boolean }
    getOauthAccountInfo():
      | { emailAddress?: string; organizationName?: string | null }
      | undefined
    hasAnthropicApiKeyAuth(): boolean
  }

  export type CoreAccountInfo = {
    accountUuid?: string
    emailAddress?: string
    organizationUuid?: string
    organizationName?: string | null
    organizationRole?: string | null
    workspaceRole?: string | null
    displayName?: string
    hasExtraUsageEnabled?: boolean
    billingType?: string | null
    accountCreatedAt?: string
    subscriptionCreatedAt?: string
  }

  export type CoreGlobalConfig = {
    oauthAccount?: CoreAccountInfo
    [key: string]: unknown
  }

  export type ConfigRuntime = {
    enableConfigs(): void
    getGlobalConfig<T = CoreGlobalConfig>(): T
    saveGlobalConfig(
      updater: (current: CoreGlobalConfig) => CoreGlobalConfig,
    ): void
  }

  export type SettingsJson = Record<string, unknown>

  export type SettingsRuntime = {
    getSettings_DEPRECATED<T = SettingsJson>(): T | undefined
    getInitialSettings<T = SettingsJson>(): T
    getSettingsForSource(source: string): SettingsJson | undefined
    updateSettingsForSource(
      source: string,
      updater: (current: SettingsJson) => SettingsJson,
    ): void
  }

  export type AppRuntime = {
    auth: AuthRuntime
    config: ConfigRuntime
    settings: SettingsRuntime
  }

  export function configureCoreAppRuntime(nextRuntime: AppRuntime): void
  export function withCoreAppRuntime<T>(
    nextRuntime: AppRuntime,
    run: () => T,
  ): T
  export function getCoreAppRuntime(): AppRuntime | null
  export function requireCoreAppRuntime(): AppRuntime
}

declare module '@codepilotx/core/agent/runtime.js' {
  export type AgentSessionStatus =
    | 'idle'
    | 'running'
    | 'waiting'
    | 'done'
    | 'error'

  export type AgentThinkingMode =
    | 'default'
    | 'enabled'
    | 'adaptive'
    | 'disabled'

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
    streamingChunks?: string[]
    streamId?: string
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
  export type AgentGuardianUserAuthorization =
    | 'unknown'
    | 'low'
    | 'medium'
    | 'high'
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
        streamId?: string
        createdAt?: string
        sourceThreadId?: string
        sourceLabel?: string
      }
    | {
        type: 'partial_message'
        sessionId: string
        text: string
        delta?: boolean
        streamId?: string
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
        request: import('@codepilotx/core/agent/permissions.js').AgentPermissionRequest
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
    | { type: 'done'; sessionId: string }
    | { type: 'error'; sessionId: string; message: string }
    | {
        type: 'tool_output_delta'
        sessionId: string
        toolUseId: string
        toolName: string
        delta: string
      }
}

declare module '@codepilotx/core/attachments/types.js' {
  export type AttachmentKind =
    | 'image'
    | 'document'
    | 'text'
    | 'audio'
    | 'video'
    | 'binary'

  export type Attachment = {
    kind: AttachmentKind
    name: string
    path: string
    mediaType: string
    sizeBytes: number
    contentBase64?: string
    textContent?: string
  }

  export type UserMessage = {
    text: string
    attachments?: Attachment[]
    skillInvocation?: {
      name: string
      args?: string
      skillPath?: string
    }
  }
}

declare module '@codepilotx/core/agent/permissions.js' {
  export type CodexApprovalsReviewer = 'user' | 'auto_review'
  export type CodexSandboxMode =
    | 'read-only'
    | 'workspace-write'
    | 'danger-full-access'
  export type AgentPermissionProfile = string
  export type AgentApprovalMode =
    | 'untrusted'
    | 'on-request'
    | 'on-failure'
    | 'never'
    | 'prompt'
    | 'auto-review'
    | 'auto-approve-edits'
    | 'bypass'
    | 'config'
    | 'plan'
  export type AgentPermissionAction =
    | 'read'
    | 'write'
    | 'shell'
    | 'network'
    | 'mcp'
  export type AgentPermissionEffect = 'allow' | 'ask' | 'deny'
  export type AgentSandboxPolicy = AgentPermissionProfile
  export type AgentPermissionActionScopes = Partial<
    Record<AgentPermissionAction, AgentPermissionEffect>
  >
  export type AgentToolPermissionOverrides = Record<
    string,
    AgentPermissionActionScopes
  >
  export type AgentPermissionPolicy = {
    profile: AgentPermissionProfile
    approvalMode: AgentApprovalMode
    approvalsReviewer?: CodexApprovalsReviewer
    sandboxMode?: CodexSandboxMode
    sandboxPolicy?: AgentSandboxPolicy
    actionScopes?: AgentPermissionActionScopes
    toolOverrides?: AgentToolPermissionOverrides
  }
  export type AgentPermissionDecision = {
    behavior: 'allow' | 'deny'
    message?: string
    alwaysAllow?: boolean
    updatedInput?: Record<string, unknown>
  }
  export type AgentPermissionRequest = {
    requestId: string
    toolName: string
    toolUseId?: string
    input: Record<string, unknown>
    description: string
    profile?: AgentPermissionProfile
    approvalMode?: AgentApprovalMode
    approvalsReviewer?: CodexApprovalsReviewer
    requestKind?:
      | 'shell-command'
      | 'file-write'
      | 'network'
      | 'sandbox-escalation'
      | 'full-access'
      | 'tool'
    autoReviewFallbackReason?: string
  }
  export type DesktopAgentPermissionMode =
    | 'default'
    | 'auto-review'
    | 'full-access'
    | 'custom'
  export const DESKTOP_AGENT_PERMISSION_MODES: readonly DesktopAgentPermissionMode[]
  export function isAgentApprovalMode(
    value: unknown,
  ): value is AgentApprovalMode
  export function isAgentPermissionProfile(
    value: unknown,
  ): value is AgentPermissionProfile
  export function isDesktopAgentPermissionMode(
    value: unknown,
  ): value is DesktopAgentPermissionMode
  export function normalizeDesktopAgentPermissionMode(
    mode: unknown,
  ): DesktopAgentPermissionMode
  export function normalizeAgentPermissionPolicy(
    policy: Partial<AgentPermissionPolicy> | undefined,
  ): AgentPermissionPolicy
  export function permissionPolicyForDesktopMode(
    mode: DesktopAgentPermissionMode | undefined,
  ): AgentPermissionPolicy
  export function resolvePermissionEffect(
    policy: AgentPermissionPolicy,
    action: AgentPermissionAction,
    toolName?: string,
  ): AgentPermissionEffect
  export function shouldPromptForPermission(
    policy: AgentPermissionPolicy,
    action: AgentPermissionAction,
    toolName?: string,
  ): boolean
}

declare module '@codepilotx/core/agent/proposedPlan.js' {
  export type ProposedPlanParseResult = {
    visibleText: string
    planText: string | null
    hasOpenPlan: boolean
    isComplete: boolean
  }
  export function extractLatestProposedPlanText(text: string): string | null
  export function stripProposedPlanBlocks(text: string): string
  export function parseProposedPlanText(text: string): ProposedPlanParseResult
}

declare module '@codepilotx/core/agent/codepilotxSessionContract.js' {
  export type CodePilotXCollaborationModeKind = 'default' | 'plan'
  export type CodePilotXCollaborationModeSettings = {
    reasoningEffort?: string | null
    developerInstructions?: string | null
  }
  export type CodePilotXCollaborationMode = {
    mode: CodePilotXCollaborationModeKind
    settings?: CodePilotXCollaborationModeSettings
  }
  export const DEFAULT_CODEPILOTX_COLLABORATION_MODE: CodePilotXCollaborationMode
  export const PLAN_CODEPILOTX_COLLABORATION_MODE: CodePilotXCollaborationMode
  export function normalizeCodePilotXCollaborationMode(
    value: unknown,
  ): CodePilotXCollaborationMode
  export function isPlanCollaborationMode(
    value: unknown,
  ): value is CodePilotXCollaborationMode
  export function planModeActiveFromCollaborationMode(value: unknown): boolean
  export function collaborationModeFromPlanModeActive(
    planModeActive: boolean | undefined,
  ): CodePilotXCollaborationMode
  export function resolveCodePilotXCollaborationMode(params: {
    collaborationMode?: unknown
    planModeActive?: boolean
  }): CodePilotXCollaborationMode
}

declare module '@codepilotx/core/agent/workflow.js' {
  import type { AgentPermissionRequest } from '@codepilotx/core/agent/permissions.js'
  import type {
    AgentContextUsage,
    AgentRuntimeEvent,
  } from '@codepilotx/core/agent/runtime.js'

  export type ThreadId = string
  export type TurnId = string
  export type TurnItemId = string
  export type WorkflowEventId = string
  export const WorkflowEventSchemaVersion: 1
  export type TurnStatus =
    | 'idle'
    | 'running'
    | 'waiting'
    | 'completed'
    | 'failed'
    | 'interrupted'
  export type TurnItemType =
    | 'user_message'
    | 'agent_message'
    | 'proposed_plan'
    | 'reasoning'
    | 'tool_call'
    | 'tool_result'
    | 'permission_request'
    | 'file_change'
    | 'error'
  export type TurnItemStatus = 'in_progress' | 'completed' | 'failed'
  export type TurnItem = {
    id: TurnItemId
    threadId: ThreadId
    turnId: TurnId
    type: TurnItemType
    status: TurnItemStatus
    createdAt: string
    updatedAt?: string
    metadata?: Record<string, unknown>
    text?: string
    streaming?: boolean
    toolName?: string
    summary?: string
    toolUseId?: string
    isError?: boolean
    request?: AgentPermissionRequest
    filePath?: string
    patch?: string
    message?: string
    code?: string
  }
  export type ThreadEvent =
    | {
        type: 'thread.started'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        createdAt: string
        metadata?: Record<string, unknown>
      }
    | {
        type: 'turn.started'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        turnId: TurnId
        createdAt: string
        input?: unknown
        metadata?: Record<string, unknown>
      }
    | {
        type: 'item.started' | 'item.updated' | 'item.completed'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        turnId: TurnId
        item: TurnItem
        createdAt: string
      }
    | {
        type: 'turn.completed'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        turnId: TurnId
        createdAt: string
        finalResponse: string
        usage?: AgentContextUsage | Record<string, unknown>
        stopReason?: string | null
        costUsd?: number
        metadata?: Record<string, unknown>
      }
    | {
        type: 'turn.failed'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        turnId: TurnId
        createdAt: string
        error: { message: string; code?: string }
      }
    | {
        type: 'turn.interrupted'
        eventId?: WorkflowEventId
        schemaVersion?: 1
        sequence?: number
        threadId: ThreadId
        turnId: TurnId
        createdAt: string
        reason?: string
      }
  export type WorkflowEventIds = {
    threadId: ThreadId
    turnId: TurnId
    now?: () => string
    itemId?: (kind: TurnItemType | string, seed?: string) => TurnItemId
    eventId?: (event: ThreadEvent, sequence?: number) => WorkflowEventId
    sequence?: () => number
  }
  export function normalizeThreadEvent(
    event: ThreadEvent,
    options?: { eventId?: string; sequence?: number },
  ): ThreadEvent
  export function createPermissionRequestDecisionEvent(params: {
    threadId: ThreadId
    turnId: TurnId
    request: AgentPermissionRequest
    behavior: 'allow' | 'deny' | 'cancel'
    createdAt?: string
    sequence?: number
    eventId?: string
  }): Extract<ThreadEvent, { type: 'item.started' | 'item.updated' | 'item.completed' }>
  export function createWorkflowId(prefix: string, seed?: string): string
  export function createThreadStartedEvent(
    threadId: ThreadId,
    metadata?: Record<string, unknown>,
    now?: () => string,
  ): Extract<ThreadEvent, { type: 'thread.started' }>
  export function createTurnStartedEvent(
    threadId: ThreadId,
    turnId: TurnId,
    input?: unknown,
    now?: () => string,
  ): Extract<ThreadEvent, { type: 'turn.started' }>
  export function agentRuntimeEventToThreadEvents(
    event: AgentRuntimeEvent,
    ids: WorkflowEventIds,
  ): ThreadEvent[]
}

declare module '@codepilotx/core/agent/codexContextDiagnostics.js' {
  import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'

  export type CodePilotXGuidanceSource = {
    path: string
    relativePath: string
    level: number
    isOverride: boolean
    contentHash: string
    summary: string
  }
  export type CodePilotXMcpServerDiagnostic = {
    name: string
    source: string
    command?: string
    args?: string[]
    url?: string
  }
  export type CodePilotXHookDiagnostic = {
    event: string
    matcher?: string
    commands: string[]
    source: string
  }
  export type CodePilotXSkillDiagnostic = {
    name: string
    description?: string
    path: string
  }
  export type CodePilotXProjectConfig = {
    approval?: string
    sandbox?: string
    projectRootMarkers?: string[]
    mcpServers?: CodePilotXMcpServerDiagnostic[]
    hooks?: CodePilotXHookDiagnostic[]
  }
  export type CodePilotXProjectConfigDiagnostics = {
    path: string | null
    config: CodePilotXProjectConfig
    ignoredProjectKeys: string[]
    diagnostics: string[]
  }
  export type CodePilotXContextDiagnostics = {
    guidanceSources: CodePilotXGuidanceSource[]
    projectConfig: CodePilotXProjectConfigDiagnostics
    permissionProfile?: AgentPermissionPolicy
    skills: CodePilotXSkillDiagnostic[]
  }
  export type CodePilotXWorkspaceTextFile = {
    path?: string
    content: string
  }
  export type CodePilotXWorkspaceFileReader = (
    relativePath: string,
  ) => Promise<CodePilotXWorkspaceTextFile | null>
  export function buildCodePilotXContextDiagnosticsFromWorkspaceFiles(options: {
    projectRoot: string
    cwd: string
    readFile: CodePilotXWorkspaceFileReader
    permissionProfile?: AgentPermissionPolicy
    skills?: CodePilotXSkillDiagnostic[]
  }): Promise<CodePilotXContextDiagnostics>
}

declare module '@codepilotx/core/agent/codexContextDiagnosticsShared.js' {
  import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'

  export type CodePilotXGuidanceSource = {
    path: string
    relativePath: string
    level: number
    isOverride: boolean
    contentHash: string
    summary: string
  }
  export type CodePilotXMcpServerDiagnostic = {
    name: string
    source: string
    command?: string
    args?: string[]
    url?: string
  }
  export type CodePilotXHookDiagnostic = {
    event: string
    matcher?: string
    commands: string[]
    source: string
  }
  export type CodePilotXSkillDiagnostic = {
    name: string
    description?: string
    path: string
  }
  export type CodePilotXProjectConfig = {
    approval?: string
    sandbox?: string
    projectRootMarkers?: string[]
    mcpServers?: CodePilotXMcpServerDiagnostic[]
    hooks?: CodePilotXHookDiagnostic[]
  }
  export type CodePilotXProjectConfigDiagnostics = {
    path: string | null
    config: CodePilotXProjectConfig
    ignoredProjectKeys: string[]
    diagnostics: string[]
  }
  export type CodePilotXContextDiagnostics = {
    guidanceSources: CodePilotXGuidanceSource[]
    projectConfig: CodePilotXProjectConfigDiagnostics
    permissionProfile?: AgentPermissionPolicy
    skills: CodePilotXSkillDiagnostic[]
  }
  export type CodePilotXWorkspaceTextFile = {
    path?: string
    content: string
  }
  export type CodePilotXWorkspaceFileReader = (
    relativePath: string,
  ) => Promise<CodePilotXWorkspaceTextFile | null>
  export function buildCodePilotXContextDiagnosticsFromWorkspaceFiles(options: {
    projectRoot: string
    cwd: string
    readFile: CodePilotXWorkspaceFileReader
    permissionProfile?: AgentPermissionPolicy
    skills?: CodePilotXSkillDiagnostic[]
  }): Promise<CodePilotXContextDiagnostics>
}

declare module '@codepilotx/core/agent/workflowView.js' {
  import type {
    AgentPermissionRequest,
    AgentSessionEvent,
    AgentSessionMessage,
    AgentSessionStatus,
  } from '@codepilotx/core/agent/runtime.js'
  import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'

  export type WorkflowToolRun = {
    id: string
    toolUseId: string
    toolName: string
    callContent: string
    resultContent: string
    callCreatedAt?: string
    resultCreatedAt?: string
    isError: boolean
    isRunning: boolean
  }
  export type WorkflowSessionViewDiagnostics = {
    duplicateEventIds: string[]
    missingToolResults: string[]
    outOfOrderSequences: Array<{ previous: number; current: number }>
  }
  export type WorkflowSessionView = {
    messages: AgentSessionMessage[]
    events: AgentSessionEvent[]
    toolRuns: WorkflowToolRun[]
    pendingPermissions: AgentPermissionRequest[]
    completedPermissionRequestIds: Set<string>
    turnStatus: AgentSessionStatus
    diagnostics: WorkflowSessionViewDiagnostics
  }
  export function deriveWorkflowSessionView(
    workflowEvents: ThreadEvent[],
    threadId?: string | null,
  ): WorkflowSessionView
}

declare module '@codepilotx/core/models/provider.js' {
  export type ModelProviderID = string
  export type ModelProviderKind =
    | 'anthropic'
    | 'anthropic-compatible'
    | 'openai-compatible'
    | 'minimax'
    | 'github-copilot'
  export type ProviderWireApi =
    | 'responses'
    | 'chat_completions'
    | 'anthropic_messages'
  export type ModelMetadata = {
    id: string
    name?: string
    label?: string
    description?: string
    badge?: string
    iconURL?: string
    contextWindow?: number
    outputTokens?: number
    inputCost?: number
    outputCost?: number
    cacheReadCost?: number
    reasoning?: boolean
    toolCall?: boolean
    structuredOutput?: boolean
    vision?: boolean
    modalities?: { input: string[]; output: string[] }
    catalogSources?: Array<'models.dev' | 'gateway'>
    gatewayModelId?: string
    modelsDevProviderId?: string
    modelType?: string
    tags?: string[]
  }
  export type ModelProviderSummary = {
    providerID: ModelProviderID
    kind: ModelProviderKind
    displayName: string
    baseURL?: string
    defaultModels: string[]
    modelMetadata?: Record<string, ModelMetadata>
    apiKeyConfigured: boolean
    envVars?: string[]
    docURL?: string
    logoURL?: string
    npmPackage?: string
    modelsDevSource?: boolean
    gatewaySource?: boolean
    requiresBaseURL?: boolean
    wireApi?: ProviderWireApi
  }
  export type ModelProviderConfig = Omit<
    ModelProviderSummary,
    'apiKeyConfigured'
  > & {
    apiKeyEnvVar?: string
  }
  export type ModelProviderState = {
    selectedProviderID: ModelProviderID
    provider: ModelProviderSummary
    model: string
    baseURL?: string
    apiKeyConfigured: boolean
    apiKeySource: string | null
    modelConfigured: boolean
    configurationMessage?: string
    models: string[]
    modelMetadata?: Record<string, ModelMetadata>
    error?: string
  }
  export function isModelProviderID(value: unknown): value is ModelProviderID
  export function createModelProviderSummary(
    provider: ModelProviderConfig,
    apiKeySource?: string | null,
  ): ModelProviderSummary
  export function createModelProviderState(params: {
    selectedProviderID: ModelProviderID
    provider: ModelProviderConfig
    model?: string
    baseURL?: string
    apiKeySource?: string | null
    models?: string[]
  }): ModelProviderState
  export type ProviderBalanceInfo = {
    currency: string
    totalBalance: string
    grantedBalance: string
    toppedUpBalance: string
  }
  export type ProviderTokenPlanUsageInfo = {
    modelName: string
    currentIntervalTotalCount: number | null
    currentIntervalRemainingCount: number | null
    currentIntervalStartTime: number | null
    currentIntervalEndTime: number | null
    currentIntervalRemainingTime: number | null
    currentIntervalStatus: number | null
    currentIntervalRemainingPercent: number | null
    currentWeeklyTotalCount: number | null
    currentWeeklyRemainingCount: number | null
    currentWeeklyStatus: number | null
    currentWeeklyRemainingPercent: number | null
    weeklyStartTime: number | null
    weeklyEndTime: number | null
    weeklyRemainingTime: number | null
    weeklyBoostPermille: number | null
  }
}

declare module '@codepilotx/core/utils/auth.js' {
  export function getAuthTokenSource(): {
    hasToken: boolean
    source: string
  }
  export function getOauthAccountInfo():
    | {
        emailAddress?: string | null
        organizationName?: string | null
      }
    | null
  export function hasAnthropicApiKeyAuth(): boolean
}

declare module '@codepilotx/core/utils/config.js' {
  export function enableConfigs(): void
}

declare module '@codepilotx/tui/utils/config.js' {
  export function enableConfigs(): void
}

declare module '@codepilotx/core/session/logs.js' {
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
    isSidechain: boolean
    isLite?: boolean
    sessionId?: string
    projectPath?: string
    gitBranch?: string
    prNumber?: number
    prUrl?: string
    prRepository?: string
    customTitle?: string
    tag?: string
    summary?: string
    fileSize?: number
  }
}

declare module '@codepilotx/core/session/storage.js' {
  export function getProjectsDir(): string
  export function getProjectDir(workspacePath: string): string
  export function loadAllProjectsMessageLogs(
    limit?: number,
    options?: { skipIndex?: boolean; initialEnrichCount?: number },
  ): Promise<import('@codepilotx/core/session/logs.js').LogOption[]>
  export function loadFullLog(
    log: import('@codepilotx/core/session/logs.js').LogOption,
  ): Promise<import('@codepilotx/core/session/logs.js').LogOption>
  export function saveAiGeneratedTitle(
    sessionId: `${string}-${string}-${string}-${string}-${string}`,
    title: string,
    transcriptPath?: string,
  ): void
}

declare module '@codepilotx/core/session/title.js' {
  export function generateSessionTitle(
    description: string,
    signal: AbortSignal,
    model: string,
  ): Promise<string | null>
}

declare module '@codepilotx/core/session/sqlite/index.js' {
  export class SessionDatabase {
    static getInstance(): SessionDatabase
    readonly db: import('better-sqlite3').Database
    open(): void
  }
  export function runMigrations(): void
  export function listSessions(
    params: import('./types.js').ListSessionsParams,
  ): import('./types.js').ListSessionsResult
  export function getSession(id: string): import('./types.js').SessionRow | undefined
  export function countSessions(
    params?: { archived?: boolean },
  ): number
  export function sessionExists(id: string): boolean
  export function upsertSession(upsert: import('./types.js').SessionUpsert): void
  export function touchRecencyAt(id: string, candidateMs?: number): void
  export function deleteSession(id: string): void
  export function backfillSessions(
    overlaysById?: Map<string, import('./backfill.js').SessionOverlay>,
  ): Promise<void>
  export function isBackfillComplete(): boolean

  export type SessionRow = import('./types.js').SessionRow
  export type SessionUpsert = import('./types.js').SessionUpsert
  export type ListSessionsParams = import('./types.js').ListSessionsParams
  export type ListSessionsResult = import('./types.js').ListSessionsResult
  export type Cursor = import('./types.js').Cursor
  export type SortKey = import('./types.js').SortKey
  export type SortDirection = import('./types.js').SortDirection
  export type SessionOverlay = import('./backfill.js').SessionOverlay
}

declare module '@codepilotx/core/utils/plugins/cache.js' {
  export function clearAllCaches(): void
}

declare module '@codepilotx/tui/headless/desktopRuntime.js' {
  export type DesktopHeadlessOutputControls = {
    injectControlResponse(message: Record<string, unknown>): void
  }
  export type DesktopHeadlessRuntime = {
    setModel(model: string | undefined): void
    setProvider(
      providerID: string | undefined,
      providerBaseURL: string | undefined,
    ): void
    setDebugConversationDump(enabled: boolean): void
    setPermissionMode(permissionMode: string | undefined): void
    setCodePilotXPermissionConfig(config: {
      permissionProfile?: string
      sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access'
      approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
      approvalsReviewer?: 'user' | 'auto_review'
    }): void
    runControlResponse(
      response: Record<string, unknown>,
      signal: AbortSignal,
    ): Promise<void>
  }
  export function createDesktopHeadlessRuntime(
    options: Record<string, unknown> & {
      onOutput?: (
        message: Record<string, unknown>,
        controls: DesktopHeadlessOutputControls,
      ) => void
    },
  ): DesktopHeadlessRuntime
  export function runDesktopHeadlessTurn(
    runtime: DesktopHeadlessRuntime,
    content: string | unknown[],
    signal: AbortSignal,
  ): Promise<void>
  export function runDesktopHeadlessControlResponse(
    runtime: DesktopHeadlessRuntime,
    response: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void>
}

declare module '@codepilotx/tui/appServer/protocol.js' {
  export type JsonRpcTurnStartResult = {
    threadId: string
    turnId: string
    eventCount: number
  }
}

declare module '@codepilotx/tui/appServer/server.js' {
  import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
  import type { JsonRpcTurnStartResult } from '@codepilotx/tui/appServer/protocol.js'

  export class JsonRpcAppServer {
    constructor(
      registry?: unknown,
      options?: {
        onThreadEvent?: (event: ThreadEvent) => void | Promise<void>
      },
    )
    startThread(params: {
      threadId?: string
      settings: unknown
    }): Promise<{
      threadId: string
      status: string
      createdAt: string
    }>
    startTurn(params: {
      threadId: string
      turnId?: string
      input: unknown
    }): Promise<JsonRpcTurnStartResult>
  }
}

declare module '@codepilotx/tui/entrypoints/sdk/controlTypes.js' {
  export type StdoutMessage = Record<string, unknown>
}

declare module '@codepilotx/tui/types/permissions.js' {
  export type PermissionMode =
    | 'default'
    | 'acceptEdits'
    | 'dontAsk'
    | 'auto'
    | 'plan'
    | 'bypassPermissions'
}

declare module '@codepilotx/tui/services/mcp/types.js' {
  export type ConfigScope =
    | 'local'
    | 'user'
    | 'project'
    | 'dynamic'
    | 'enterprise'
    | 'claudeai'
    | 'managed'

  export type McpServerConfig = Record<string, unknown> & {
    type?: string
    command?: string
    args?: string[]
    url?: string
    name?: string
  }

  export type ScopedMcpServerConfig = McpServerConfig & {
    scope: ConfigScope
    pluginSource?: string
  }

  export function McpServerConfigSchema(): {
    safeParse(value: unknown):
      | { success: true; data: McpServerConfig }
      | {
          success: false
          error: {
            issues: Array<{
              path: Array<string | number>
              message: string
            }>
          }
        }
  }
}

declare module '@codepilotx/tui/services/mcp/config.js' {
  import type {
    ConfigScope,
    ScopedMcpServerConfig,
  } from '@codepilotx/tui/services/mcp/types.js'

  export function getAllMcpConfigs(): Promise<{
    servers: Record<string, ScopedMcpServerConfig>
    errors: unknown[]
  }>
  export function addMcpConfig(
    name: string,
    config: unknown,
    scope: ConfigScope,
  ): Promise<void>
  export function removeMcpConfig(
    name: string,
    scope: ConfigScope,
  ): Promise<void>
  export function isMcpServerDisabled(name: string): boolean
  export function setMcpServerEnabled(name: string, enabled: boolean): void
}

declare module '@codepilotx/tui/utils/envUtils.js' {
  export const CODEPILOTX_CONFIG_DIR_ENV: string
  export const CODEPILOTX_CONFIG_DIR_NAME: string
  export const LEGACY_CLAUDE_CONFIG_DIR_ENV: string
}

declare module '@codepilotx/tui/utils/plans.js' {
  export function getPlanFilePath(agentId?: string): string
}

declare module '@codepilotx/tui/bootstrap/state.js' {
  export function getSdkBetas(): string[]
}

declare module '@codepilotx/tui/utils/context.js' {
  export function getContextWindowForModel(
    model: string | undefined,
    betas: string[],
  ): number
}

declare module '@codepilotx/tui/utils/settings/settings.js' {
  export function getSettings_DEPRECATED(): Record<string, unknown>
  export function updateSettingsForSource(
    source: string,
    settings: Record<string, unknown>,
  ): { error?: Error }
}

declare module '@codepilotx/tui/commands.js' {
  export type Command = {
    type: 'prompt' | 'local' | 'local-jsx'
    name: string
    description: string
    source?: string
    isHidden?: boolean
    userInvocable?: boolean
    isEnabled?: () => boolean
    userFacingName?: () => string
  }
  export function getCommands(cwd: string): Promise<Command[]>
  export function getCommandName(command: Command): string
  export function formatDescriptionWithSource(command: Command): string
}

declare module '@codepilotx/tui/plugins/bundled/index.js' {
  export function initBuiltinPlugins(): void
}

declare module '@codepilotx/tui/utils/model/model.js' {
  export function getMainLoopModel(): string
  export function parseUserSpecifiedModel(model: string): string
}

declare module '@codepilotx/tui/utils/model/providerConfig.js' {
  export function listProviderConfigs(): Promise<
    Array<import('@codepilotx/core/models/provider.js').ModelProviderSummary>
  >
  export function getProviderConfig(
    providerID: string,
  ): Promise<import('@codepilotx/core/models/provider.js').ModelProviderSummary>
  export function getSelectedProviderConfig(): {
    baseURL?: string
  }
  export function getSelectedProviderID(): string
  export function getProviderCatalogDiagnostics(): {
    modelsDev: {
      status: 'idle' | 'fulfilled' | 'rejected'
      providerCount?: number
      usableProviderCount?: number
      filteredMissingApiCount?: number
      error?: string
    }
    gateway: {
      status: 'idle' | 'fulfilled' | 'rejected'
      modelCount?: number
      error?: string
    }
    providerCount: number
    providerIds: string[]
  }
  export function isModelProviderID(value: unknown): value is string
  export function getCachedProviderModels(providerID: string): string[] | null
  export function getProviderApiKey(providerID: string): string | undefined
  export function getProviderApiKeySource(providerID: string): string | null
  export function fetchProviderModels(options: {
    providerID: string
    apiKey?: string
    baseURL?: string
  }): Promise<{
    models: string[]
    error?: string
  }>
  export function fetchProviderBalance(options: {
    providerID: string
    apiKey?: string
    baseURL?: string
  }): Promise<{
    isAvailable: boolean
    balances: import('@codepilotx/core/models/provider.js').ProviderBalanceInfo[]
    tokenPlanUsages?: import('@codepilotx/core/models/provider.js').ProviderTokenPlanUsageInfo[]
    error?: string
  }>
  export function saveSelectedProvider(options: {
    providerID: string
    modelID?: string
    baseURL?: string
  }): { error?: Error }
  export function saveProviderApiKey(
    providerID: string,
    apiKey: string,
  ): { success: boolean; warning?: string }
  export function deleteProviderApiKey(
    providerID: string,
  ): { success: boolean; warning?: string }
}

declare module '@codepilotx/core/config/env.js' {
  export const CODEPILOTX_CONFIG_DIR_ENV: string
  export const LEGACY_CLAUDE_CONFIG_DIR_ENV: string
  export const CODEPILOTX_CONFIG_DIR_NAME: string
  export const LEGACY_CLAUDE_CONFIG_DIR_NAME: string
}

declare module '@codepilotx/core/config/settings.js' {
  export function getSettings_DEPRECATED(): Record<string, unknown> | null
}

declare module '@codepilotx/core/agent/controlTypes.js' {
  export type SDKControlRequest = any
  export type SDKControlResponse = any
  export type SDKControlInitializeRequest = any
  export type SDKControlInitializeResponse = any
  export type SDKControlMcpSetServersResponse = any
  export type SDKControlPermissionRequest = any
  export type SDKControlReloadPluginsResponse = any
  export type SDKPartialAssistantMessage = any
  export type SDKPermissionDenial = any
  export type SDKRateLimitInfo = any
  export type StdinMessage = any
  export type StdoutMessage = any
}

declare module '@codepilotx/core/agent/permissionMode.js' {
  export type ExternalPermissionMode =
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'default'
    | 'dontAsk'
    | 'auto'
    | 'plan'
  export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
  export type PermissionMode = InternalPermissionMode
}

declare module '@codepilotx/core/appServer/protocol.js' {
  import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
  import type {
    ThreadEvent,
    ThreadId,
    TurnId,
    TurnItem,
  } from '@codepilotx/core/agent/workflow.js'
  import type { WorkflowSessionView } from '@codepilotx/core/agent/workflowView.js'

  export const APP_SERVER_PROTOCOL_VERSION: 1
  export const THREAD_EVENT_NOTIFICATION: 'thread/event'
  export const SESSION_SNAPSHOT_UPDATED_NOTIFICATION: 'session/snapshot.updated'
  export const APP_SERVER_METHODS: readonly string[]
  export type JsonRpcThreadRuntimeSettings = Record<string, unknown>
  export type JsonRpcThreadRuntimeState = {
    threadId: ThreadId
    status: string
    createdAt: string
    currentTurnId?: TurnId
  }
  export type JsonRpcThreadRuntimeResumeState =
    Partial<JsonRpcThreadRuntimeState> & {
      nextSequence?: number
      startedEventEmitted?: boolean
      metadata?: Record<string, unknown>
    }
  export type JsonRpcThreadRuntimeForkOptions = {
    threadId?: ThreadId
    settings?: JsonRpcThreadRuntimeSettings
    metadata?: Record<string, unknown>
  }
  export type JsonRpcInitializeResult = {
    protocolVersion: 1
    capabilities: {
      transports: ['stdio']
      methods: readonly string[]
      notifications: ['thread/event', 'session/snapshot.updated']
    }
  }
  export type JsonRpcThreadStartParams = {
    threadId?: ThreadId
    settings: JsonRpcThreadRuntimeSettings
  }
  export type JsonRpcThreadStartResult = {
    threadId: ThreadId
    status: string
    createdAt: string
  }
  export type JsonRpcThreadResumeParams = {
    threadId: ThreadId
    settings: JsonRpcThreadRuntimeSettings
    state?: JsonRpcThreadRuntimeResumeState
  }
  export type JsonRpcThreadForkParams = {
    sourceThreadId: ThreadId
    options?: JsonRpcThreadRuntimeForkOptions
  }
  export type JsonRpcTurnStartParams = {
    threadId: ThreadId
    turnId?: TurnId
    input: string | ContentBlockParam[]
    uuid?: string
    isMeta?: boolean
  }
  export type JsonRpcTurnStartResult = {
    threadId: ThreadId
    turnId: TurnId
    eventCount: number
  }
  export type JsonRpcTurnInterruptParams = {
    threadId: ThreadId
    turnId?: TurnId
  }
  export type JsonRpcTurnRollbackParams = {
    threadId: ThreadId
    turnId: TurnId
  }
  export type JsonRpcItemInjectParams = {
    threadId: ThreadId
    turnId: TurnId
    item: TurnItem
    eventType?: 'item.started' | 'item.updated' | 'item.completed'
  }
  export type JsonRpcSessionGetSnapshotParams = { threadId: ThreadId }
  export type JsonRpcSessionSnapshot = {
    threadId: ThreadId
    eventCount: number
    updatedAt: string | null
    view: WorkflowSessionView
  }
  export type JsonRpcErrorData = {
    threadId?: ThreadId
    turnId?: TurnId
    cause?: string
  }
  export function createInitializeResult(): JsonRpcInitializeResult
  export function createJsonRpcProtocolFixtures(): Record<string, unknown>
}

declare module '@codepilotx/core/appServer/server.js' {
  import type {
    ThreadEvent,
    ThreadId,
    TurnItemEvent,
  } from '@codepilotx/core/agent/workflow.js'
  import type {
    JsonRpcInitializeResult,
    JsonRpcItemInjectParams,
    JsonRpcSessionGetSnapshotParams,
    JsonRpcSessionSnapshot,
    JsonRpcThreadForkParams,
    JsonRpcThreadResumeParams,
    JsonRpcThreadRuntimeState,
    JsonRpcThreadStartParams,
    JsonRpcThreadStartResult,
    JsonRpcTurnInterruptParams,
    JsonRpcTurnRollbackParams,
    JsonRpcTurnStartParams,
    JsonRpcTurnStartResult,
  } from '@codepilotx/core/appServer/protocol.js'

  export type JsonRpcAppServerRegistry = {
    startThread(params: JsonRpcThreadStartParams): JsonRpcThreadStartResult & {
      event: ThreadEvent
    }
    resumeThread(params: JsonRpcThreadResumeParams): {
      threadId: ThreadId
      state: JsonRpcThreadRuntimeState
      event: ThreadEvent
    }
    forkThread(params: JsonRpcThreadForkParams): {
      threadId: ThreadId
      state: JsonRpcThreadRuntimeState
      event: ThreadEvent
    }
    startTurn(
      params: JsonRpcTurnStartParams,
    ): AsyncGenerator<ThreadEvent, void, unknown>
    interruptTurn(params: JsonRpcTurnInterruptParams): ThreadEvent
    rollbackTurn(params: JsonRpcTurnRollbackParams): ThreadEvent
    injectItem(params: JsonRpcItemInjectParams): TurnItemEvent
    getSessionSnapshot(
      params: JsonRpcSessionGetSnapshotParams,
    ): JsonRpcSessionSnapshot
  }
  export type JsonRpcAppServerOptions = {
    onThreadEvent?: (event: ThreadEvent) => void | Promise<void>
    onSessionSnapshotUpdated?: (
      snapshot: JsonRpcSessionSnapshot,
    ) => void | Promise<void>
  }
  export class JsonRpcAppServer {
    constructor(
      registry?: JsonRpcAppServerRegistry,
      options?: JsonRpcAppServerOptions,
    )
    initialize(): Promise<JsonRpcInitializeResult>
    startThread(params: JsonRpcThreadStartParams): Promise<JsonRpcThreadStartResult>
    resumeThread(params: JsonRpcThreadResumeParams): Promise<JsonRpcThreadStartResult>
    forkThread(params: JsonRpcThreadForkParams): Promise<JsonRpcThreadStartResult>
    startTurn(params: JsonRpcTurnStartParams): Promise<JsonRpcTurnStartResult>
    interruptTurn(params: JsonRpcTurnInterruptParams): Promise<ThreadEvent>
    rollbackTurn(params: JsonRpcTurnRollbackParams): Promise<ThreadEvent>
    injectItem(params: JsonRpcItemInjectParams): Promise<ThreadEvent>
    getSessionSnapshot(
      params: JsonRpcSessionGetSnapshotParams,
    ): Promise<JsonRpcSessionSnapshot>
  }
}

declare module '@codepilotx/core/services/mcp/types.js' {
  export type ConfigScope =
    | 'local'
    | 'user'
    | 'project'
    | 'dynamic'
    | 'enterprise'
    | 'claudeai'
    | 'managed'
  export type McpServerConfig = Record<string, unknown>
  export type ScopedMcpServerConfig = McpServerConfig & {
    scope: ConfigScope
    pluginSource?: string
  }
  export function McpServerConfigSchema(): {
    safeParse(value: unknown):
      | { success: true; data: McpServerConfig }
      | {
          success: false
          error: {
            issues: Array<{
              path: Array<string | number>
              message: string
            }>
      }
        }
  }
  export type McpJsonConfig = {
    mcpServers: Record<string, McpServerConfig>
  }
  export function McpJsonConfigSchema(): {
    safeParse(value: unknown):
      | { success: true; data: McpJsonConfig }
      | {
          success: false
          error: {
            issues: Array<{
              path: Array<string | number>
              message: string
            }>
          }
        }
  }
}

declare module '@codepilotx/core/services/mcp/configRuntime.js' {
  import type {
    McpJsonConfig,
    McpServerConfig,
    ScopedMcpServerConfig,
  } from '@codepilotx/core/services/mcp/types.js'

  export type McpServerPolicyEntry = {
    serverName?: string
    serverCommand?: string[]
    serverUrl?: string
  }

  export type McpServerConfigStore = {
    getUserMcpServers(): Record<string, McpServerConfig> | undefined
    saveUserMcpServers(
      servers: Record<string, McpServerConfig>,
    ): void | Promise<void>
    getLocalMcpServers(): Record<string, McpServerConfig> | undefined
    saveLocalMcpServers(
      servers: Record<string, McpServerConfig>,
    ): void | Promise<void>
    readMcpJsonFile(filePath: string): McpJsonConfig | null
    writeMcpJsonFile(config: McpJsonConfig, cwd: string): Promise<void>
    getEnterpriseMcpFilePath(): string
    getDisabledMcpServers(): string[]
    getEnabledMcpServers(): string[]
    saveDisabledMcpServers(disabled: string[]): void | Promise<void>
    saveEnabledMcpServers(enabled: string[]): void | Promise<void>
    isDefaultDisabledBuiltin?(name: string): boolean
  }

  export type McpServerSettingsProvider = {
    getAllowlist(): McpServerPolicyEntry[] | undefined
    getDenylist(): McpServerPolicyEntry[] | undefined
    isManagedOnly(): boolean
    isPluginOnlyLocked(): boolean
    isSourceEnabled(source: string): boolean
    getProjectApprovalStatus(serverName: string): 'approved' | 'rejected' | 'pending'
  }

  export type McpPluginServerProvider = {
    loadPluginMcpServers(): Promise<{
      servers: Record<string, ScopedMcpServerConfig>
      suppressed: Array<{ name: string; duplicateOf: string }>
    }>
  }

  export type McpClaudeAiServerProvider = {
    isEligible(): boolean
    fetchConfigs(): Promise<Record<string, ScopedMcpServerConfig>>
  }

  export type McpConfigRuntime = {
    configStore: McpServerConfigStore
    settings?: McpServerSettingsProvider
    plugins?: McpPluginServerProvider
    claudeAi?: McpClaudeAiServerProvider
    getCwd?: () => string
    logDebug?: (message: string, opts?: { level?: string }) => void
    logError?: (error: unknown) => void
  }

  export function configureMcpConfigRuntime(runtime: McpConfigRuntime): void
}

declare module '@codepilotx/core/services/mcp/config.js' {
  import type {
    ConfigScope,
    McpServerConfig,
    ScopedMcpServerConfig,
  } from '@codepilotx/core/services/mcp/types.js'

  export function getAllMcpConfigs(): Promise<{
    servers: Record<string, ScopedMcpServerConfig>
  }>
  export function addMcpConfig(
    name: string,
    config: McpServerConfig | Record<string, unknown>,
    scope: ConfigScope,
  ): Promise<void>
  export function removeMcpConfig(
    name: string,
    scope: ConfigScope,
  ): Promise<void>
  export function setMcpServerEnabled(
    name: string,
    enabled: boolean,
  ): Promise<void>
  export function isMcpServerDisabled(name: string): boolean
}

declare module '@codepilotx/core/services/oauth/githubExchange.js' {
  export type GithubExchangeInput = {
    githubAccessToken: string
    githubUser: {
      login: string
      id: number
      name?: string | null
      avatarUrl?: string | null
    }
    client: 'desktop' | 'tui'
  }

  export type GithubExchangeTokens = {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
    scopes: string[]
    subscriptionType: string | null
    rateLimitTier: string | null
    source: string
    tokenAccount?: {
      uuid?: string
      emailAddress?: string
      organizationUuid?: string
    }
  }

  export function resolveAuthBaseUrl(settingUrl?: string | null): string
  export function resolveGithubClientId(
    preferredClientId?: string | null,
  ): string
  export function exchangeGithubToken(
    input: GithubExchangeInput,
    authBaseUrl?: string | null,
  ): Promise<GithubExchangeTokens>
  export function refreshCodePilotToken(
    refreshToken: string,
    authBaseUrl?: string | null,
  ): Promise<GithubExchangeTokens>
}

	declare module '@codepilotx/core/models/context.js' {
	  export const MODEL_CONTEXT_WINDOW_DEFAULT: number
	  export function getContextWindowForModel(
	    model: string,
	    provider?: string,
	  ): number
	}

declare module '@codepilotx/core/models/providerConfig.js' {
  import type {
    ModelProviderConfig,
    ModelProviderID,
    ProviderBalanceInfo,
    ProviderTokenPlanUsageInfo,
    ProviderWireApi,
  } from '@codepilotx/core/models/provider.js'

  export type { ProviderWireApi }
  export type ProviderConfig = ModelProviderConfig
  export type ProviderConfigRuntime = {
    fetch?: typeof fetch
    env?: Record<string, string | undefined>
  }
  export function listProviderConfigs(): Promise<ModelProviderConfig[]>
  export function getProviderConfig(
    providerID: ModelProviderID,
  ): Promise<ModelProviderConfig>
  export function getSelectedProviderConfig(): ModelProviderConfig
  export function getSelectedProviderID(): ModelProviderID
  export function saveSelectedProvider(options: {
    providerID: ModelProviderID
    modelID?: string
    baseURL?: string
  }): { error?: Error }
  export function fetchProviderModels(options: {
    providerID: ModelProviderID
    apiKey?: string
    baseURL?: string
  }): Promise<{ models: string[]; error?: string }>
  export function fetchProviderBalance(options: {
    providerID: ModelProviderID
    apiKey?: string
    baseURL?: string
  }): Promise<{
    isAvailable: boolean
    balances: ProviderBalanceInfo[]
    tokenPlanUsages?: ProviderTokenPlanUsageInfo[]
    error?: string
  }>
  export function getCachedProviderModels(
    providerID: ModelProviderID,
  ): string[] | null
  export function getProviderApiKey(providerID: ModelProviderID): string | null
  export function getProviderApiKeySource(
    providerID: ModelProviderID,
  ): string | null
  export function saveProviderApiKey(
    providerID: ModelProviderID,
    apiKey: string,
  ): { success: boolean; warning?: string }
  export function deleteProviderApiKey(
    providerID: ModelProviderID,
  ): { success: boolean; warning?: string }
  export function clearProviderConfigCatalogCacheForTests(): void
  export function withProviderConfigRuntime<T>(
    runtime: ProviderConfigRuntime,
    run: () => T,
  ): T
}

declare module '@codepilotx/core/memory/state.js' {
  export const MEMORY_TYPES: readonly [
    'user',
    'feedback',
    'project',
    'reference',
  ]
  export type MemoryType = (typeof MEMORY_TYPES)[number]
  export type AutoMemoryPaths = {
    memoryBaseDir: string
    autoMemPath: string
    entrypointPath: string
    hasPathOverride: boolean
    source: 'override' | 'setting' | 'repo' | 'default'
  }
  export type RepoMemorySkeletonFile = {
    relativePath: string
    content: string
  }
  export type UserMemoryPaths = {
    memoryDir: string
    profilePath: string
    preferencesPath: string
    eventsPath: string
    conversationIndexPath: string
  }
  export function parseMemoryType(raw: unknown): MemoryType | undefined
  export function buildRepoMemorySkeleton(): RepoMemorySkeletonFile[]
  export function buildUserMemorySkeleton(): RepoMemorySkeletonFile[]
  export function parseMemoryFrontmatter(
    content: string,
  ): Record<string, string>
  export function resolveUserMemoryPaths(input: {
    configHomeDir: string
  }): UserMemoryPaths
  export function resolveAutoMemoryPaths(input: {
    configHomeDir: string
    projectRoot: string
    canonicalProjectRoot?: string | null
    remoteMemoryDir?: string
    pathOverride?: string
    trustedDirectorySetting?: string
    homeDir: string
    repoMemoryEnabled?: boolean
  }): AutoMemoryPaths
}
