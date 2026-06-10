import type {
  DesktopFilePreview,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopThinkingMode,
} from '../shared/types.js'

export type AppView = 'quickChat' | 'search' | 'plugins' | 'automation'

export type DrawerTab =
  | 'files'
  | 'diff'
  | 'permissions'
  | 'toolLog'
  | 'settings'

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  streaming?: boolean
}

export type SessionListItem = {
  id: string
  sessionName: string | null
  workspaceName: string
  workspacePath: string
  standalone?: boolean
  permissionMode: DesktopPermissionMode
  model: string | null
  fallbackModel: string | null
  thinkingMode: DesktopThinkingMode
  hasSystemPrompt: boolean
  hasAppendSystemPrompt: boolean
  additionalDirectoryCount: number
  status: DesktopSessionStatus
  createdAt: string
}

export type ToolLogEntry = {
  id: string
  toolName: string
  summary: string
  kind: 'start' | 'result'
  isError?: boolean
  expanded: boolean
  createdAt: string
}

export type SessionViewState = {
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  selectedFile: DesktopFilePreview | null
}
