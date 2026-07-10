import {
  DESKTOP_AGENT_PERMISSION_MODES,
  isDesktopAgentPermissionMode,
  normalizeDesktopAgentPermissionMode,
  permissionPolicyForDesktopMode,
} from '@codepilotx/core/agent/permissions.js'
import type { AgentPermissionPolicy } from '@codepilotx/core/agent/permissions.js'
import type {
  DesktopDrawerTab,
  DesktopDiffMarkerStyle,
  DesktopPermissionMode,
  DesktopPersonality,
  DesktopReviewView,
  DesktopSandboxMode,
  DesktopSidebarOrganization,
  DesktopSidebarSort,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
  LocalRouterMode,
  ModelProviderID,
  SidebarSectionId,
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

export const DESKTOP_DIFF_MARKER_STYLES = new Set<DesktopDiffMarkerStyle>([
  'color',
  'symbol',
])

export const DESKTOP_SIDEBAR_ORGANIZATIONS = new Set<DesktopSidebarOrganization>([
  'projects',
  'flat',
])

export const DESKTOP_SIDEBAR_SORTS = new Set<DesktopSidebarSort>([
  'priority',
  'recent',
  'manual',
])

export const DESKTOP_DRAWER_TABS = new Set<DesktopDrawerTab>([
  'files',
  'diff',
  'permissions',
  'toolLog',
  'settings',
])

export const MAX_RECENT_WORKSPACES = 5
export const MAX_REMOVED_WORKSPACES = 50

export const VALID_SIDEBAR_SECTION_IDS: readonly SidebarSectionId[] = [
  'pinned',
  'projects',
  'conversations',
]

export function defaultDesktopStoredSettings(): DesktopStoredSettings {
  return {
    enableParetoCodeRouter: false,
    enableFusionRouter: false,
    enableAutoReviewPermissionMode: false,
    enableFullAccessPermissionMode: false,
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    model: '',
    planExecutionModel: '',
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
    providerID: '',
    providerBaseURL: '',
    showContextUsage: true,
    defaultOpenTargetId: 'default-app',
    gitBranchPrefix: 'codepilotx/',
    gitPrMergeMethod: 'merge',
    gitShowPrIconsInSidebar: true,
    gitDraftPullRequest: true,
    gitAutoDeleteWorktree: true,
    gitAutoDeleteWorktreeLimit: 15,
    allowForcePush: false,
    commitMessagePrompt: '',
    pullRequestPrompt: '',
	    githubOAuthClientId: '',
	    authBaseUrl: '',
	    installCodePilotXDependencies: true,
    personality: 'pragmatic',
    customInstructions: '',
    enableMemory: true,
    lastActiveWorkspacePath: '',
    removedWorkspaces: [],
    skipToolAidedChats: false,
    githubMemorySyncEnabled: false,
    githubMemoryRepository: '',
    reviewView: 'inline',
    diffMarkerStyle: 'color',
    rustSearchAndDiffKernels: false,
    sidebarOrganization: 'projects',
    sidebarSort: 'priority',
    sidebarManualOrder: {},
	    browserAllowedSites: [],
	    collapsedSidebarSections: [],
	    browserSitePermissions: [],
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
  const permissionMode = normalizeDesktopPermissionMode(parsed.permissionMode)
  return {
    enableParetoCodeRouter:
      typeof parsed.enableParetoCodeRouter === 'boolean'
        ? parsed.enableParetoCodeRouter
        : defaults.enableParetoCodeRouter,
    enableFusionRouter:
      typeof parsed.enableFusionRouter === 'boolean'
        ? parsed.enableFusionRouter
        : defaults.enableFusionRouter,
    enableAutoReviewPermissionMode:
      typeof parsed.enableAutoReviewPermissionMode === 'boolean'
        ? parsed.enableAutoReviewPermissionMode
        : permissionMode === 'auto-review'
          ? true
          : defaults.enableAutoReviewPermissionMode,
    enableFullAccessPermissionMode:
      typeof parsed.enableFullAccessPermissionMode === 'boolean'
        ? parsed.enableFullAccessPermissionMode
        : permissionMode === 'full-access'
          ? true
          : defaults.enableFullAccessPermissionMode,
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
    permissionMode: permissionMode === 'custom' ? 'default' : permissionMode,
    model: migrateModelAlias(stringOrDefault(parsed.model, defaults.model)),
    planExecutionModel: stringOrDefault(
      parsed.planExecutionModel,
      defaults.planExecutionModel,
    ),
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
    providerID:
      parsed.providerID === 'anthropic'
        ? defaults.providerID
        : typeof parsed.providerID === 'string'
          ? parsed.providerID.trim()
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
	    authBaseUrl: stringOrDefault(
	      parsed.authBaseUrl,
	      defaults.authBaseUrl,
	    ),
	    installCodePilotXDependencies:
      typeof parsed.installCodePilotXDependencies === 'boolean'
        ? parsed.installCodePilotXDependencies
        : defaults.installCodePilotXDependencies,
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
    lastActiveWorkspacePath:
      typeof parsed.lastActiveWorkspacePath === 'string'
        ? parsed.lastActiveWorkspacePath
        : defaults.lastActiveWorkspacePath,
    removedWorkspaces: normalizeRemovedWorkspaces(
      parsed.removedWorkspaces,
      defaults.removedWorkspaces,
    ),
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
    diffMarkerStyle: isDesktopDiffMarkerStyle(parsed.diffMarkerStyle)
      ? parsed.diffMarkerStyle
      : defaults.diffMarkerStyle,
    rustSearchAndDiffKernels:
      typeof parsed.rustSearchAndDiffKernels === 'boolean'
        ? parsed.rustSearchAndDiffKernels
        : defaults.rustSearchAndDiffKernels,
    sidebarOrganization: isDesktopSidebarOrganization(parsed.sidebarOrganization)
      ? parsed.sidebarOrganization
      : defaults.sidebarOrganization,
    sidebarSort: isDesktopSidebarSort(parsed.sidebarSort)
      ? parsed.sidebarSort
      : defaults.sidebarSort,
    sidebarManualOrder: normalizeSidebarManualOrder(
      parsed.sidebarManualOrder,
      defaults.sidebarManualOrder,
    ),
    browserAllowedSites: normalizeStringList(
      parsed.browserAllowedSites,
      defaults.browserAllowedSites,
    ),
    collapsedSidebarSections: normalizeStringList(
      parsed.collapsedSidebarSections,
      defaults.collapsedSidebarSections,
    ).filter(
      (id, index, arr) =>
        (VALID_SIDEBAR_SECTION_IDS as readonly string[]).includes(id) &&
        arr.indexOf(id) === index,
    ) as SidebarSectionId[],
    browserSitePermissions: normalizeBrowserSitePermissions(
      parsed.browserSitePermissions,
      parsed.browserAllowedSites,
    ),
  }
}

function normalizeBrowserSitePermissions(
  value: unknown,
  legacyAllowedSites: unknown,
): DesktopStoredSettings['browserSitePermissions'] {
  if (Array.isArray(value)) {
    return value.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const record = item as {
        origin?: unknown
        decision?: unknown
        updatedAt?: unknown
      }
      if (record.decision !== 'allow' && record.decision !== 'deny') return []
      const origin = normalizeBrowserPermissionOrigin(record.origin)
      if (!origin) return []
      return [
        {
          origin,
          decision: record.decision as 'allow' | 'deny',
          updatedAt:
            typeof record.updatedAt === 'string' ? record.updatedAt : '',
        },
      ]
    }).filter(
      (item, index, items) =>
        items.findIndex(candidate => candidate.origin === item.origin) === index,
    )
  }
  return normalizeStringList(legacyAllowedSites, []).flatMap(site => {
    const origin = normalizeBrowserPermissionOrigin(site)
    return origin
      ? [
          {
            origin,
            decision: 'allow' as const,
            updatedAt: '',
          },
        ]
      : []
  })
}

function normalizeBrowserPermissionOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed === 'file://') return trimmed
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }
  return parsed.origin
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
          pinnedAt:
            typeof workspace.pinnedAt === 'string'
              ? workspace.pinnedAt
              : null,
        },
      ]
  })
}

export function normalizeRemovedWorkspaces(
  value: unknown,
  fallback: DesktopStoredSettings['removedWorkspaces'],
): DesktopStoredSettings['removedWorkspaces'] {
  if (!Array.isArray(value)) return fallback
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as {
      path?: unknown
      name?: unknown
      removedAt?: unknown
    }
    if (typeof record.path !== 'string') return []
    if (typeof record.name !== 'string') return []
    return [
      {
        path: record.path,
        name: record.name,
        removedAt:
          typeof record.removedAt === 'string' ? record.removedAt : new Date().toISOString(),
      },
    ]
  }).slice(0, MAX_REMOVED_WORKSPACES)
}

export function isDesktopDiffMarkerStyle(
  value: unknown,
): value is DesktopDiffMarkerStyle {
  return DESKTOP_DIFF_MARKER_STYLES.has(value as DesktopDiffMarkerStyle)
}

export function isDesktopSidebarOrganization(
  value: unknown,
): value is DesktopSidebarOrganization {
  return DESKTOP_SIDEBAR_ORGANIZATIONS.has(
    value as DesktopSidebarOrganization,
  )
}

export function isDesktopSidebarSort(
  value: unknown,
): value is DesktopSidebarSort {
  return DESKTOP_SIDEBAR_SORTS.has(value as DesktopSidebarSort)
}

export function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  if (workspace.isStandalone) return workspaces
  const index = workspaces.findIndex(item => item.path === workspace.path)
  if (index >= 0) {
    // Update in-place without changing position
    const next = [...workspaces]
    next[index] = {
      ...workspace,
      pinnedAt: workspace.pinnedAt !== undefined
        ? workspace.pinnedAt
        : next[index].pinnedAt ?? null,
    }
    return next
  }
  // Append new workspace to the end
  return [...workspaces, workspace].slice(-MAX_RECENT_WORKSPACES)
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

export { isLocalRouterMode, normalizeLocalRouterMode } from './types.js'
export type { LocalRouterMode } from './types.js'

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  return value.filter(item => typeof item === 'string')
}

function normalizeSidebarManualOrder(
  value: unknown,
  fallback: Record<string, string[]>,
): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback
  }
  const normalized: Record<string, string[]> = {}
  for (const [scopeKey, sessionIds] of Object.entries(value)) {
    if (!Array.isArray(sessionIds)) continue
    const deduped = sessionIds.filter((sessionId, index, list): sessionId is string => {
      return typeof sessionId === 'string' && list.indexOf(sessionId) === index
    })
    if (deduped.length > 0) {
      normalized[scopeKey] = deduped
    }
  }
  return normalized
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
