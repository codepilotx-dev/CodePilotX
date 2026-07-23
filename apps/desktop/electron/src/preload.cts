import { contextBridge, ipcRenderer } from "electron"
import type { DesktopThemeSettingsV4 } from "./settings/appearance-settings-store.js"
import type { DesktopSettingsPayload } from "./settings/desktop-settings-contract.js"

type AgentConnectionState = "connected" | "disconnected" | "unknown"
type SystemThemeVariant = "light" | "dark"

interface WindowBackdropCapability {
  supported: boolean
  platform: NodeJS.Platform
}

interface DesktopExternalOpenTarget {
  targetId: string
  label: string
  kind: "default-app" | "editor"
  iconDataUrl?: string
}

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
  getDesktopSettings: (): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke("desktop-settings:get"),
  saveDesktopSettings: (
    settings: DesktopSettingsPayload,
  ): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke("desktop-settings:save", settings),
  copyProviderApiKey: (
    credentialId: string,
  ): Promise<{ clearAfterMs: 60000 }> =>
    ipcRenderer.invoke("api-key:copy", credentialId),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:open-external", url),
  listExternalOpenTargets: (targetPath: string): Promise<DesktopExternalOpenTarget[]> =>
    ipcRenderer.invoke("shell:list-external-open-targets", targetPath),
  openPathWithTarget: (targetPath: string, targetId: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-path-with-target", targetPath, targetId),
  revealPathInFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke("shell:reveal-path-in-folder", targetPath),
  openLogDirectory: (): Promise<string> => ipcRenderer.invoke("startup:open-logs"),
  quitDuringStartup: (): Promise<void> => ipcRenderer.invoke("startup:quit"),
  getAppearanceSettings: (): Promise<DesktopThemeSettingsV4> =>
    ipcRenderer.invoke("appearance:settings:get"),
  saveAppearanceSettings: (settings: DesktopThemeSettingsV4): Promise<void> =>
    ipcRenderer.invoke("appearance:settings:save", settings),
  getSystemTheme: (): Promise<SystemThemeVariant> =>
    ipcRenderer.invoke("appearance:system-theme:get"),
  onSystemThemeChange: (listener: (variant: SystemThemeVariant) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, variant: unknown) => {
      if (variant === "light" || variant === "dark") listener(variant)
    }
    ipcRenderer.on("appearance:system-theme:changed", handler)
    return () => ipcRenderer.removeListener("appearance:system-theme:changed", handler)
  },
  getWindowBackdropCapability: (): Promise<WindowBackdropCapability> =>
    ipcRenderer.invoke("appearance:backdrop:get-capability"),
  applyWindowBackdrop: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("appearance:backdrop:apply", enabled),
}

contextBridge.exposeInMainWorld("codePilotXDesktop", desktop)
