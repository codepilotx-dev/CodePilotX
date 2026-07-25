import {
  clipboard,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type WebContents,
} from "electron"
import {
  DESKTOP_SETTINGS_IPC_CHANNELS,
  type DesktopSettingsPayload,
} from "@codepilotx/shared/desktop-settings-ipc"
import {
  DESKTOP_EDIT_ACTIONS,
  DESKTOP_EDIT_IPC_CHANNELS,
  type DesktopEditAction,
} from "@codepilotx/shared/desktop-edit-ipc"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import { isSafeExternalUrl } from "../security/navigation.js"
import {
  normalizeDesktopSettingsPayload,
  requireApiKeyMaterial,
} from "../settings/desktop-settings-contract.js"
import type {
  AgentConnectionState,
  SidecarSupervisor,
} from "../sidecar/supervisor.js"
import type { WindowManager } from "../windows/window-manager.js"
import type { ExternalOpenTargetService } from "./external-open-targets.js"

const API_KEY_CLIPBOARD_CLEAR_DELAY_MS = 60_000 as const

interface DesktopIpcDependencies {
  windows: WindowManager
  logger: DesktopLogger
  externalOpenTargets: ExternalOpenTargetService
  getSupervisor: () => SidecarSupervisor | undefined
  getConnectionState: () => AgentConnectionState
  getLogDirectory: () => string
  quitDuringStartup: () => void
  broadcastDesktopSettingsChanged: (settings: DesktopSettingsPayload) => void
  isDesktopRendererSender: (sender: WebContents) => boolean
}

export function registerDesktopIpc(
  dependencies: DesktopIpcDependencies,
): void {
  const {
    windows,
    logger,
    externalOpenTargets,
    getSupervisor,
    getConnectionState,
    getLogDirectory,
    quitDuringStartup,
    broadcastDesktopSettingsChanged,
    isDesktopRendererSender,
  } = dependencies

  ipcMain.handle("window:minimize", event => {
    requireMainWindowSender(event, windows)
    windows.mainWindow?.minimize()
  })
  ipcMain.handle("window:toggle-maximize", event => {
    requireMainWindowSender(event, windows)
    const mainWindow = windows.mainWindow
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle("window:close", event => {
    requireMainWindowSender(event, windows)
    windows.mainWindow?.close()
  })
  ipcMain.handle(
    "window:is-maximized",
    event => {
      requireMainWindowSender(event, windows)
      return windows.mainWindow?.isMaximized() ?? false
    },
  )
  ipcMain.handle("agent:connection-state", event => {
    requireDesktopRendererSender(event, isDesktopRendererSender)
    return getConnectionState()
  })
  ipcMain.handle(
    DESKTOP_EDIT_IPC_CHANNELS.perform,
    (event, action: unknown) => {
      requireMainWindowSender(event, windows)
      if (!isDesktopEditAction(action)) {
        throw new Error("编辑命令无效")
      }
      performDesktopEditAction(event.sender, action)
    },
  )
  ipcMain.handle(DESKTOP_SETTINGS_IPC_CHANNELS.get, async (event) => {
    requireDesktopRendererSender(event, isDesktopRendererSender)
    const supervisor = requireSupervisor(getSupervisor())
    const response = await supervisor.request("/api/desktop-settings")
    return normalizeDesktopSettingsPayload(await response.json())
  })
  ipcMain.handle(
    DESKTOP_SETTINGS_IPC_CHANNELS.save,
    async (event, settings: unknown) => {
      requireMainWindowSender(event, windows)
      const supervisor = requireSupervisor(getSupervisor())
      const normalizedSettings = normalizeDesktopSettingsPayload(settings)
      const response = await supervisor.request("/api/desktop-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedSettings),
      })
      const saved = normalizeDesktopSettingsPayload(await response.json())
      broadcastDesktopSettingsChanged(saved)
      return saved
    },
  )
  ipcMain.handle("api-key:copy", async (event, credentialId: unknown) => {
    requireMainWindowSender(event, windows)
    const supervisor = requireSupervisor(getSupervisor())
    if (
      typeof credentialId !== "string"
      || credentialId.length < 1
      || credentialId.length > 200
      || !/^[A-Za-z0-9._:-]+$/.test(credentialId)
    ) {
      throw new Error("API Key 凭据 ID 无效")
    }
    const response = await supervisor.request(
      `/api/desktop/api-keys/${encodeURIComponent(credentialId)}/copy-material`,
      { method: "POST" },
    )
    const payload = await response.json() as { key?: unknown }
    const material = requireApiKeyMaterial(payload.key)
    clipboard.writeText(material)
    setTimeout(() => {
      if (clipboard.readText() === material) clipboard.clear()
    }, API_KEY_CLIPBOARD_CLEAR_DELAY_MS).unref()
    return { clearAfterMs: API_KEY_CLIPBOARD_CLEAR_DELAY_MS }
  })
  ipcMain.handle("shell:open-external", async (event, url: unknown) => {
    requireMainWindowSender(event, windows)
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw new Error("拒绝打开不安全的外部链接")
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(
    "shell:list-external-open-targets",
    async (event, targetPath: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      return externalOpenTargets.listTargets(targetPath)
    },
  )
  ipcMain.handle(
    "shell:open-path-with-target",
    async (event, targetPath: unknown, targetId: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string" || typeof targetId !== "string") {
        throw new Error("外部打开参数无效")
      }
      await externalOpenTargets.openPathWithTarget(targetPath, targetId)
    },
  )
  ipcMain.handle(
    "shell:reveal-path-in-folder",
    (event, targetPath: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      externalOpenTargets.revealPathInFolder(targetPath)
    },
  )
  ipcMain.handle("startup:open-logs", async event => {
    requireMainWindowSender(event, windows)
    const directory = getLogDirectory()
    const openError = await shell.openPath(directory)
    if (openError) {
      logger.error("desktop.open-log-directory-failed", {
        reason: "shell-open-failed",
      })
      throw new Error(`无法打开日志目录：${openError}`)
    }
    logger.info("desktop.log-directory-opened")
    return directory
  })
  ipcMain.handle("startup:quit", event => {
    requireMainWindowSender(event, windows)
    quitDuringStartup()
  })
  ipcMain.handle("workspace:pick-directory", async event => {
    requireMainWindowSender(event, windows)
    const options: OpenDialogOptions = {
      title: "选择项目目录",
      properties: ["openDirectory", "createDirectory"],
    }
    const mainWindow = windows.mainWindow
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

function isDesktopEditAction(value: unknown): value is DesktopEditAction {
  return typeof value === "string"
    && (DESKTOP_EDIT_ACTIONS as readonly string[]).includes(value)
}

function performDesktopEditAction(
  sender: WebContents,
  action: DesktopEditAction,
): void {
  switch (action) {
    case "undo":
      sender.undo()
      return
    case "redo":
      sender.redo()
      return
    case "cut":
      sender.cut()
      return
    case "copy":
      sender.copy()
      return
    case "paste":
      sender.paste()
      return
    case "delete":
      sender.delete()
      return
    case "selectAll":
      sender.selectAll()
  }
}

function requireDesktopRendererSender(
  event: Electron.IpcMainInvokeEvent,
  isAllowed: (sender: WebContents) => boolean,
): void {
  if (!isAllowed(event.sender)) {
    throw new Error("IPC 调用来源无效")
  }
}

function requireMainWindowSender(
  event: Electron.IpcMainInvokeEvent,
  windows: WindowManager,
): void {
  if (!windows.isMainSender(event.sender)) {
    throw new Error("IPC 调用来源无效")
  }
}

function requireSupervisor(
  supervisor: SidecarSupervisor | undefined,
): SidecarSupervisor {
  if (!supervisor) throw new Error("Agent 尚未初始化")
  return supervisor
}
