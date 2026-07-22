import { contextBridge, ipcRenderer } from "electron"
import type { DesktopThemeSettingsV3 } from "./appearance-settings-store.js"
import type { AgentDiagnostic } from "./desktop-diagnostics.js"

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

const sanitizeAgentDiagnostic = (value: unknown): AgentDiagnostic | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.level !== "info" && input.level !== "warn" && input.level !== "error") return undefined
  if (input.source !== "agent" && input.source !== "desktop") return undefined
  const safeText = (item: unknown, maxLength: number) => typeof item === "string" && item.length > 0
    ? item
      .replace(/\bBearer\s+[^\s,;"']+|\bsk-[A-Za-z0-9_-]+\b/gi, "[REDACTED]")
      .replace(/\b(token|api[-_]?key|password|secret|cookie|authorization|credential)=([^\s,;]+)/gi, "$1=[REDACTED]")
      .slice(0, maxLength)
    : undefined
  const safeNumber = (item: unknown) =>
    typeof item === "number" && Number.isFinite(item) && item >= 0 ? item : undefined
  const at = safeText(input.at, 64)
  const code = safeText(input.code, 128)
  const message = safeText(input.message, 1_000)
  if (!at || !code || !message) return undefined
  const rawDetails = input.details
  const detailInput = rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
    ? rawDetails as Record<string, unknown>
    : undefined
  const details = detailInput ? {
    phase: safeText(detailInput.phase, 128),
    durationMs: safeNumber(detailInput.durationMs),
    failureCount: safeNumber(detailInput.failureCount),
    attempt: safeNumber(detailInput.attempt),
    toolCallId: safeText(detailInput.toolCallId, 256),
  } : undefined
  const compactDetails = details && Object.values(details).some(item => item !== undefined) ? details : undefined
  return { at, level: input.level, source: input.source, code, message, ...(compactDetails ? { details: compactDetails } : {}) }
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
  onAgentDiagnostic: (listener: (diagnostic: AgentDiagnostic) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const diagnostic = sanitizeAgentDiagnostic(value)
      if (diagnostic) listener(diagnostic)
    }
    ipcRenderer.on("agent:diagnostic", handler)
    return () => ipcRenderer.removeListener("agent:diagnostic", handler)
  },
  getDesktopSettings: (): Promise<unknown> =>
    ipcRenderer.invoke("desktop-settings:get"),
  saveDesktopSettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke("desktop-settings:save", settings),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:open-external", url),
  listExternalOpenTargets: (targetPath: string): Promise<DesktopExternalOpenTarget[]> =>
    ipcRenderer.invoke("shell:list-external-open-targets", targetPath),
  openPathWithTarget: (targetPath: string, targetId: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-path-with-target", targetPath, targetId),
  revealPathInFolder: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke("shell:reveal-path-in-folder", targetPath),
  openLogDirectory: (): Promise<string> => ipcRenderer.invoke("startup:open-logs"),
  quitDuringStartup: (): Promise<void> => ipcRenderer.invoke("startup:quit"),
  getAppearanceSettings: (): Promise<DesktopThemeSettingsV3> =>
    ipcRenderer.invoke("appearance:settings:get"),
  saveAppearanceSettings: (settings: DesktopThemeSettingsV3): Promise<void> =>
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
