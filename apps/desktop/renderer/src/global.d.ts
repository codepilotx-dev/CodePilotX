import type {
  DesktopApi,
  DesktopStoredSettings,
  DesktopThemeSettings,
} from '../shared/types.js'

declare global {
  interface Window {
    desktopApi: DesktopApi
    codePilotXDesktop?: {
      minimize(): Promise<void>
      toggleMaximize(): Promise<boolean>
      close(): Promise<void>
      isMaximized(): Promise<boolean>
      pickWorkspaceDirectory(): Promise<string | null>
      openExternal(url: string): Promise<void>
      listExternalOpenTargets(targetPath: string): Promise<Array<{
        targetId: string
        label: string
        kind: 'default-app' | 'editor'
        iconDataUrl?: string
      }>>
      openPathWithTarget(targetPath: string, targetId: string): Promise<void>
      revealPathInFolder(targetPath: string): Promise<void>
      getAppearanceSettings(): Promise<DesktopThemeSettings>
      saveAppearanceSettings(settings: DesktopThemeSettings): Promise<void>
      getSystemTheme(): Promise<'light' | 'dark'>
      onSystemThemeChange(
        listener: (theme: 'light' | 'dark') => void,
      ): () => void
      getWindowBackdropCapability(): Promise<{
        supported: boolean
        platform: string
      }>
      applyWindowBackdrop(enabled: boolean): Promise<boolean>
      getDesktopSettings(): Promise<DesktopStoredSettings>
      saveDesktopSettings(
        settings: DesktopStoredSettings,
      ): Promise<DesktopStoredSettings>
      copyProviderApiKey(
        credentialId: string,
      ): Promise<{ clearAfterMs: 60000 }>
    }
  }
}

declare module '*.css'
declare module '*.scss'

export {}
