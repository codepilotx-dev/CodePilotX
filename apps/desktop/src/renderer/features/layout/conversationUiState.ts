import type { RightDockPlan, RightDockToolId } from './rightDockTools.js'
import type { DesktopComposerAttachment } from '../../../shared/types.js'

const STORAGE_PREFIX = 'conversation.ui-state.'

export type ConversationUiState = {
  rightDock: {
    open: boolean
    activeTool: RightDockToolId | null
    openTools: RightDockToolId[]
  }
  plan: RightDockPlan | null
  mainScrollTop: number
  sideChatInput: string
  sideChatAttachments: DesktopComposerAttachment[]
}

export function createDefaultConversationUiState(): ConversationUiState {
  return {
    rightDock: {
      open: false,
      activeTool: null,
      openTools: [],
    },
    plan: null,
    mainScrollTop: 0,
    sideChatInput: '',
    sideChatAttachments: [],
  }
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
    },
    plan: state.plan,
    mainScrollTop: state.mainScrollTop,
    sideChatInput: state.sideChatInput ?? '',
    sideChatAttachments: state.sideChatAttachments ?? [],
  }
}
