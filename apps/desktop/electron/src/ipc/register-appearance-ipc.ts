import { ipcMain } from "electron"
import {
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV6,
} from "../settings/appearance-settings-store.js"
import type { WindowAppearanceController } from "../windows/appearance.js"

export function registerAppearanceIpc(
  initialSettings: DesktopThemeSettingsV6,
  appearance: WindowAppearanceController,
): void {
  let settings = normalizeAppearanceSettings(initialSettings)
  ipcMain.handle("appearance:settings:get", () => settings)
  ipcMain.handle(
    "appearance:settings:save",
    (_event, value: unknown) => {
      settings = normalizeAppearanceSettings(value)
      appearance.broadcastAppearanceSettings(settings)
    },
  )
  ipcMain.handle(
    "appearance:system-theme:get",
    () => appearance.systemThemeVariant(),
  )
  appearance.registerThemeBroadcast()
}
