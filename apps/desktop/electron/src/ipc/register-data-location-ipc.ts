import { dialog, ipcMain, type OpenDialogOptions } from "electron"
import {
  DESKTOP_DATA_LOCATION_IPC_CHANNELS,
} from "@codepilotx/shared/desktop-data-location-ipc"
import type { DataLocationStore } from "../settings/data-location-store.js"
import type { WindowManager } from "../windows/window-manager.js"

type DataLocationIpcDependencies = {
  store: DataLocationStore
  windows: WindowManager
  installDirectory: string
  relaunch: () => void
}

export function registerDataLocationIpc(
  dependencies: DataLocationIpcDependencies,
): void {
  const { store, windows, installDirectory, relaunch } = dependencies
  ipcMain.handle(DESKTOP_DATA_LOCATION_IPC_CHANNELS.get, event => {
    requireMainWindow(event.sender.id, windows)
    return store.state()
  })
  ipcMain.handle(
    DESKTOP_DATA_LOCATION_IPC_CHANNELS.choose,
    async (event, workspaceRoots: unknown) => {
      requireMainWindow(event.sender.id, windows)
      const options: OpenDialogOptions = {
        title: "选择 CodePilotX 用户数据的父目录",
        properties: ["openDirectory", "createDirectory"],
      }
      const result = windows.mainWindow
        ? await dialog.showOpenDialog(windows.mainWindow, options)
        : await dialog.showOpenDialog(options)
      const selected = result.canceled ? null : result.filePaths[0] ?? null
      if (!selected) return null
      const change = await store.schedule(
        selected,
        installDirectory,
        normalizeWorkspaceRoots(workspaceRoots),
      )
      setImmediate(relaunch)
      return change
    },
  )
  ipcMain.handle(DESKTOP_DATA_LOCATION_IPC_CHANNELS.retry, event => {
    requireMainWindow(event.sender.id, windows)
    setImmediate(relaunch)
  })
  ipcMain.handle(
    DESKTOP_DATA_LOCATION_IPC_CHANNELS.restore,
    async event => {
      requireMainWindow(event.sender.id, windows)
      await store.restoreActive()
      setImmediate(relaunch)
    },
  )
}

function normalizeWorkspaceRoots(value: unknown): string[] {
  if (value === undefined) return []
  if (
    !Array.isArray(value)
    || value.length > 1_000
    || value.some(path => typeof path !== "string" || path.length > 32_768)
  ) {
    throw new Error("工作区路径列表无效")
  }
  return value
}

function requireMainWindow(senderId: number, windows: WindowManager): void {
  if (windows.mainWindow?.webContents.id !== senderId) {
    throw new Error("IPC 调用来源无效")
  }
}
