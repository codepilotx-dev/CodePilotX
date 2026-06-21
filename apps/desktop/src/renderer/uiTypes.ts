import type {
  DesktopContextUsage,
  DesktopFilePreview,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionListItem,
  DesktopSessionMessage,
  DesktopToolLogEntry,
  DesktopWorkflowEvent,
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
  return (
    session.sessionName ??
    session.customTitle ??
    session.aiTitle ??
    session.firstPrompt ??
    session.workspaceName
  )
}

export type SessionViewState = {
  eventModelVersion?: 1
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  messages: Message[]
  toolLog: ToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
  selectedFile: DesktopFilePreview | null
}
