import { ipcMain } from "electron"
import {
  DESKTOP_APPEARANCE_IPC_CHANNELS,
  type DesktopStartupThemeSeed,
} from "@codepilotx/shared/desktop-appearance-ipc"
import {
  type AppearanceSettingsStore,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV7,
} from "../settings/appearance-settings-store.js"
import type { WindowAppearanceController } from "../windows/appearance.js"
import { resolveStartupPageTheme } from "../windows/startup-page.js"

export function registerAppearanceIpc(
  initialSettings: DesktopThemeSettingsV7,
  appearance: WindowAppearanceController,
  store: AppearanceSettingsStore,
  isMainWindowSender: (sender: Electron.WebContents) => boolean,
): void {
  let settings = normalizeAppearanceSettings(initialSettings)
  ipcMain.on(
    DESKTOP_APPEARANCE_IPC_CHANNELS.getStartupThemeSeed,
    (event) => {
      if (!isMainWindowSender(event.sender)) {
        event.returnValue = null
        return
      }
      const resolved = resolveStartupPageTheme(
        settings,
        appearance.systemThemeVariant(),
      )
      const seed: DesktopStartupThemeSeed = {
        version: 1,
        variant: resolved.variant,
        surface: resolved.theme.surface,
        ink: resolved.theme.ink,
      }
      event.returnValue = seed
    },
  )
  ipcMain.handle(DESKTOP_APPEARANCE_IPC_CHANNELS.getSettings, () => settings)
  ipcMain.handle(
    DESKTOP_APPEARANCE_IPC_CHANNELS.saveSettings,
    async (_event, value: unknown) => {
      const next = migrateAppearanceSettings(value)
      await store.save(next)
      settings = next
      appearance.updateSettings(next)
      appearance.broadcastAppearanceSettings(next)
    },
  )
  ipcMain.handle(
    DESKTOP_APPEARANCE_IPC_CHANNELS.getSystemTheme,
    () => appearance.systemThemeVariant(),
  )
  appearance.registerThemeBroadcast()
}
