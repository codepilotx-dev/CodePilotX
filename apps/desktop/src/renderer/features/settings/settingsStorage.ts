import type { AppView, DrawerTab } from '../../uiTypes.js'
import type { DesktopPermissionMode, DesktopThinkingMode, DesktopWorkspace } from '../../../shared/types.js'

export const PERMISSION_MODE_OPTIONS: Array<{
  value: DesktopPermissionMode
  label: string
  detail: string
}> = [
  {
    value: 'default',
    label: '自动审查',
    detail: '编辑和高风险工具会按原有规则请求确认。',
  },
  {
    value: 'acceptEdits',
    label: '允许编辑',
    detail: '默认允许文件编辑，其他高风险动作仍会确认。',
  },
  {
    value: 'plan',
    label: '规划模式',
    detail: '先分析和规划，再决定是否实施。',
  },
  {
    value: 'dontAsk',
    label: '严格拦截',
    detail: '需要额外确认的动作会被拒绝。',
  },
  {
    value: 'bypassPermissions',
    label: '免确认',
    detail: '跳过权限询问，直接执行会话内动作。',
  },
]

export const THINKING_MODE_OPTIONS: Array<{
  value: DesktopThinkingMode
  label: string
}> = [
  { value: 'disabled', label: '低' },
  { value: 'default', label: '中' },
  { value: 'adaptive', label: '高' },
  { value: 'enabled', label: '超高' },
]

export const DESKTOP_SETTINGS_STORAGE_KEY = 'claude-code-desktop-settings'
export const MAX_RECENT_WORKSPACES = 5

export type StoredDesktopSettings = {
  permissionMode: DesktopPermissionMode
  model: string
  fallbackModel: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  activeView: AppView
  drawerTab: DrawerTab
  selectedModelPreset: string
}

export function defaultDesktopSettings(): StoredDesktopSettings {
  return {
    permissionMode: 'default',
    model: '',
    fallbackModel: '',
    sessionName: '',
    thinkingMode: 'default',
    systemPrompt: '',
    appendSystemPrompt: '',
    additionalDirectories: '',
    recentWorkspaces: [],
    activeView: 'quickChat',
    drawerTab: 'files',
    selectedModelPreset: '',
  }
}

export function upsertRecentWorkspace(
  workspaces: DesktopWorkspace[],
  workspace: DesktopWorkspace,
): DesktopWorkspace[] {
  const filtered = workspaces.filter(item => item.path !== workspace.path)
  return [workspace, ...filtered].slice(0, MAX_RECENT_WORKSPACES)
}

function isDesktopPermissionMode(value: unknown): value is DesktopPermissionMode {
  return PERMISSION_MODE_OPTIONS.some(option => option.value === value)
}

function isDesktopThinkingMode(value: unknown): value is DesktopThinkingMode {
  return THINKING_MODE_OPTIONS.some(option => option.value === value)
}

function isAppView(value: unknown): value is AppView {
  return (
    value === 'quickChat' ||
    value === 'search' ||
    value === 'plugins' ||
    value === 'automation'
  )
}

function isDrawerTab(value: unknown): value is DrawerTab {
  return (
    value === 'files' ||
    value === 'diff' ||
    value === 'permissions' ||
    value === 'toolLog' ||
    value === 'settings'
  )
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function parseStoredRecentWorkspaces(value: unknown): DesktopWorkspace[] {
  if (!Array.isArray(value)) return []
  const workspaces: DesktopWorkspace[] = []
  for (const item of value) {
    if (
      item &&
      typeof item === 'object' &&
      isString((item as DesktopWorkspace).name) &&
      isString((item as DesktopWorkspace).path)
    ) {
      workspaces.push({
        name: (item as DesktopWorkspace).name,
        path: (item as DesktopWorkspace).path,
        branchName:
          typeof (item as DesktopWorkspace).branchName === 'string'
            ? (item as DesktopWorkspace).branchName
            : null,
        isGitRepo:
          typeof (item as DesktopWorkspace).isGitRepo === 'boolean'
            ? (item as DesktopWorkspace).isGitRepo
            : undefined,
      })
    }
  }
  return workspaces
}

export function readStoredDesktopSettings(): StoredDesktopSettings {
  try {
    const raw = window.localStorage.getItem(DESKTOP_SETTINGS_STORAGE_KEY)
    if (!raw) return defaultDesktopSettings()
    const parsed = JSON.parse(raw) as {
      permissionMode?: unknown
      model?: unknown
      fallbackModel?: unknown
      sessionName?: unknown
      thinkingMode?: unknown
      systemPrompt?: unknown
      appendSystemPrompt?: unknown
      additionalDirectories?: unknown
      recentWorkspaces?: unknown
      activeView?: unknown
      drawerTab?: unknown
      selectedModelPreset?: unknown
    }
    return {
      permissionMode: isDesktopPermissionMode(parsed.permissionMode)
        ? parsed.permissionMode
        : 'default',
      model: isString(parsed.model) ? parsed.model : '',
      fallbackModel: isString(parsed.fallbackModel) ? parsed.fallbackModel : '',
      sessionName: isString(parsed.sessionName) ? parsed.sessionName : '',
      thinkingMode: isDesktopThinkingMode(parsed.thinkingMode)
        ? parsed.thinkingMode
        : 'default',
      systemPrompt: isString(parsed.systemPrompt) ? parsed.systemPrompt : '',
      appendSystemPrompt: isString(parsed.appendSystemPrompt)
        ? parsed.appendSystemPrompt
        : '',
      additionalDirectories: isString(parsed.additionalDirectories)
        ? parsed.additionalDirectories
        : '',
      recentWorkspaces: parseStoredRecentWorkspaces(parsed.recentWorkspaces),
      activeView: isAppView(parsed.activeView) ? parsed.activeView : 'quickChat',
      drawerTab: isDrawerTab(parsed.drawerTab) ? parsed.drawerTab : 'files',
      selectedModelPreset: isString(parsed.selectedModelPreset)
        ? parsed.selectedModelPreset
        : '',
    }
  } catch {
    return defaultDesktopSettings()
  }
}

export function storeDesktopSettings(settings: StoredDesktopSettings): void {
  window.localStorage.setItem(
    DESKTOP_SETTINGS_STORAGE_KEY,
    JSON.stringify(settings),
  )
}

export function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function parseAdditionalDirectories(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
}
