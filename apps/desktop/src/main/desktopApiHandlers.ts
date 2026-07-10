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
import { mergeDesktopBrowserAllowedSites } from '../shared/settingsSchema.js'
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
  getGithubProfileOverview,
  listGithubRepositories,
  logoutAppAuth,
  logoutGithub,
  pollGithubLogin,
  clearGithubUserStatus,
  setGithubUserStatus,
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
  deleteProjectMemory,
  deleteUserMemory,
  exportUserMemory,
  importUserMemory,
  listProjectMemories,
  listProjectMemoryRecalls,
  listUserMemories,
  readProjectMemory,
  readUserMemory,
  resetProjectMemory,
  resetUserMemory,
  saveProjectMemory,
  saveUserMemory,
} from './desktopMemoryService.js'
import {
  installDesktopSkill,
  listDesktopSkillCatalog,
} from './skillsCatalogService.js'
import type { DesktopApiHandlers } from './ipc.js'
import { createDesktopApiHandlers } from './ipc.js'
import { desktopAutoUpdater } from './autoUpdater.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'
import {
  authorizeComposerFilePaths,
  chooseDesktopComposerFiles,
  readDesktopComposerAttachments,
} from './desktopComposerAttachments.js'
import { readOptionalWorkspaceFile } from './optionalWorkspaceFile.js'
import type { DesktopWindowService } from './windowService.js'
import type { DesktopBrowserService } from './browserService.js'
import {
  checkoutWorkspaceBranch,
  chooseWorkspace,
  commitWorkspaceChanges,
  createPullRequest,
  createWorkspaceBranch,
  discardWorkspaceChanges,
  applyWorkspaceReviewOperation,
  getWorkspaceGitStatus,
  getWorkspaceContext,
  getWorkspaceDiff,
  getWorkspaceReviewDiff,
  listOpenTargets,
  listWorkspaceFiles,
  openPathWithDefaultTarget,
  pushWorkspaceBranch,
  openWorkspace,
  readWorkspaceFile,
  registerAllowedWorkspaces,
} from './workspaceService.js'
import type { DebugToolProbeService } from './debugToolProbeService.js'
import {
  getDataLocationState,
  chooseAndMigrateDataLocation,
} from './desktopDataLocation.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopBuiltinPlugin,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopMcpRuntimeStatus,
  McpReloadResult,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopSlashCommandSuggestion,
  DesktopGitOperationResult,
  DesktopSessionMetadataPatch,
  DesktopSessionCatalogStatus,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopToolchainDiagnosticReport,
  DesktopToolchainInstallResult,
  DesktopUserMessageInput,
  LocalRouterMode,
  RestoreSessionTurnChangesInput,
  SaveSessionReviewCommentInput,
  SessionReviewCommentInput,
} from '../shared/types.js'

export type DesktopApiHandlerDependencies = {
  windowService: DesktopWindowService
  browserService: DesktopBrowserService
  debugToolProbeService: DebugToolProbeService
  debugEnabled: boolean
  getRuntimeOptions(): {
    agentExecutablePath: string
    configDirectoryPath: string
    runtimePreference: DesktopAgentRuntimePreference
    runtimeSelectionSource: 'default' | 'env'
  }
  getToolchainStatus(enabled: boolean): Promise<DesktopToolchainDiagnosticReport>
  diagnoseToolchain(enabled: boolean): Promise<DesktopToolchainDiagnosticReport>
  reinstallToolchain(enabled: boolean): Promise<DesktopToolchainInstallResult>
  deleteToolchain(enabled: boolean): Promise<DesktopToolchainInstallResult>
  listBuiltinPlugins(): Promise<DesktopBuiltinPlugin[]>
  setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<DesktopBuiltinPlugin>
  listSlashCommands(workspacePath?: string): Promise<DesktopSlashCommandSuggestion[]>
  getMcpRuntimeStatus(sessionId?: string): Promise<DesktopMcpRuntimeStatus>
  reloadMcpConfiguration(): Promise<McpReloadResult>
  createSession(
    options: CreateDesktopSessionOptions,
  ): Promise<CreateDesktopSessionResult>
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
  restoreSessionTurnChanges(
    input: RestoreSessionTurnChangesInput,
  ): Promise<DesktopGitOperationResult>
  onDesktopSettingsSaved?(settings: DesktopStoredSettings): void
}

export function buildDesktopApiHandlers(
  dependencies: DesktopApiHandlerDependencies,
): DesktopApiHandlers {
  const { windowService, debugEnabled } = dependencies
  return createDesktopApiHandlers({
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus: async () => {
      const settings = await readDesktopStoredSettings()
      return getRuntimeStatus({
        ...dependencies.getRuntimeOptions(),
        toolchainStatus: await dependencies.getToolchainStatus(
          settings.installCodePilotXDependencies,
        ),
      })
    },
    diagnoseDesktopToolchain: async () => {
      const settings = await readDesktopStoredSettings()
      return dependencies.diagnoseToolchain(settings.installCodePilotXDependencies)
    },
    reinstallDesktopToolchain: async () => {
      const settings = await readDesktopStoredSettings()
      return dependencies.reinstallToolchain(settings.installCodePilotXDependencies)
    },
    deleteDesktopToolchain: async () => {
      const settings = await readDesktopStoredSettings()
      return dependencies.deleteToolchain(settings.installCodePilotXDependencies)
    },
    getDesktopSettings: async () => {
      const settings = await readDesktopStoredSettings()
      registerRecentWorkspaces(settings)
      return settings
    },
    saveDesktopSettings: async (settings: DesktopStoredSettings) => {
      const currentSettings = await readDesktopStoredSettings()
      const savedSettings = await saveDesktopStoredSettings({
        ...settings,
        browserAllowedSites: mergeDesktopBrowserAllowedSites(
          currentSettings.browserAllowedSites,
          settings.browserAllowedSites,
        ),
      })
      registerRecentWorkspaces(savedSettings)
      dependencies.onDesktopSettingsSaved?.(savedSettings)
      return savedSettings
    },
    listProjectMemories: async workspacePath =>
      listProjectMemories(workspacePath),
    readProjectMemory: async (workspacePath, relativePath) =>
      readProjectMemory(workspacePath, undefined, relativePath),
    saveProjectMemory: async input => saveProjectMemory(input),
    deleteProjectMemory: async input => deleteProjectMemory(input),
    resetProjectMemory: async input => resetProjectMemory(input),
    listProjectMemoryRecalls: async workspacePath =>
      listProjectMemoryRecalls(workspacePath),
    listUserMemories: async () =>
      listUserMemories(dependencies.getRuntimeOptions().configDirectoryPath),
    readUserMemory: async relativePath =>
      readUserMemory(
        dependencies.getRuntimeOptions().configDirectoryPath,
        relativePath,
      ),
    saveUserMemory: async input =>
      saveUserMemory({
        ...input,
        configHomeDir: dependencies.getRuntimeOptions().configDirectoryPath,
      }),
    deleteUserMemory: async input =>
      deleteUserMemory({
        ...input,
        configHomeDir: dependencies.getRuntimeOptions().configDirectoryPath,
      }),
    resetUserMemory: async input =>
      resetUserMemory({
        ...input,
        configHomeDir: dependencies.getRuntimeOptions().configDirectoryPath,
      }),
    exportUserMemory: async () =>
      exportUserMemory(dependencies.getRuntimeOptions().configDirectoryPath),
    importUserMemory: async input =>
      importUserMemory(
        dependencies.getRuntimeOptions().configDirectoryPath,
        input.files,
      ),
    getBrowserState: dependencies.browserService.getState,
    openBrowser: dependencies.browserService.open,
    navigateBrowser: dependencies.browserService.navigate,
    reloadBrowser: dependencies.browserService.reload,
    goBackBrowser: dependencies.browserService.goBack,
    goForwardBrowser: dependencies.browserService.goForward,
    closeBrowser: dependencies.browserService.close,
    setBrowserBounds: dependencies.browserService.setBounds,
    clearBrowserAllowedSites: dependencies.browserService.clearAllowedSites,
    listBuiltinPlugins: dependencies.listBuiltinPlugins,
    setBuiltinPluginEnabled: dependencies.setBuiltinPluginEnabled,
    listSkillsCatalog: listDesktopSkillCatalog,
    installSkill: installDesktopSkill,
    listSlashCommands: dependencies.listSlashCommands,
    getMcpRuntimeStatus: dependencies.getMcpRuntimeStatus ?? (async () => ({ servers: [], totalTools: 0, totalResources: 0, totalPrompts: 0 })),
    listMcpServers: listDesktopMcpServers,
    saveMcpServer: saveDesktopMcpServer,
    removeMcpServer: removeDesktopMcpServer,
    setMcpServerEnabled: setDesktopMcpServerEnabled,
    reloadMcpConfiguration: dependencies.reloadMcpConfiguration ?? (async () => ({ refreshed: 0, skipped: 0, failed: 0 })),
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
    getGithubProfileOverview,
    setGithubUserStatus,
    clearGithubUserStatus,
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
    restoreSessionTurnChanges: dependencies.restoreSessionTurnChanges,
    createPullRequest,
    getWorkspaceReviewDiff,
    applyWorkspaceReviewOperation,
    listWorkspaceFiles,
    readWorkspaceFile,
    readOptionalWorkspaceFile: (workspacePath, filePath) =>
      readOptionalWorkspaceFile(readWorkspaceFile, workspacePath, filePath),
    chooseComposerFiles: chooseDesktopComposerFiles,
    authorizeComposerFilePaths: async filePaths => {
      authorizeComposerFilePaths(filePaths)
    },
    readComposerFiles: readDesktopComposerAttachments,
    getWorkspaceDiff,
    getThemeSettings: readDesktopThemeSettings,
    saveThemeSettings: saveDesktopThemeSettings,
    createSession: dependencies.createSession,
    listSessions: dependencies.listSessions,
    getSessionCatalogStatus: dependencies.getSessionCatalogStatus,
    getSession: dependencies.getSession,
    getActiveSessionId: dependencies.getActiveSessionId,
    setActiveSession: dependencies.setActiveSession,
    updateSessionMetadata: dependencies.updateSessionMetadata,
    renameSession: dependencies.renameSession,
    saveSessionReviewComment: dependencies.saveSessionReviewComment,
    resolveSessionReviewComment: dependencies.resolveSessionReviewComment,
    deleteSessionReviewComment: dependencies.deleteSessionReviewComment,
    setSessionPermissionMode: dependencies.setSessionPermissionMode,
    setSessionPlanModeActive: dependencies.setSessionPlanModeActive,
    setSessionLocalRouterMode: dependencies.setSessionLocalRouterMode,
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
	    openDevTools: async () => {
	      if (!debugEnabled) return
	      windowService.openDevTools()
	    },
	    closeDevTools: async () => {
	      if (!debugEnabled) return
	      windowService.closeDevTools()
	    },
    openSettings: async () => windowService.openSettings(),
    logOut: async () => {
      // Full logout: clear exchanged app token, GitHub token, account config, and caches
      await logoutAppAuth()
      await logoutGithub()
      windowService.logOut()
    },
    exitApp: async () => windowService.exitApp(),
    getDataLocation: async (): Promise<DesktopDataLocationState> =>
      getDataLocationState(),
    chooseDataLocation: async (): Promise<DesktopDataLocationMigrationResult | null> =>
      chooseAndMigrateDataLocation(),
    checkForUpdates: async () => {
      desktopAutoUpdater?.checkForUpdates()
    },
    downloadUpdate: async () => {
      desktopAutoUpdater?.downloadUpdate()
    },
	    quitAndInstall: async () => {
	      desktopAutoUpdater?.quitAndInstall()
	    },
	    listDebugBuiltinTools: async () => {
	      if (!debugEnabled) {
	        return { toolNames: [], enabled: [], hasProbeInput: [] }
	      }
	      return dependencies.debugToolProbeService.listBuiltinTools()
	    },
	    runDebugToolProbe: async (mode) => {
	      if (!debugEnabled) {
	        throw new Error('Debug tools are disabled in packaged builds.')
	      }
	      const { controller, runId } = dependencies.debugToolProbeService.startProbe(mode)
	      try {
	        const report = await dependencies.debugToolProbeService.runProbe(mode, controller.signal)
	        dependencies.debugToolProbeService.finishProbeRun(runId)
	        return report
	      } catch (err) {
	        dependencies.debugToolProbeService.finishProbeRun(runId)
	        throw err
	      }
	    },
	    cancelDebugToolProbe: async (runId) => {
	      if (!debugEnabled) return
	      dependencies.debugToolProbeService.cancelRun(runId)
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
