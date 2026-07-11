import type { DesktopQueuedFollowUp } from '../../../shared/types.js'

type QueuedFollowUpsBySessionRef = {
  current: Record<string, DesktopQueuedFollowUp[]>
}

export function createSessionQueueLifecycleController(
  queuedFollowUpsBySessionRef: QueuedFollowUpsBySessionRef,
  setQueuedFollowUps: (items: DesktopQueuedFollowUp[]) => void,
) {
  function removeSession(
    removedSessionId: string,
    activeSessionId: string | null,
  ): void {
    delete queuedFollowUpsBySessionRef.current[removedSessionId]
    setQueuedFollowUps(
      activeSessionId
        ? queuedFollowUpsBySessionRef.current[activeSessionId] ?? []
        : [],
    )
  }

  return { removeSession }
}
