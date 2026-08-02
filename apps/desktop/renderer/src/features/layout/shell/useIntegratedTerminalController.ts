import { useCallback, useEffect } from 'react'
import { OPEN_TERMINAL_EVENT } from '../../terminal/openTerminalEvent.js'
import type {
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from '../dock/rightDockState.js'

export type IntegratedTerminalToggleAction =
  | 'unavailable'
  | 'hide-bottom'
  | 'move-to-bottom'
  | 'open-bottom'

export function resolveIntegratedTerminalToggleAction(
  threadId: string | null,
  state: WorkbenchTabsState,
): IntegratedTerminalToggleAction {
  if (!threadId) return 'unavailable'
  if (state.right.tabIds.includes('terminal')) return 'move-to-bottom'
  if (
    state.bottom.open &&
    state.bottom.activeTabId === 'terminal'
  ) return 'hide-bottom'
  return 'open-bottom'
}

export function useIntegratedTerminalController({
  threadId,
  state,
  openPanelTab,
  movePanelTab,
  togglePanel,
}: {
  threadId: string | null
  state: WorkbenchTabsState
  openPanelTab: (
    target: WorkbenchPanelTarget,
    tab: WorkbenchTabDescriptor,
    index?: number,
  ) => void
  movePanelTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  togglePanel: (target: WorkbenchPanelTarget) => void
}) {
  const openIntegratedTerminal = useCallback((): void => {
    if (!threadId) return
    if (state.right.tabIds.includes('terminal')) {
      movePanelTab('right', 'bottom', 'terminal')
    } else {
      openPanelTab('bottom', { id: 'terminal', kind: 'terminal' })
    }
    focusTerminalAfterLayout(threadId)
  }, [movePanelTab, openPanelTab, state.right.tabIds, threadId])

  const toggleIntegratedTerminal = useCallback((): void => {
    const action = resolveIntegratedTerminalToggleAction(threadId, state)
    if (action === 'unavailable') return
    if (action === 'hide-bottom') {
      togglePanel('bottom')
      return
    }
    openIntegratedTerminal()
  }, [openIntegratedTerminal, state, threadId, togglePanel])

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const requestedThreadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId
      if (requestedThreadId === threadId) openIntegratedTerminal()
    }
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, onOpen)
  }, [openIntegratedTerminal, threadId])

  return {
    terminalAvailable: threadId !== null,
    terminalVisible:
      state.bottom.open && state.bottom.activeTabId === 'terminal',
    openIntegratedTerminal,
    toggleIntegratedTerminal,
  }
}

export function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element &&
    target.closest('[data-terminal-keyboard-capture]') !== null
}

function focusTerminalAfterLayout(threadId: string | null): void {
  if (!threadId) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const terminal = document.querySelector<HTMLElement>(
        `[data-terminal-keyboard-capture][data-thread-id="${CSS.escape(threadId)}"] .xterm-helper-textarea`,
      )
      terminal?.focus()
    })
  })
}
