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
      listExternalOpenTargets(targetPath: string): Promise<Array<{
        targetId: string
        label: string
        kind: 'default-app' | 'editor'
        iconDataUrl?: string
      }>>
      openPathWithTarget(targetPath: string, targetId: string): Promise<void>
      revealPathInFolder(targetPath: string): Promise<void>
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
      getDesktopSettings(): Promise<unknown>
      saveDesktopSettings(settings: unknown): Promise<unknown>
    }
  }
}

declare module '*.css'
declare module '*.scss'

export {}
