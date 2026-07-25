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
import type { CodePilotXCollaborationMode } from '@codepilotx/core/agent/codepilotxSessionContract.js'
import type {
  AgentPermissionDecision,
  AgentPermissionRequest,
  DesktopAgentPermissionMode,
} from '@codepilotx/core/agent/permissions.js'
import type { ThreadEvent } from '@codepilotx/core/agent/workflow.js'
import type { Attachment, UserMessage } from '@codepilotx/core/attachments/types.js'
import type {
  ApprovalRequest,
  SubagentProjection,
  SubagentRun,
  SubagentTask,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import type {
  DesktopDataLocationChange,
  DesktopDataLocationControlSource,
  DesktopDataLocationState,
} from '@codepilotx/shared/desktop-data-location-ipc'
import type {
  ModelMetadata,
  ModelProviderID as CoreModelProviderID,
  ModelProviderKind,
  ModelProviderSummary,
  ProviderBalanceInfo,
  ProviderTokenPlanUsageInfo,
} from '@codepilotx/core/models/provider.js'
import type {
  CatalogProvider,
  IntegrationAuthorizeRequest,
  IntegrationAuthorizeResponse,
  IntegrationAuthorizeCompleteRequest,
  IntegrationAuthorizeStatusRequest,
  IntegrationAuthorizeStatusResponse,
  IntegrationConnectRequest,
  IntegrationDisconnectRequest,
  IntegrationListResponse,
  ModelRef,
  OkResponse,
  ProviderTestResponse,
} from '@codepilotx/shared'
import type { CodexHighlightThemeSlug } from './codexThemes/manifest.js'
import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'

export type DesktopAuthStatus = {
  authenticated: boolean
  method: string
  email?: string | null
  organizationName?: string | null
}

export interface DesktopWorkspace extends AgentWorkspace {
  pinnedAt?: string | null
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
  sizeBytes: number
  readonly: boolean
  revision: DesktopFileRevision
}

export type DesktopFileRevision = {
  mtimeMs: number
  sha256: string
}

export type DesktopFileSaveResult =
  | {
      outcome: 'saved'
      revision: DesktopFileRevision
    }
  | {
      outcome: 'conflict'
      revision: DesktopFileRevision
      content: string
    }

export type DesktopFileSaveInput = {
  workspacePath: string
  filePath: string
  content: string
  expectedRevision: DesktopFileRevision
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
  skillInvocation?: {
    name: string
    args?: string
    skillPath?: string
  }
}

/**
 * Structured user message passed to the runtime for processing.
 * Previously `string | ContentBlockParam[]`; now uses the neutral
 * `UserMessage` format so the runtime can handle attachments natively.
 */
export type DesktopUserMessageContent = UserMessage | string

export type DesktopDiffSummary = {
  patch: string
}

export type DesktopReviewScope = 'unstaged' | 'staged'

export type DesktopReviewSource =
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'branch'; baseBranch: string }
  | { kind: 'commit'; commitSha: string }
  | { kind: 'last-turn'; threadId: string; turnId: string }
  | {
      kind: 'pull-request'
      owner: string
      repository: string
      number: number
    }

export type DesktopReviewDelivery = 'inline' | 'detached'

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
  revision?: string
  renderable?: boolean
  tooLargeReason?: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
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
  revision?: string
  hunkId?: string | null
  githubCommentId?: string | null
  githubThreadId?: string | null
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

export type RestoreSessionTurnChangesInput = {
  sessionId: string
  turnRestoreId: string
  paths: string[]
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
  runtimeKind:
    | 'rust-sidecar'
  runtimePreference:
    | 'auto'
    | 'rust-sidecar'
  runtimeSelectionSource: 'default' | 'env'
  agentExecutablePath: string
  agentExecutableExists: boolean
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

export type DesktopExternalOpenTarget = {
  id: string
  label: string
  kind: 'default-app' | 'editor'
  iconDataUrl?: string
  preferred: boolean
}

export type DesktopSessionStatus = AgentSessionStatus

export type DesktopPermissionMode = DesktopAgentPermissionMode

export type DesktopPermissionProfile = string

export type DesktopApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'
  | {
      type: 'granular'
      sandboxApproval: boolean
      rules: boolean
      skillApproval: boolean
      requestPermissions: boolean
      mcpElicitations: boolean
    }

export type DesktopApprovalsReviewer = 'user' | 'auto_review'

export type DesktopPermissionConfig = {
  sandboxMode: Exclude<DesktopSandboxMode, 'full-access'>
  approvalPolicy: DesktopApprovalPolicy
  approvalsReviewer: DesktopApprovalsReviewer
}

export type DesktopCollaborationMode = CodePilotXCollaborationMode

export type DesktopThinkingMode = AgentThinkingMode

export type DesktopDrawerTab =
  | 'files'
  | 'diff'
  | 'permissions'
  | 'toolLog'
  | 'settings'

export type ModelProviderID = CoreModelProviderID

export type DesktopModelProviderKind = ModelProviderKind

export type DesktopModelMetadata = ModelMetadata & {
  variants?: string[]
}

export type DesktopModelProviderSummary = Omit<ModelProviderSummary, 'modelMetadata'> & {
  integrationID?: string
  modelMetadata?: Record<string, DesktopModelMetadata>
}

export type DesktopModelProviderState = {
  selectedProviderID: ModelProviderID
  provider: DesktopModelProviderSummary
  model: string
  variant?: string
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
  modelMetadata?: Record<string, DesktopModelMetadata>
  total?: number
  nextCursor?: string
  error?: string
}

export type DesktopApiKeyHealthStatus =
  | 'untested'
  | 'healthy'
  | 'auth-failed'
  | 'rate-limited'
  | 'error'

export type DesktopApiKeySummary = {
  id: string
  providerId: ModelProviderID
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  priority: number
  health: {
    status: DesktopApiKeyHealthStatus
    lastTestedAt?: number
    lastUsedAt?: number
    errorCategory?: 'authentication' | 'rate-limit' | 'network' | 'unknown'
    cooldownUntil?: number
  }
  createdAt: number
  updatedAt: number
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
  loginId: string | null
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
  id?: string
  variant?: string
  baseURL?: string
}

export type DesktopIntegration = IntegrationListResponse['integrations'][number]
export type DesktopIntegrationConnectRequest = IntegrationConnectRequest
export type DesktopIntegrationAuthorizeRequest = IntegrationAuthorizeRequest
export type DesktopIntegrationAuthorizeResponse = IntegrationAuthorizeResponse
export type DesktopIntegrationAuthorizeCompleteRequest = IntegrationAuthorizeCompleteRequest
export type DesktopIntegrationAuthorizeStatusRequest = IntegrationAuthorizeStatusRequest
export type DesktopIntegrationAuthorizeStatusResponse = IntegrationAuthorizeStatusResponse
export type DesktopIntegrationDisconnectRequest = IntegrationDisconnectRequest
export type DesktopModelRef = ModelRef
export type DesktopCatalogProvider = CatalogProvider

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
export type DesktopFollowUpBehavior = 'steer' | 'queue'
export type DesktopSidebarOrganization = 'projects' | 'flat'
export type DesktopSidebarSort =
  | 'priority'
  | 'updated'
  | 'created'
  | 'manual'

export type DesktopRemovedWorkspace = {
  path: string
  name: string
  removedAt: string
}

export type DesktopPetSettings = {
  enabled: boolean
  selectedPetId: string | null
  size: number
  notifyAttention: boolean
  notifyCompletion: boolean
  notifyFailure: boolean
}

export type SidebarProductMode = 'coding' | 'working'
export type SidebarSectionId = 'pinned' | 'projects' | 'recent'

export type DesktopStoredSettings = {
  enableParetoCodeRouter?: boolean
  enableFusionRouter?: boolean
  enableAutoReviewPermissionMode?: boolean
  enableFullAccessPermissionMode?: boolean
  permissionConfig: DesktopPermissionConfig
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  permissionProfile?: DesktopPermissionProfile
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  approvalPolicy?: DesktopApprovalPolicy
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  approvalsReviewer?: DesktopApprovalsReviewer
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  permissionMode?: DesktopPermissionMode
  model: string
  planExecutionModel: string
  reviewModel: string
  smallFastModel: string
  fastModel: string
  defaultModel: string
  deepModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  followUpBehavior: DesktopFollowUpBehavior
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  lastActiveWorkspacePath: string
  removedWorkspaces: DesktopRemovedWorkspace[]
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
	  authBaseUrl: string
	  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
	  sandboxMode?: DesktopSandboxMode
  allowNetworkAccess?: boolean
  installCodePilotXDependencies: boolean
  workspaceDependenciesMigrated: boolean
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  defaultModeRequestUserInput: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  reviewDelivery: DesktopReviewDelivery
  diffMarkerStyle: DesktopDiffMarkerStyle
  rustSearchAndDiffKernels: boolean
  sidebarOrganization: DesktopSidebarOrganization
  sidebarProductMode: SidebarProductMode
  sidebarStateVersion: number
  sidebarSort: DesktopSidebarSort
  sidebarManualOrder: Record<string, string[]>
  sidebarSessionPins: Record<string, string>
  collapsedSidebarProjectPaths: string[]
  sidebarSectionOrder: SidebarSectionId[]
	  browserAllowedSites: string[]
	  collapsedSidebarSections: SidebarSectionId[]
	  browserSitePermissions: DesktopBrowserSitePermission[]
  pet: DesktopPetSettings
}

export type DesktopMcpScope =
  | 'local'
  | 'user'
  | 'project'
  | 'dynamic'
  | 'enterprise'
  | 'claudeai'
  | 'managed'

export type DesktopEditableMcpScope = 'local' | 'user'

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

export type DesktopMcpRuntimeServerStatus = {
  name: string
  scope: DesktopMcpScope
  type: DesktopMcpTransport
  status: 'connected' | 'failed' | 'pending' | 'disabled' | 'unsupported'
  error?: string
  toolCount: number
  resourceCount: number
  promptCount: number
}

export type DesktopMcpRuntimeStatus = {
  servers: DesktopMcpRuntimeServerStatus[]
  totalTools: number
  totalResources: number
  totalPrompts: number
}

export type McpReloadResult = {
  /** Sessions that received the RPC successfully. */
  refreshed: number
  /** Sessions that were not running (null session or sidecar not started). */
  skipped: number
  /** Sessions where the RPC threw an error. */
  failed: number
}

export type SaveDesktopMcpServerOptions = {
  originalName?: string
  name: string
  scope: DesktopEditableMcpScope
  config: DesktopMcpServerConfig
}

export type {
  DesktopChromeTheme,
  DesktopThemeMode,
  DesktopThemeVariant,
} from '@codepilotx/shared/desktop-theme'
import type {
  DesktopChromeTheme,
  DesktopThemeSettingsV6 as SharedDesktopThemeSettingsV6,
  DesktopThemeVariant,
} from '@codepilotx/shared/desktop-theme'

export type DesktopThemeConfigV1 = {
  codeThemeId: string
  theme: DesktopChromeTheme
  variant: DesktopThemeVariant
}

export type DesktopThemeSettingsV6 =
  SharedDesktopThemeSettingsV6<CodexHighlightThemeSlug>

export type DesktopThemeSettings = DesktopThemeSettingsV6

export type DesktopPermissionRememberOptionId = 'session' | 'persistentPrefix'

export type DesktopPermissionRememberOption = {
  id: DesktopPermissionRememberOptionId
  label: string
  hint?: string
}

export type DesktopPermissionDecision = AgentPermissionDecision & {
  planExecutionModel?: string
  planExecutionProviderID?: string
  planExecutionProviderBaseURL?: string
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
  appServerThreadId?: string | null
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
  rolloutPath?: string | null
  legacyTranscriptPath?: string | null
  source?: "user" | "internal_guardian" | "subagent" | null
  parentSessionId?: string | null
  guardianRolloutPath?: string | null
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
  effort?: string | null
  personality?: DesktopPersonality
  reviewModel?: string | null
  thinkingMode: DesktopThinkingMode
  hasSystemPrompt: boolean
  hasAppendSystemPrompt: boolean
  additionalDirectoryCount: number
  status: DesktopSessionStatus
  threadGoal?: DesktopThreadGoal | null
  unreadAt?: string | null
  lastMessageAt?: string | null
  createdAt: string
}

export type DesktopSessionSettingsSnapshot = {
  localRouterMode?: LocalRouterMode
  permissionConfig: DesktopPermissionConfig
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  providerBaseURL?: string
  debugConversationDump?: boolean
  model?: string
  effort?: string | null
  personality?: DesktopPersonality
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
  installCodePilotXDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}

export type DesktopQueuedFollowUp = {
  id: string
  input: DesktopUserMessageInput
  previewText: string
  createdAt: string
}

export type DesktopQueuePauseReason = 'interrupted' | 'turn_failed'

export type DesktopSessionViewSnapshot = {
  messages: DesktopSessionMessage[]
  toolLog: DesktopToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
}

export type DesktopSessionEventType = AgentSessionEventType

export type DesktopSessionEvent = AgentSessionEvent

export type DesktopSessionSnapshot = {
  appServerThreadId?: string | null
  /** A newly-created desktop session has not started its persistent Thread yet. */
  appServerThreadPending?: boolean
  item: DesktopSessionListItem
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  view: DesktopSessionViewSnapshot
  events?: DesktopSessionEvent[]
  eventModelVersion?: 1
  workflowEvents?: DesktopWorkflowEvent[]
  workflowEventModelVersion?: 1
  reviewComments?: DesktopReviewComment[]
  queuedFollowUps?: DesktopQueuedFollowUp[]
  queuePauseReason?: DesktopQueuePauseReason | null
  queueVersion?: number
  updatedAt: string
}

export type DesktopSubagentRead = {
  task: SubagentTask
  currentRun: SubagentRun | null
  snapshot: ThreadSnapshot
  capabilities: {
    canSend: boolean
    canStop: boolean
    canRetry: boolean
    canRespondToApprovals: boolean
    canRespondToQuestions: boolean
    canSubmitPlanDecision: boolean
    canApplyWorktree: boolean
    canDiscardWorktree: boolean
    canRestoreWorkspace: boolean
  }
}

export type DesktopSessionStoreChange = {
  activeSessionId: string | null
  sessions: DesktopSessionSnapshot[]
}

export type DesktopSessionCatalogStatus = {
  state: 'loading' | 'ready' | 'unavailable'
  error: string | null
}

export type DesktopSettingsChange = {
  settings: DesktopStoredSettings
}

export type DesktopSessionMetadataPatch = {
  archivedAt?: string | null
}

export type DesktopAgentEvent = AgentRuntimeEvent

export type DesktopWorkflowEvent = ThreadEvent

export type CreateDesktopSessionOptions = {
  appServerThreadId?: string | null
  localRouterMode?: LocalRouterMode
  workspacePath?: string
  /** First submitted text used to name/materialize a projectless workspace. */
  projectlessPrompt?: string
  permissionConfig?: DesktopPermissionConfig
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
  installCodePilotXDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}

export type CreateDesktopSessionResult = {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
}

export type DesktopThreadGoalStatus =
  | 'active'
  | 'paused'
  | 'blocked'
  | 'usageLimited'
  | 'budgetLimited'
  | 'complete'

export type DesktopThreadGoal = {
  threadId: string
  objective: string
  status: DesktopThreadGoalStatus
  tokenBudget: number | null
  tokensUsed: number
  timeUsedSeconds: number
  createdAt: number
  updatedAt: number
}

export type DesktopRuntimePermissionProfile = {
  id: string
  description: string | null
}

export type DesktopSkillFormat =
  | 'codepilotx'
  | 'agents'
  | 'codex'
  | 'claude'

export type DesktopSkillSource =
  | 'workspace'
  | 'user'
  | 'system'
  | 'admin'

export type DesktopInstalledSkill = {
  name: string
  description: string
  shortDescription?: string
  path: string
  scope: 'user' | 'repo' | 'system' | 'admin'
  source: DesktopSkillSource
  format: DesktopSkillFormat
  enabled: boolean
}

export type DesktopInstalledSkillDetails = DesktopInstalledSkill & {
  content: string
}

export type DesktopRuntimeHook = {
  key: string
  eventName: string
  handlerType: string
  matcher: string | null
  command: string | null
  timeoutSec: number
  statusMessage: string | null
  sourcePath: string
  source: string
  pluginId: string | null
  displayOrder: number
  enabled: boolean
  isManaged: boolean
  currentHash: string
  trustStatus: 'managed' | 'untrusted' | 'trusted' | 'modified'
}

export type DesktopCatalogResult<T> =
  | { state: 'ready'; data: T; updatedAt: string }
  | { state: 'stale'; data: T; updatedAt: string; error: string }
  | { state: 'unavailable'; data: null; error: string }

export type DesktopAiReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string }

export type DesktopAiReviewStartResult = {
  threadId: string
  turnId: string
  delivery: DesktopReviewDelivery
  source: DesktopReviewSource
}

export type DesktopRollbackRequest = {
  sessionId: string
  numTurns: number
  restoreFiles: boolean
}

export type DesktopRollbackResult = {
  snapshot: DesktopSessionSnapshot
  restoredFiles: string[]
}

export type DesktopModelSelection = {
  providerID?: ModelProviderID
  providerBaseURL?: string
  model?: string
  variant?: string
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
  skillPath?: string
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

export type {
  DesktopDataLocationControlSource,
  DesktopDataLocationState,
}
export type DesktopDataLocationMigrationResult = DesktopDataLocationChange

export type DebugToolProbeMode = 'safe' | 'realManual' | 'realAuto'

export type DebugToolProbeItemStatus =
  | 'passed'
  | 'failed'
  | 'permissionDenied'
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
  skippedByEnvironment: number
  items: DebugToolProbeItem[]
  logPath?: string
}

export type RustSidecarBinarySource = 'env-override' | 'workspace' | 'bundled'

export type RustSidecarProbeInfo = {
  binaryPath: string
  binarySource: RustSidecarBinarySource
  binaryExists: boolean
  configDirectoryPath: string
  sqliteHome?: string
  protocolCapabilities?: string[]
  userAgent?: string
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

export type DesktopUserMemoryListing = {
  memoryDir: string
  profilePath: string
  preferencesPath: string
  eventsPath: string
  conversationIndexPath: string
  memories: DesktopProjectMemory[]
}

export type DesktopProjectMemoryContent = DesktopProjectMemory & {
  content: string
}

export type DesktopTaskSuggestion =
  RpcResult<'task-suggestion/generate'>['suggestions'][number]

export type GenerateDesktopTaskSuggestionsInput = {
  workspacePath: string | null
  context: RpcParams<'task-suggestion/generate'>['context']
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

export type SaveUserMemoryInput = {
  relativePath: string
  content: string
}

export type DeleteUserMemoryInput = {
  relativePath: string
}

export type ResetUserMemoryInput = {
  includeEventLog: boolean
}

export type ExportUserMemoryResult = {
  memoryDir: string
  files: Array<{
    relativePath: string
    content: string
  }>
}

export type ImportUserMemoryInput = {
  files: Array<{
    relativePath: string
    content: string
  }>
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
  status: 'injected' | 'viewed'
  consumedOnIteration: number
  memories: DesktopMemoryRecallFile[]
}

export type DesktopMemoryRecallListing = {
  recallLogPath: string
  recalls: DesktopMemoryRecallEvent[]
}

export type DesktopApi = {
  listSubagents?(threadId: string): Promise<SubagentProjection[]>
  readSubagent?(taskId: string): Promise<DesktopSubagentRead>
  sendSubagent?(taskId: string, input: DesktopUserMessageInput, model?: string | DesktopModelSelection, permissionMode?: DesktopPermissionMode): Promise<unknown>
  stopSubagent?(taskId: string): Promise<unknown>
  retrySubagent?(taskId: string): Promise<unknown>
  applySubagentWorktree?(taskId: string): Promise<unknown>
  discardSubagentWorktree?(taskId: string): Promise<unknown>
  restoreSubagentWorkspace?(taskId: string): Promise<unknown>
  respondSubagentApproval?(approval: ApprovalRequest, decision: 'allow-once' | 'deny' | 'stop'): Promise<void>
  respondSubagentQuestion?(questionId: string, answer: string | null, ignored: boolean): Promise<void>
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
  listUserMemories(): Promise<DesktopUserMemoryListing>
  readUserMemory(relativePath: string): Promise<DesktopProjectMemoryContent>
  saveUserMemory(input: SaveUserMemoryInput): Promise<DesktopProjectMemory>
  deleteUserMemory(input: DeleteUserMemoryInput): Promise<void>
  resetUserMemory(input: ResetUserMemoryInput): Promise<void>
  generateTaskSuggestions(
    input: GenerateDesktopTaskSuggestionsInput,
  ): Promise<RpcResult<'task-suggestion/generate'>>
  exportUserMemory(): Promise<ExportUserMemoryResult>
  importUserMemory(input: ImportUserMemoryInput): Promise<ExportUserMemoryResult>
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
  getMcpRuntimeStatus(sessionId?: string): Promise<DesktopMcpRuntimeStatus>
  saveMcpServer(options: SaveDesktopMcpServerOptions): Promise<DesktopMcpServerListItem[]>
  removeMcpServer(name: string, scope: DesktopEditableMcpScope): Promise<DesktopMcpServerListItem[]>
  setMcpServerEnabled(name: string, enabled: boolean): Promise<DesktopMcpServerListItem[]>
  reloadMcpConfiguration(): Promise<McpReloadResult>
  listOpenTargets(): Promise<DesktopOpenTarget[]>
  listExternalOpenTargets(targetPath: string): Promise<DesktopExternalOpenTarget[]>
  openPathWithTarget(targetPath: string, targetId: string): Promise<void>
  openPathWithDefaultTarget(targetPath: string): Promise<void>
  revealPathInFolder(targetPath: string): Promise<void>
  listModelProviders(): Promise<DesktopModelProviderSummary[]>
  getModelProviderState(): Promise<DesktopModelProviderState>
  fetchProviderModels(options: {
    providerID: ModelProviderID
    apiKey?: string
    baseURL?: string
    query?: string
    cursor?: string
    limit?: number
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
  listApiKeys(providerId?: ModelProviderID): Promise<DesktopApiKeySummary[]>
  createApiKey(input: {
    providerId: ModelProviderID
    label: string
    key: string
  }): Promise<void>
  updateApiKey(input: {
    credentialId: string
    label?: string
    key?: string
  }): Promise<void>
  setActiveApiKey(providerId: ModelProviderID, credentialId: string): Promise<void>
  setApiKeyEnabled(credentialId: string, enabled: boolean): Promise<void>
  reorderApiKeys(providerId: ModelProviderID, orderedCredentialIds: string[]): Promise<void>
  testApiKey(credentialId: string): Promise<void>
  deleteApiKey(credentialId: string): Promise<void>
  copyProviderApiKey(credentialId: string): Promise<{ clearAfterMs: 60000 }>
  testModelProvider(providerID: ModelProviderID): Promise<ProviderTestResponse>
  listIntegrations(): Promise<DesktopIntegration[]>
  connectIntegration(input: DesktopIntegrationConnectRequest): Promise<OkResponse>
  authorizeIntegration(
    input: DesktopIntegrationAuthorizeRequest,
  ): Promise<DesktopIntegrationAuthorizeResponse>
  completeIntegrationAuthorization(
    input: DesktopIntegrationAuthorizeCompleteRequest,
  ): Promise<OkResponse>
  getIntegrationAuthorizationStatus(
    input: DesktopIntegrationAuthorizeStatusRequest,
  ): Promise<DesktopIntegrationAuthorizeStatusResponse>
  disconnectIntegration(
    input: DesktopIntegrationDisconnectRequest,
  ): Promise<OkResponse>
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
  restoreSessionTurnChanges(
    input: RestoreSessionTurnChangesInput,
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
  listWorkspaceFiles(workspacePath: string, directoryPath?: string): Promise<DesktopFileEntry[]>
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<DesktopFilePreview>
  readOptionalWorkspaceFile(
    workspacePath: string,
    filePath: string,
  ): Promise<DesktopFilePreview | null>
  saveWorkspaceFile(input: DesktopFileSaveInput): Promise<DesktopFileSaveResult>
  watchWorkspaceFile(workspacePath: string, filePath: string): Promise<void>
  unwatchWorkspaceFile(workspacePath: string, filePath: string): Promise<void>
  chooseComposerFiles(): Promise<DesktopComposerAttachment[]>
  authorizeComposerFilePaths(filePaths: string[]): Promise<void>
  readComposerFiles(filePaths: string[]): Promise<DesktopComposerAttachment[]>
  getWorkspaceDiff(workspacePath: string): Promise<DesktopDiffSummary>
  getThemeSettings(): Promise<DesktopThemeSettings>
  saveThemeSettings(settings: DesktopThemeSettings): Promise<void>
  createSession(options: CreateDesktopSessionOptions): Promise<CreateDesktopSessionResult>
  listSessions(options?: { archived?: boolean }): Promise<DesktopSessionSnapshot[]>
  getSessionCatalogStatus(): Promise<DesktopSessionCatalogStatus>
  getSession(sessionId: string): Promise<DesktopSessionSnapshot>
  getActiveSessionId(): Promise<string | null>
  setActiveSession(sessionId: string | null): Promise<void>
  updateSessionMetadata(
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ): Promise<DesktopSessionSnapshot>
  renameSession(
    sessionId: string,
    name: string,
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
  submitSessionFollowUp(
    sessionId: string,
    input: DesktopUserMessageInput,
    behavior: DesktopFollowUpBehavior,
  ): Promise<'steered' | 'queued'>
  updateQueuedFollowUp(
    sessionId: string,
    followUpId: string,
    input: DesktopUserMessageInput,
  ): Promise<DesktopSessionSnapshot>
  removeQueuedFollowUp(
    sessionId: string,
    followUpId: string,
  ): Promise<DesktopSessionSnapshot>
  sendQueuedFollowUpNow(
    sessionId: string,
    followUpId: string,
  ): Promise<void>
  reorderQueuedFollowUps(
    sessionId: string,
    followUpIds: string[],
  ): Promise<DesktopSessionSnapshot>
  resumeQueuedFollowUps(sessionId: string): Promise<DesktopSessionSnapshot>
  compactSession(sessionId: string): Promise<void>
  getSessionPromptPreview(sessionId: string): Promise<unknown>
  rollbackSession(
    input: DesktopRollbackRequest,
  ): Promise<DesktopRollbackResult>
  getSessionGoal(sessionId: string): Promise<DesktopThreadGoal | null>
  setSessionGoal(
    sessionId: string,
    input: {
      objective?: string
      status?: 'active' | 'paused' | 'complete'
    },
  ): Promise<DesktopThreadGoal>
  clearSessionGoal(sessionId: string): Promise<boolean>
  startSessionReview(
    sessionId: string,
    target: DesktopAiReviewTarget,
  ): Promise<DesktopAiReviewStartResult>
  listRuntimePermissionProfiles(
    workspacePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<DesktopCatalogResult<DesktopRuntimePermissionProfile[]>>
  setSessionPermissionProfile(
    sessionId: string,
    profile: string,
    approvalPolicy?: DesktopApprovalPolicy,
  ): Promise<DesktopSessionSnapshot>
  listRuntimeSkills(
    workspacePath?: string | null,
    options?: { forceReload?: boolean },
  ): Promise<DesktopCatalogResult<DesktopInstalledSkill[]>>
  readRuntimeSkill(
    path: string,
    workspacePath?: string | null,
  ): Promise<DesktopInstalledSkillDetails>
  setRuntimeSkillEnabled(
    path: string,
    enabled: boolean,
  ): Promise<DesktopInstalledSkill>
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
  getDataLocation(): Promise<DesktopDataLocationState>
  chooseDataLocation(): Promise<DesktopDataLocationMigrationResult | null>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onWorkflowEvent(callback: (event: DesktopWorkflowEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
  onSessionStoreChange(callback: (change: DesktopSessionStoreChange) => void): () => void
  onDesktopSettingsChange(callback: (change: DesktopSettingsChange) => void): () => void
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
