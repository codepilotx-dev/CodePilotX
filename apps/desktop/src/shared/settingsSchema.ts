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
    permissionMode: 'default',
    model: '',
    fallbackModel: '',
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
    allowForcePush: false,
    commitMessagePrompt: '',
    pullRequestPrompt: '',
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
    permissionMode: normalizeDesktopPermissionMode(parsed.permissionMode),
    model: migrateModelAlias(stringOrDefault(parsed.model, defaults.model)),
    fallbackModel: stringOrDefault(parsed.fallbackModel, defaults.fallbackModel),
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
  }
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

export function isDesktopDrawerTab(value: unknown): value is DesktopDrawerTab {
  return (
    typeof value === 'string' &&
    DESKTOP_DRAWER_TABS.has(value as DesktopDrawerTab)
  )
}

export function isModelProviderID(value: unknown): value is ModelProviderID {
  return typeof value === 'string' && value.trim().length > 0
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
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
