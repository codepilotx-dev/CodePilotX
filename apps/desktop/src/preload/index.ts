import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  desktopApiChannel,
} from '../shared/ipcChannels.js'
import type {
  DesktopAgentEvent,
  DesktopApi,
  DesktopUiCommand,
  DesktopWorkflowEvent,
  DesktopUpdateStatus,
} from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke(desktopApiChannel('getAuthStatus')),
  getRuntimeStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getRuntimeStatus')),
  getDesktopSettings: () =>
    ipcRenderer.invoke(desktopApiChannel('getDesktopSettings')),
  saveDesktopSettings: settings =>
    ipcRenderer.invoke(desktopApiChannel('saveDesktopSettings'), settings),
  listBuiltinPlugins: () =>
    ipcRenderer.invoke(desktopApiChannel('listBuiltinPlugins')),
  setBuiltinPluginEnabled: (pluginId, enabled) =>
    ipcRenderer.invoke(
      desktopApiChannel('setBuiltinPluginEnabled'),
      pluginId,
      enabled,
    ),
  listSlashCommands: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('listSlashCommands'), workspacePath),
  listMcpServers: () => ipcRenderer.invoke(desktopApiChannel('listMcpServers')),
  saveMcpServer: options =>
    ipcRenderer.invoke(desktopApiChannel('saveMcpServer'), options),
  removeMcpServer: (name, scope) =>
    ipcRenderer.invoke(desktopApiChannel('removeMcpServer'), name, scope),
  setMcpServerEnabled: (name, enabled) =>
    ipcRenderer.invoke(desktopApiChannel('setMcpServerEnabled'), name, enabled),
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
  createPullRequest: input =>
    ipcRenderer.invoke(desktopApiChannel('createPullRequest'), input),
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
  listSessions: () => ipcRenderer.invoke(desktopApiChannel('listSessions')),
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
  readWorkflowEventLog: () =>
    ipcRenderer.invoke(desktopApiChannel('readWorkflowEventLog')),
  openConfigFile: () =>
    ipcRenderer.invoke(desktopApiChannel('openConfigFile')),
  openExternalURL: url =>
    ipcRenderer.invoke(desktopApiChannel('openExternalURL'), url),
  chooseComposerFiles: () =>
    ipcRenderer.invoke(desktopApiChannel('chooseComposerFiles')),
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
  openSettings: () => ipcRenderer.invoke(desktopApiChannel('openSettings')),
  logOut: () => ipcRenderer.invoke(desktopApiChannel('logOut')),
  exitApp: () => ipcRenderer.invoke(desktopApiChannel('exitApp')),
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
  checkForUpdates: () =>
    ipcRenderer.invoke(desktopApiChannel('checkForUpdates')),
  downloadUpdate: () =>
    ipcRenderer.invoke(desktopApiChannel('downloadUpdate')),
  quitAndInstall: () =>
    ipcRenderer.invoke(desktopApiChannel('quitAndInstall')),
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
