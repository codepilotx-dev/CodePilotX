import type {
  DesktopApi,
  DesktopComposerAttachment,
  DesktopQueuedFollowUp,
  DesktopSessionSnapshot,
} from '../../../shared/types.js'
import type { SessionListItem } from '../../uiTypes.js'

type QueueGoalDesktopApi = Pick<
  DesktopApi,
  | 'clearSessionGoal'
  | 'getSession'
  | 'removeQueuedFollowUp'
  | 'sendQueuedFollowUpNow'
  | 'setSessionGoal'
>

type SessionQueueGoalActionDeps = {
  activeSessionItem: SessionListItem | null
  queuedFollowUps: DesktopQueuedFollowUp[]
  desktopApi: QueueGoalDesktopApi
  applyReturnedSessionSnapshot: (
    sessionId: string,
    snapshot: DesktopSessionSnapshot,
  ) => void
  setErrorMessage: (message: string) => void
  setMainInput: (value: string) => void
  setMainAttachments: (attachments: DesktopComposerAttachment[]) => void
  focusMainComposer: () => void
  setSideInput: (value: string) => void
  setSideAttachments: (attachments: DesktopComposerAttachment[]) => void
  focusSideComposer: () => void
}

export function createSessionQueueGoalActions(
  deps: SessionQueueGoalActionDeps,
) {
  const activeSessionId = deps.activeSessionItem?.id

  async function applyAuthoritativeSnapshot(sessionId: string): Promise<void> {
    try {
      deps.applyReturnedSessionSnapshot(
        sessionId,
        await deps.desktopApi.getSession(sessionId),
      )
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function remove(followUpId: string): Promise<void> {
    if (!activeSessionId) return
    try {
      deps.applyReturnedSessionSnapshot(
        activeSessionId,
        await deps.desktopApi.removeQueuedFollowUp(activeSessionId, followUpId),
      )
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function sendNow(followUpId: string): Promise<void> {
    if (!activeSessionId) return
    try {
      await deps.desktopApi.sendQueuedFollowUpNow(activeSessionId, followUpId)
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function editMain(followUpId: string): Promise<void> {
    const followUp = findQueuedFollowUp(deps.queuedFollowUps, followUpId)
    if (!activeSessionId || !followUp) return
    try {
      deps.applyReturnedSessionSnapshot(
        activeSessionId,
        await deps.desktopApi.removeQueuedFollowUp(activeSessionId, followUpId),
      )
      deps.setMainInput(followUp.input.text)
      deps.setMainAttachments(followUp.input.attachments ?? [])
      deps.focusMainComposer()
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function editSide(followUpId: string): Promise<void> {
    const followUp = findQueuedFollowUp(deps.queuedFollowUps, followUpId)
    if (!activeSessionId || !followUp) return
    try {
      deps.applyReturnedSessionSnapshot(
        activeSessionId,
        await deps.desktopApi.removeQueuedFollowUp(activeSessionId, followUpId),
      )
      deps.setSideInput(followUp.input.text)
      deps.setSideAttachments(followUp.input.attachments ?? [])
      deps.focusSideComposer()
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function updateGoal(input: {
    objective?: string
    status?: 'active' | 'paused' | 'complete'
  }): Promise<void> {
    if (!activeSessionId) return
    try {
      await deps.desktopApi.setSessionGoal(activeSessionId, input)
      await applyAuthoritativeSnapshot(activeSessionId)
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  async function clearGoal(): Promise<void> {
    if (!activeSessionId) return
    try {
      await deps.desktopApi.clearSessionGoal(activeSessionId)
      await applyAuthoritativeSnapshot(activeSessionId)
    } catch (error) {
      deps.setErrorMessage(errorMessageOf(error))
    }
  }

  return {
    applyAuthoritativeSnapshot,
    remove,
    sendNow,
    editMain,
    editSide,
    updateGoal,
    clearGoal,
  }
}

function findQueuedFollowUp(
  queuedFollowUps: DesktopQueuedFollowUp[],
  followUpId: string,
): DesktopQueuedFollowUp | null {
  return queuedFollowUps.find(item => item.id === followUpId) ?? null
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
