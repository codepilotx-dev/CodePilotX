import { contextBridge, ipcRenderer } from "electron"

type AgentConnectionState = "connected" | "disconnected" | "unknown"

const desktop = {
  minimize: (): Promise<void> => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke("window:toggle-maximize"),
  close: (): Promise<void> => ipcRenderer.invoke("window:close"),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke("window:is-maximized"),
  onMaximizedChange: (listener: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
    ipcRenderer.on("window:maximized-changed", handler)
    return () => ipcRenderer.removeListener("window:maximized-changed", handler)
  },
  pickWorkspaceDirectory: (): Promise<string | null> => ipcRenderer.invoke("workspace:pick-directory"),
  // Main process support is intentionally optional during the transition. This
  // listener is inert until it starts publishing agent:connection-changed.
  onAgentConnectionChange: (listener: (state: AgentConnectionState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (state === "connected" || state === "disconnected" || state === "unknown") listener(state)
    }
    ipcRenderer.on("agent:connection-changed", handler)
    return () => ipcRenderer.removeListener("agent:connection-changed", handler)
  },
  getAgentConnectionState: (): Promise<AgentConnectionState> => ipcRenderer.invoke("agent:connection-state"),
  openLogDirectory: (): Promise<string> => ipcRenderer.invoke("startup:open-logs"),
  quitDuringStartup: (): Promise<void> => ipcRenderer.invoke("startup:quit"),
}

contextBridge.exposeInMainWorld("codePilotXDesktop", desktop)
