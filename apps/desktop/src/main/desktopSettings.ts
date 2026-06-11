import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  DesktopDrawerTab,
  DesktopPermissionMode,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
  ModelProviderID,
} from '../shared/types.js'

const SETTINGS_FILE_NAME = 'settings.json'

const PERMISSION_MODES = new Set<DesktopPermissionMode>([
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
])
const THINKING_MODES = new Set<DesktopThinkingMode>([
  'default',
  'enabled',
  'adaptive',
  'disabled',
])
const DRAWER_TABS = new Set<DesktopDrawerTab>([
  'files',
  'diff',
  'permissions',
  'toolLog',
  'settings',
])
const PROVIDERS = new Set<ModelProviderID>([
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
  'groq',
  'custom',
])

export function getDesktopConfigDirectoryPath(): string {
  return join(getOpenAgentConfigHomeDir(), 'desktop')
}

export function getOpenAgentConfigHomeDir(): string {
  return join(homedir(), '.oh-my-openagent')
}

function getDesktopSettingsPath(): string {
  return join(getDesktopConfigDirectoryPath(), SETTINGS_FILE_NAME)
}

export function defaultDesktopStoredSettings(): DesktopStoredSettings {
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
    drawerTab: 'files',
    selectedModelPreset: '',
    providerID: 'anthropic',
    providerBaseURL: '',
    showContextUsage: true,
  }
}

export async function readDesktopStoredSettings(): Promise<DesktopStoredSettings> {
  try {
    const raw = await readFile(getDesktopSettingsPath(), 'utf8')
    return normalizeDesktopStoredSettings(JSON.parse(raw))
  } catch {
    return defaultDesktopStoredSettings()
  }
}

export async function saveDesktopStoredSettings(
  settings: DesktopStoredSettings,
): Promise<DesktopStoredSettings> {
  const normalized = normalizeDesktopStoredSettings(settings)
  const settingsPath = getDesktopSettingsPath()
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(normalized, null, 2), 'utf8')
  return normalized
}

function normalizeDesktopStoredSettings(value: unknown): DesktopStoredSettings {
  const parsed =
    value && typeof value === 'object'
      ? (value as Partial<DesktopStoredSettings>)
      : {}
  const defaults = defaultDesktopStoredSettings()
  return {
    permissionMode: isPermissionMode(parsed.permissionMode)
      ? parsed.permissionMode
      : defaults.permissionMode,
    model: stringOrDefault(parsed.model, defaults.model),
    fallbackModel: stringOrDefault(parsed.fallbackModel, defaults.fallbackModel),
    sessionName: stringOrDefault(parsed.sessionName, defaults.sessionName),
    thinkingMode: isThinkingMode(parsed.thinkingMode)
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
    recentWorkspaces: normalizeWorkspaces(parsed.recentWorkspaces),
    drawerTab: isDrawerTab(parsed.drawerTab)
      ? parsed.drawerTab
      : defaults.drawerTab,
    selectedModelPreset: stringOrDefault(
      parsed.selectedModelPreset,
      defaults.selectedModelPreset,
    ),
    providerID: isProvider(parsed.providerID)
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
  }
}

function normalizeWorkspaces(value: unknown): DesktopWorkspace[] {
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

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function isPermissionMode(value: unknown): value is DesktopPermissionMode {
  return typeof value === 'string' && PERMISSION_MODES.has(value as DesktopPermissionMode)
}

function isThinkingMode(value: unknown): value is DesktopThinkingMode {
  return typeof value === 'string' && THINKING_MODES.has(value as DesktopThinkingMode)
}

function isDrawerTab(value: unknown): value is DesktopDrawerTab {
  return typeof value === 'string' && DRAWER_TABS.has(value as DesktopDrawerTab)
}

function isProvider(value: unknown): value is ModelProviderID {
  return typeof value === 'string' && PROVIDERS.has(value as ModelProviderID)
}
