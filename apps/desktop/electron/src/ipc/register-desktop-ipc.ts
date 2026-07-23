import { clipboard, dialog, ipcMain, shell, type OpenDialogOptions } from "electron"
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
  } = dependencies

  ipcMain.handle("window:minimize", () => windows.mainWindow?.minimize())
  ipcMain.handle("window:toggle-maximize", () => {
    const mainWindow = windows.mainWindow
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle("window:close", () => windows.mainWindow?.close())
  ipcMain.handle(
    "window:is-maximized",
    () => windows.mainWindow?.isMaximized() ?? false,
  )
  ipcMain.handle("agent:connection-state", () => getConnectionState())
  ipcMain.handle("desktop-settings:get", async () => {
    const supervisor = requireSupervisor(getSupervisor())
    const response = await supervisor.request("/api/desktop-settings")
    return normalizeDesktopSettingsPayload(await response.json())
  })
  ipcMain.handle(
    "desktop-settings:save",
    async (_event, settings: unknown) => {
      const supervisor = requireSupervisor(getSupervisor())
      const normalizedSettings = normalizeDesktopSettingsPayload(settings)
      const response = await supervisor.request("/api/desktop-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedSettings),
      })
      return normalizeDesktopSettingsPayload(await response.json())
    },
  )
  ipcMain.handle("api-key:copy", async (_event, credentialId: unknown) => {
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
  ipcMain.handle("shell:open-external", async (_event, url: unknown) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw new Error("拒绝打开不安全的外部链接")
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(
    "shell:list-external-open-targets",
    async (_event, targetPath: unknown) => {
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      return externalOpenTargets.listTargets(targetPath)
    },
  )
  ipcMain.handle(
    "shell:open-path-with-target",
    async (_event, targetPath: unknown, targetId: unknown) => {
      if (typeof targetPath !== "string" || typeof targetId !== "string") {
        throw new Error("外部打开参数无效")
      }
      await externalOpenTargets.openPathWithTarget(targetPath, targetId)
    },
  )
  ipcMain.handle(
    "shell:reveal-path-in-folder",
    (_event, targetPath: unknown) => {
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      externalOpenTargets.revealPathInFolder(targetPath)
    },
  )
  ipcMain.handle("startup:open-logs", async () => {
    const directory = getLogDirectory()
    const openError = await shell.openPath(directory)
    if (openError) {
      logger.error("desktop.open-log-directory-failed", {
        directory,
        message: openError,
      })
      throw new Error(`无法打开日志目录：${openError}`)
    }
    logger.info("desktop.log-directory-opened", { directory })
    return directory
  })
  ipcMain.handle("startup:quit", () => quitDuringStartup())
  ipcMain.handle("workspace:pick-directory", async () => {
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

function requireSupervisor(
  supervisor: SidecarSupervisor | undefined,
): SidecarSupervisor {
  if (!supervisor) throw new Error("Agent 尚未初始化")
  return supervisor
}
