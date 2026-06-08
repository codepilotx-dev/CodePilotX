import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAgentEvent, DesktopApi } from '../shared/types.js'

const api: DesktopApi = {
  getAuthStatus: () => ipcRenderer.invoke('desktop:getAuthStatus'),
  login: () => ipcRenderer.invoke('desktop:login'),
  chooseWorkspace: () => ipcRenderer.invoke('desktop:chooseWorkspace'),
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
