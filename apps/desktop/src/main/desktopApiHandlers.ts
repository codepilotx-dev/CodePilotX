import { shell } from 'electron'
import {
  getAuthStatus,
  getRuntimeStatus,
} from './authRuntimeService.js'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import {
  fetchProviderBalance,
  fetchProviderModels,
  getModelProviderState,
  listModelProviders,
  saveModelProvider,
  saveProviderApiKey,
} from './modelProviderService.js'
import {
  listDesktopMcpServers,
  removeDesktopMcpServer,
  saveDesktopMcpServer,
  setDesktopMcpServerEnabled,
} from './mcpSettingsService.js'
import {
  readDesktopThemeSettings,
  saveDesktopThemeSettings,
} from './themeSettings.js'
import type { DesktopApiHandlers } from './ipc.js'
import { createDesktopApiHandlers } from './ipc.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'
import type { DesktopWindowService } from './windowService.js'
import {
  checkoutWorkspaceBranch,
  chooseWorkspace,
  commitWorkspaceChanges,
  createPullRequest,
  createWorkspaceBranch,
  getWorkspaceGitStatus,
  getWorkspaceContext,
  getWorkspaceDiff,
  listOpenTargets,
  listWorkspaceFiles,
  openPathWithDefaultTarget,
  pushWorkspaceBranch,
  openWorkspace,
  readWorkspaceFile,
  registerAllowedWorkspaces,
} from './workspaceService.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopBuiltinPlugin,
  DesktopPermissionDecision,
  DesktopSessionMetadataPatch,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
} from '../shared/types.js'

export type DesktopApiHandlerDependencies = {
  windowService: DesktopWindowService
  getRuntimeOptions(): {
    agentExecutablePath: string
    configDirectoryPath: string
    runtimePreference: DesktopAgentRuntimePreference
    runtimeSelectionSource: 'default' | 'env'
  }
  listBuiltinPlugins(): Promise<DesktopBuiltinPlugin[]>
  setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<DesktopBuiltinPlugin>
  createSession(
    options: CreateDesktopSessionOptions,
  ): Promise<CreateDesktopSessionResult>
  listSessions(): Promise<DesktopSessionSnapshot[]>
  getSession(sessionId: string): Promise<DesktopSessionSnapshot>
  getActiveSessionId(): Promise<string | null>
  setActiveSession(sessionId: string | null): Promise<void>
  updateSessionMetadata(
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ): Promise<DesktopSessionSnapshot>
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
}

export function buildDesktopApiHandlers(
  dependencies: DesktopApiHandlerDependencies,
): DesktopApiHandlers {
  const { windowService } = dependencies
  return createDesktopApiHandlers({
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus: async () => getRuntimeStatus(dependencies.getRuntimeOptions()),
    getDesktopSettings: async () => {
      const settings = await readDesktopStoredSettings()
      registerRecentWorkspaces(settings)
      return settings
    },
    saveDesktopSettings: async (settings: DesktopStoredSettings) => {
      const savedSettings = await saveDesktopStoredSettings(settings)
      registerRecentWorkspaces(savedSettings)
      return savedSettings
    },
    listBuiltinPlugins: dependencies.listBuiltinPlugins,
    setBuiltinPluginEnabled: dependencies.setBuiltinPluginEnabled,
    listMcpServers: listDesktopMcpServers,
    saveMcpServer: saveDesktopMcpServer,
    removeMcpServer: removeDesktopMcpServer,
    setMcpServerEnabled: setDesktopMcpServerEnabled,
    listOpenTargets,
    openPathWithDefaultTarget,
    listModelProviders: async () => listModelProviders(),
    getModelProviderState: async () => getModelProviderState(),
    fetchProviderModels,
    fetchProviderBalance,
    saveModelProvider,
    saveProviderApiKey,
    chooseWorkspace,
    openWorkspace,
    getWorkspaceContext,
    checkoutWorkspaceBranch,
    getWorkspaceGitStatus,
    createWorkspaceBranch,
    commitWorkspaceChanges,
    pushWorkspaceBranch,
    createPullRequest,
    listWorkspaceFiles,
    readWorkspaceFile,
    getWorkspaceDiff,
    getThemeSettings: readDesktopThemeSettings,
    saveThemeSettings: saveDesktopThemeSettings,
    createSession: dependencies.createSession,
    listSessions: dependencies.listSessions,
    getSession: dependencies.getSession,
    getActiveSessionId: dependencies.getActiveSessionId,
    setActiveSession: dependencies.setActiveSession,
    updateSessionMetadata: dependencies.updateSessionMetadata,
    readWorkflowEventLog: async () => windowService.readWorkflowEventLog(),
    openExternalURL,
    sendUserMessage: dependencies.sendUserMessage,
    respondToPermission: dependencies.respondToPermission,
    interruptSession: dependencies.interruptSession,
    disposeSession: dependencies.disposeSession,
    minimizeWindow: async () => windowService.minimizeWindow(),
    toggleWindowMaximized: async () => windowService.toggleWindowMaximized(),
    closeWindow: async () => windowService.closeWindow(),
    isWindowMaximized: async () => windowService.isWindowMaximized(),
    newWindow: async () => windowService.newWindow(),
    openDevTools: async () => windowService.openDevTools(),
    openSettings: async () => windowService.openSettings(),
    logOut: async () => windowService.logOut(),
    exitApp: async () => windowService.exitApp(),
  })
}

function registerRecentWorkspaces(settings: DesktopStoredSettings): void {
  registerAllowedWorkspaces(
    settings.recentWorkspaces.map(workspace => workspace.path),
  )
}

async function openExternalURL(url: string): Promise<void> {
  const parsed = new URL(requireNonEmptyString(url, 'External URL'))
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS external URLs can be opened.')
  }
  await shell.openExternal(parsed.toString())
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`)
  }
  return trimmed
}
