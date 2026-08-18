export const DESKTOP_WINDOW_IPC_CHANNELS = {
  minimize: "window:minimize",
  toggleMaximize: "window:toggle-maximize",
  close: "window:close",
  isMaximized: "window:is-maximized",
} as const

export interface DesktopWindowIpcBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<boolean>
  close(): Promise<void>
  isMaximized(): Promise<boolean>
}
