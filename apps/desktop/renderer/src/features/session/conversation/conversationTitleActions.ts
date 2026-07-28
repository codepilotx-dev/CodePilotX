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

export function isRenameConversationShortcut(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'
  >,
): boolean {
  return (
    event.ctrlKey &&
    event.altKey &&
    !event.metaKey &&
    !event.repeat &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'r'
  )
}
