import {
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
import {
  DESKTOP_UPDATE_IPC_CHANNELS,
} from "@codepilotx/shared/desktop-update-ipc"
import {
  DESKTOP_ATTACHMENT_IPC_CHANNELS,
  type DesktopAttachmentSaveInput,
  type DesktopComposerPathListInput,
  type DesktopComposerPathReadInput,
} from "@codepilotx/shared/desktop-attachment-ipc"
import { DESKTOP_WINDOW_IPC_CHANNELS } from "@codepilotx/shared/desktop-window-ipc"
import { DESKTOP_WORKSPACE_IPC_CHANNELS } from "@codepilotx/shared/desktop-workspace-ipc"
import { DESKTOP_SHELL_IPC_CHANNELS } from "@codepilotx/shared/desktop-shell-ipc"
import {
  DESKTOP_CLIPBOARD_IPC_CHANNELS,
  requireDesktopClipboardRichTextInput,
  requireDesktopClipboardTextInput,
} from "@codepilotx/shared/desktop-clipboard-ipc"
import { DESKTOP_STARTUP_IPC_CHANNELS } from "@codepilotx/shared/desktop-startup-ipc"
import type { DesktopClipboardService } from "../clipboard/desktop-clipboard-service.js"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import { isSafeExternalUrl } from "../security/navigation.js"
import {
  normalizeDesktopSettingsPayload,
  requireApiKeyMaterial,
} from "../settings/desktop-settings-contract.js"
import type {
  SidecarSupervisor,
} from "../sidecar/supervisor.js"
import type { WindowManager } from "../windows/window-manager.js"
import type { DesktopAutoUpdater } from "../update/desktop-auto-updater.js"
import type { ExternalOpenTargetService } from "./external-open-targets.js"
import type { AttachmentDownloadService } from "./attachment-download-service.js"
import type { ComposerPathGrantService } from "./composer-path-grant-service.js"

interface DesktopIpcDependencies {
  windows: WindowManager
  logger: DesktopLogger
  externalOpenTargets: ExternalOpenTargetService
  updater: DesktopAutoUpdater
  attachmentDownloads: AttachmentDownloadService
  composerPathGrants: ComposerPathGrantService
  clipboardService: DesktopClipboardService
  getSupervisor: () => SidecarSupervisor | undefined
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
    updater,
    attachmentDownloads,
    composerPathGrants,
    clipboardService,
    getSupervisor,
    getLogDirectory,
    quitDuringStartup,
    broadcastDesktopSettingsChanged,
    isDesktopRendererSender,
  } = dependencies

  ipcMain.handle(
    DESKTOP_ATTACHMENT_IPC_CHANNELS.saveToDownloads,
    async (event, input: DesktopAttachmentSaveInput) => {
      requireMainWindowSender(event, windows)
      return attachmentDownloads.save(input)
    },
  )

  const grantOwnersWithCleanup = new Set<number>()
  const retainGrantOwner = (sender: WebContents): void => {
    if (grantOwnersWithCleanup.has(sender.id)) return
    grantOwnersWithCleanup.add(sender.id)
    sender.once("destroyed", () => {
      grantOwnersWithCleanup.delete(sender.id)
      composerPathGrants.clearOwner(sender.id)
    })
  }
  ipcMain.handle(
    DESKTOP_ATTACHMENT_IPC_CHANNELS.chooseComposerFiles,
    async event => {
      requireMainWindowSender(event, windows)
      const options: OpenDialogOptions = {
        title: "Files and folders",
        properties: ["openFile", "multiSelections"],
      }
      const mainWindow = windows.mainWindow
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return []
      retainGrantOwner(event.sender)
      return composerPathGrants.grantPaths(event.sender.id, result.filePaths)
    },
  )
  ipcMain.handle(
    DESKTOP_ATTACHMENT_IPC_CHANNELS.grantComposerPaths,
    async (event, paths: unknown) => {
      requireMainWindowSender(event, windows)
      retainGrantOwner(event.sender)
      return composerPathGrants.grantPaths(event.sender.id, paths)
    },
  )
  ipcMain.handle(
    DESKTOP_ATTACHMENT_IPC_CHANNELS.readComposerPathGrant,
    async (event, input: DesktopComposerPathReadInput) => {
      requireMainWindowSender(event, windows)
      return composerPathGrants.read(event.sender.id, input)
    },
  )
  ipcMain.handle(
    DESKTOP_ATTACHMENT_IPC_CHANNELS.listComposerPathGrant,
    async (event, input: DesktopComposerPathListInput) => {
      requireMainWindowSender(event, windows)
      return composerPathGrants.list(event.sender.id, input)
    },
  )

  ipcMain.handle(DESKTOP_WINDOW_IPC_CHANNELS.minimize, event => {
    requireMainWindowSender(event, windows)
    windows.mainWindow?.minimize()
  })
  ipcMain.handle(DESKTOP_WINDOW_IPC_CHANNELS.toggleMaximize, event => {
    requireMainWindowSender(event, windows)
    const mainWindow = windows.mainWindow
    if (!mainWindow) return false
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return mainWindow.isMaximized()
  })
  ipcMain.handle(DESKTOP_WINDOW_IPC_CHANNELS.close, event => {
    requireMainWindowSender(event, windows)
    windows.mainWindow?.close()
  })
  ipcMain.handle(
    DESKTOP_WINDOW_IPC_CHANNELS.isMaximized,
    event => {
      requireMainWindowSender(event, windows)
      return windows.mainWindow?.isMaximized() ?? false
    },
  )
  ipcMain.handle(DESKTOP_UPDATE_IPC_CHANNELS.check, async event => {
    requireMainWindowSender(event, windows)
    await updater.checkForUpdates()
  })
  ipcMain.handle(DESKTOP_UPDATE_IPC_CHANNELS.download, async event => {
    requireMainWindowSender(event, windows)
    await updater.downloadUpdate()
  })
  ipcMain.handle(DESKTOP_UPDATE_IPC_CHANNELS.quitAndInstall, async event => {
    requireMainWindowSender(event, windows)
    await updater.quitAndInstall()
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
    const response = await supervisor.request("/api/config/desktop-projection")
    return normalizeDesktopSettingsPayload(await response.json())
  })
  ipcMain.handle(
    DESKTOP_SETTINGS_IPC_CHANNELS.save,
    async (event, settings: unknown) => {
      requireMainWindowSender(event, windows)
      const supervisor = requireSupervisor(getSupervisor())
      const normalizedSettings = normalizeDesktopSettingsPayload(settings)
      const response = await supervisor.request("/api/config/desktop-projection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedSettings),
      })
      const saved = normalizeDesktopSettingsPayload(await response.json())
      broadcastDesktopSettingsChanged(saved)
      return saved
    },
  )
  ipcMain.handle(
    DESKTOP_CLIPBOARD_IPC_CHANNELS.writeText,
    (event, input: unknown) => {
      requireMainWindowSender(event, windows)
      const { text } = requireDesktopClipboardTextInput(input)
      clipboardService.writeText(text)
    },
  )
  ipcMain.handle(
    DESKTOP_CLIPBOARD_IPC_CHANNELS.writeRichText,
    (event, input: unknown) => {
      requireMainWindowSender(event, windows)
      clipboardService.writeRichText(requireDesktopClipboardRichTextInput(input))
    },
  )
  ipcMain.handle(
    DESKTOP_CLIPBOARD_IPC_CHANNELS.copyProviderApiKey,
    async (event, credentialId: unknown) => {
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
      return clipboardService.writeSensitiveText(material)
    },
  )
  ipcMain.handle(DESKTOP_SHELL_IPC_CHANNELS.openExternal, async (event, url: unknown) => {
    requireMainWindowSender(event, windows)
    if (typeof url !== "string" || !isSafeExternalUrl(url)) {
      throw new Error("拒绝打开不安全的外部链接")
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(
    DESKTOP_SHELL_IPC_CHANNELS.listExternalOpenTargets,
    async (event, targetPath: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      return externalOpenTargets.listTargets(targetPath)
    },
  )
  ipcMain.handle(
    DESKTOP_SHELL_IPC_CHANNELS.openPathWithTarget,
    async (event, targetPath: unknown, targetId: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string" || typeof targetId !== "string") {
        throw new Error("外部打开参数无效")
      }
      await externalOpenTargets.openPathWithTarget(targetPath, targetId)
    },
  )
  ipcMain.handle(
    DESKTOP_SHELL_IPC_CHANNELS.revealPathInFolder,
    (event, targetPath: unknown) => {
      requireMainWindowSender(event, windows)
      if (typeof targetPath !== "string") throw new Error("路径参数无效")
      externalOpenTargets.revealPathInFolder(targetPath)
    },
  )
  ipcMain.handle(DESKTOP_STARTUP_IPC_CHANNELS.openLogs, async event => {
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
  ipcMain.handle(DESKTOP_STARTUP_IPC_CHANNELS.quit, event => {
    requireMainWindowSender(event, windows)
    quitDuringStartup()
  })
  ipcMain.handle(DESKTOP_WORKSPACE_IPC_CHANNELS.pickDirectory, async event => {
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
