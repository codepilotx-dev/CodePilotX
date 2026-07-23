import { ipcMain, type IpcMainInvokeEvent } from "electron"
import { PET_OVERLAY_CHANNELS } from "@codepilotx/shared/desktop-pet-overlay"
import type { WindowManager } from "../windows/window-manager.js"
import type { PetOverlayWindowController } from "../windows/pet-overlay-window.js"

export function registerPetOverlayIpc(
  windows: WindowManager,
  pets: PetOverlayWindowController,
): void {
  ipcMain.handle(PET_OVERLAY_CHANNELS.open, event => {
    requireMainSender(event, windows)
    return pets.open()
  })
  ipcMain.handle(PET_OVERLAY_CHANNELS.hide, event => {
    requireKnownSender(event, windows, pets)
    pets.hide()
  })
  ipcMain.handle(PET_OVERLAY_CHANNELS.getState, event => {
    requireKnownSender(event, windows, pets)
    return pets.windowState()
  })
  ipcMain.on(PET_OVERLAY_CHANNELS.beginDrag, event => {
    requireOverlaySender(event, pets)
    pets.beginDrag()
  })
  ipcMain.on(PET_OVERLAY_CHANNELS.updateDrag, event => {
    requireOverlaySender(event, pets)
    pets.updateDrag()
  })
  ipcMain.on(PET_OVERLAY_CHANNELS.endDrag, event => {
    requireOverlaySender(event, pets)
    pets.endDrag()
  })
  ipcMain.on(
    PET_OVERLAY_CHANNELS.setPointerPassthrough,
    (event, passthrough: unknown) => {
      requireOverlaySender(event, pets)
      if (typeof passthrough !== "boolean") throw new Error("穿透参数无效")
      pets.setPointerPassthrough(passthrough)
    },
  )
  ipcMain.handle(
    PET_OVERLAY_CHANNELS.requestKeyboardFocus,
    (event, focused: unknown) => {
      requireOverlaySender(event, pets)
      if (typeof focused !== "boolean") throw new Error("焦点参数无效")
      pets.requestKeyboardFocus(focused)
    },
  )
  ipcMain.handle(
    PET_OVERLAY_CHANNELS.openSession,
    (event, sessionId: unknown) => {
      requireOverlaySender(event, pets)
      if (
        typeof sessionId !== "string"
        || sessionId.length < 1
        || sessionId.length > 200
      ) {
        throw new Error("任务 ID 无效")
      }
      windows.mainWindow?.webContents.send(
        PET_OVERLAY_CHANNELS.openSession,
        sessionId,
      )
      windows.focus(true)
    },
  )
}

function requireMainSender(
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  windows: WindowManager,
): void {
  if (event.sender !== windows.mainWindow?.webContents) {
    throw new Error("IPC 调用来源无效")
  }
}

function requireOverlaySender(
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  pets: PetOverlayWindowController,
): void {
  if (!pets.isOverlaySender(event.sender)) {
    throw new Error("IPC 调用来源无效")
  }
}

function requireKnownSender(
  event: IpcMainInvokeEvent | Electron.IpcMainEvent,
  windows: WindowManager,
  pets: PetOverlayWindowController,
): void {
  if (
    event.sender !== windows.mainWindow?.webContents
    && !pets.isOverlaySender(event.sender)
  ) {
    throw new Error("IPC 调用来源无效")
  }
}
