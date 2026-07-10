import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  desktopApiChannel,
} from '../shared/ipcChannels.js'
import type {
  DesktopAgentEvent,
  DesktopApi,
  DesktopDataLocationMigrationResult,
  DesktopDataLocationState,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopUiCommand,
  DesktopWorkflowEvent,
  DesktopUpdateStatus,
} from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke(desktopApiChannel('getAuthStatus')),
  getRuntimeStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getRuntimeStatus')),
  diagnoseDesktopToolchain: () =>
    ipcRenderer.invoke(desktopApiChannel('diagnoseDesktopToolchain')),
  reinstallDesktopToolchain: () =>
    ipcRenderer.invoke(desktopApiChannel('reinstallDesktopToolchain')),
  deleteDesktopToolchain: () =>
    ipcRenderer.invoke(desktopApiChannel('deleteDesktopToolchain')),
  getDesktopSettings: () =>
    ipcRenderer.invoke(desktopApiChannel('getDesktopSettings')),
  saveDesktopSettings: settings =>
    ipcRenderer.invoke(desktopApiChannel('saveDesktopSettings'), settings),
  listProjectMemories: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('listProjectMemories'), workspacePath),
  readProjectMemory: (workspacePath, relativePath) =>
    ipcRenderer.invoke(
      desktopApiChannel('readProjectMemory'),
      workspacePath,
      relativePath,
    ),
  saveProjectMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('saveProjectMemory'), input),
  deleteProjectMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('deleteProjectMemory'), input),
  resetProjectMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('resetProjectMemory'), input),
  listProjectMemoryRecalls: workspacePath =>
    ipcRenderer.invoke(
      desktopApiChannel('listProjectMemoryRecalls'),
      workspacePath,
    ),
  listUserMemories: () =>
    ipcRenderer.invoke(desktopApiChannel('listUserMemories')),
  readUserMemory: relativePath =>
    ipcRenderer.invoke(desktopApiChannel('readUserMemory'), relativePath),
  saveUserMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('saveUserMemory'), input),
  deleteUserMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('deleteUserMemory'), input),
  resetUserMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('resetUserMemory'), input),
  exportUserMemory: () =>
    ipcRenderer.invoke(desktopApiChannel('exportUserMemory')),
  importUserMemory: input =>
    ipcRenderer.invoke(desktopApiChannel('importUserMemory'), input),
  getBrowserState: () => ipcRenderer.invoke(desktopApiChannel('getBrowserState')),
  openBrowser: url => ipcRenderer.invoke(desktopApiChannel('openBrowser'), url),
  navigateBrowser: url =>
    ipcRenderer.invoke(desktopApiChannel('navigateBrowser'), url),
  reloadBrowser: () => ipcRenderer.invoke(desktopApiChannel('reloadBrowser')),
  goBackBrowser: () => ipcRenderer.invoke(desktopApiChannel('goBackBrowser')),
  goForwardBrowser: () =>
    ipcRenderer.invoke(desktopApiChannel('goForwardBrowser')),
  closeBrowser: () => ipcRenderer.invoke(desktopApiChannel('closeBrowser')),
  setBrowserBounds: bounds =>
    ipcRenderer.invoke(desktopApiChannel('setBrowserBounds'), bounds),
  clearBrowserAllowedSites: () =>
    ipcRenderer.invoke(desktopApiChannel('clearBrowserAllowedSites')),
  listBuiltinPlugins: () =>
    ipcRenderer.invoke(desktopApiChannel('listBuiltinPlugins')),
  setBuiltinPluginEnabled: (pluginId, enabled) =>
    ipcRenderer.invoke(
      desktopApiChannel('setBuiltinPluginEnabled'),
      pluginId,
      enabled,
    ),
  listSkillsCatalog: options =>
    ipcRenderer.invoke(desktopApiChannel('listSkillsCatalog'), options),
  installSkill: skillId =>
    ipcRenderer.invoke(desktopApiChannel('installSkill'), skillId),
  listSlashCommands: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('listSlashCommands'), workspacePath),
  listMcpServers: () => ipcRenderer.invoke(desktopApiChannel('listMcpServers')),
  getMcpRuntimeStatus: (sessionId?: string) => ipcRenderer.invoke(desktopApiChannel('getMcpRuntimeStatus'), sessionId),
  saveMcpServer: options =>
    ipcRenderer.invoke(desktopApiChannel('saveMcpServer'), options),
  removeMcpServer: (name, scope) =>
    ipcRenderer.invoke(desktopApiChannel('removeMcpServer'), name, scope),
  setMcpServerEnabled: (name, enabled) =>
    ipcRenderer.invoke(desktopApiChannel('setMcpServerEnabled'), name, enabled),
  reloadMcpConfiguration: () =>
    ipcRenderer.invoke(desktopApiChannel('reloadMcpConfiguration')),
  listOpenTargets: () =>
    ipcRenderer.invoke(desktopApiChannel('listOpenTargets')),
  openPathWithDefaultTarget: targetPath =>
    ipcRenderer.invoke(desktopApiChannel('openPathWithDefaultTarget'), targetPath),
  listModelProviders: () =>
    ipcRenderer.invoke(desktopApiChannel('listModelProviders')),
  getModelProviderState: () =>
    ipcRenderer.invoke(desktopApiChannel('getModelProviderState')),
  fetchProviderModels: options =>
    ipcRenderer.invoke(desktopApiChannel('fetchProviderModels'), options),
  fetchProviderBalance: options =>
    ipcRenderer.invoke(desktopApiChannel('fetchProviderBalance'), options),
  saveModelProvider: options =>
    ipcRenderer.invoke(desktopApiChannel('saveModelProvider'), options),
  saveProviderApiKey: (providerID, apiKey) =>
    ipcRenderer.invoke(desktopApiChannel('saveProviderApiKey'), providerID, apiKey),
  deleteProviderApiKey: providerID =>
    ipcRenderer.invoke(desktopApiChannel('deleteProviderApiKey'), providerID),
  getCopilotAuthStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getCopilotAuthStatus')),
  startCopilotLogin: () =>
    ipcRenderer.invoke(desktopApiChannel('startCopilotLogin')),
  pollCopilotLogin: () =>
    ipcRenderer.invoke(desktopApiChannel('pollCopilotLogin')),
  cancelCopilotLogin: () =>
    ipcRenderer.invoke(desktopApiChannel('cancelCopilotLogin')),
  getGithubAuthStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getGithubAuthStatus')),
  startGithubLogin: input =>
    ipcRenderer.invoke(desktopApiChannel('startGithubLogin'), input),
  pollGithubLogin: () =>
    ipcRenderer.invoke(desktopApiChannel('pollGithubLogin')),
  logoutGithub: () =>
    ipcRenderer.invoke(desktopApiChannel('logoutGithub')),
  listGithubRepositories: () =>
    ipcRenderer.invoke(desktopApiChannel('listGithubRepositories')),
  getGithubProfileOverview: () =>
    ipcRenderer.invoke(desktopApiChannel('getGithubProfileOverview')),
  setGithubUserStatus: input =>
    ipcRenderer.invoke(desktopApiChannel('setGithubUserStatus'), input),
  clearGithubUserStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('clearGithubUserStatus')),
  cloneGithubRepository: input =>
    ipcRenderer.invoke(desktopApiChannel('cloneGithubRepository'), input),
  chooseWorkspace: () =>
    ipcRenderer.invoke(desktopApiChannel('chooseWorkspace')),
  openWorkspace: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('openWorkspace'), workspacePath),
  getWorkspaceContext: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('getWorkspaceContext'), workspacePath),
  checkoutWorkspaceBranch: (workspacePath, branchName) =>
    ipcRenderer.invoke(
      desktopApiChannel('checkoutWorkspaceBranch'),
      workspacePath,
      branchName,
    ),
  getWorkspaceGitStatus: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('getWorkspaceGitStatus'), workspacePath),
  createWorkspaceBranch: input =>
    ipcRenderer.invoke(desktopApiChannel('createWorkspaceBranch'), input),
  commitWorkspaceChanges: input =>
    ipcRenderer.invoke(desktopApiChannel('commitWorkspaceChanges'), input),
  pushWorkspaceBranch: input =>
    ipcRenderer.invoke(desktopApiChannel('pushWorkspaceBranch'), input),
  discardWorkspaceChanges: input =>
    ipcRenderer.invoke(desktopApiChannel('discardWorkspaceChanges'), input),
  restoreSessionTurnChanges: input =>
    ipcRenderer.invoke(desktopApiChannel('restoreSessionTurnChanges'), input),
  createPullRequest: input =>
    ipcRenderer.invoke(desktopApiChannel('createPullRequest'), input),
  getWorkspaceReviewDiff: input =>
    ipcRenderer.invoke(desktopApiChannel('getWorkspaceReviewDiff'), input),
  applyWorkspaceReviewOperation: input =>
    ipcRenderer.invoke(desktopApiChannel('applyWorkspaceReviewOperation'), input),
  listWorkspaceFiles: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('listWorkspaceFiles'), workspacePath),
  readWorkspaceFile: (workspacePath, filePath) =>
    ipcRenderer.invoke(
      desktopApiChannel('readWorkspaceFile'),
      workspacePath,
      filePath,
    ),
  readOptionalWorkspaceFile: (workspacePath, filePath) =>
    ipcRenderer.invoke(
      desktopApiChannel('readOptionalWorkspaceFile'),
      workspacePath,
      filePath,
    ),
  getWorkspaceDiff: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('getWorkspaceDiff'), workspacePath),
  getThemeSettings: () =>
    ipcRenderer.invoke(desktopApiChannel('getThemeSettings')),
  saveThemeSettings: settings =>
    ipcRenderer.invoke(desktopApiChannel('saveThemeSettings'), settings),
  createSession: options =>
    ipcRenderer.invoke(desktopApiChannel('createSession'), options),
  listSessions: options => ipcRenderer.invoke(desktopApiChannel('listSessions'), options),
  getSessionCatalogStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getSessionCatalogStatus')),
  getSession: sessionId =>
    ipcRenderer.invoke(desktopApiChannel('getSession'), sessionId),
  getActiveSessionId: () =>
    ipcRenderer.invoke(desktopApiChannel('getActiveSessionId')),
  setActiveSession: sessionId =>
    ipcRenderer.invoke(desktopApiChannel('setActiveSession'), sessionId),
  updateSessionMetadata: (sessionId, patch) =>
    ipcRenderer.invoke(
      desktopApiChannel('updateSessionMetadata'),
      sessionId,
      patch,
    ),
  renameSession: (sessionId, name) =>
    ipcRenderer.invoke(desktopApiChannel('renameSession'), sessionId, name),
  saveSessionReviewComment: input =>
    ipcRenderer.invoke(desktopApiChannel('saveSessionReviewComment'), input),
  resolveSessionReviewComment: input =>
    ipcRenderer.invoke(desktopApiChannel('resolveSessionReviewComment'), input),
  deleteSessionReviewComment: input =>
    ipcRenderer.invoke(desktopApiChannel('deleteSessionReviewComment'), input),
  setSessionPermissionMode: (sessionId, mode) =>
    ipcRenderer.invoke(
      desktopApiChannel('setSessionPermissionMode'),
      sessionId,
      mode,
    ),
  setSessionPlanModeActive: (sessionId, active) =>
    ipcRenderer.invoke(
      desktopApiChannel('setSessionPlanModeActive'),
      sessionId,
      active,
    ),
  setSessionLocalRouterMode: (sessionId, mode) =>
    ipcRenderer.invoke(
      desktopApiChannel('setSessionLocalRouterMode'),
      sessionId,
      mode,
    ),
  readWorkflowEventLog: () =>
    ipcRenderer.invoke(desktopApiChannel('readWorkflowEventLog')),
  openConfigFile: () =>
    ipcRenderer.invoke(desktopApiChannel('openConfigFile')),
  openExternalURL: url =>
    ipcRenderer.invoke(desktopApiChannel('openExternalURL'), url),
  chooseComposerFiles: () =>
    ipcRenderer.invoke(desktopApiChannel('chooseComposerFiles')),
  authorizeComposerFilePaths: filePaths =>
    ipcRenderer.invoke(
      desktopApiChannel('authorizeComposerFilePaths'),
      filePaths,
    ),
  readComposerFiles: filePaths =>
    ipcRenderer.invoke(desktopApiChannel('readComposerFiles'), filePaths),
  sendUserMessage: (sessionId, content, model) =>
    ipcRenderer.invoke(
      desktopApiChannel('sendUserMessage'),
      sessionId,
      content,
      model,
    ),
  respondToPermission: (sessionId, requestId, decision) =>
    ipcRenderer.invoke(
      desktopApiChannel('respondToPermission'),
      sessionId,
      requestId,
      decision,
    ),
  interruptSession: sessionId =>
    ipcRenderer.invoke(desktopApiChannel('interruptSession'), sessionId),
  disposeSession: sessionId =>
    ipcRenderer.invoke(desktopApiChannel('disposeSession'), sessionId),
  minimizeWindow: () => ipcRenderer.invoke(desktopApiChannel('minimizeWindow')),
  toggleWindowMaximized: () =>
    ipcRenderer.invoke(desktopApiChannel('toggleWindowMaximized')),
  closeWindow: () => ipcRenderer.invoke(desktopApiChannel('closeWindow')),
  isWindowMaximized: () =>
    ipcRenderer.invoke(desktopApiChannel('isWindowMaximized')),
  newWindow: () => ipcRenderer.invoke(desktopApiChannel('newWindow')),
  openDevTools: () => ipcRenderer.invoke(desktopApiChannel('openDevTools')),
  closeDevTools: () => ipcRenderer.invoke(desktopApiChannel('closeDevTools')),
  openSettings: () => ipcRenderer.invoke(desktopApiChannel('openSettings')),
  logOut: () => ipcRenderer.invoke(desktopApiChannel('logOut')),
  exitApp: () => ipcRenderer.invoke(desktopApiChannel('exitApp')),
  getDataLocation: () =>
    ipcRenderer.invoke(desktopApiChannel('getDataLocation')),
  chooseDataLocation: () =>
    ipcRenderer.invoke(desktopApiChannel('chooseDataLocation')),
  onAgentEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopAgentEvent) => {
      callback(payload)
    }
    ipcRenderer.on(DESKTOP_AGENT_EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_AGENT_EVENT_CHANNEL, listener)
  },
  onWorkflowEvent: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: DesktopWorkflowEvent,
    ) => {
      callback(payload)
    }
    ipcRenderer.on(DESKTOP_WORKFLOW_EVENT_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_WORKFLOW_EVENT_CHANNEL, listener)
  },
  onUiCommand: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: DesktopUiCommand,
    ) => {
      callback(command)
    }
    ipcRenderer.on(DESKTOP_UI_COMMAND_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_UI_COMMAND_CHANNEL, listener)
  },
  onSessionStoreChange: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      change: DesktopSessionStoreChange,
    ) => {
      callback(change)
    }
    ipcRenderer.on(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, listener)
  },
  onDesktopSettingsChange: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      change: DesktopSettingsChange,
    ) => {
      callback(change)
    }
    ipcRenderer.on(DESKTOP_SETTINGS_CHANGE_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_SETTINGS_CHANGE_CHANNEL, listener)
  },
  checkForUpdates: () =>
    ipcRenderer.invoke(desktopApiChannel('checkForUpdates')),
  downloadUpdate: () =>
    ipcRenderer.invoke(desktopApiChannel('downloadUpdate')),
  quitAndInstall: () =>
    ipcRenderer.invoke(desktopApiChannel('quitAndInstall')),
  listDebugBuiltinTools: () =>
    ipcRenderer.invoke(desktopApiChannel('listDebugBuiltinTools')),
  runDebugToolProbe: mode =>
    ipcRenderer.invoke(desktopApiChannel('runDebugToolProbe'), mode),
  cancelDebugToolProbe: runId =>
    ipcRenderer.invoke(desktopApiChannel('cancelDebugToolProbe'), runId),
  onUpdateStatusChange: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: DesktopUpdateStatus,
    ) => {
      callback(status)
    }
    ipcRenderer.on(DESKTOP_UPDATE_STATUS_CHANNEL, listener)
    return () => ipcRenderer.off(DESKTOP_UPDATE_STATUS_CHANNEL, listener)
  },
}

contextBridge.exposeInMainWorld('desktopApi', api)
