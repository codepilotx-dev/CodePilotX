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
    | { type: 'status'; sessionId: string; status: AgentSessionStatus }
    | {
        type: 'diff'
        sessionId: string
        filePath: string
        patch: string
        sourceThreadId?: string
        sourceLabel?: string
      }
    | { type: 'done'; sessionId: string }
    | { type: 'error'; sessionId: string; message: string }
}

declare module '@codepilotx/core/agent/permissions.js' {
  export type AgentPermissionProfile =
    | 'read-only'
    | 'workspace-write'
    | 'danger-full-access'
  export type AgentApprovalMode =
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
    input: Record<string, unknown>
    description: string
    profile?: AgentPermissionProfile
    approvalMode?: AgentApprovalMode
  }
  export type DesktopAgentPermissionMode =
    | 'auto'
    | 'bypassPermissions'
    | 'customConfig'
    | 'default'
    | 'plan'
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

  export type CodexGuidanceSource = {
    path: string
    relativePath: string
    level: number
    isOverride: boolean
    contentHash: string
    summary: string
  }
  export type CodexMcpServerDiagnostic = {
    name: string
    source: string
    command?: string
    args?: string[]
    url?: string
  }
  export type CodexHookDiagnostic = {
    event: string
    matcher?: string
    commands: string[]
    source: string
  }
  export type CodexSkillDiagnostic = {
    name: string
    description?: string
    path: string
  }
  export type CodexProjectConfig = {
    approval?: string
    sandbox?: string
    projectRootMarkers?: string[]
    mcpServers?: CodexMcpServerDiagnostic[]
    hooks?: CodexHookDiagnostic[]
  }
  export type CodexProjectConfigDiagnostics = {
    path: string | null
    config: CodexProjectConfig
    ignoredProjectKeys: string[]
    diagnostics: string[]
  }
  export type CodexContextDiagnostics = {
    guidanceSources: CodexGuidanceSource[]
    projectConfig: CodexProjectConfigDiagnostics
    permissionProfile?: AgentPermissionPolicy
    skills: CodexSkillDiagnostic[]
  }
  export type CodexWorkspaceTextFile = {
    path?: string
    content: string
  }
  export type CodexWorkspaceFileReader = (
    relativePath: string,
  ) => Promise<CodexWorkspaceTextFile | null>
  export function buildCodexContextDiagnosticsFromWorkspaceFiles(options: {
    projectRoot: string
    cwd: string
    readFile: CodexWorkspaceFileReader
    permissionProfile?: AgentPermissionPolicy
    skills?: CodexSkillDiagnostic[]
  }): Promise<CodexContextDiagnostics>
}

declare module '@codepilotx/core/agent/codexContextDiagnosticsShared.js' {
  import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'

  export type CodexGuidanceSource = {
    path: string
    relativePath: string
    level: number
    isOverride: boolean
    contentHash: string
    summary: string
  }
  export type CodexMcpServerDiagnostic = {
    name: string
    source: string
    command?: string
    args?: string[]
    url?: string
  }
  export type CodexHookDiagnostic = {
    event: string
    matcher?: string
    commands: string[]
    source: string
  }
  export type CodexSkillDiagnostic = {
    name: string
    description?: string
    path: string
  }
  export type CodexProjectConfig = {
    approval?: string
    sandbox?: string
    projectRootMarkers?: string[]
    mcpServers?: CodexMcpServerDiagnostic[]
    hooks?: CodexHookDiagnostic[]
  }
  export type CodexProjectConfigDiagnostics = {
    path: string | null
    config: CodexProjectConfig
    ignoredProjectKeys: string[]
    diagnostics: string[]
  }
  export type CodexContextDiagnostics = {
    guidanceSources: CodexGuidanceSource[]
    projectConfig: CodexProjectConfigDiagnostics
    permissionProfile?: AgentPermissionPolicy
    skills: CodexSkillDiagnostic[]
  }
  export type CodexWorkspaceTextFile = {
    path?: string
    content: string
  }
  export type CodexWorkspaceFileReader = (
    relativePath: string,
  ) => Promise<CodexWorkspaceTextFile | null>
  export function buildCodexContextDiagnosticsFromWorkspaceFiles(options: {
    projectRoot: string
    cwd: string
    readFile: CodexWorkspaceFileReader
    permissionProfile?: AgentPermissionPolicy
    skills?: CodexSkillDiagnostic[]
  }): Promise<CodexContextDiagnostics>
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
    | 'openai-compatible'
    | 'minimax'
    | 'github-copilot'
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

declare module '@codepilotx/tui/headless/desktopRuntime.js' {
  export type DesktopHeadlessOutputControls = {
    injectControlResponse(message: Record<string, unknown>): void
  }
  export type DesktopHeadlessRuntime = {
    setModel(model: string | undefined): void
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

declare module '@codepilotx/tui/utils/plugins/cacheUtils.js' {
  export function clearAllCaches(): void
}

declare module '@codepilotx/tui/utils/model/model.js' {
  export function getMainLoopModel(): string
  export function parseUserSpecifiedModel(model: string): string
}

declare module '@codepilotx/tui/utils/sessionTitle.js' {
  export function generateSessionTitle(
    description: string,
    signal: AbortSignal,
    model: string,
  ): Promise<string | null>
}

declare module '@codepilotx/tui/utils/sessionStorage.js' {
  export function getProjectDir(workspacePath: string): string
  export function loadAllProjectsMessageLogs(
    projectPath?: string,
    options?: Record<string, unknown>,
  ): Promise<import('@codepilotx/tui/types/logs.js').LogOption[]>
  export function loadFullLog(
    log: import('@codepilotx/tui/types/logs.js').LogOption,
  ): Promise<import('@codepilotx/tui/types/logs.js').LogOption>
  export function saveAiGeneratedTitle(
    sessionId: `${string}-${string}-${string}-${string}-${string}`,
    title: string,
  ): void
}

declare module '@codepilotx/tui/types/logs.js' {
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

declare module '@codepilotx/core/agent/desktopRuntime.js' {
  import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
  import type { StdoutMessage } from '@codepilotx/core/agent/controlTypes.js'
  import type { PermissionMode } from '@codepilotx/core/agent/permissionMode.js'

  export type DesktopHeadlessThinkingMode =
    | 'default'
    | 'enabled'
    | 'adaptive'
    | 'disabled'
  export type DesktopHeadlessOutputControls = {
    injectControlResponse(response: Record<string, unknown>): void
  }
  export type DesktopHeadlessRuntimeOptions = {
    sessionId: string
    workspacePath: string
    configDirectoryPath?: string
    resumeExistingSession?: boolean
    permissionProfile?: string
    approvalPolicy?: 'untrusted' | 'on-request' | 'on-failure' | 'never'
    approvalsReviewer?: 'user' | 'auto'
    permissionMode?: PermissionMode
    model?: string
    smallFastModel?: string
    fastModel?: string
    defaultModel?: string
    deepModel?: string
    sessionName?: string
    thinkingMode?: DesktopHeadlessThinkingMode
    systemPrompt?: string
    appendSystemPrompt?: string
    additionalDirectories?: string[]
    askUserQuestionMaxQuestions?: number
    permissionPromptToolName?: string
    onOutput(
      message: StdoutMessage,
      controls: DesktopHeadlessOutputControls,
    ): Promise<void> | void
  }
  export type DesktopHeadlessRuntime = {
    setModel(model: string | undefined): void
    runUserTurn(
      content: string | ContentBlockParam[],
      signal: AbortSignal,
    ): Promise<void>
  }
  export function createDesktopHeadlessRuntime(
    options: DesktopHeadlessRuntimeOptions,
  ): DesktopHeadlessRuntime
  export function runDesktopHeadlessTurn(
    runtime: DesktopHeadlessRuntime,
    content: string | ContentBlockParam[],
    signal: AbortSignal,
  ): Promise<void>
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
  export function setMcpServerEnabled(name: string, enabled: boolean): void
  export function isMcpServerDisabled(name: string): boolean
}

declare module '@codepilotx/core/models/context.js' {
  export const MODEL_CONTEXT_WINDOW_DEFAULT: number
  export function getContextWindowForModel(model: string): number
}

declare module '@codepilotx/core/models/providerConfig.js' {
  import type {
    ModelProviderConfig,
    ModelProviderID,
    ProviderBalanceInfo,
    ProviderTokenPlanUsageInfo,
  } from '@codepilotx/core/models/provider.js'

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
}
