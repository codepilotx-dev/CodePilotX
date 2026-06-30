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
import type { CodexCollaborationMode } from '@codepilotx/core/agent/codexSessionContract.js'
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

export type DesktopReviewScope = 'unstaged' | 'staged'

export type DesktopReviewSide = 'left' | 'right'

export type DesktopReviewLineType = 'added' | 'removed' | 'context' | 'meta'

export type DesktopReviewDiffLine = {
  id: string
  type: DesktopReviewLineType
  oldLine: number | null
  newLine: number | null
  content: string
  raw: string
}

export type DesktopReviewDiffHunk = {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
  lines: DesktopReviewDiffLine[]
}

export type DesktopReviewDiffFile = {
  path: string
  originalPath?: string
  status: string
  additions: number
  deletions: number
  isUntracked: boolean
  hunks: DesktopReviewDiffHunk[]
}

export type DesktopReviewScopeSummary = {
  scope: DesktopReviewScope
  changedFiles: number
  additions: number
  deletions: number
}

export type DesktopReviewDiffInput = {
  workspacePath: string
  scope?: DesktopReviewScope
}

export type DesktopReviewDiffResult = {
  scopes: DesktopReviewScopeSummary[]
  activeScope: DesktopReviewScope
  files: DesktopReviewDiffFile[]
  status: DesktopGitStatus
}

export type DesktopReviewOperationAction = 'stage' | 'unstage' | 'revert'

export type DesktopReviewOperationTarget =
  | { type: 'file'; path: string }
  | { type: 'hunk'; path: string; hunkId: string }

export type DesktopReviewOperationInput = {
  workspacePath: string
  scope: DesktopReviewScope
  action: DesktopReviewOperationAction
  target: DesktopReviewOperationTarget
}

export type DesktopReviewOperationResult =
  | { ok: true; status: DesktopGitStatus; reviewDiff: DesktopReviewDiffResult; output?: string }
  | { ok: false; error: string }

export type DesktopReviewCommentStatus = 'open' | 'resolved'

export type DesktopReviewComment = {
  id: string
  sessionId: string
  filePath: string
  side: DesktopReviewSide
  lineNumber: number
  lineContent: string
  body: string
  status: DesktopReviewCommentStatus
  createdAt: string
  updatedAt: string
}

export type SaveSessionReviewCommentInput = {
  sessionId: string
  comment:
    | Omit<DesktopReviewComment, 'id' | 'sessionId' | 'status' | 'createdAt' | 'updatedAt'>
    | DesktopReviewComment
}

export type SessionReviewCommentInput = {
  sessionId: string
  commentId: string
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

export type DiscardWorkspaceChangesInput = {
  workspacePath: string
  paths: string[]
  includeUntracked?: boolean
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
  toolchainEnabled: boolean
  toolchainRoot: string | null
  managedToolchainRoot: string
  packagedToolchainRoot: string
  toolchainPathEntries: string[]
  toolchainBinaries: DesktopRuntimeBinaryStatus[]
}

export type DesktopRuntimeBinaryName = 'node' | 'npm' | 'npx' | 'python' | 'pip'

export type DesktopRuntimeBinarySource =
  | 'managed'
  | 'packaged'
  | 'system'
  | 'missing'

export type DesktopRuntimeBinaryStatus = {
  name: DesktopRuntimeBinaryName
  source: DesktopRuntimeBinarySource
  path: string | null
  exists: boolean
  targetVersion?: string
  version: string | null
  error?: string
}

export type DesktopToolchainDiagnosticReport = {
  enabled: boolean
  root: string | null
  managedRoot: string
  packagedRoot: string
  pathEntries: string[]
  binaries: DesktopRuntimeBinaryStatus[]
  logPath?: string
}

export type DesktopToolchainInstallResult =
  | {
      ok: true
      root: string
      copiedFrom: string | null
      diagnostics: DesktopToolchainDiagnosticReport
    }
  | { ok: false; error: string; diagnostics: DesktopToolchainDiagnosticReport }

export type DesktopBrowserBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type DesktopBrowserState = {
  open: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  allowedSites: string[]
  sitePermissions: DesktopBrowserSitePermission[]
}

export type DesktopBrowserSitePermission = {
  origin: string
  decision: 'allow' | 'deny'
  updatedAt: string
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

export type DesktopPermissionProfile = string

export type DesktopApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'

export type DesktopApprovalsReviewer = 'user' | 'auto_review'

export type DesktopCollaborationMode = CodexCollaborationMode

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

export type DesktopCopilotAuthStatus = {
  authenticated: boolean
  user?: string | null
  method?: string | null
  error?: string
}

export type DesktopCopilotLoginState =
  | 'idle'
  | 'starting'
  | 'awaiting_auth'
  | 'completed'
  | 'failed'

export type DesktopCopilotLoginStatus = {
  state: DesktopCopilotLoginState
  deviceCode: string | null
  verificationUrl: string | null
  error: string | null
  auth: DesktopCopilotAuthStatus | null
  elapsedMs: number
}

export type DesktopGithubUser = {
  login: string
  id: number
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
}

export type DesktopGithubAuthStatus = {
  configured: boolean
  authenticated: boolean
  user: DesktopGithubUser | null
  error?: string
}

export type DesktopGithubLoginState =
  | 'idle'
  | 'starting'
  | 'awaiting_auth'
  | 'completed'
  | 'failed'

export type DesktopGithubLoginStatus = {
  state: DesktopGithubLoginState
  userCode: string | null
  verificationUri: string | null
  expiresAt: string | null
  error: string | null
  auth: DesktopGithubAuthStatus | null
  elapsedMs: number
}

export type StartGithubLoginInput = {
  clientId?: string
}

export type DesktopGithubRepository = {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
  fork: boolean
  archived: boolean
  disabled: boolean
  cloneUrl: string
  sshUrl: string
  htmlUrl: string
  description: string | null
  defaultBranch: string
  pushedAt: string | null
  updatedAt: string | null
}

export type DesktopGithubRepositoryListResult =
  | { ok: true; repositories: DesktopGithubRepository[] }
  | { ok: false; error: string }

export type CloneGithubRepositoryInput = {
  repository: DesktopGithubRepository
}

export type DesktopGithubCloneResult =
  | { ok: true; workspace: DesktopWorkspace }
  | { ok: false; error: string }

export type DesktopGithubProfileRepository = {
  id: string
  name: string
  fullName: string
  url: string
  description: string | null
  isPrivate: boolean
  isFork: boolean
  primaryLanguage: {
    name: string
    color: string | null
  } | null
  stargazerCount: number
  forkCount: number
  updatedAt: string
}

export type DesktopGithubContributionDay = {
  date: string
  count: number
  color: string
}

export type DesktopGithubContributionWeek = {
  days: DesktopGithubContributionDay[]
}

export type DesktopGithubUserStatus = {
  emoji: string | null
  message: string | null
  indicatesLimitedAvailability: boolean
  expiresAt: string | null
}

export type DesktopGithubUserStatusInput = {
  emoji: string
  message: string
  limitedAvailability: boolean
  expiresAt?: string | null
}

export type DesktopGithubUserStatusResult =
  | { ok: true; status: DesktopGithubUserStatus | null }
  | { ok: false; error: string }

export type DesktopGithubProfileOverview = {
  user: DesktopGithubUser & {
    bio: string | null
    company: string | null
    location: string | null
    websiteUrl: string | null
    email: string | null
    followers: number
    following: number
    repositoryCount: number
    starredRepositoryCount: number
    status: DesktopGithubUserStatus | null
  }
  organizations: Array<{
    login: string
    avatarUrl: string
    url: string
  }>
  pinnedRepositories: DesktopGithubProfileRepository[]
  popularRepositories: DesktopGithubProfileRepository[]
  contributions: {
    totalContributions: number
    totalCommitContributions: number
    totalIssueContributions: number
    totalPullRequestContributions: number
    totalPullRequestReviewContributions: number
    restrictedContributionsCount: number
    weeks: DesktopGithubContributionWeek[]
  }
}

export type DesktopGithubProfileOverviewResult =
  | { ok: true; overview: DesktopGithubProfileOverview }
  | { ok: false; error: string }

export type SaveDesktopModelProviderOptions = {
  providerID: ModelProviderID
  modelID?: string
  baseURL?: string
}

export type LocalRouterMode = 'off' | 'pareto-code' | 'fusion'

export const LOCAL_ROUTER_MODES = ['off', 'pareto-code', 'fusion'] as const

export function isLocalRouterMode(value: unknown): value is LocalRouterMode {
  return (
    typeof value === 'string' &&
    (LOCAL_ROUTER_MODES as readonly string[]).includes(value)
  )
}

export function normalizeLocalRouterMode(
  value: unknown,
  fallback: LocalRouterMode = 'off',
): LocalRouterMode {
  return isLocalRouterMode(value) ? value : fallback
}

export type DesktopSandboxMode =
  | 'read-only'
  | 'workspace-write'
  | 'full-access'
  | 'danger-full-access'

export type DesktopPersonality =
  | 'pragmatic'
  | 'friendly'
  | 'concise'
  | 'encouraging'

export type DesktopReviewView = 'inline' | 'split'
export type DesktopDiffMarkerStyle = 'color' | 'symbol'

export type DesktopStoredSettings = {
  enableParetoCodeRouter?: boolean
  enableFusionRouter?: boolean
  permissionProfile?: DesktopPermissionProfile
  approvalPolicy?: DesktopApprovalPolicy
  approvalsReviewer?: DesktopApprovalsReviewer
  permissionMode: DesktopPermissionMode
  model: string
  planExecutionModel: string
  reviewModel: string
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
  gitPrMergeMethod: 'merge' | 'squash'
  gitShowPrIconsInSidebar: boolean
  gitDraftPullRequest: boolean
  gitAutoDeleteWorktree: boolean
  gitAutoDeleteWorktreeLimit: number
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  githubOAuthClientId: string
  sandboxMode?: DesktopSandboxMode
  allowNetworkAccess?: boolean
  installCodexDependencies: boolean
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  diffMarkerStyle: DesktopDiffMarkerStyle
  rustSearchAndDiffKernels: boolean
  browserAllowedSites: string[]
  browserSitePermissions: DesktopBrowserSitePermission[]
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

export type DesktopThemeFontEntry = {
  preset: string
  fallback: string
}

export type DesktopThemeRadixAccentColor =
  | 'gray'
  | 'gold'
  | 'bronze'
  | 'brown'
  | 'yellow'
  | 'amber'
  | 'orange'
  | 'tomato'
  | 'red'
  | 'ruby'
  | 'crimson'
  | 'pink'
  | 'plum'
  | 'purple'
  | 'violet'
  | 'iris'
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'teal'
  | 'jade'
  | 'green'
  | 'grass'
  | 'lime'
  | 'mint'
  | 'sky'

export type DesktopThemeRadixGrayColor =
  | 'auto'
  | 'gray'
  | 'mauve'
  | 'slate'
  | 'sage'
  | 'olive'
  | 'sand'

export type DesktopThemeRadixPanelBackground = 'solid' | 'translucent'
export type DesktopThemeRadixRadius =
  | 'none'
  | 'small'
  | 'medium'
  | 'large'
  | 'full'
export type DesktopThemeRadixScaling =
  | '90%'
  | '95%'
  | '100%'
  | '105%'
  | '110%'

export type DesktopThemeRadixConfig = {
  accentColor: DesktopThemeRadixAccentColor
  grayColor: DesktopThemeRadixGrayColor
  panelBackground: DesktopThemeRadixPanelBackground
  radius: DesktopThemeRadixRadius
  scaling: DesktopThemeRadixScaling
}

export type DesktopThemeConfigV1 = {
  codeThemeId: string
  theme: {
    accent: string
    contrast: number
    fonts: {
      code: DesktopThemeFontEntry
      ui: DesktopThemeFontEntry
    }
    ink: string
    opaqueWindows: boolean
    semanticColors: {
      diffAdded: string
      diffRemoved: string
      skill: string
    }
    radix: DesktopThemeRadixConfig
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
  glassmorphismEnabled: boolean
  pointerCursorEnabled: boolean
  reduceMotion: 'system' | 'on' | 'off'
  fontSizes: {
    code: number
    ui: number
  }
  customThemes: DesktopThemeCustomTheme[]
  presetOverrides: Record<string, DesktopThemeConfigV1>
}

export type DesktopPermissionRememberOptionId = 'session' | 'persistentPrefix'

export type DesktopPermissionRememberOption = {
  id: DesktopPermissionRememberOptionId
  label: string
  hint?: string
}

export type DesktopPermissionDecision = AgentPermissionDecision & {
  planExecutionModel?: string
  savePlanExecutionModel?: boolean
  rememberOptionId?: DesktopPermissionRememberOptionId
}

export type DesktopPermissionRequest = AgentPermissionRequest & {
  rememberOptions?: DesktopPermissionRememberOption[]
}

export type DesktopSessionMessage = AgentSessionMessage

export type DesktopToolLogEntry = AgentToolLogEntry

export type DesktopContextUsage = AgentContextUsage

export type DesktopSessionListItem = {
  id: string
  sessionName: string | null
  aiTitle: string | null
  localRouterMode?: LocalRouterMode
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
  permissionProfile?: DesktopPermissionProfile
  approvalPolicy?: DesktopApprovalPolicy
  approvalsReviewer?: DesktopApprovalsReviewer
  permissionMode: DesktopPermissionMode
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  model: string | null
  reviewModel?: string | null
  thinkingMode: DesktopThinkingMode
  hasSystemPrompt: boolean
  hasAppendSystemPrompt: boolean
  additionalDirectoryCount: number
  status: DesktopSessionStatus
  lastMessageAt?: string | null
  createdAt: string
}

export type DesktopSessionSettingsSnapshot = {
  localRouterMode?: LocalRouterMode
  permissionProfile?: DesktopPermissionProfile
  approvalPolicy?: DesktopApprovalPolicy
  approvalsReviewer?: DesktopApprovalsReviewer
  permissionMode: DesktopPermissionMode
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  providerBaseURL?: string
  debugConversationDump?: boolean
  model?: string
  planExecutionModel?: string
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
  installCodexDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
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
  reviewComments?: DesktopReviewComment[]
  updatedAt: string
}

export type DesktopSessionMetadataPatch = {
  pinnedAt?: string | null
  archivedAt?: string | null
}

export type DesktopAgentEvent = AgentRuntimeEvent

export type DesktopWorkflowEvent = ThreadEvent

export type CreateDesktopSessionOptions = {
  localRouterMode?: LocalRouterMode
  workspacePath?: string
  permissionProfile?: DesktopPermissionProfile
  approvalPolicy?: DesktopApprovalPolicy
  approvalsReviewer?: DesktopApprovalsReviewer
  permissionMode?: DesktopPermissionMode
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  providerBaseURL?: string
  debugConversationDump?: boolean
  model?: string
  planExecutionModel?: string
  reviewModel?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  installCodexDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}

export type CreateDesktopSessionResult = {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
}

export type DesktopModelSelection = {
  providerID?: ModelProviderID
  providerBaseURL?: string
  model?: string
  debugConversationDump?: boolean
  localRouterMode?: LocalRouterMode
}

export type DesktopBuiltinPlugin = {
  id: string
  enabled: boolean
}

export type DesktopSkillOwnerFilter = 'all' | 'official' | 'community'

export type DesktopSkillCatalogOptions = {
  query?: string
  owner?: DesktopSkillOwnerFilter
  view?: 'all-time' | 'trending' | 'hot'
  page?: number
  perPage?: number
}

export type DesktopSkillCatalogItem = {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string | null
  url: string
  isDuplicate: boolean
  installed: boolean
  audit: DesktopSkillAudit | null
}

export type DesktopSkillCatalogResult = {
  skills: DesktopSkillCatalogItem[]
  page: number
  perPage: number
  total?: number
  hasMore: boolean
}

export type DesktopSkillAuditStatus = 'pass' | 'warn' | 'fail'

export type DesktopSkillAudit = {
  status: DesktopSkillAuditStatus
  summary: string
  providerCount: number
  auditedAt: string | null
}

export type DesktopSkillInstallOptions = {
  id: string
  installUrl?: string | null
}

export type DesktopSkillInstallResult = {
  id: string
  slug: string
  installed: boolean
  installPath: string
}

export type DesktopSlashCommandSuggestion = {
  name: string
  title: string
  description: string
  category: 'command' | 'skill'
  scope?: string
}

export type DesktopUiCommand =
  | 'newConversation'
  | 'chooseWorkspace'
  | 'refreshWorkspace'
  | 'openSettings'
  | 'logOut'

export type DesktopUpdateStatus =
  | { phase: 'checking' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; percent: number }
  | { phase: 'downloaded' }
  | { phase: 'error'; message: string }
  | { phase: 'no-update' }

export type DebugToolProbeMode = 'safe' | 'realManual' | 'realAuto'

export type DebugToolProbeItemStatus =
  | 'passed'
  | 'failed'
  | 'permissionDenied'
  | 'unsupportedProbe'
  | 'skippedByEnvironment'

export type DebugToolProbeItem = {
  toolName: string
  status: DebugToolProbeItemStatus
  reason?: string
  durationMs?: number
  permissionRequestId?: string
  permissionDecision?: string
  inputSummary?: string
  error?: string
}

export type DebugToolProbeReport = {
  runId: string
  mode: DebugToolProbeMode
  startedAt: string
  finishedAt?: string
  cancelled?: boolean
  totalTools: number
  passed: number
  failed: number
  permissionDenied: number
  unsupportedProbe: number
  skippedByEnvironment: number
  items: DebugToolProbeItem[]
  logPath?: string
}

export type DesktopProjectMemoryType =
  | 'user'
  | 'feedback'
  | 'project'
  | 'reference'

export type DesktopProjectMemory = {
  relativePath: string
  absolutePath: string
  type?: DesktopProjectMemoryType
  description: string | null
  size: number
  mtimeMs: number
}

export type DesktopProjectMemoryListing = {
  memoryDir: string
  entrypointPath: string
  memories: DesktopProjectMemory[]
}

export type DesktopProjectMemoryContent = DesktopProjectMemory & {
  content: string
}

export type SaveProjectMemoryInput = {
  workspacePath: string
  relativePath: string
  content: string
}

export type DeleteProjectMemoryInput = {
  workspacePath: string
  relativePath: string
}

export type ResetProjectMemoryInput = {
  workspacePath: string
  includeRecallLog: boolean
}

export type DesktopMemoryRecallFile = {
  relativePath: string
  type?: DesktopProjectMemoryType
  description?: string | null
  mtimeMs?: number
  truncated?: boolean
}

export type DesktopMemoryRecallEvent = {
  sessionId: string
  createdAt: string
  querySummary: string
  status: 'injected'
  consumedOnIteration: number
  memories: DesktopMemoryRecallFile[]
}

export type DesktopMemoryRecallListing = {
  recallLogPath: string
  recalls: DesktopMemoryRecallEvent[]
}

export type DesktopApi = {
  getAuthStatus(): Promise<DesktopAuthStatus>
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>
  diagnoseDesktopToolchain(): Promise<DesktopToolchainDiagnosticReport>
  reinstallDesktopToolchain(): Promise<DesktopToolchainInstallResult>
  deleteDesktopToolchain(): Promise<DesktopToolchainInstallResult>
  getDesktopSettings(): Promise<DesktopStoredSettings>
  saveDesktopSettings(settings: DesktopStoredSettings): Promise<DesktopStoredSettings>
  listProjectMemories(workspacePath: string): Promise<DesktopProjectMemoryListing>
  readProjectMemory(
    workspacePath: string,
    relativePath: string,
  ): Promise<DesktopProjectMemoryContent>
  saveProjectMemory(input: SaveProjectMemoryInput): Promise<DesktopProjectMemory>
  deleteProjectMemory(input: DeleteProjectMemoryInput): Promise<void>
  resetProjectMemory(input: ResetProjectMemoryInput): Promise<void>
  listProjectMemoryRecalls(workspacePath: string): Promise<DesktopMemoryRecallListing>
  getBrowserState(): Promise<DesktopBrowserState>
  openBrowser(url?: string): Promise<DesktopBrowserState>
  navigateBrowser(url: string): Promise<DesktopBrowserState>
  reloadBrowser(): Promise<DesktopBrowserState>
  goBackBrowser(): Promise<DesktopBrowserState>
  goForwardBrowser(): Promise<DesktopBrowserState>
  closeBrowser(): Promise<DesktopBrowserState>
  setBrowserBounds(bounds: DesktopBrowserBounds): Promise<DesktopBrowserState>
  clearBrowserAllowedSites(): Promise<DesktopBrowserState>
  listBuiltinPlugins(): Promise<DesktopBuiltinPlugin[]>
  setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<DesktopBuiltinPlugin>
  listSkillsCatalog(
    options?: DesktopSkillCatalogOptions,
  ): Promise<DesktopSkillCatalogResult>
  installSkill(
    skill: string | DesktopSkillInstallOptions,
  ): Promise<DesktopSkillInstallResult>
  listSlashCommands(workspacePath?: string): Promise<DesktopSlashCommandSuggestion[]>
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
  getCopilotAuthStatus(): Promise<DesktopCopilotAuthStatus>
  startCopilotLogin(): Promise<DesktopCopilotLoginStatus>
  pollCopilotLogin(): Promise<DesktopCopilotLoginStatus>
  cancelCopilotLogin(): Promise<{ cancelled: boolean }>
  getGithubAuthStatus(): Promise<DesktopGithubAuthStatus>
  startGithubLogin(
    input?: StartGithubLoginInput,
  ): Promise<DesktopGithubLoginStatus>
  pollGithubLogin(): Promise<DesktopGithubLoginStatus>
  logoutGithub(): Promise<DesktopGithubAuthStatus>
  listGithubRepositories(): Promise<DesktopGithubRepositoryListResult>
  getGithubProfileOverview(): Promise<DesktopGithubProfileOverviewResult>
  setGithubUserStatus(
    input: DesktopGithubUserStatusInput,
  ): Promise<DesktopGithubUserStatusResult>
  clearGithubUserStatus(): Promise<DesktopGithubUserStatusResult>
  cloneGithubRepository(
    input: CloneGithubRepositoryInput,
  ): Promise<DesktopGithubCloneResult>
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
  discardWorkspaceChanges(
    input: DiscardWorkspaceChangesInput,
  ): Promise<DesktopGitOperationResult>
  createPullRequest(
    input: CreatePullRequestInput,
  ): Promise<DesktopPullRequestResult>
  getWorkspaceReviewDiff(
    input: DesktopReviewDiffInput,
  ): Promise<DesktopReviewDiffResult>
  applyWorkspaceReviewOperation(
    input: DesktopReviewOperationInput,
  ): Promise<DesktopReviewOperationResult>
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
  saveSessionReviewComment(
    input: SaveSessionReviewCommentInput,
  ): Promise<DesktopSessionSnapshot>
  resolveSessionReviewComment(
    input: SessionReviewCommentInput,
  ): Promise<DesktopSessionSnapshot>
  deleteSessionReviewComment(
    input: SessionReviewCommentInput,
  ): Promise<DesktopSessionSnapshot>
  setSessionPermissionMode(
    sessionId: string,
    mode: DesktopPermissionMode,
  ): Promise<DesktopSessionSnapshot>
  setSessionPlanModeActive(
    sessionId: string,
    active: boolean,
  ): Promise<DesktopSessionSnapshot>
  setSessionLocalRouterMode(
    sessionId: string,
    mode: LocalRouterMode,
  ): Promise<DesktopSessionSnapshot>
  readWorkflowEventLog(): Promise<DesktopWorkflowEvent[]>
  openConfigFile(): Promise<{ path: string }>
  openExternalURL(url: string): Promise<void>
  sendUserMessage(
    sessionId: string,
    content: DesktopUserMessageInput,
    model?: string | DesktopModelSelection,
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
  closeDevTools(): Promise<void>
  openSettings(): Promise<void>
  logOut(): Promise<void>
  exitApp(): Promise<void>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onWorkflowEvent(callback: (event: DesktopWorkflowEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): Promise<void>
  onUpdateStatusChange(callback: (status: DesktopUpdateStatus) => void): () => void
  listDebugBuiltinTools(): Promise<{
    toolNames: string[]
    enabled: boolean[]
    hasProbeInput: boolean[]
  }>
  runDebugToolProbe(mode: DebugToolProbeMode): Promise<DebugToolProbeReport>
  cancelDebugToolProbe(runId: string): Promise<void>
}
