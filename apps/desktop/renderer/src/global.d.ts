import type {
  DesktopStoredSettings,
  DesktopSystemFontsResult,
  DesktopThemeSettings,
} from '../shared/types.js'
import type { DesktopPetOverlayBridge } from '@codepilotx/shared/desktop-pet-overlay'
import type { DesktopDataLocationIpcBridge } from '@codepilotx/shared/desktop-data-location-ipc'
import type { DesktopEditIpcBridge } from '@codepilotx/shared/desktop-edit-ipc'
import type { DesktopUpdateIpcBridge } from '@codepilotx/shared/desktop-update-ipc'
import type { DesktopTerminalIpcBridge } from '@codepilotx/shared/desktop-terminal-ipc'
import type { DesktopNotificationIpcBridge } from '@codepilotx/shared/desktop-notification-ipc'
import type { DesktopAttachmentIpcBridge } from '@codepilotx/shared/desktop-attachment-ipc'
import type { DesktopBrowserIpcBridge } from '@codepilotx/shared/desktop-browser-ipc'
import type { DesktopWindowIpcBridge } from '@codepilotx/shared/desktop-window-ipc'
import type { DesktopWorkspaceIpcBridge } from '@codepilotx/shared/desktop-workspace-ipc'
import type { DesktopShellIpcBridge } from '@codepilotx/shared/desktop-shell-ipc'
import type { DesktopApiKeyIpcBridge } from '@codepilotx/shared/desktop-api-key-ipc'
import type { DesktopStartupIpcBridge } from '@codepilotx/shared/desktop-startup-ipc'
import type { DesktopAppearanceIpcBridge } from '@codepilotx/shared/desktop-appearance-ipc'

declare global {
  const __CODEPILOTX_VERSION__: string

  interface Window {
    codePilotXDesktop?: {
      listSystemFonts(): Promise<DesktopSystemFontsResult>
      getDesktopSettings(): Promise<DesktopStoredSettings>
      saveDesktopSettings(
        settings: DesktopStoredSettings,
      ): Promise<DesktopStoredSettings>
      onDesktopSettingsChange?(
        listener: (
          change:
            | DesktopStoredSettings
            | { settings: DesktopStoredSettings },
        ) => void,
      ): () => void
    } & DesktopPetOverlayBridge
      & DesktopDataLocationIpcBridge
      & DesktopEditIpcBridge
      & DesktopTerminalIpcBridge
      & DesktopUpdateIpcBridge
      & DesktopNotificationIpcBridge
      & DesktopAttachmentIpcBridge
      & DesktopBrowserIpcBridge
      & DesktopWindowIpcBridge
      & DesktopWorkspaceIpcBridge
      & DesktopShellIpcBridge
      & DesktopApiKeyIpcBridge
      & DesktopStartupIpcBridge
      & DesktopAppearanceIpcBridge<DesktopThemeSettings['codeThemeIds']['light']>
  }
}

declare module '*.css'
declare module '*.scss'

export {}
