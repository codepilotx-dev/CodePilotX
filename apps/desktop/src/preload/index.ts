import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopAgentEvent,
  DesktopApi,
  DesktopUiCommand,
} from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke('desktop:getAuthStatus'),
  getRuntimeStatus: () => ipcRenderer.invoke('desktop:getRuntimeStatus'),
  getDesktopSettings: () => ipcRenderer.invoke('desktop:getDesktopSettings'),
  saveDesktopSettings: settings =>
    ipcRenderer.invoke('desktop:saveDesktopSettings', settings),
  listOpenTargets: () => ipcRenderer.invoke('desktop:listOpenTargets'),
  openPathWithDefaultTarget: targetPath =>
    ipcRenderer.invoke('desktop:openPathWithDefaultTarget', targetPath),
  listModelProviders: () => ipcRenderer.invoke('desktop:listModelProviders'),
  getModelProviderState: () =>
    ipcRenderer.invoke('desktop:getModelProviderState'),
  fetchProviderModels: options =>
    ipcRenderer.invoke('desktop:fetchProviderModels', options),
  fetchProviderBalance: options =>
    ipcRenderer.invoke('desktop:fetchProviderBalance', options),
  saveModelProvider: options =>
    ipcRenderer.invoke('desktop:saveModelProvider', options),
  saveProviderApiKey: (providerID, apiKey) =>
    ipcRenderer.invoke('desktop:saveProviderApiKey', providerID, apiKey),
  chooseWorkspace: () => ipcRenderer.invoke('desktop:chooseWorkspace'),
  openWorkspace: workspacePath =>
    ipcRenderer.invoke('desktop:openWorkspace', workspacePath),
  getWorkspaceContext: workspacePath =>
    ipcRenderer.invoke('desktop:getWorkspaceContext', workspacePath),
  checkoutWorkspaceBranch: (workspacePath, branchName) =>
    ipcRenderer.invoke('desktop:checkoutWorkspaceBranch', workspacePath, branchName),
  listWorkspaceFiles: workspacePath =>
    ipcRenderer.invoke('desktop:listWorkspaceFiles', workspacePath),
  readWorkspaceFile: (workspacePath, filePath) =>
    ipcRenderer.invoke('desktop:readWorkspaceFile', workspacePath, filePath),
  getWorkspaceDiff: workspacePath =>
    ipcRenderer.invoke('desktop:getWorkspaceDiff', workspacePath),
  getThemeSettings: () => ipcRenderer.invoke('desktop:getThemeSettings'),
  saveThemeSettings: settings =>
    ipcRenderer.invoke('desktop:saveThemeSettings', settings),
  createSession: options => ipcRenderer.invoke('desktop:createSession', options),
  listSessions: () => ipcRenderer.invoke('desktop:listSessions'),
  getActiveSessionId: () => ipcRenderer.invoke('desktop:getActiveSessionId'),
  setActiveSession: sessionId =>
    ipcRenderer.invoke('desktop:setActiveSession', sessionId),
  updateSessionMetadata: (sessionId, patch) =>
    ipcRenderer.invoke('desktop:updateSessionMetadata', sessionId, patch),
  openExternalURL: url => ipcRenderer.invoke('desktop:openExternalURL', url),
  sendUserMessage: (sessionId, content, model) =>
    ipcRenderer.invoke('desktop:sendUserMessage', sessionId, content, model),
  respondToPermission: (sessionId, requestId, decision) =>
    ipcRenderer.invoke(
      'desktop:respondToPermission',
      sessionId,
      requestId,
      decision,
    ),
  interruptSession: sessionId =>
    ipcRenderer.invoke('desktop:interruptSession', sessionId),
  disposeSession: sessionId =>
    ipcRenderer.invoke('desktop:disposeSession', sessionId),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimizeWindow'),
  toggleWindowMaximized: () =>
    ipcRenderer.invoke('desktop:toggleWindowMaximized'),
  closeWindow: () => ipcRenderer.invoke('desktop:closeWindow'),
  isWindowMaximized: () => ipcRenderer.invoke('desktop:isWindowMaximized'),
  newWindow: () => ipcRenderer.invoke('desktop:newWindow'),
  openSettings: () => ipcRenderer.invoke('desktop:openSettings'),
  logOut: () => ipcRenderer.invoke('desktop:logOut'),
  exitApp: () => ipcRenderer.invoke('desktop:exitApp'),
  onAgentEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopAgentEvent) => {
      callback(payload)
    }
    ipcRenderer.on('desktop:agent-event', listener)
    return () => ipcRenderer.off('desktop:agent-event', listener)
  },
  onUiCommand: callback => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: DesktopUiCommand,
    ) => {
      callback(command)
    }
    ipcRenderer.on('desktop:ui-command', listener)
    return () => ipcRenderer.off('desktop:ui-command', listener)
  },
}

contextBridge.exposeInMainWorld('desktopApi', api)
