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
  appearance.registerThemeBroadcast()
}
