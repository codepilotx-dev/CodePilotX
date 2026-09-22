export const DESKTOP_WORKSPACE_IPC_CHANNELS = {
  pickDirectory: "workspace:pick-directory",
} as const

export interface DesktopWorkspaceIpcBridge {
  pickWorkspaceDirectory(): Promise<string | null>
}
