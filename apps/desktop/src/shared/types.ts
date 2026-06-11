export type DesktopAuthStatus = {
  authenticated: boolean
  method: string
  email?: string | null
  organizationName?: string | null
}

export type DesktopWorkspace = {
  path: string
  name: string
  branchName?: string | null
  branches?: string[]
  isGitRepo?: boolean
  isStandalone?: boolean
}

export type DesktopFileEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  depth: number
}

export type DesktopFilePreview = {
  path: string
  content: string
  truncated: boolean
}

export type DesktopDiffSummary = {
  patch: string
}

export type DesktopRuntimeStatus = {
  runtimeKind: 'subprocess' | 'in-process-headless'
  agentExecutablePath: string
  agentExecutableExists: boolean
  configDirectoryPath: string
}

export type DesktopOpenTargetKind =
  | 'default-app'
  | 'file-explorer'
  | 'terminal'
  | 'editor'

export type DesktopOpenTarget = {
  id: string
  label: string
  kind: DesktopOpenTargetKind
  executablePath?: string
  command?: string
  iconDataUrl?: string
}

export type DesktopSessionStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type DesktopPermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'

export type DesktopThinkingMode =
  | 'default'
  | 'enabled'
  | 'adaptive'
  | 'disabled'

export type DesktopDrawerTab =
  | 'files'
  | 'diff'
  | 'permissions'
  | 'toolLog'
  | 'settings'

export type ModelProviderID = string

export type DesktopModelProviderKind =
  | 'anthropic'
  | 'openai-compatible'
  | 'minimax'
  | 'ai-gateway'

export type DesktopModelMetadata = {
  id: string
  name?: string
  label?: string
  description?: string
  badge?: string
  contextWindow?: number
  outputTokens?: number
  inputCost?: number
  outputCost?: number
  cacheReadCost?: number
  reasoning?: boolean
  toolCall?: boolean
  structuredOutput?: boolean
  vision?: boolean
  modalities?: {
    input: string[]
    output: string[]
  }
  catalogSources?: Array<'models.dev' | 'gateway'>
  gatewayModelId?: string
  modelsDevProviderId?: string
  modelType?: string
  tags?: string[]
}

export type DesktopModelProviderSummary = {
  providerID: ModelProviderID
  kind: DesktopModelProviderKind
  displayName: string
  baseURL?: string
  defaultModels: string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  apiKeyConfigured: boolean
  envVars?: string[]
  docURL?: string
  logoURL?: string
  npmPackage?: string
  modelsDevSource?: boolean
  gatewaySource?: boolean
  requiresBaseURL?: boolean
}

export type DesktopModelProviderState = {
  selectedProviderID: ModelProviderID
  provider: DesktopModelProviderSummary
  model: string
  baseURL?: string
  apiKeyConfigured: boolean
  apiKeySource: string | null
  models: string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  error?: string
}

export type DesktopProviderModelListResult = {
  models: string[]
  error?: string
}

export type DesktopProviderBalanceInfo = {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export type DesktopProviderBalanceResult = {
  isAvailable: boolean
  balances: DesktopProviderBalanceInfo[]
  error?: string
}

export type SaveDesktopModelProviderOptions = {
  providerID: ModelProviderID
  modelID?: string
  baseURL?: string
}

export type DesktopStoredSettings = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  drawerTab: DesktopDrawerTab
  selectedModelPreset: string
  providerID: ModelProviderID
  providerBaseURL: string
  showContextUsage: boolean
  defaultOpenTargetId: string
}

export type DesktopThemeMode = 'light' | 'dark' | 'system'

export type DesktopThemeVariant = 'light' | 'dark'

export type DesktopThemeConfigV1 = {
  codeThemeId: string
  theme: {
    accent: string
    contrast: number
    fonts: {
      code: string
      ui: string
    }
    ink: string
    opaqueWindows: boolean
    semanticColors: {
      diffAdded: string
      diffRemoved: string
      skill: string
    }
    surface: string
  }
  variant: DesktopThemeVariant
}

export type DesktopThemeSettings = {
  mode: DesktopThemeMode
  themes: Partial<Record<DesktopThemeVariant, DesktopThemeConfigV1>>
}

export type DesktopPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  alwaysAllow?: boolean
}

export type DesktopPermissionRequest = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  description: string
}

export type DesktopSessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
  streaming?: boolean
}

export type DesktopToolLogEntry = {
  id: string
  toolName: string
  summary: string
  kind: 'start' | 'result'
  isError?: boolean
  expanded: boolean
  createdAt: string
}

export type DesktopContextUsage = {
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

export type DesktopSessionListItem = {
  id: string
  sessionName: string | null
  aiTitle: string | null
  workspaceName: string
  workspacePath: string
  standalone?: boolean
  pinnedAt?: string | null
  archivedAt?: string | null
  permissionMode: DesktopPermissionMode
  model: string | null
  fallbackModel: string | null
  thinkingMode: DesktopThinkingMode
  hasSystemPrompt: boolean
  hasAppendSystemPrompt: boolean
  additionalDirectoryCount: number
  status: DesktopSessionStatus
  lastMessageAt?: string | null
  createdAt: string
}

export type DesktopSessionSettingsSnapshot = {
  permissionMode: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
}

export type DesktopSessionViewSnapshot = {
  messages: DesktopSessionMessage[]
  toolLog: DesktopToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
}

export type DesktopSessionSnapshot = {
  item: DesktopSessionListItem
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  view: DesktopSessionViewSnapshot
  updatedAt: string
}

export type DesktopSessionMetadataPatch = {
  pinnedAt?: string | null
  archivedAt?: string | null
}

export type DesktopAgentEvent =
  | { type: 'message'; sessionId: string; role: 'user' | 'assistant' | 'system'; text: string; createdAt?: string }
  | { type: 'partial_message'; sessionId: string; text: string; createdAt?: string }
  | { type: 'context_usage'; sessionId: string; usage: DesktopContextUsage }
  | { type: 'session_title'; sessionId: string; title: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; summary: string }
  | { type: 'tool_result'; sessionId: string; toolName: string; summary: string; isError?: boolean }
  | { type: 'permission_request'; sessionId: string; request: DesktopPermissionRequest }
  | { type: 'status'; sessionId: string; status: DesktopSessionStatus }
  | { type: 'diff'; sessionId: string; filePath: string; patch: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }

export type CreateDesktopSessionOptions = {
  workspacePath?: string
  permissionMode?: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
}

export type CreateDesktopSessionResult = {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
}

export type DesktopUiCommand =
  | 'newConversation'
  | 'chooseWorkspace'
  | 'refreshWorkspace'
  | 'openSettings'
  | 'logOut'

export type DesktopApi = {
  getAuthStatus(): Promise<DesktopAuthStatus>
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>
  getDesktopSettings(): Promise<DesktopStoredSettings>
  saveDesktopSettings(settings: DesktopStoredSettings): Promise<DesktopStoredSettings>
  listOpenTargets(): Promise<DesktopOpenTarget[]>
  openPathWithDefaultTarget(targetPath: string): Promise<void>
  listModelProviders(): Promise<DesktopModelProviderSummary[]>
  getModelProviderState(): Promise<DesktopModelProviderState>
  fetchProviderModels(options: {
    providerID: ModelProviderID
    apiKey?: string
    baseURL?: string
  }): Promise<DesktopProviderModelListResult>
  fetchProviderBalance(options: {
    providerID: ModelProviderID
    apiKey?: string
    baseURL?: string
  }): Promise<DesktopProviderBalanceResult>
  saveModelProvider(
    options: SaveDesktopModelProviderOptions,
  ): Promise<DesktopModelProviderState>
  saveProviderApiKey(
    providerID: ModelProviderID,
    apiKey: string,
  ): Promise<DesktopModelProviderState>
  chooseWorkspace(): Promise<DesktopWorkspace | null>
  openWorkspace(workspacePath: string): Promise<DesktopWorkspace>
  getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace>
  checkoutWorkspaceBranch(
    workspacePath: string,
    branchName: string,
  ): Promise<DesktopWorkspace>
  listWorkspaceFiles(workspacePath: string): Promise<DesktopFileEntry[]>
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<DesktopFilePreview>
  getWorkspaceDiff(workspacePath: string): Promise<DesktopDiffSummary>
  getThemeSettings(): Promise<DesktopThemeSettings>
  saveThemeSettings(settings: DesktopThemeSettings): Promise<void>
  createSession(options: CreateDesktopSessionOptions): Promise<CreateDesktopSessionResult>
  listSessions(): Promise<DesktopSessionSnapshot[]>
  getActiveSessionId(): Promise<string | null>
  setActiveSession(sessionId: string | null): Promise<void>
  updateSessionMetadata(
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ): Promise<DesktopSessionSnapshot>
  openExternalURL(url: string): Promise<void>
  sendUserMessage(
    sessionId: string,
    content: string,
    model?: string,
  ): Promise<void>
  respondToPermission(
    sessionId: string,
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  interruptSession(sessionId: string): Promise<void>
  disposeSession(sessionId: string): Promise<void>
  minimizeWindow(): Promise<void>
  toggleWindowMaximized(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  newWindow(): Promise<void>
  openSettings(): Promise<void>
  logOut(): Promise<void>
  exitApp(): Promise<void>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
}
