import type { DesktopSessionStatus } from '../../../../shared/types.js'

export function canRegenerateConversationTitle(input: {
  hasActiveSession: boolean
  hasFirstMessage: boolean
  pending: boolean
  status: DesktopSessionStatus
}): boolean {
  return (
    input.hasActiveSession &&
    input.hasFirstMessage &&
    input.status === 'done' &&
    !input.pending
  )
}

export function shouldCloseConversationRenameDialog(input: {
  activeSessionId: string | null
  requestedSessionId: string
  succeeded: boolean
}): boolean {
  return (
    input.succeeded &&
    input.activeSessionId === input.requestedSessionId
  )
}
