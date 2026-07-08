import type { DesktopApi } from '../shared/types.js'

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}

declare module '*.css'
declare module '*.scss'

export {}
