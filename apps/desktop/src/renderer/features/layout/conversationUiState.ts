import type { RightDockPlan, RightDockToolId } from './rightDockTools.js'

const STORAGE_PREFIX = 'conversation.ui-state.'

export type ConversationUiState = {
  rightDock: {
    open: boolean
    activeTool: RightDockToolId | null
    openTools: RightDockToolId[]
    width: number
  }
  plan: RightDockPlan | null
  mainScrollTop: number
}

export function saveConversationUiState(
  sessionId: string,
  state: ConversationUiState,
): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + sessionId,
      JSON.stringify(state),
    )
  } catch {
    /* localStorage full or disabled; silently ignore */
  }
}

export function loadConversationUiState(
  sessionId: string,
): ConversationUiState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + sessionId)
    if (!raw) return null
    return JSON.parse(raw) as ConversationUiState
  } catch {
    return null
  }
}

export function removeConversationUiState(sessionId: string): void {
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + sessionId)
  } catch {
    /* silently ignore */
  }
}

export function validateConversationUiState(
  state: ConversationUiState,
  enabledTools: readonly RightDockToolId[],
): ConversationUiState {
  const enabledSet = new Set(enabledTools)
  const openTools = state.rightDock.openTools.filter(id => enabledSet.has(id))
  const activeTool =
    state.rightDock.activeTool !== null && openTools.includes(state.rightDock.activeTool)
      ? state.rightDock.activeTool
      : openTools.length > 0
        ? openTools[openTools.length - 1]!
        : null
  const open = openTools.length > 0 && state.rightDock.open

  return {
    rightDock: {
      open,
      activeTool,
      openTools,
      width: state.rightDock.width,
    },
    plan: state.plan,
    mainScrollTop: state.mainScrollTop,
  }
}
