import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAgentEvent, DesktopApi } from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke('desktop:getAuthStatus'),
  getRuntimeStatus: () => ipcRenderer.invoke('desktop:getRuntimeStatus'),
  login: () => ipcRenderer.invoke('desktop:login'),
  chooseWorkspace: () => ipcRenderer.invoke('desktop:chooseWorkspace'),
  openWorkspace: workspacePath =>
    ipcRenderer.invoke('desktop:openWorkspace', workspacePath),
  listWorkspaceFiles: workspacePath =>
    ipcRenderer.invoke('desktop:listWorkspaceFiles', workspacePath),
  readWorkspaceFile: (workspacePath, filePath) =>
    ipcRenderer.invoke('desktop:readWorkspaceFile', workspacePath, filePath),
  getWorkspaceDiff: workspacePath =>
    ipcRenderer.invoke('desktop:getWorkspaceDiff', workspacePath),
  createSession: options => ipcRenderer.invoke('desktop:createSession', options),
  sendUserMessage: (sessionId, content) =>
    ipcRenderer.invoke('desktop:sendUserMessage', sessionId, content),
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
  onAgentEvent: callback => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopAgentEvent) => {
      callback(payload)
    }
    ipcRenderer.on('desktop:agent-event', listener)
    return () => ipcRenderer.off('desktop:agent-event', listener)
  },
}

contextBridge.exposeInMainWorld('desktopApi', api)
