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
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type {
  ModelMetadata,
  ModelProviderID as CoreModelProviderID,
  ModelProviderKind,
  ModelProviderSummary,
  ProviderBalanceInfo,
  ProviderTokenPlanUsageInfo,
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

export type DesktopComposerAttachmentKind =
  | 'image'
  | 'document'
  | 'text'
  | 'audio'
  | 'video'
  | 'binary'

export type DesktopComposerAttachmentStatus = 'ready' | 'error'

export type DesktopComposerAttachment = {
  id: string
  name: string
  path: string
  mediaType: string
  sizeBytes: number
  kind: DesktopComposerAttachmentKind
  status: DesktopComposerAttachmentStatus
  error?: string
  contentBase64?: string
  previewDataUrl?: string
  textContent?: string
  truncated?: boolean
}

export type DesktopUserMessageInput = {
  text: string
  attachments?: DesktopComposerAttachment[]
}

export type DesktopUserMessageContent = string | ContentBlockParam[]

export type DesktopDiffSummary = {
  patch: string
}

export type DesktopGitFileChange = {
  path: string
  originalPath?: string
  status: string
  stagedStatus: string
  unstagedStatus: string
  additions: number | null
  deletions: number | null
  isUntracked: boolean
}

export type DesktopGitStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: DesktopGitFileChange[]
}

export type DesktopGitStatusResult =
  | { ok: true; status: DesktopGitStatus }
  | { ok: false; error: string }

export type CreateBranchInput = {
  workspacePath: string
  branchName: string
  startPoint?: string
}

export type CommitChangesInput = {
  workspacePath: string
  message: string
  paths: string[]
}

export type PushBranchInput = {
  workspacePath: string
  setUpstream?: boolean
  forceWithLease?: boolean
}

export type CreatePullRequestInput = {
  workspacePath: string
  title: string
  body?: string
  draft?: boolean
}

export type DesktopGitWorkspaceResult =
  | { ok: true; workspace: DesktopWorkspace; status: DesktopGitStatus }
  | { ok: false; error: string }

export type DesktopGitOperationResult =
  | { ok: true; status: DesktopGitStatus; output?: string }
  | { ok: false; error: string }

export type DesktopPullRequestResult =
  | { ok: true; url: string; output?: string }
  | { ok: false; error: string }

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
  modelConfigured: boolean
  configurationMessage?: string
  models: string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  error?: string
}

export type DesktopProviderModelListResult = {
  models: string[]
  error?: string
}

export type DesktopProviderBalanceInfo = ProviderBalanceInfo
export type DesktopProviderTokenPlanUsageInfo = ProviderTokenPlanUsageInfo

export type DesktopProviderBalanceResult = {
  isAvailable: boolean
  balances: DesktopProviderBalanceInfo[]
  tokenPlanUsages?: DesktopProviderTokenPlanUsageInfo[]
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
  smallFastModel: string
  fastModel: string
  defaultModel: string
  deepModel: string
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
  fontSizes: {
    code: number
    ui: number
  }
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
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
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
  workflowEvents?: DesktopWorkflowEvent[]
  workflowEventModelVersion?: 1
  updatedAt: string
}

export type DesktopSessionMetadataPatch = {
  pinnedAt?: string | null
  archivedAt?: string | null
}

export type DesktopAgentEvent = AgentRuntimeEvent

export type DesktopWorkflowEvent = ThreadEvent

export type CreateDesktopSessionOptions = {
  workspacePath?: string
  permissionMode?: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
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
  deleteProviderApiKey(
    providerID: ModelProviderID,
  ): Promise<DesktopModelProviderState>
  chooseWorkspace(): Promise<DesktopWorkspace | null>
  openWorkspace(workspacePath: string): Promise<DesktopWorkspace>
  getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace>
  checkoutWorkspaceBranch(
    workspacePath: string,
    branchName: string,
  ): Promise<DesktopWorkspace>
  getWorkspaceGitStatus(workspacePath: string): Promise<DesktopGitStatusResult>
  createWorkspaceBranch(
    input: CreateBranchInput,
  ): Promise<DesktopGitWorkspaceResult>
  commitWorkspaceChanges(
    input: CommitChangesInput,
  ): Promise<DesktopGitOperationResult>
  pushWorkspaceBranch(
    input: PushBranchInput,
  ): Promise<DesktopGitOperationResult>
  createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<DesktopPullRequestResult>
  listWorkspaceFiles(workspacePath: string): Promise<DesktopFileEntry[]>
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<DesktopFilePreview>
  readOptionalWorkspaceFile(
    workspacePath: string,
    filePath: string,
  ): Promise<DesktopFilePreview | null>
  chooseComposerFiles(): Promise<DesktopComposerAttachment[]>
  readComposerFiles(filePaths: string[]): Promise<DesktopComposerAttachment[]>
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
  readWorkflowEventLog(): Promise<DesktopWorkflowEvent[]>
  openExternalURL(url: string): Promise<void>
  sendUserMessage(
    sessionId: string,
    content: DesktopUserMessageInput,
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
  onWorkflowEvent(callback: (event: DesktopWorkflowEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
}
