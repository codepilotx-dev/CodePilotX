import type { DesktopApi } from '../shared/types.js'

declare global {
  interface Window {
    desktopApi: DesktopApi
    codePilotXDesktop?: {
      minimize(): Promise<void>
      toggleMaximize(): Promise<boolean>
      close(): Promise<void>
      isMaximized(): Promise<boolean>
    }
  }
}

declare module '*.css'
declare module '*.scss'

export {}
