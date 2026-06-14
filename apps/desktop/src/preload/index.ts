import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  desktopApiChannel,
} from '../shared/ipcChannels.js'
import type {
  DesktopAgentEvent,
  DesktopApi,
  DesktopUiCommand,
} from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke(desktopApiChannel('getAuthStatus')),
  getRuntimeStatus: () =>
    ipcRenderer.invoke(desktopApiChannel('getRuntimeStatus')),
  getDesktopSettings: () =>
    ipcRenderer.invoke(desktopApiChannel('getDesktopSettings')),
  saveDesktopSettings: settings =>
    ipcRenderer.invoke(desktopApiChannel('saveDesktopSettings'), settings),
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
  listWorkspaceFiles: workspacePath =>
    ipcRenderer.invoke(desktopApiChannel('listWorkspaceFiles'), workspacePath),
  readWorkspaceFile: (workspacePath, filePath) =>
    ipcRenderer.invoke(
      desktopApiChannel('readWorkspaceFile'),
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
  openExternalURL: url =>
    ipcRenderer.invoke(desktopApiChannel('openExternalURL'), url),
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
}

contextBridge.exposeInMainWorld('desktopApi', api)
