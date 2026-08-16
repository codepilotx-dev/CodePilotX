import { ipcMain } from "electron"
import {
  type AppearanceSettingsStore,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV7,
} from "../settings/appearance-settings-store.js"
import type { WindowAppearanceController } from "../windows/appearance.js"

export function registerAppearanceIpc(
  initialSettings: DesktopThemeSettingsV7,
  appearance: WindowAppearanceController,
  store: AppearanceSettingsStore,
): void {
  let settings = normalizeAppearanceSettings(initialSettings)
  ipcMain.handle("appearance:settings:get", () => settings)
  ipcMain.handle(
    "appearance:settings:save",
    async (_event, value: unknown) => {
      const next = migrateAppearanceSettings(value)
      await store.save(next)
      settings = next
      appearance.broadcastAppearanceSettings(next)
    },
  )
  ipcMain.handle(
    "appearance:system-theme:get",
    () => appearance.systemThemeVariant(),
  )
  appearance.registerThemeBroadcast()
}
