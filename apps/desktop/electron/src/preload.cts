import { contextBridge, ipcRenderer } from "electron"
import type { DesktopThemeSettingsV6 } from "./settings/appearance-settings-store.js"
import type {
  DesktopPetOverlayBridge,
  DesktopPetPresentation,
} from "@codepilotx/shared/desktop-pet-overlay"
import type {
  DesktopSettingsIpcBridge,
  DesktopSettingsPayload,
} from "@codepilotx/shared/desktop-settings-ipc"
import type {
  DesktopDataLocationIpcBridge,
} from "@codepilotx/shared/desktop-data-location-ipc"

// Sandboxed preload scripts cannot resolve workspace packages at runtime.
// Keep this literal type-checked against the shared contract so the emitted
// preload remains self-contained without allowing IPC channel drift.
const PET_OVERLAY_CHANNELS = {
  open: "pet-overlay:open",
  hide: "pet-overlay:hide",
  getState: "pet-overlay:get-state",
  previewPresentation: "desktop-pet-overlay:preview-presentation",
  presentationPreview: "desktop-pet-overlay:presentation-preview",
  getGlobalPointerPosition:
    "desktop-pet-overlay:get-global-pointer-position",
  beginDrag: "pet-overlay:drag-begin",
  updateDrag: "pet-overlay:drag-update",
  endDrag: "pet-overlay:drag-end",
  setPointerPassthrough: "pet-overlay:pointer-passthrough",
  requestKeyboardFocus: "pet-overlay:keyboard-focus",
  openSession: "pet-overlay:open-session",
} as const satisfies typeof import("@codepilotx/shared/desktop-pet-overlay").PET_OVERLAY_CHANNELS

const DESKTOP_SETTINGS_IPC_CHANNELS = {
  get: "desktop-settings:get",
  save: "desktop-settings:save",
  changed: "desktop-settings:changed",
} as const satisfies typeof import("@codepilotx/shared/desktop-settings-ipc").DESKTOP_SETTINGS_IPC_CHANNELS

const DESKTOP_DATA_LOCATION_IPC_CHANNELS = {
  get: "desktop-data-location:get",
  choose: "desktop-data-location:choose",
  retry: "desktop-data-location:retry",
  restore: "desktop-data-location:restore",
} as const satisfies typeof import("@codepilotx/shared/desktop-data-location-ipc").DESKTOP_DATA_LOCATION_IPC_CHANNELS

type AgentConnectionState = "connected" | "disconnected" | "unknown"
type SystemThemeVariant = "light" | "dark"

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
  getDataLocation: () =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.get),
  chooseDataLocation: (workspaceRoots?: readonly string[]) =>
    ipcRenderer.invoke(
      DESKTOP_DATA_LOCATION_IPC_CHANNELS.choose,
      workspaceRoots,
    ),
  retryDataLocation: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.retry),
  restoreDataLocation: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_DATA_LOCATION_IPC_CHANNELS.restore),
  getDesktopSettings: (): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke(DESKTOP_SETTINGS_IPC_CHANNELS.get),
  saveDesktopSettings: (
    settings: DesktopSettingsPayload,
  ): Promise<DesktopSettingsPayload> =>
    ipcRenderer.invoke(DESKTOP_SETTINGS_IPC_CHANNELS.save, settings),
  onDesktopSettingsChange: (
    listener: (settings: DesktopSettingsPayload) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      settings: unknown,
    ): void => {
      if (isRecord(settings)) listener(settings as DesktopSettingsPayload)
    }
    ipcRenderer.on(DESKTOP_SETTINGS_IPC_CHANNELS.changed, handler)
    return () =>
      ipcRenderer.removeListener(DESKTOP_SETTINGS_IPC_CHANNELS.changed, handler)
  },
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
  getAppearanceSettings: (): Promise<DesktopThemeSettingsV6> =>
    ipcRenderer.invoke("appearance:settings:get"),
  saveAppearanceSettings: (settings: DesktopThemeSettingsV6): Promise<void> =>
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
  openPetOverlay: (): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.open),
  hidePetOverlay: (): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.hide),
  getPetOverlayWindowState: () =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.getState),
  previewPetPresentation: (
    presentation: DesktopPetPresentation,
  ): Promise<DesktopPetPresentation> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.previewPresentation, presentation),
  onPetPresentationPreview: (
    listener: (presentation: DesktopPetPresentation) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      presentation: unknown,
    ): void => {
      if (isPetPresentation(presentation)) listener(presentation)
    }
    ipcRenderer.on(PET_OVERLAY_CHANNELS.presentationPreview, handler)
    return () =>
      ipcRenderer.removeListener(
        PET_OVERLAY_CHANNELS.presentationPreview,
        handler,
      )
  },
  getPetGlobalPointerPosition: () =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.getGlobalPointerPosition),
  beginPetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.beginDrag),
  updatePetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.updateDrag),
  endPetDrag: (): void => ipcRenderer.send(PET_OVERLAY_CHANNELS.endDrag),
  setPetPointerPassthrough: (passthrough: boolean): void =>
    ipcRenderer.send(PET_OVERLAY_CHANNELS.setPointerPassthrough, passthrough),
  requestPetKeyboardFocus: (focused: boolean): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.requestKeyboardFocus, focused),
  openPetSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke(PET_OVERLAY_CHANNELS.openSession, sessionId),
  onPetOpenSession: (listener: (sessionId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: unknown) => {
      if (typeof sessionId === "string") listener(sessionId)
    }
    ipcRenderer.on(PET_OVERLAY_CHANNELS.openSession, handler)
    return () =>
      ipcRenderer.removeListener(PET_OVERLAY_CHANNELS.openSession, handler)
  },
} satisfies DesktopPetOverlayBridge
  & DesktopSettingsIpcBridge
  & DesktopDataLocationIpcBridge
  & Record<string, unknown>

contextBridge.exposeInMainWorld("codePilotXDesktop", desktop)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPetPresentation(value: unknown): value is DesktopPetPresentation {
  return isRecord(value)
    && (typeof value.selectedPetId === "string" || value.selectedPetId === null)
    && typeof value.size === "number"
    && Number.isFinite(value.size)
}
