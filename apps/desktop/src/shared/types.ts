import type {
  AgentContextUsage,
  AgentRuntimeEvent,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionMessage,
  AgentSessionStatus,
  AgentThinkingMode,
  AgentToolLogEntry,
  AgentWorkspace,
} from '@codepilotx/core/agent/runtime.js'
import type {
  AgentPermissionDecision,
  AgentPermissionRequest,
  DesktopAgentPermissionMode,
} from '@codepilotx/core/agent/permissions.js'
import type {
  ModelMetadata,
  ModelProviderID as CoreModelProviderID,
  ModelProviderKind,
  ModelProviderSummary,
  ProviderBalanceInfo,
} from '@codepilotx/core/models/provider.js'

export type DesktopAuthStatus = {
  authenticated: boolean
  method: string
  email?: string | null
  organizationName?: string | null
}

export type DesktopWorkspace = AgentWorkspace

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
  runtimeKind: 'subprocess' | 'in-process-headless' | 'embedded-headless'
  runtimePreference: 'auto' | 'embedded-headless' | 'subprocess'
  runtimeSelectionSource: 'default' | 'env'
  agentExecutablePath: string
  agentExecutableExists: boolean
  subprocessFallbackAvailable: boolean
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

export type DesktopSessionStatus = AgentSessionStatus

export type DesktopPermissionMode = DesktopAgentPermissionMode

export type DesktopThinkingMode = AgentThinkingMode

export type DesktopDrawerTab =
  | 'files'
  | 'diff'
  | 'permissions'
  | 'toolLog'
  | 'settings'

export type ModelProviderID = CoreModelProviderID

export type DesktopModelProviderKind = ModelProviderKind

export type DesktopModelMetadata = ModelMetadata

export type DesktopModelProviderSummary = ModelProviderSummary

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

export type DesktopProviderBalanceInfo = ProviderBalanceInfo

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
  gitBranchPrefix: string
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
}

export type DesktopMcpScope =
  | 'local'
  | 'user'
  | 'project'
  | 'dynamic'
  | 'enterprise'
  | 'claudeai'
  | 'managed'

export type DesktopEditableMcpScope = 'local' | 'user' | 'project'

export type DesktopMcpTransport = 'stdio' | 'sse' | 'http' | 'ws' | 'sdk' | string

export type DesktopMcpServerConfig = Record<string, unknown>

export type DesktopMcpServerListItem = {
  name: string
  scope: DesktopMcpScope
  type: DesktopMcpTransport
  summary: string
  enabled: boolean
  editable: boolean
  removable: boolean
  config: DesktopMcpServerConfig
}

export type SaveDesktopMcpServerOptions = {
  originalName?: string
  name: string
  scope: DesktopEditableMcpScope
  config: DesktopMcpServerConfig
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

export type DesktopThemeCustomTheme = {
  id: string
  label: string
  config: DesktopThemeConfigV1
  sourcePresetId?: string
}

export type DesktopThemeSettings = {
  mode: DesktopThemeMode
  activeThemeIds: Record<DesktopThemeVariant, string>
  customThemes: DesktopThemeCustomTheme[]
  presetOverrides: Record<string, DesktopThemeConfigV1>
}

export type DesktopPermissionDecision = AgentPermissionDecision

export type DesktopPermissionRequest = AgentPermissionRequest

export type DesktopSessionMessage = AgentSessionMessage

export type DesktopToolLogEntry = AgentToolLogEntry

export type DesktopContextUsage = AgentContextUsage

export type DesktopSessionListItem = {
  id: string
  sessionName: string | null
  aiTitle: string | null
  customTitle?: string | null
  tag?: string | null
  summary?: string | null
  gitBranch?: string | null
  firstPrompt?: string | null
  prNumber?: number | null
  prUrl?: string | null
  prRepository?: string | null
  transcriptPath?: string | null
  fileSize?: number | null
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

export type DesktopSessionEventType = AgentSessionEventType

export type DesktopSessionEvent = AgentSessionEvent

export type DesktopSessionSnapshot = {
  item: DesktopSessionListItem
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  view: DesktopSessionViewSnapshot
  events?: DesktopSessionEvent[]
  eventModelVersion?: 1
  updatedAt: string
}

export type DesktopSessionMetadataPatch = {
  pinnedAt?: string | null
  archivedAt?: string | null
}

export type DesktopAgentEvent = AgentRuntimeEvent

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

export type DesktopBuiltinPlugin = {
  id: string
  enabled: boolean
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
  listBuiltinPlugins(): Promise<DesktopBuiltinPlugin[]>
  setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<DesktopBuiltinPlugin>
  listMcpServers(): Promise<DesktopMcpServerListItem[]>
  saveMcpServer(options: SaveDesktopMcpServerOptions): Promise<DesktopMcpServerListItem[]>
  removeMcpServer(name: string, scope: DesktopEditableMcpScope): Promise<DesktopMcpServerListItem[]>
  setMcpServerEnabled(name: string, enabled: boolean): Promise<DesktopMcpServerListItem[]>
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
  getSession(sessionId: string): Promise<DesktopSessionSnapshot>
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
  openDevTools(): Promise<void>
  openSettings(): Promise<void>
  logOut(): Promise<void>
  exitApp(): Promise<void>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
}
