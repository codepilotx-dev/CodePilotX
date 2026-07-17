import type { DesktopApi } from '../shared/types.js'

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
      getAppearanceSettings(): Promise<unknown>
      saveAppearanceSettings(settings: unknown): Promise<unknown>
      getSystemTheme(): Promise<'light' | 'dark'>
      onSystemThemeChange(
        listener: (theme: 'light' | 'dark') => void,
      ): () => void
      getWindowBackdropCapability(): Promise<{
        supported: boolean
        platform: string
      }>
      applyWindowBackdrop(enabled: boolean): Promise<boolean>
    }
  }
}

declare module '*.css'
declare module '*.scss'

export {}
