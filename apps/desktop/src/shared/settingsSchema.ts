import {
  DESKTOP_AGENT_PERMISSION_MODES,
  isDesktopAgentPermissionMode,
  normalizeDesktopAgentPermissionMode,
  permissionPolicyForDesktopMode,
} from '@codepilotx/core/agent/permissions.js'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import type {
  DesktopDrawerTab,
  DesktopPermissionMode,
  DesktopPersonality,
  DesktopReviewView,
  DesktopSandboxMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
} from './types.js'

export const DESKTOP_PERMISSION_MODES = new Set<DesktopPermissionMode>([
  ...DESKTOP_AGENT_PERMISSION_MODES,
])

export const DESKTOP_THINKING_MODES = new Set<DesktopThinkingMode>([
  'default',
  'enabled',
  'adaptive',
  'disabled',
])

export const DESKTOP_SANDBOX_MODES = new Set<DesktopSandboxMode>([
  'read-only',
  'workspace-write',
  'full-access',
  'danger-full-access',
])

export const DESKTOP_PERSONALITIES = new Set<DesktopPersonality>([
  'pragmatic',
  'friendly',
  'concise',
  'encouraging',
])

export const DESKTOP_REVIEW_VIEWS = new Set<DesktopReviewView>([
  'inline',
  'split',
])

export const DESKTOP_DRAWER_TABS = new Set<DesktopDrawerTab>([
  'files',
  'diff',
  'permissions',
  'toolLog',
  'settings',
])

export const MAX_RECENT_WORKSPACES = 5

export function defaultDesktopStoredSettings(): DesktopStoredSettings {
  return {
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    model: '',
    reviewModel: '',
    smallFastModel: '',
    fastModel: '',
    defaultModel: '',
    deepModel: '',
    sessionName: '',
    thinkingMode: 'default',
    systemPrompt: '',
    appendSystemPrompt: '',
    additionalDirectories: '',
    recentWorkspaces: [],
    drawerTab: 'files',
    selectedModelPreset: '',
    providerID: 'minimax',
    providerBaseURL: '',
    showContextUsage: true,
    defaultOpenTargetId: 'default-app',
gitBranchPrefix: 'codex/',
    gitPrMergeMethod: 'merge',
    gitShowPrIconsInSidebar: true,
    gitDraftPullRequest: true,
    gitAutoDeleteWorktree: true,
    gitAutoDeleteWorktreeLimit: 15,
    allowForcePush: false,
    commitMessagePrompt: '',
    pullRequestPrompt: '',
    githubOAuthClientId: '',
    installCodexDependencies: true,
    personality: 'pragmatic',
    customInstructions: '',
    enableMemory: false,
    skipToolAidedChats: false,
    githubMemorySyncEnabled: false,
    githubMemoryRepository: '',
    reviewView: 'inline',
    rustSearchAndDiffKernels: false,
    browserAllowedSites: [],
  }
}

export function normalizeDesktopStoredSettings(
  value: unknown,
): DesktopStoredSettings {
  const parsed =
    value && typeof value === 'object'
      ? (value as Partial<DesktopStoredSettings>)
      : {}
  const defaults = defaultDesktopStoredSettings()
  return {
    permissionProfile: normalizeDesktopPermissionProfile(
      parsed.permissionProfile,
      defaults.permissionProfile,
    ),
    approvalPolicy: normalizeDesktopApprovalPolicy(
      parsed.approvalPolicy,
      defaults.approvalPolicy,
    ),
    approvalsReviewer: normalizeDesktopApprovalsReviewer(
      parsed.approvalsReviewer,
      defaults.approvalsReviewer,
    ),
    permissionMode: normalizeDesktopPermissionMode(parsed.permissionMode),
    model: migrateModelAlias(stringOrDefault(parsed.model, defaults.model)),
    reviewModel: stringOrDefault(parsed.reviewModel, defaults.reviewModel),
    smallFastModel: stringOrDefault(
      parsed.smallFastModel,
      defaults.smallFastModel,
    ),
    fastModel: stringOrDefault(
      parsed.fastModel,
      stringOrDefault(
        (parsed as { haikuModel?: unknown }).haikuModel,
        defaults.fastModel,
      ),
    ),
    defaultModel: stringOrDefault(
      parsed.defaultModel,
      stringOrDefault(
        (parsed as { sonnetModel?: unknown }).sonnetModel,
        defaults.defaultModel,
      ),
    ),
    deepModel: stringOrDefault(
      parsed.deepModel,
      stringOrDefault(
        (parsed as { opusModel?: unknown }).opusModel,
        defaults.deepModel,
      ),
    ),
    sessionName: stringOrDefault(parsed.sessionName, defaults.sessionName),
    thinkingMode: isDesktopThinkingMode(parsed.thinkingMode)
      ? parsed.thinkingMode
      : defaults.thinkingMode,
    systemPrompt: stringOrDefault(parsed.systemPrompt, defaults.systemPrompt),
    appendSystemPrompt: stringOrDefault(
      parsed.appendSystemPrompt,
      defaults.appendSystemPrompt,
    ),
    additionalDirectories: stringOrDefault(
      parsed.additionalDirectories,
      defaults.additionalDirectories,
    ),
    recentWorkspaces: normalizeDesktopWorkspaces(parsed.recentWorkspaces),
    drawerTab: isDesktopDrawerTab(parsed.drawerTab)
      ? parsed.drawerTab
      : defaults.drawerTab,
    selectedModelPreset: stringOrDefault(
      parsed.selectedModelPreset,
      defaults.selectedModelPreset,
    ),
    providerID: parsed.providerID === 'anthropic'
      ? defaults.providerID
      : isModelProviderID(parsed.providerID)
      ? parsed.providerID
      : defaults.providerID,
    providerBaseURL: stringOrDefault(
      parsed.providerBaseURL,
      defaults.providerBaseURL,
    ),
    showContextUsage:
      typeof parsed.showContextUsage === 'boolean'
        ? parsed.showContextUsage
        : defaults.showContextUsage,
    defaultOpenTargetId: stringOrDefault(
      parsed.defaultOpenTargetId,
      defaults.defaultOpenTargetId,
    ),
    gitBranchPrefix: stringOrDefault(
      parsed.gitBranchPrefix,
      defaults.gitBranchPrefix,
    ),
    gitPrMergeMethod: isDesktopGitPrMergeMethod(parsed.gitPrMergeMethod)
      ? parsed.gitPrMergeMethod
      : defaults.gitPrMergeMethod,
    gitShowPrIconsInSidebar:
      typeof parsed.gitShowPrIconsInSidebar === 'boolean'
        ? parsed.gitShowPrIconsInSidebar
        : defaults.gitShowPrIconsInSidebar,
    gitDraftPullRequest:
      typeof parsed.gitDraftPullRequest === 'boolean'
        ? parsed.gitDraftPullRequest
        : defaults.gitDraftPullRequest,
    gitAutoDeleteWorktree:
      typeof parsed.gitAutoDeleteWorktree === 'boolean'
        ? parsed.gitAutoDeleteWorktree
        : defaults.gitAutoDeleteWorktree,
    gitAutoDeleteWorktreeLimit: normalizeGitWorktreeLimit(
      parsed.gitAutoDeleteWorktreeLimit,
      defaults.gitAutoDeleteWorktreeLimit,
    ),
    allowForcePush:
      typeof parsed.allowForcePush === 'boolean'
        ? parsed.allowForcePush
        : defaults.allowForcePush,
    commitMessagePrompt: stringOrDefault(
      parsed.commitMessagePrompt,
      defaults.commitMessagePrompt,
    ),
    pullRequestPrompt: stringOrDefault(
      parsed.pullRequestPrompt,
      defaults.pullRequestPrompt,
    ),
    githubOAuthClientId: stringOrDefault(
      parsed.githubOAuthClientId,
      defaults.githubOAuthClientId,
    ),
    installCodexDependencies:
      typeof parsed.installCodexDependencies === 'boolean'
        ? parsed.installCodexDependencies
        : defaults.installCodexDependencies,
    personality: isDesktopPersonality(parsed.personality)
      ? parsed.personality
      : defaults.personality,
    customInstructions: stringOrDefault(
      parsed.customInstructions,
      defaults.customInstructions,
    ),
    enableMemory:
      typeof parsed.enableMemory === 'boolean'
        ? parsed.enableMemory
        : defaults.enableMemory,
    skipToolAidedChats:
      typeof parsed.skipToolAidedChats === 'boolean'
        ? parsed.skipToolAidedChats
        : defaults.skipToolAidedChats,
    githubMemorySyncEnabled:
      typeof parsed.githubMemorySyncEnabled === 'boolean'
        ? parsed.githubMemorySyncEnabled
        : defaults.githubMemorySyncEnabled,
    githubMemoryRepository: stringOrDefault(
      parsed.githubMemoryRepository,
      defaults.githubMemoryRepository,
    ),
    reviewView: isDesktopReviewView(parsed.reviewView)
      ? parsed.reviewView
      : defaults.reviewView,
    rustSearchAndDiffKernels:
      typeof parsed.rustSearchAndDiffKernels === 'boolean'
        ? parsed.rustSearchAndDiffKernels
        : defaults.rustSearchAndDiffKernels,
    browserAllowedSites: normalizeStringList(
      parsed.browserAllowedSites,
      defaults.browserAllowedSites,
    ),
  }
}

export function normalizeDesktopPermissionProfile(
  value: unknown,
  fallback = ':workspace',
): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export function normalizeDesktopApprovalPolicy(
  value: unknown,
  fallback: DesktopStoredSettings['approvalPolicy'] = 'on-request',
): DesktopStoredSettings['approvalPolicy'] {
  return value === 'untrusted' ||
    value === 'on-request' ||
    value === 'on-failure' ||
    value === 'never'
    ? value
    : fallback
}

export function normalizeDesktopApprovalsReviewer(
  value: unknown,
  fallback: DesktopStoredSettings['approvalsReviewer'] = 'user',
): DesktopStoredSettings['approvalsReviewer'] {
  if (value === 'auto') return 'auto_review'
  return value === 'user' || value === 'auto_review' ? value : fallback
}

export function normalizeDesktopWorkspaces(value: unknown): DesktopWorkspace[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const workspace = item as Partial<DesktopWorkspace>
    if (workspace.isStandalone) return []
    if (typeof workspace.name !== 'string') return []
    if (typeof workspace.path !== 'string') return []
    return [
      {
        name: workspace.name,
        path: workspace.path,
        branchName:
          typeof workspace.branchName === 'string'
            ? workspace.branchName
            : null,
        isGitRepo:
          typeof workspace.isGitRepo === 'boolean'
            ? workspace.isGitRepo
            : undefined,
      },
    ]
  })
}

export function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  if (workspace.isStandalone) return workspaces
  const filtered = workspaces.filter(item => item.path !== workspace.path)
  return [workspace, ...filtered].slice(0, MAX_RECENT_WORKSPACES)
}

export function mergeDesktopBrowserAllowedSites(
  current: string[],
  incoming: string[],
): string[] {
  return [...current, ...incoming].filter(
    (site, index, sites) => sites.indexOf(site) === index,
  )
}

export function isDesktopPermissionMode(
  value: unknown,
): value is DesktopPermissionMode {
  return isDesktopAgentPermissionMode(value)
}

export function normalizeDesktopPermissionMode(
  value: unknown,
): DesktopPermissionMode {
  return normalizeDesktopAgentPermissionMode(
    typeof value === 'string' ? value : undefined,
  )
}

export function desktopPermissionPolicyForMode(
  mode: DesktopPermissionMode | undefined,
): AgentPermissionPolicy {
  return permissionPolicyForDesktopMode(mode)
}

export function isDesktopThinkingMode(
  value: unknown,
): value is DesktopThinkingMode {
  return (
    typeof value === 'string' &&
    DESKTOP_THINKING_MODES.has(value as DesktopThinkingMode)
  )
}

export function isDesktopSandboxMode(
  value: unknown,
): value is DesktopSandboxMode {
  return (
    typeof value === 'string' &&
    DESKTOP_SANDBOX_MODES.has(value as DesktopSandboxMode)
  )
}

export function isDesktopPersonality(
  value: unknown,
): value is DesktopPersonality {
  return (
    typeof value === 'string' &&
    DESKTOP_PERSONALITIES.has(value as DesktopPersonality)
  )
}

export function isDesktopReviewView(
  value: unknown,
): value is DesktopReviewView {
  return (
    typeof value === 'string' &&
    DESKTOP_REVIEW_VIEWS.has(value as DesktopReviewView)
  )
}

export function isDesktopDrawerTab(value: unknown): value is DesktopDrawerTab {
  return (
    typeof value === 'string' &&
    DESKTOP_DRAWER_TABS.has(value as DesktopDrawerTab)
  )
}

export const DESKTOP_GIT_PR_MERGE_METHODS = new Set<'merge' | 'squash'>([
  'merge',
  'squash',
])

export function isDesktopGitPrMergeMethod(
  value: unknown,
): value is 'merge' | 'squash' {
  return typeof value === 'string' && DESKTOP_GIT_PR_MERGE_METHODS.has(value as 'merge' | 'squash')
}

export function normalizeGitWorktreeLimit(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

export function isModelProviderID(value: unknown): value is ModelProviderID {
  return typeof value === 'string' && value.trim().length > 0
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter(item => typeof item === 'string')
}

function migrateModelAlias(model: string): string {
  switch (model) {
    case 'haiku':
      return 'fast'
    case 'sonnet':
      return 'default'
    case 'opus':
    case 'best':
      return 'deep'
    case 'opusplan':
      return 'plan'
    case 'sonnet[1m]':
      return 'default[1m]'
    case 'opus[1m]':
      return 'deep[1m]'
    default:
      return model
  }
}
