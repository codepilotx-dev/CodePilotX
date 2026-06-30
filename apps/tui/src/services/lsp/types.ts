export interface ScopedLspServerConfig {
  scope: string
  name: string
  command: string
  args: string[]
  languageIds: string[]
  initializationOptions?: Record<string, unknown>
}

export interface LspServerState {
  running: boolean
  config: ScopedLspServerConfig
  pid?: number
}
