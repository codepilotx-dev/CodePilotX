export type WorkbenchPanelTarget = 'right' | 'bottom'

export type WorkbenchFocusArea = 'main' | 'right-panel' | 'bottom-panel'

export type MarkdownFileViewMode = 'rich' | 'source'

export type WorkbenchTabKind =
  | 'review'
  | 'browser'
  | 'file-browser'
  | 'file-preview'
  | 'plan'
  | 'side-chat'
  | 'side-task'
  | 'tool-probe'
  | 'dialog-debug'
  | 'performance-diagnostics'

export type DebugTabDescriptor =
  | { id: 'tool-probe'; kind: 'tool-probe' }
  | { id: 'dialog-debug'; kind: 'dialog-debug' }
  | {
      id: 'performance-diagnostics'
      kind: 'performance-diagnostics'
    }

export type WorkbenchTabDescriptor =
  | { id: 'review'; kind: 'review' }
  | { id: 'browser'; kind: 'browser' }
  | { id: 'file-browser'; kind: 'file-browser' }
  | {
      id: `file:${string}`
      kind: 'file-preview'
      workspacePath: string
      relativePath: string
      preview: boolean
      markdownViewMode?: MarkdownFileViewMode
      line?: number
      column?: number
      endLine?: number
      endColumn?: number
    }
  | {
      id: `plan:${string}`
      kind: 'plan'
      eventId: string
      title: string
      legacyContent?: string
    }
  | { id: 'side-chat'; kind: 'side-chat' }
  | {
      id: `side-task:${string}`
      kind: 'side-task'
      taskId: string
      childThreadId: string
    }
  | DebugTabDescriptor

export type WorkbenchTabId = WorkbenchTabDescriptor['id']

export type WorkbenchFlags = {
  debugMode: boolean
}

export type WorkbenchPanelSnapshot = {
  open: boolean
  activeTabId: WorkbenchTabId | null
  tabIds: WorkbenchTabId[]
}

export type WorkbenchTabsState = {
  schemaVersion: 2
  tabsById: Partial<Record<WorkbenchTabId, WorkbenchTabDescriptor>>
  right: WorkbenchPanelSnapshot
  bottom: WorkbenchPanelSnapshot
  rightFullWidth: boolean
  restoreRightFullWidthOnNextOpen: boolean
  focusArea: WorkbenchFocusArea
}

/**
 * Temporary naming compatibility for callers migrating from the fixed-tool
 * workbench. The shape is the v2 dynamic-tab state.
 */
export type WorkbenchPanelState = WorkbenchTabsState

export type WorkbenchPanelAction =
  | {
      type: 'openTab'
      target: WorkbenchPanelTarget
      tab: WorkbenchTabDescriptor
      index?: number
    }
  | {
      type: 'selectTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeOtherTabs'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | {
      type: 'closeTabsToRight'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
    }
  | { type: 'pinTab'; tabId: WorkbenchTabId }
  | {
      type: 'setFileMarkdownViewMode'
      tabId: WorkbenchTabId
      mode: MarkdownFileViewMode
    }
  | {
      type: 'moveTab'
      source: WorkbenchPanelTarget
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
      index?: number
    }
  | {
      type: 'reorderTab'
      target: WorkbenchPanelTarget
      tabId: WorkbenchTabId
      index: number
    }
  | { type: 'togglePanel'; target: WorkbenchPanelTarget }
  | {
      type: 'closePanel'
      target: WorkbenchPanelTarget
      responsive?: boolean
    }
  | { type: 'toggleRightFullWidth' }
  | { type: 'focusPanel'; target: WorkbenchPanelTarget | 'main' }

export function createDefaultWorkbenchPanelState(): WorkbenchTabsState {
  return {
    schemaVersion: 2,
    tabsById: {},
    right: createEmptyPanel(),
    bottom: createEmptyPanel(),
    rightFullWidth: false,
    restoreRightFullWidthOnNextOpen: false,
    focusArea: 'main',
  }
}

export const createDefaultWorkbenchTabsState =
  createDefaultWorkbenchPanelState

export function applyWorkbenchPanelAction(
  state: WorkbenchTabsState,
  action: WorkbenchPanelAction,
  flags: WorkbenchFlags = { debugMode: false },
): WorkbenchTabsState {
  if (action.type === 'focusPanel') {
    const focusArea: WorkbenchFocusArea =
      action.target === 'main' ? 'main' : `${action.target}-panel`
    return focusArea === state.focusArea ? state : { ...state, focusArea }
  }

  if (action.type === 'toggleRightFullWidth') {
    if (!state.right.open) {
      return {
        ...state,
        right: { ...openPanelWithFallback(state.right), open: true },
        rightFullWidth: true,
        restoreRightFullWidthOnNextOpen: false,
        focusArea: 'right-panel',
      }
    }
    return {
      ...state,
      rightFullWidth: !state.rightFullWidth,
      restoreRightFullWidthOnNextOpen: false,
      focusArea: state.rightFullWidth ? 'main' : 'right-panel',
    }
  }

  if (action.type === 'togglePanel') {
    return state[action.target].open
      ? closeWorkbenchPanel(state, action.target)
      : openWorkbenchPanel(state, action.target)
  }

  if (action.type === 'closePanel') {
    if (!state[action.target].open) return state
    if (
      action.target === 'right' &&
      action.responsive &&
      state.rightFullWidth
    ) {
      return {
        ...closeWorkbenchPanel(state, action.target),
        restoreRightFullWidthOnNextOpen: true,
      }
    }
    return closeWorkbenchPanel(state, action.target)
  }

  if (action.type === 'openTab') {
    if (!isWorkbenchTabEnabled(action.tab, flags)) return state

    const existingTarget = findTabTarget(state, action.tab.id)
    if (existingTarget) {
      const existing = state.tabsById[action.tab.id]
      const reopenedTab =
        existing?.kind === 'file-preview' &&
        action.tab.kind === 'file-preview' &&
        existing.markdownViewMode
          ? {
              ...action.tab,
              markdownViewMode: existing.markdownViewMode,
            }
          : action.tab
      const tab =
        existing?.kind === 'file-preview' &&
        !existing.preview &&
        reopenedTab.kind === 'file-preview'
          ? { ...reopenedTab, preview: false }
          : reopenedTab
      return {
        ...state,
        tabsById: { ...state.tabsById, [tab.id]: tab },
        [existingTarget]: {
          ...state[existingTarget],
          open: true,
          activeTabId: tab.id,
        },
        focusArea: `${existingTarget}-panel`,
      }
    }

    let next = state
    if (action.tab.kind === 'file-preview' && action.tab.preview) {
      const replaceableId = findReplaceablePreviewTab(state)
      if (replaceableId) {
        next = removeTabEverywhere(state, replaceableId)
      }
    }

    return {
      ...next,
      tabsById: {
        ...next.tabsById,
        [action.tab.id]: action.tab,
      },
      [action.target]: {
        ...insertTab(next[action.target], action.tab.id, action.index),
        open: true,
        activeTabId: action.tab.id,
      },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'selectTab') {
    const panel = state[action.target]
    if (!panel.tabIds.includes(action.tabId)) return state
    return {
      ...state,
      [action.target]: {
        ...panel,
        open: true,
        activeTabId: action.tabId,
      },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'closeTab') {
    if (!state[action.target].tabIds.includes(action.tabId)) return state
    return removeTabEverywhere(state, action.tabId)
  }

  if (action.type === 'closeOtherTabs') {
    const panel = state[action.target]
    if (!panel.tabIds.includes(action.tabId)) return state
    return removeTabsFromPanel(
      state,
      action.target,
      panel.tabIds.filter(id => id !== action.tabId),
      action.tabId,
    )
  }

  if (action.type === 'closeTabsToRight') {
    const panel = state[action.target]
    const index = panel.tabIds.indexOf(action.tabId)
    if (index < 0 || index === panel.tabIds.length - 1) return state
    return removeTabsFromPanel(
      state,
      action.target,
      panel.tabIds.slice(index + 1),
      action.tabId,
    )
  }

  if (action.type === 'pinTab') {
    const tab = state.tabsById[action.tabId]
    if (tab?.kind !== 'file-preview' || !tab.preview) return state
    return {
      ...state,
      tabsById: {
        ...state.tabsById,
        [tab.id]: { ...tab, preview: false },
      },
    }
  }

  if (action.type === 'setFileMarkdownViewMode') {
    const tab = state.tabsById[action.tabId]
    if (
      tab?.kind !== 'file-preview' ||
      tab.markdownViewMode === action.mode
    ) {
      return state
    }
    return {
      ...state,
      tabsById: {
        ...state.tabsById,
        [tab.id]: { ...tab, markdownViewMode: action.mode },
      },
    }
  }

  if (action.type === 'moveTab') {
    if (!state[action.source].tabIds.includes(action.tabId)) return state
    if (action.source === action.target) {
      return applyWorkbenchPanelAction(state, {
        type: 'reorderTab',
        target: action.target,
        tabId: action.tabId,
        index: action.index ?? state[action.target].tabIds.length - 1,
      })
    }
    const source = removeTab(state[action.source], action.tabId)
    const target = insertTab(state[action.target], action.tabId, action.index)
    return {
      ...state,
      [action.source]: source,
      [action.target]: {
        ...target,
        open: true,
        activeTabId: action.tabId,
      },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'reorderTab') {
    const panel = state[action.target]
    if (!panel.tabIds.includes(action.tabId)) return state
    return {
      ...state,
      [action.target]: insertTab(
        removeTab(panel, action.tabId),
        action.tabId,
        action.index,
      ),
    }
  }

  return state
}

export const applyWorkbenchTabsAction = applyWorkbenchPanelAction

export function isDebugWorkbenchTab(
  tab: WorkbenchTabDescriptor,
): tab is DebugTabDescriptor {
  return (
    tab.kind === 'tool-probe' ||
    tab.kind === 'dialog-debug' ||
    tab.kind === 'performance-diagnostics'
  )
}

export function isWorkbenchTabEnabled(
  tab: WorkbenchTabDescriptor,
  flags: WorkbenchFlags,
): boolean {
  return !isDebugWorkbenchTab(tab) || flags.debugMode
}

function createEmptyPanel(): WorkbenchPanelSnapshot {
  return {
    open: false,
    activeTabId: null,
    tabIds: [],
  }
}

function openWorkbenchPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
): WorkbenchTabsState {
  const restoringFullWidth =
    target === 'right' && state.restoreRightFullWidthOnNextOpen
  return {
    ...state,
    [target]: { ...openPanelWithFallback(state[target]), open: true },
    rightFullWidth: restoringFullWidth ? true : state.rightFullWidth,
    restoreRightFullWidthOnNextOpen:
      target === 'right' ? false : state.restoreRightFullWidthOnNextOpen,
    focusArea: `${target}-panel`,
  }
}

function closeWorkbenchPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
): WorkbenchTabsState {
  const wasFullWidth = target === 'right' && state.rightFullWidth
  return {
    ...state,
    [target]: { ...state[target], open: false },
    rightFullWidth: wasFullWidth ? false : state.rightFullWidth,
    restoreRightFullWidthOnNextOpen:
      target === 'right' ? wasFullWidth : state.restoreRightFullWidthOnNextOpen,
    focusArea:
      state.focusArea === `${target}-panel` ? 'main' : state.focusArea,
  }
}

function openPanelWithFallback(
  panel: WorkbenchPanelSnapshot,
): WorkbenchPanelSnapshot {
  return {
    ...panel,
    activeTabId:
      panel.activeTabId && panel.tabIds.includes(panel.activeTabId)
        ? panel.activeTabId
        : (panel.tabIds[0] ?? null),
  }
}

function findTabTarget(
  state: WorkbenchTabsState,
  tabId: WorkbenchTabId,
): WorkbenchPanelTarget | null {
  if (state.right.tabIds.includes(tabId)) return 'right'
  if (state.bottom.tabIds.includes(tabId)) return 'bottom'
  return null
}

function findReplaceablePreviewTab(
  state: WorkbenchTabsState,
): WorkbenchTabId | null {
  for (const tabId of [...state.right.tabIds, ...state.bottom.tabIds]) {
    const tab = state.tabsById[tabId]
    if (tab?.kind === 'file-preview' && tab.preview) return tabId
  }
  return null
}

function insertTab(
  panel: WorkbenchPanelSnapshot,
  tabId: WorkbenchTabId,
  index?: number,
): WorkbenchPanelSnapshot {
  const tabIds = panel.tabIds.filter(id => id !== tabId)
  const safeIndex =
    index === undefined
      ? tabIds.length
      : Math.max(0, Math.min(tabIds.length, Math.round(index)))
  tabIds.splice(safeIndex, 0, tabId)
  return { ...panel, activeTabId: tabId, tabIds }
}

function removeTab(
  panel: WorkbenchPanelSnapshot,
  tabId: WorkbenchTabId,
): WorkbenchPanelSnapshot {
  const index = panel.tabIds.indexOf(tabId)
  if (index < 0) return panel
  const tabIds = panel.tabIds.filter(id => id !== tabId)
  const activeTabId =
    panel.activeTabId === tabId
      ? (tabIds[Math.min(index, tabIds.length - 1)] ?? null)
      : panel.activeTabId && tabIds.includes(panel.activeTabId)
        ? panel.activeTabId
        : (tabIds[tabIds.length - 1] ?? null)
  return { ...panel, activeTabId, tabIds }
}

function removeTabEverywhere(
  state: WorkbenchTabsState,
  tabId: WorkbenchTabId,
): WorkbenchTabsState {
  const tabsById = { ...state.tabsById }
  delete tabsById[tabId]
  return {
    ...state,
    tabsById,
    right: removeTab(state.right, tabId),
    bottom: removeTab(state.bottom, tabId),
  }
}

function removeTabsFromPanel(
  state: WorkbenchTabsState,
  target: WorkbenchPanelTarget,
  tabIdsToRemove: readonly WorkbenchTabId[],
  activeTabId: WorkbenchTabId,
): WorkbenchTabsState {
  const removeSet = new Set(tabIdsToRemove)
  const tabsById = { ...state.tabsById }
  for (const tabId of removeSet) delete tabsById[tabId]
  const panel = state[target]
  return {
    ...state,
    tabsById,
    [target]: {
      ...panel,
      activeTabId,
      tabIds: panel.tabIds.filter(id => !removeSet.has(id)),
    },
  }
}
