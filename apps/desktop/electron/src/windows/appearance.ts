import { app, BrowserWindow, nativeTheme } from "electron"
export type SystemThemeVariant = "light" | "dark"

export class WindowAppearanceController {
  registerThemeBroadcast(): void {
    nativeTheme.on("updated", this.#broadcastSystemTheme)
    app.once("will-quit", () => {
      nativeTheme.removeListener("updated", this.#broadcastSystemTheme)
    })
  }

  systemThemeVariant(): SystemThemeVariant {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light"
  }

  broadcastAppearanceSettings(settings: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send("appearance:settings:changed", settings)
      }
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
