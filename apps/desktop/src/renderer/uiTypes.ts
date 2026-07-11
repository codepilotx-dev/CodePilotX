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

export function sessionDisplayTitle(
  session: SessionListItem,
  fallbackTitle?: string | null,
): string {
  return (
    session.customTitle ??
    fallbackTitle ??
    session.aiTitle ??
    session.firstPrompt ??
    session.sessionName ??
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
  closedStreamIds?: Set<string>
  streamingTerminal?: boolean
  activeStreamTurnId?: string
}

export function sessionViewFallbackTitle(
  view: Pick<SessionViewState, 'events' | 'messages'>,
): string | null {
  const eventTitle = firstUserContent(
    view.events as Array<{ role?: string; content?: string }>,
  )
  const messageTitle = firstUserContent(
    view.messages.map(message => ({
      role: message.role,
      content: message.text,
    })),
  )
  const title = eventTitle ?? messageTitle
  if (!title) return null
  return title.length > 28 ? `${title.slice(0, 28)}...` : title
}

function firstUserContent(
  items: Array<{ role?: string; content?: string }>,
): string | null {
  const content = items.find(item => item.role === 'user')?.content
  const title = content?.trim().split(/\r?\n/)[0]?.trim()
  return title || null
}
