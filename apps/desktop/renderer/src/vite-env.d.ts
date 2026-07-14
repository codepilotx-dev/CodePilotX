/// <reference types="vite/client" />

interface Window {
  codePilotXDesktop?: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<boolean>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
    pickWorkspaceDirectory: () => Promise<string | null>
    onAgentConnectionChange: (listener: (state: 'connected' | 'disconnected' | 'unknown') => void) => () => void
    getAgentConnectionState: () => Promise<'connected' | 'disconnected' | 'unknown'>
    openLogDirectory: () => Promise<string>
    quitDuringStartup: () => Promise<void>
  }
}
