export type DesktopAuthStatus = {
  authenticated: boolean
  method: string
  email?: string | null
  organizationName?: string | null
}

export type DesktopWorkspace = {
  path: string
  name: string
  branchName?: string | null
  isGitRepo?: boolean
}

export type DesktopFileEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  depth: number
}

export type DesktopFilePreview = {
  path: string
  content: string
  truncated: boolean
}

export type DesktopDiffSummary = {
  patch: string
}

export type DesktopRuntimeStatus = {
  agentExecutablePath: string
  agentExecutableExists: boolean
}

export type DesktopSessionStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error'

export type DesktopPermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'dontAsk'

export type DesktopThinkingMode =
  | 'default'
  | 'enabled'
  | 'adaptive'
  | 'disabled'

export type DesktopPermissionDecision = {
  behavior: 'allow' | 'deny'
  message?: string
  alwaysAllow?: boolean
}

export type DesktopPermissionRequest = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  description: string
}

export type DesktopAgentEvent =
  | { type: 'message'; sessionId: string; role: 'user' | 'assistant' | 'system'; text: string }
  | { type: 'partial_message'; sessionId: string; text: string }
  | { type: 'tool_start'; sessionId: string; toolName: string; summary: string }
  | { type: 'tool_result'; sessionId: string; toolName: string; summary: string; isError?: boolean }
  | { type: 'permission_request'; sessionId: string; request: DesktopPermissionRequest }
  | { type: 'status'; sessionId: string; status: DesktopSessionStatus }
  | { type: 'diff'; sessionId: string; filePath: string; patch: string }
  | { type: 'error'; sessionId: string; message: string }
  | { type: 'done'; sessionId: string }

export type CreateDesktopSessionOptions = {
  workspacePath: string
  permissionMode?: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
}

export type CreateDesktopSessionResult = {
  sessionId: string
}

export type DesktopUiCommand =
  | 'newConversation'
  | 'chooseWorkspace'
  | 'refreshWorkspace'
  | 'openSettings'
  | 'logOut'

export type DesktopApi = {
  getAuthStatus(): Promise<DesktopAuthStatus>
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>
  chooseWorkspace(): Promise<DesktopWorkspace | null>
  openWorkspace(workspacePath: string): Promise<DesktopWorkspace>
  getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace>
  listWorkspaceFiles(workspacePath: string): Promise<DesktopFileEntry[]>
  readWorkspaceFile(workspacePath: string, filePath: string): Promise<DesktopFilePreview>
  getWorkspaceDiff(workspacePath: string): Promise<DesktopDiffSummary>
  createSession(options: CreateDesktopSessionOptions): Promise<CreateDesktopSessionResult>
  sendUserMessage(sessionId: string, content: string): Promise<void>
  respondToPermission(
    sessionId: string,
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  interruptSession(sessionId: string): Promise<void>
  disposeSession(sessionId: string): Promise<void>
  minimizeWindow(): Promise<void>
  toggleWindowMaximized(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  newWindow(): Promise<void>
  openSettings(): Promise<void>
  logOut(): Promise<void>
  exitApp(): Promise<void>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
}
