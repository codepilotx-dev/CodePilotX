import type {
  DesktopContextUsage,
  DesktopFilePreview,
  DesktopPermissionRequest,
  DesktopSessionListItem,
  DesktopSessionMessage,
  DesktopToolLogEntry,
} from '../shared/types.js'

export type AppView = 'quickChat' | 'search' | 'plugins' | 'automation'

export type DrawerTab =
  | 'files'
  | 'diff'
  | 'permissions'
  | 'toolLog'
  | 'settings'

export type Message = DesktopSessionMessage

export type SessionListItem = DesktopSessionListItem

export type ToolLogEntry = DesktopToolLogEntry

export function sessionDisplayTitle(session: SessionListItem): string {
  return session.sessionName ?? session.aiTitle ?? session.workspaceName
}

export type SessionViewState = {
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  selectedFile: DesktopFilePreview | null
}
