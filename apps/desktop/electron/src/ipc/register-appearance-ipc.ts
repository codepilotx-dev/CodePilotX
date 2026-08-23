import { ipcMain, type WebContents } from "electron"
import {
  DESKTOP_APPEARANCE_IPC_CHANNELS,
} from "@codepilotx/shared/desktop-appearance-ipc"
import {
  type AppearanceSettingsStore,
  migrateAppearanceSettings,
  normalizeAppearanceSettings,
  type DesktopThemeSettingsV7,
} from "../settings/appearance-settings-store.js"
import type { WindowAppearanceController } from "../windows/appearance.js"
import type { WindowManager } from "../windows/window-manager.js"
import { createTitleBarOverlayUpdateHandler } from "./title-bar-overlay.js"

export function registerAppearanceIpc(
  initialSettings: DesktopThemeSettingsV7,
  appearance: WindowAppearanceController,
  store: AppearanceSettingsStore,
  windows: WindowManager,
): void {
  let settings = normalizeAppearanceSettings(initialSettings)
  const updateTitleBarOverlay = createTitleBarOverlayUpdateHandler<WebContents>({
    isMainWindowSender: sender => windows.isMainSender(sender),
    updateTitleBarOverlay: overlay => windows.updateTitleBarOverlay(overlay),
  })
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
  ipcMain.handle(
    DESKTOP_APPEARANCE_IPC_CHANNELS.updateTitleBarOverlay,
    (event, value: unknown) => {
      updateTitleBarOverlay(event.sender, value)
    },
  )
  appearance.registerThemeBroadcast()
}
