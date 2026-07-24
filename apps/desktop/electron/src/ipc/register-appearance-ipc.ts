import { ipcMain } from "electron"
import type { AppearanceSettingsStore } from "../settings/appearance-settings-store.js"
import type { WindowAppearanceController } from "../windows/appearance.js"

export function registerAppearanceIpc(
  settingsStore: AppearanceSettingsStore,
  appearance: WindowAppearanceController,
): void {
  ipcMain.handle("appearance:settings:get", () => settingsStore.load())
  ipcMain.handle(
    "appearance:settings:save",
    async (_event, settings: unknown) => {
      await settingsStore.save(settings)
    },
  )
  ipcMain.handle(
    "appearance:system-theme:get",
    () => appearance.systemThemeVariant(),
  )
  ipcMain.handle("appearance:backdrop:get-capability", () => ({
    supported: appearance.supportsWindowBackdrop(),
    platform: process.platform,
  }))
  ipcMain.handle(
    "appearance:backdrop:apply",
    (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean") {
        throw new Error("窗口背景材质参数无效")
      }
      return appearance.applyWindowBackdrop(enabled)
    },
  )
  appearance.registerThemeBroadcast()
}
