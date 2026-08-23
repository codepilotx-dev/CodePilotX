import type { DesktopThemeSettingsV7, DesktopThemeVariant } from "./desktop-theme.js"

export const DESKTOP_APPEARANCE_IPC_CHANNELS = {
  getSettings: "appearance:settings:get",
  saveSettings: "appearance:settings:save",
  getSystemTheme: "appearance:system-theme:get",
  systemThemeChanged: "appearance:system-theme:changed",
  updateTitleBarOverlay: "appearance:titlebar-overlay:update",
} as const

export interface DesktopTitleBarOverlay {
  backgroundColor: string
  foregroundColor: string
  height: number
}

export interface DesktopAppearanceIpcBridge<CodeThemeId extends string = string> {
  getAppearanceSettings(): Promise<DesktopThemeSettingsV7<CodeThemeId>>
  saveAppearanceSettings(
    settings: DesktopThemeSettingsV7<CodeThemeId>,
  ): Promise<void>
  getSystemTheme(): Promise<DesktopThemeVariant>
  onSystemThemeChange(
    listener: (variant: DesktopThemeVariant) => void,
  ): () => void
  updateTitleBarOverlay(overlay: DesktopTitleBarOverlay): Promise<void>
}
