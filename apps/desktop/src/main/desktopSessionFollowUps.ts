import type {
  DesktopQueuedFollowUp,
  DesktopSessionSnapshot,
  DesktopUserMessageInput,
} from '../shared/types.js'
import { desktopUserMessageInputToPreviewText } from '../shared/desktopUserMessage.js'
import { randomUUID } from 'node:crypto'

export function appendQueuedFollowUp(
  snapshot: DesktopSessionSnapshot,
  item: { input: DesktopUserMessageInput; previewText?: string },
): DesktopSessionSnapshot {
  const newItem: DesktopQueuedFollowUp = {
    id: randomUUID(),
    input: item.input,
    previewText: item.previewText ?? desktopUserMessageInputToPreviewText(item.input),
    createdAt: new Date().toISOString(),
  }
  return {
    ...snapshot,
    queuedFollowUps: [...(snapshot.queuedFollowUps ?? []), newItem],
    updatedAt: new Date().toISOString(),
  }
}

export function replaceQueuedFollowUp(
  snapshot: DesktopSessionSnapshot,
  followUpId: string,
  input: DesktopUserMessageInput,
): DesktopSessionSnapshot {
  return {
    ...snapshot,
    queuedFollowUps: (snapshot.queuedFollowUps ?? []).map(item =>
      item.id === followUpId
        ? {
            ...item,
            input,
            previewText: desktopUserMessageInputToPreviewText(input),
          }
        : item,
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function removeQueuedFollowUp(
  snapshot: DesktopSessionSnapshot,
  followUpId: string,
): DesktopSessionSnapshot {
  return {
    ...snapshot,
    queuedFollowUps: (snapshot.queuedFollowUps ?? []).filter(
      f => f.id !== followUpId,
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function peekQueuedFollowUp(
  snapshot: DesktopSessionSnapshot,
): DesktopQueuedFollowUp | null {
  const items = snapshot.queuedFollowUps ?? []
  return items.length > 0 ? items[0] : null
}

export function requireQueuedFollowUp(
  snapshot: DesktopSessionSnapshot,
  followUpId: string,
): DesktopQueuedFollowUp {
  const found = (snapshot.queuedFollowUps ?? []).find(f => f.id === followUpId)
  if (!found) throw new Error(`Follow-up not found: ${followUpId}`)
  return found
}

export function isSessionDrainable(
  snapshot: DesktopSessionSnapshot,
): boolean {
  const status = snapshot.item.status
  if (status === 'running' || status === 'waiting') return false
  if ((snapshot.view.pendingPermissions?.length ?? 0) > 0) return false
  return true
}
