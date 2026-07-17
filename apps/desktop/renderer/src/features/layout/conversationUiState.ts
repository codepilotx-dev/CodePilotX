import type { RightDockPlan, RightDockToolId } from './rightDockTools.js'
import {
  createDefaultWorkbenchPanelState,
  type WorkbenchPanelState,
} from './rightDockState.js'
import type { DesktopComposerAttachment } from '../../../shared/types.js'

const STORAGE_PREFIX = 'conversation.ui-state.'

export type ConversationUiState = {
  panels: WorkbenchPanelState
  plan: RightDockPlan | null
  mainScrollTop: number
  sideChatInput: string
  sideChatAttachments: DesktopComposerAttachment[]
}

export function createDefaultConversationUiState(): ConversationUiState {
  return {
    panels: createDefaultWorkbenchPanelState(),
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
  state: ConversationUiState | LegacyConversationUiState,
  enabledTools: readonly RightDockToolId[],
): ConversationUiState {
  const enabledSet = new Set(enabledTools)
  const defaults = createDefaultWorkbenchPanelState()
  const legacy = state as LegacyConversationUiState
  const storedPanels =
    'panels' in state && state.panels
      ? state.panels
      : {
          ...defaults,
          right: legacy.rightDock ?? defaults.right,
        }
  const right = validatePanelSnapshot(storedPanels.right, enabledSet)
  const bottom = validatePanelSnapshot(storedPanels.bottom, enabledSet)

  return {
    panels: {
      right,
      bottom,
      rightFullWidth: Boolean(storedPanels.rightFullWidth && right.open),
      restoreRightFullWidthOnNextOpen: Boolean(
        storedPanels.restoreRightFullWidthOnNextOpen,
      ),
      focusArea:
        storedPanels.focusArea === 'right-panel' ||
        storedPanels.focusArea === 'bottom-panel'
          ? storedPanels.focusArea
          : 'main',
    },
    plan: state.plan,
    mainScrollTop: state.mainScrollTop,
    sideChatInput: state.sideChatInput ?? '',
    sideChatAttachments: state.sideChatAttachments ?? [],
  }
}

type LegacyConversationUiState = Omit<ConversationUiState, 'panels'> & {
  rightDock?: {
    open: boolean
    activeTool: RightDockToolId | null
    openTools: RightDockToolId[]
  }
  panels?: WorkbenchPanelState
}

function validatePanelSnapshot(
  panel: WorkbenchPanelState['right'] | undefined,
  enabledTools: ReadonlySet<RightDockToolId>,
): WorkbenchPanelState['right'] {
  const openTools = (panel?.openTools ?? []).filter(id => enabledTools.has(id))
  const activeTool =
    panel?.activeTool && openTools.includes(panel.activeTool)
      ? panel.activeTool
      : (openTools[openTools.length - 1] ?? null)
  return {
    open: Boolean(panel?.open),
    activeTool,
    openTools,
  }
}
