export const SIDEBAR_SESSION_DRAG_TYPE = 'application/x-codepilotx-sidebar-session'

export function beginSidebarSessionDrag(
  dataTransfer: DataTransfer,
  sessionId: string,
): void {
  dataTransfer.effectAllowed = 'copyMove'
  dataTransfer.setData(SIDEBAR_SESSION_DRAG_TYPE, sessionId)
}

export function hasSidebarSessionDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(SIDEBAR_SESSION_DRAG_TYPE)
}

export function readSidebarSessionDrag(dataTransfer: DataTransfer): string | null {
  const sessionId = dataTransfer.getData(SIDEBAR_SESSION_DRAG_TYPE).trim()
  return sessionId || null
}
