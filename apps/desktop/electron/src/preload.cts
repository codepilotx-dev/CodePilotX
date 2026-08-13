import { contextBridge, ipcRenderer, webUtils } from "electron"
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
import type {
  DesktopEditAction,
  DesktopEditIpcBridge,
} from "@codepilotx/shared/desktop-edit-ipc"
import type {
  DesktopUpdateIpcBridge,
  DesktopUpdateStatus,
} from "@codepilotx/shared/desktop-update-ipc"
import type {
  AttachDesktopTerminalInput,
  CloseDesktopTerminalForThreadInput,
  CloseDesktopTerminalInput,
  DesktopTerminalEvent,
  DesktopTerminalIpcBridge,
  DesktopTerminalProfile,
  DesktopTerminalSnapshot,
  EnsureDesktopTerminalInput,
  ResizeDesktopTerminalInput,
  RunDesktopTerminalActionInput,
  WriteDesktopTerminalInput,
} from "@codepilotx/shared/desktop-terminal-ipc"
import type {
  DesktopNotificationActivation,
  DesktopNotificationIpcBridge,
  DesktopNotificationRequest,
  DesktopNotificationResult,
} from "@codepilotx/shared/desktop-notification-ipc"
import type {
  DesktopAttachmentIpcBridge,
  DesktopAttachmentSaveInput,
  DesktopAttachmentSaveResult,
  DesktopComposerPathGrant,
  DesktopComposerPathListInput,
  DesktopComposerPathListResult,
  DesktopComposerPathPreview,
  DesktopComposerPathReadInput,
} from "@codepilotx/shared/desktop-attachment-ipc"
import type {
  CreateOrRestoreDesktopBrowserInput,
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
  DesktopBrowserTabInput,
  NavigateDesktopBrowserInput,
  SetDesktopBrowserBoundsInput,
  SetDesktopBrowserVisibleInput,
} from "@codepilotx/shared/desktop-browser-ipc"
import type {
  DesktopMicrophoneIpcBridge,
} from "@codepilotx/shared/desktop-microphone-ipc"

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

const DESKTOP_EDIT_IPC_CHANNELS = {
  perform: "desktop-edit:perform",
} as const satisfies typeof import("@codepilotx/shared/desktop-edit-ipc").DESKTOP_EDIT_IPC_CHANNELS

const DESKTOP_UPDATE_IPC_CHANNELS = {
  check: "desktop-update:check",
  download: "desktop-update:download",
  quitAndInstall: "desktop-update:quit-and-install",
  status: "desktop-update:status",
} as const satisfies typeof import("@codepilotx/shared/desktop-update-ipc").DESKTOP_UPDATE_IPC_CHANNELS

const DESKTOP_TERMINAL_IPC_CHANNELS = {
  listProfiles: "desktop-terminal:list-profiles",
  ensure: "desktop-terminal:ensure",
  attach: "desktop-terminal:attach",
  write: "desktop-terminal:write",
  resize: "desktop-terminal:resize",
  close: "desktop-terminal:close",
  closeThread: "desktop-terminal:close-thread",
  runAction: "desktop-terminal:run-action",
  event: "desktop-terminal:event",
} as const satisfies typeof import("@codepilotx/shared/desktop-terminal-ipc").DESKTOP_TERMINAL_IPC_CHANNELS

const DESKTOP_NOTIFICATION_IPC_CHANNELS = {
  show: "desktop-notification:show",
  activated: "desktop-notification:activated",
} as const satisfies typeof import("@codepilotx/shared/desktop-notification-ipc").DESKTOP_NOTIFICATION_IPC_CHANNELS

const DESKTOP_ATTACHMENT_IPC_CHANNELS = {
  saveToDownloads: "desktop-attachment:save-to-downloads",
  chooseComposerFiles: "desktop-attachment:choose-composer-files",
  grantComposerPaths: "desktop-attachment:grant-composer-paths",
  readComposerPathGrant: "desktop-attachment:read-composer-path-grant",
  listComposerPathGrant: "desktop-attachment:list-composer-path-grant",
} as const satisfies typeof import("@codepilotx/shared/desktop-attachment-ipc").DESKTOP_ATTACHMENT_IPC_CHANNELS

const DESKTOP_BROWSER_IPC_CHANNELS = {
  getState: "desktop-browser:get-state",
  createOrRestore: "desktop-browser:create-or-restore",
  navigate: "desktop-browser:navigate",
  reload: "desktop-browser:reload",
  stop: "desktop-browser:stop",
  goBack: "desktop-browser:go-back",
  goForward: "desktop-browser:go-forward",
  setBounds: "desktop-browser:set-bounds",
  setVisible: "desktop-browser:set-visible",
  focus: "desktop-browser:focus",
  close: "desktop-browser:close",
  clearAllowedSites: "desktop-browser:clear-allowed-sites",
  stateChanged: "desktop-browser:state-changed",
} as const satisfies typeof import("@codepilotx/shared/desktop-browser-ipc").DESKTOP_BROWSER_IPC_CHANNELS

const DESKTOP_MICROPHONE_IPC_CHANNELS = {
  openPrivacySettings: "desktop-microphone:open-privacy-settings",
} as const satisfies typeof import("@codepilotx/shared/desktop-microphone-ipc").DESKTOP_MICROPHONE_IPC_CHANNELS

function isDesktopNotificationActivation(
  value: unknown,
): value is DesktopNotificationActivation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const activation = value as Record<string, unknown>
  return isNotificationIdentifier(activation.notificationId)
    && isNotificationIdentifier(activation.threadId)
}

function isNotificationIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(value)
}

type AgentConnectionState = "connected" | "disconnected" | "unknown"
type SystemThemeVariant = "light" | "dark"
const pendingComposerDropPaths = new Set<string>()

interface DesktopExternalOpenTarget {
  targetId: string
  label: string
  kind: "default-app" | "editor"
  iconDataUrl?: string
}

const desktop = {
  getDesktopBrowserState: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.getState, input),
  createOrRestoreDesktopBrowser: (
    input: CreateOrRestoreDesktopBrowserInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.createOrRestore, input),
  navigateDesktopBrowser: (
    input: NavigateDesktopBrowserInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.navigate, input),
  reloadDesktopBrowser: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.reload, input),
  stopDesktopBrowser: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.stop, input),
  goBackDesktopBrowser: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.goBack, input),
  goForwardDesktopBrowser: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.goForward, input),
  setDesktopBrowserBounds: (
    input: SetDesktopBrowserBoundsInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.setBounds, input),
  setDesktopBrowserVisible: (
    input: SetDesktopBrowserVisibleInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.setVisible, input),
  focusDesktopBrowser: (input: DesktopBrowserTabInput): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.focus, input),
  closeDesktopBrowser: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.close, input),
  clearDesktopBrowserAllowedSites: (
    input: DesktopBrowserTabInput,
  ): Promise<DesktopBrowserSnapshot> =>
    ipcRenderer.invoke(DESKTOP_BROWSER_IPC_CHANNELS.clearAllowedSites, input),
  onDesktopBrowserStateChange: (
    listener: (state: DesktopBrowserSnapshot) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: unknown,
    ): void => {
      if (isDesktopBrowserSnapshot(state)) listener(state)
    }
    ipcRenderer.on(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged, handler)
    return () =>
      ipcRenderer.removeListener(DESKTOP_BROWSER_IPC_CHANNELS.stateChanged, handler)
  },
  openMicrophonePrivacySettings: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_MICROPHONE_IPC_CHANNELS.openPrivacySettings),
  saveAttachmentToDownloads: (
    input: DesktopAttachmentSaveInput,
  ): Promise<DesktopAttachmentSaveResult> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads, input),
  chooseComposerFiles: (): Promise<DesktopComposerPathGrant[]> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.chooseComposerFiles),
  grantComposerPaths: (
    paths: readonly string[],
  ): Promise<DesktopComposerPathGrant[]> => {
    if (
      !Array.isArray(paths)
      || paths.some(path =>
        typeof path !== "string" || !pendingComposerDropPaths.has(path),
      )
    ) {
      return Promise.reject(new Error("本地文件未通过拖放或粘贴选择"))
    }
    for (const path of paths) pendingComposerDropPaths.delete(path)
    return ipcRenderer.invoke(
      DESKTOP_ATTACHMENT_IPC_CHANNELS.grantComposerPaths,
      paths,
    )
  },
  getPathForFile: (file: File): string => {
    const path = webUtils.getPathForFile(file)
    if (path) pendingComposerDropPaths.add(path)
    return path
  },
  readComposerPathGrant: (
    input: DesktopComposerPathReadInput,
  ): Promise<DesktopComposerPathPreview> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.readComposerPathGrant, input),
  listComposerPathGrant: (
    input: DesktopComposerPathListInput,
  ): Promise<DesktopComposerPathListResult> =>
    ipcRenderer.invoke(DESKTOP_ATTACHMENT_IPC_CHANNELS.listComposerPathGrant, input),
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
  performEditAction: (action: DesktopEditAction): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_EDIT_IPC_CHANNELS.perform, action),
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
  checkForUpdates: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.check),
  downloadUpdate: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.download),
  quitAndInstall: (): Promise<void> =>
    ipcRenderer.invoke(DESKTOP_UPDATE_IPC_CHANNELS.quitAndInstall),
  onUpdateStatusChange: (
    listener: (status: DesktopUpdateStatus) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: unknown,
    ): void => {
      if (isDesktopUpdateStatus(status)) listener(status)
    }
    ipcRenderer.on(DESKTOP_UPDATE_IPC_CHANNELS.status, handler)
    return () =>
      ipcRenderer.removeListener(DESKTOP_UPDATE_IPC_CHANNELS.status, handler)
  },
  listTerminalProfiles: (): Promise<readonly DesktopTerminalProfile[]> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.listProfiles),
  ensureTerminal: (
    input: EnsureDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.ensure, input),
  attachTerminal: (
    input: AttachDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.attach, input),
  writeTerminal: (input: WriteDesktopTerminalInput): void =>
    ipcRenderer.send(DESKTOP_TERMINAL_IPC_CHANNELS.write, input),
  resizeTerminal: (input: ResizeDesktopTerminalInput): void =>
    ipcRenderer.send(DESKTOP_TERMINAL_IPC_CHANNELS.resize, input),
  closeTerminal: (
    input: CloseDesktopTerminalInput,
  ): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.close, input),
  closeTerminalForThread: (
    input: CloseDesktopTerminalForThreadInput,
  ): Promise<{ closed: boolean }> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.closeThread, input),
  runTerminalAction: (
    input: RunDesktopTerminalActionInput,
  ): Promise<DesktopTerminalSnapshot> =>
    ipcRenderer.invoke(DESKTOP_TERMINAL_IPC_CHANNELS.runAction, input),
  onTerminalEvent: (
    listener: (event: DesktopTerminalEvent) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      event: unknown,
    ): void => {
      if (isDesktopTerminalEvent(event)) listener(event)
    }
    ipcRenderer.on(DESKTOP_TERMINAL_IPC_CHANNELS.event, handler)
    return () =>
      ipcRenderer.removeListener(DESKTOP_TERMINAL_IPC_CHANNELS.event, handler)
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
  showDesktopNotification: (
    request: DesktopNotificationRequest,
  ): Promise<DesktopNotificationResult> =>
    ipcRenderer.invoke(DESKTOP_NOTIFICATION_IPC_CHANNELS.show, request),
  onDesktopNotificationActivated: (
    listener: (activation: DesktopNotificationActivation) => void,
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      activation: unknown,
    ): void => {
      if (isDesktopNotificationActivation(activation)) listener(activation)
    }
    ipcRenderer.on(DESKTOP_NOTIFICATION_IPC_CHANNELS.activated, handler)
    return () =>
      ipcRenderer.removeListener(
        DESKTOP_NOTIFICATION_IPC_CHANNELS.activated,
        handler,
      )
  },
} satisfies DesktopPetOverlayBridge
  & DesktopSettingsIpcBridge
  & DesktopDataLocationIpcBridge
  & DesktopEditIpcBridge
  & DesktopUpdateIpcBridge
  & DesktopTerminalIpcBridge
  & DesktopNotificationIpcBridge
  & DesktopAttachmentIpcBridge
  & DesktopBrowserIpcBridge
  & DesktopMicrophoneIpcBridge
  & Record<string, unknown>

contextBridge.exposeInMainWorld("codePilotXDesktop", desktop)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDesktopBrowserSnapshot(
  value: unknown,
): value is DesktopBrowserSnapshot {
  if (!isRecord(value)) return false
  return isIdentifier(value.tabId)
    && typeof value.open === "boolean"
    && typeof value.url === "string"
    && typeof value.title === "string"
    && typeof value.loading === "boolean"
    && typeof value.canGoBack === "boolean"
    && typeof value.canGoForward === "boolean"
    && (value.error === null || typeof value.error === "string")
    && Array.isArray(value.allowedSites)
    && value.allowedSites.every(site => typeof site === "string")
    && Array.isArray(value.sitePermissions)
}

function isPetPresentation(value: unknown): value is DesktopPetPresentation {
  return isRecord(value)
    && (typeof value.selectedPetId === "string" || value.selectedPetId === null)
    && typeof value.size === "number"
    && Number.isFinite(value.size)
}

function isDesktopUpdateStatus(
  value: unknown,
): value is DesktopUpdateStatus {
  if (!isRecord(value) || typeof value.phase !== "string") return false
  switch (value.phase) {
    case "checking":
    case "downloaded":
    case "no-update":
      return true
    case "available":
      return typeof value.version === "string"
        && value.version.length > 0
        && value.version.length <= 64
    case "downloading":
      return typeof value.percent === "number"
        && Number.isFinite(value.percent)
        && value.percent >= 0
        && value.percent <= 100
    case "error":
      return typeof value.message === "string"
        && value.message.length > 0
        && value.message.length <= 200
    default:
      return false
  }
}

function isDesktopTerminalEvent(value: unknown): value is DesktopTerminalEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false
  if (value.type === "output") return isDesktopTerminalChunk(value.chunk)
  if (value.type !== "state") return false
  return isIdentifier(value.terminalId)
    && isIdentifier(value.instanceId)
    && isTerminalState(value.state)
    && (value.exitCode === null || Number.isSafeInteger(value.exitCode))
    && isTerminalExitReason(value.exitReason)
}

function isDesktopTerminalChunk(value: unknown): boolean {
  return isRecord(value)
    && isIdentifier(value.terminalId)
    && isIdentifier(value.instanceId)
    && Number.isSafeInteger(value.sequence)
    && Number(value.sequence) >= 0
    && typeof value.data === "string"
    && new TextEncoder().encode(value.data).byteLength <= 1_048_576
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 200
    && /^[A-Za-z0-9._:-]+$/.test(value)
}

function isTerminalState(value: unknown): boolean {
  return ["starting", "running", "closing", "exited", "failed"].includes(String(value))
}

function isTerminalExitReason(value: unknown): boolean {
  return value === null || [
    "process-exit",
    "user-close",
    "task-close",
    "workspace-delete",
    "app-quit",
    "launch-failed",
  ].includes(String(value))
}
