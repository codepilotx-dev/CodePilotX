import { shell } from 'electron'
import { join } from 'node:path'
import {
  getAuthStatus,
  getRuntimeStatus,
} from './authRuntimeService.js'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import {
  deleteProviderApiKey,
  fetchProviderBalance,
  fetchProviderModels,
  getModelProviderState,
  listModelProviders,
  saveModelProvider,
  saveProviderApiKey,
} from './modelProviderService.js'
import {
  getCopilotAuthStatus,
  startCopilotLogin,
  pollCopilotLogin,
  cancelCopilotLogin,
} from './copilotAuthService.js'
import {
  cloneGithubRepository,
  getGithubAuthStatus,
  listGithubRepositories,
  logoutGithub,
  pollGithubLogin,
  startGithubLogin,
} from './githubService.js'
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
import {
  installDesktopSkill,
  listDesktopSkillCatalog,
} from './skillsCatalogService.js'
import type { DesktopApiHandlers } from './ipc.js'
import { createDesktopApiHandlers } from './ipc.js'
import { desktopAutoUpdater } from './autoUpdater.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'
import {
  chooseDesktopComposerFiles,
  readDesktopComposerAttachments,
} from './desktopComposerAttachments.js'
import { readOptionalWorkspaceFile } from './optionalWorkspaceFile.js'
import type { DesktopWindowService } from './windowService.js'
import {
  checkoutWorkspaceBranch,
  chooseWorkspace,
  commitWorkspaceChanges,
  createPullRequest,
  createWorkspaceBranch,
  discardWorkspaceChanges,
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
  DesktopPermissionMode,
  DesktopSlashCommandSuggestion,
  DesktopSessionMetadataPatch,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopUserMessageInput,
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
  listSlashCommands(workspacePath?: string): Promise<DesktopSlashCommandSuggestion[]>
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
  setSessionPermissionMode(
    sessionId: string,
    mode: DesktopPermissionMode,
  ): Promise<DesktopSessionSnapshot>
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
    listSkillsCatalog: listDesktopSkillCatalog,
    installSkill: installDesktopSkill,
    listSlashCommands: dependencies.listSlashCommands,
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
    deleteProviderApiKey,
    getCopilotAuthStatus,
    startCopilotLogin,
    pollCopilotLogin,
    cancelCopilotLogin,
    getGithubAuthStatus,
    startGithubLogin,
    pollGithubLogin,
    logoutGithub,
    listGithubRepositories,
    cloneGithubRepository,
    chooseWorkspace,
    openWorkspace,
    getWorkspaceContext,
    checkoutWorkspaceBranch,
    getWorkspaceGitStatus,
    createWorkspaceBranch,
    commitWorkspaceChanges,
    pushWorkspaceBranch,
    discardWorkspaceChanges,
    createPullRequest,
    listWorkspaceFiles,
    readWorkspaceFile,
    readOptionalWorkspaceFile: (workspacePath, filePath) =>
      readOptionalWorkspaceFile(readWorkspaceFile, workspacePath, filePath),
    chooseComposerFiles: chooseDesktopComposerFiles,
    readComposerFiles: readDesktopComposerAttachments,
    getWorkspaceDiff,
    getThemeSettings: readDesktopThemeSettings,
    saveThemeSettings: saveDesktopThemeSettings,
    createSession: dependencies.createSession,
    listSessions: dependencies.listSessions,
    getSession: dependencies.getSession,
    getActiveSessionId: dependencies.getActiveSessionId,
    setActiveSession: dependencies.setActiveSession,
    updateSessionMetadata: dependencies.updateSessionMetadata,
    setSessionPermissionMode: dependencies.setSessionPermissionMode,
    readWorkflowEventLog: async () => windowService.readWorkflowEventLog(),
    openConfigFile: async () => openConfigFile(dependencies.getRuntimeOptions()),
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
    checkForUpdates: async () => {
      desktopAutoUpdater?.checkForUpdates()
    },
    downloadUpdate: async () => {
      desktopAutoUpdater?.downloadUpdate()
    },
    quitAndInstall: async () => {
      desktopAutoUpdater?.quitAndInstall()
    },
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

async function openConfigFile(options: {
  configDirectoryPath: string
}): Promise<{ path: string }> {
  const configDirectory = requireNonEmptyString(
    options.configDirectoryPath,
    'Config directory path',
  )
  const configPath = join(configDirectory, 'config.toml')
  const errorMessage = await shell.openPath(configPath)
  if (errorMessage) {
    throw new Error(errorMessage)
  }
  return { path: configPath }
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
