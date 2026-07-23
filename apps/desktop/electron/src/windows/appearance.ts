import { app, BrowserWindow, nativeTheme } from "electron"
import type { DesktopLogger } from "../logging/desktop-logger.js"
import type { WindowManager } from "./window-manager.js"

export type SystemThemeVariant = "light" | "dark"

export class WindowAppearanceController {
  readonly #windows: WindowManager
  readonly #logger: DesktopLogger

  constructor(windows: WindowManager, logger: DesktopLogger) {
    this.#windows = windows
    this.#logger = logger
  }

  registerThemeBroadcast(): void {
    nativeTheme.on("updated", this.#broadcastSystemTheme)
    app.once("will-quit", () => {
      nativeTheme.removeListener("updated", this.#broadcastSystemTheme)
    })
  }

  systemThemeVariant(): SystemThemeVariant {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  }

  supportsWindowBackdrop(): boolean {
    const mainWindow = this.#windows.mainWindow
    return process.platform === "win32"
      && Boolean(mainWindow)
      && typeof mainWindow?.setBackgroundMaterial === "function"
  }

  applyWindowBackdrop(enabled: boolean): boolean {
    const mainWindow = this.#windows.mainWindow
    if (
      !mainWindow
      || mainWindow.isDestroyed()
      || !this.supportsWindowBackdrop()
    ) {
      return false
    }
    try {
      mainWindow.setBackgroundMaterial(enabled ? "acrylic" : "none")
      return true
    } catch (error) {
      this.#logger.warn("desktop.window-backdrop-failed", {
        enabled,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  readonly #broadcastSystemTheme = (): void => {
    const variant = this.systemThemeVariant()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("appearance:system-theme:changed", variant)
      }
    }
  }
}
