import { join } from "node:path"
import { BrowserWindow, screen, type WebContents } from "electron"
import type { DesktopPetOverlayWindowState } from "@codepilotx/shared/desktop-pet-overlay"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import {
  isAllowedApplicationUrl,
  normalizeOrigin,
} from "../security/navigation.js"
import {
  clampPetOverlayBounds,
  type PetOverlayWindowStateV1,
  PetOverlayWindowStateStore,
} from "./pet-overlay-window-state.js"

export class PetOverlayWindowController {
  #window?: BrowserWindow
  #applicationOrigin?: string
  #dragStart?: {
    cursor: Electron.Point
    bounds: Electron.Rectangle
  }

  constructor(
    private readonly logger: DesktopLogger,
    private readonly moduleDirectory: string,
    private readonly stateStore: PetOverlayWindowStateStore,
    private state: PetOverlayWindowStateV1,
  ) {}

  get overlayWindow(): BrowserWindow | undefined {
    return this.#window
  }

  setApplicationOrigin(origin: string): void {
    this.#applicationOrigin = normalizeOrigin(origin)
  }

  async open(): Promise<void> {
    if (!this.#applicationOrigin) throw new Error("Agent 尚未连接")
    const overlay = this.#ensureWindow()
    const target = `${this.#applicationOrigin}/#/pet-overlay`
    if (overlay.webContents.getURL() !== target) await overlay.loadURL(target)
    overlay.showInactive()
  }

  hide(): void {
    this.#window?.hide()
  }

  windowState(): DesktopPetOverlayWindowState {
    return {
      open: this.#window?.isVisible() ?? false,
      bounds: this.#window?.getBounds() ?? this.state.bounds,
    }
  }

  isOverlaySender(sender: WebContents): boolean {
    return this.#window?.webContents === sender
  }

  beginDrag(): void {
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    this.#dragStart = {
      cursor: screen.getCursorScreenPoint(),
      bounds: overlay.getBounds(),
    }
  }

  updateDrag(): void {
    const overlay = this.#window
    const start = this.#dragStart
    if (!overlay || overlay.isDestroyed() || !start) return
    const cursor = screen.getCursorScreenPoint()
    const candidate = {
      ...start.bounds,
      x: start.bounds.x + cursor.x - start.cursor.x,
      y: start.bounds.y + cursor.y - start.cursor.y,
    }
    const workArea = screen.getDisplayNearestPoint(cursor).workArea
    const bounds = clampPetOverlayBounds(candidate, workArea)
    overlay.setBounds(bounds, false)
    this.state = { version: 1, bounds }
  }

  endDrag(): void {
    this.#dragStart = undefined
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    this.state = { version: 1, bounds: overlay.getBounds() }
    this.stateStore.scheduleSave(this.state)
  }

  setPointerPassthrough(passthrough: boolean): void {
    this.#window?.setIgnoreMouseEvents(passthrough, { forward: true })
  }

  requestKeyboardFocus(focused: boolean): void {
    const overlay = this.#window
    if (!overlay || overlay.isDestroyed()) return
    overlay.setFocusable(focused)
    overlay.setIgnoreMouseEvents(!focused, { forward: true })
    if (focused) {
      overlay.show()
      overlay.focus()
    }
  }

  async flushState(): Promise<void> {
    this.endDrag()
    await this.stateStore.flush()
  }

  destroy(): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy()
    this.#window = undefined
  }

  #ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window
    const overlay = new BrowserWindow({
      ...this.state.bounds,
      transparent: true,
      frame: false,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: join(this.moduleDirectory, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: true,
      },
    })
    this.#window = overlay
    overlay.setAlwaysOnTop(true, "floating")
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    overlay.setIgnoreMouseEvents(true, { forward: true })
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
    overlay.webContents.on("will-navigate", (event, url) => {
      if (!isAllowedApplicationUrl(url, this.#applicationOrigin)) {
        event.preventDefault()
      }
    })
    overlay.webContents.on("preload-error", (_event, _preloadPath, error) => {
      this.logger.error("pet-overlay.preload-error", {
        message: error.message,
      })
    })
    overlay.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        this.logger.error("pet-overlay.did-fail-load", {
          errorCode,
          errorDescription,
          isMainFrame,
        })
      },
    )
    overlay.webContents.on("render-process-gone", (_event, details) => {
      this.logger.error("pet-overlay.render-process-gone", {
        reason: details.reason,
        exitCode: details.exitCode,
      })
    })
    overlay.on("unresponsive", () => {
      this.logger.warn("pet-overlay.unresponsive")
    })
    overlay.on("closed", () => {
      if (this.#window === overlay) this.#window = undefined
    })
    return overlay
  }
}
