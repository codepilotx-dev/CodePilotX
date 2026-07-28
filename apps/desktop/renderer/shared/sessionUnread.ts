import type { DesktopAgentEvent } from './types.js'

export function shouldMarkSessionUnread(
  event: DesktopAgentEvent,
  activeSessionId: string | null,
): boolean {
  if (event.sessionId === activeSessionId) return false
  if (event.type === 'error') return true
  return event.type === 'message' && event.role === 'assistant'
}
