import type { DesktopSessionSnapshot } from '../shared/types.js'

/**
 * Rollback plan derived from a session snapshot.
 * Describes which turns to remove and how the snapshot should change.
 */
export type DesktopRollbackPlan = {
  /** IDs of turns to be removed. */
  turnIds: string[]
  /** Number of messages to keep after rollback. */
  keepMessageCount: number
  /** Whether the history allows clean turn-boundary detection. */
  hasCleanBoundaries: boolean
}

export type DesktopRollbackRequest = {
  sessionId: string
  numTurns: number
  restoreFiles: boolean
}

export type DesktopRollbackResult = {
  snapshot: DesktopSessionSnapshot
  restoredFiles: string[]
}

/**
 * Plan a rollback by analyzing the session snapshot.
 * Determines which turns to remove based on message history.
 */
export function planDesktopRollback(
  snapshot: DesktopSessionSnapshot,
  numTurns: number,
): DesktopRollbackPlan {
  const view = snapshot.view
  const messages = view.messages ?? []
  const userMessageIndices: number[] = []

  // Find user message positions (turn boundaries)
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      userMessageIndices.push(i)
    }
  }

  // Determine if boundaries are clean
  const hasCleanBoundaries = userMessageIndices.length >= numTurns

  // Calculate how many messages to keep
  let keepMessageCount = messages.length
  if (hasCleanBoundaries && numTurns > 0) {
    const targetUserIndex = Math.max(0, userMessageIndices.length - numTurns)
    const cutIndex = userMessageIndices[targetUserIndex]
    keepMessageCount = cutIndex
  }

  // Get turn IDs to remove (from workflow events that have turn info)
  const turnIds: string[] = []
  const workflowEvents = snapshot.workflowEvents ?? []
  let turnsFound = 0
  for (let i = workflowEvents.length - 1; i >= 0 && turnsFound < numTurns; i--) {
    const event = workflowEvents[i]
    const eventType = (event as { type: string }).type
    if (eventType === 'turn.started' || eventType === 'turn.completed') {
      const eventWithId = event as { turn_id?: string; id?: string; turnId?: string }
      const turnId = eventWithId.turn_id ?? eventWithId.id ?? eventWithId.turnId
      if (turnId) {
        turnIds.unshift(turnId)
        turnsFound++
      }
    }
  }

  return {
    turnIds,
    keepMessageCount,
    hasCleanBoundaries,
  }
}

/**
 * Apply a rollback plan to a session snapshot.
 * Returns a new snapshot with the rolled-back state.
 */
export function applyDesktopRollback(
  snapshot: DesktopSessionSnapshot,
  plan: DesktopRollbackPlan,
): DesktopSessionSnapshot {
  const view = snapshot.view
  const messages = view.messages ?? []
  const trimmedMessages = messages.slice(0, plan.keepMessageCount)

  // Clear tool log entries after the cut point
  const toolLog = (view.toolLog ?? []).filter(entry => {
    // Find the index of this entry in the message timeline
    const entryIndex = messages.indexOf(entry as never)
    return entryIndex < 0 || entryIndex < plan.keepMessageCount
  })

  return {
    ...snapshot,
    view: {
      ...view,
      messages: trimmedMessages,
      toolLog,
    },
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Validate a rollback request before execution.
 * Ensures the session history is sufficient for the requested rollback.
 */
export function validateRollbackRequest(
  snapshot: DesktopSessionSnapshot,
  numTurns: number,
): { ok: true } | { ok: false; error: string } {
  const view = snapshot.view
  const messages = view.messages ?? []
  const userMessageCount = messages.filter(m => m.role === 'user').length

  if (numTurns < 1) {
    return { ok: false, error: 'Rollback must remove at least one turn.' }
  }

  if (userMessageCount < numTurns) {
    return {
      ok: false,
      error: `Cannot rollback ${numTurns} turns: only ${userMessageCount} user messages in history.`,
    }
  }

  const workflowEvents = snapshot.workflowEvents ?? []
  const turnEvents = workflowEvents.filter(
    e => (e as { type: string }).type === 'turn.started' || (e as { type: string }).type === 'turn.completed',
  )
  if (turnEvents.length < numTurns) {
    return {
      ok: false,
      error: `Cannot rollback ${numTurns} turns: insufficient turn event history.`,
    }
  }

  return { ok: true }
}
