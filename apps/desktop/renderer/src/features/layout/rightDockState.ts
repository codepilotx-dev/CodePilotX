import { isRightDockToolEnabled } from './rightDockTools.js'
import type { RightDockToolId } from './rightDockTools.js'

export type { RightDockToolId } from './rightDockTools.js'

export type RightDockFlags = {
  debugMode: boolean
}

export type RightDockState = {
  open: boolean
  activeTool: RightDockToolId | null
  openTools: RightDockToolId[]
}

export type WorkbenchPanelTarget = 'right' | 'bottom'

export type WorkbenchFocusArea = 'main' | 'right-panel' | 'bottom-panel'

export type WorkbenchPanelSnapshot = RightDockState

export type WorkbenchPanelState = {
  right: WorkbenchPanelSnapshot
  bottom: WorkbenchPanelSnapshot
  rightFullWidth: boolean
  restoreRightFullWidthOnNextOpen: boolean
  focusArea: WorkbenchFocusArea
}

export type WorkbenchPanelAction =
  | { type: 'togglePanel'; target: WorkbenchPanelTarget }
  | { type: 'openTool'; target: WorkbenchPanelTarget; tool: RightDockToolId }
  | { type: 'selectTool'; target: WorkbenchPanelTarget; tool: RightDockToolId }
  | { type: 'closeTool'; target: WorkbenchPanelTarget; tool: RightDockToolId }
  | { type: 'closePanel'; target: WorkbenchPanelTarget; responsive?: boolean }
  | {
      type: 'moveTool'
      source: WorkbenchPanelTarget
      target: WorkbenchPanelTarget
      tool: RightDockToolId
      index?: number
    }
  | {
      type: 'reorderTool'
      target: WorkbenchPanelTarget
      tool: RightDockToolId
      index: number
    }
  | { type: 'toggleRightFullWidth' }
  | { type: 'focusPanel'; target: WorkbenchPanelTarget | 'main' }
  | { type: 'replaceRight'; state: RightDockState }

export function createDefaultWorkbenchPanelState(): WorkbenchPanelState {
  return {
    right: {
      open: false,
      activeTool: null,
      openTools: [],
    },
    bottom: {
      open: false,
      activeTool: null,
      openTools: [],
    },
    rightFullWidth: false,
    restoreRightFullWidthOnNextOpen: false,
    focusArea: 'main',
  }
}

export function applyWorkbenchPanelAction(
  state: WorkbenchPanelState,
  action: WorkbenchPanelAction,
  flags: RightDockFlags = { debugMode: false },
): WorkbenchPanelState {
  if (action.type === 'replaceRight') {
    const rightTools = new Set(action.state.openTools)
    const bottomTools = state.bottom.openTools.filter(
      tool => !rightTools.has(tool),
    )
    const bottomActive =
      state.bottom.activeTool && bottomTools.includes(state.bottom.activeTool)
        ? state.bottom.activeTool
        : (bottomTools[0] ?? null)
    return {
      ...state,
      right: action.state,
      bottom: {
        ...state.bottom,
        activeTool: bottomActive,
        openTools: bottomTools,
      },
    }
  }

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
    const panel = state[action.target]
    if (panel.open) {
      return closeWorkbenchPanel(state, action.target)
    }
    const fallbackTool =
      action.target === 'bottom' && panel.openTools.length === 0
        ? 'terminal'
        : undefined
    return openWorkbenchPanel(state, action.target, fallbackTool, flags)
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

  if (action.type === 'openTool') {
    if (!isRightDockToolEnabled(action.tool, flags)) return state
    const otherTarget = action.target === 'right' ? 'bottom' : 'right'
    const other = removeTool(state[otherTarget], action.tool)
    const target = addTool(state[action.target], action.tool)
    return {
      ...state,
      [otherTarget]: other,
      [action.target]: { ...target, open: true, activeTool: action.tool },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'selectTool') {
    const panel = state[action.target]
    if (!panel.openTools.includes(action.tool)) return state
    return {
      ...state,
      [action.target]: {
        ...panel,
        open: true,
        activeTool: action.tool,
      },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'closeTool') {
    const panel = state[action.target]
    if (!panel.openTools.includes(action.tool)) return state
    return {
      ...state,
      [action.target]: removeTool(panel, action.tool),
    }
  }

  if (action.type === 'moveTool') {
    if (!state[action.source].openTools.includes(action.tool)) return state
    if (!isRightDockToolEnabled(action.tool, flags)) return state
    const source = removeTool(state[action.source], action.tool)
    const target = insertTool(state[action.target], action.tool, action.index)
    return {
      ...state,
      [action.source]: source,
      [action.target]: { ...target, open: true, activeTool: action.tool },
      focusArea: `${action.target}-panel`,
    }
  }

  if (action.type === 'reorderTool') {
    const panel = state[action.target]
    if (!panel.openTools.includes(action.tool)) return state
    return {
      ...state,
      [action.target]: insertTool(
        removeTool(panel, action.tool),
        action.tool,
        action.index,
      ),
    }
  }

  return state
}

function openWorkbenchPanel(
  state: WorkbenchPanelState,
  target: WorkbenchPanelTarget,
  fallbackTool: RightDockToolId | undefined,
  flags: RightDockFlags,
): WorkbenchPanelState {
  let panel = openPanelWithFallback(state[target])
  if (fallbackTool && isRightDockToolEnabled(fallbackTool, flags)) {
    panel = addTool(panel, fallbackTool)
  }
  const restoringFullWidth =
    target === 'right' && state.restoreRightFullWidthOnNextOpen
  return {
    ...state,
    [target]: { ...panel, open: true },
    rightFullWidth: restoringFullWidth ? true : state.rightFullWidth,
    restoreRightFullWidthOnNextOpen:
      target === 'right' ? false : state.restoreRightFullWidthOnNextOpen,
    focusArea: `${target}-panel`,
  }
}

function closeWorkbenchPanel(
  state: WorkbenchPanelState,
  target: WorkbenchPanelTarget,
): WorkbenchPanelState {
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
    activeTool:
      panel.activeTool && panel.openTools.includes(panel.activeTool)
        ? panel.activeTool
        : (panel.openTools[0] ?? null),
  }
}

function addTool(
  panel: WorkbenchPanelSnapshot,
  tool: RightDockToolId,
): WorkbenchPanelSnapshot {
  if (panel.openTools.includes(tool)) {
    return { ...panel, activeTool: tool }
  }
  return {
    ...panel,
    activeTool: tool,
    openTools: [...panel.openTools, tool],
  }
}

function insertTool(
  panel: WorkbenchPanelSnapshot,
  tool: RightDockToolId,
  index?: number,
): WorkbenchPanelSnapshot {
  const tools = panel.openTools.filter(id => id !== tool)
  const safeIndex =
    index === undefined
      ? tools.length
      : Math.max(0, Math.min(tools.length, Math.round(index)))
  tools.splice(safeIndex, 0, tool)
  return { ...panel, activeTool: tool, openTools: tools }
}

function removeTool(
  panel: WorkbenchPanelSnapshot,
  tool: RightDockToolId,
): WorkbenchPanelSnapshot {
  const index = panel.openTools.indexOf(tool)
  if (index < 0) return panel
  const openTools = panel.openTools.filter(id => id !== tool)
  const activeTool =
    panel.activeTool === tool
      ? (openTools[Math.min(index, openTools.length - 1)] ?? null)
      : panel.activeTool
  return { ...panel, activeTool, openTools }
}

export type RightDockAction =
  | { type: 'openTool'; tool: RightDockToolId }
  | { type: 'selectTool'; tool: RightDockToolId }
  | { type: 'closeTool'; tool: RightDockToolId }
  | { type: 'close' }

export function applyRightDockAction(
  state: RightDockState,
  action: RightDockAction,
  flags: RightDockFlags = { debugMode: false },
): RightDockState {
  if (action.type === 'close') {
    if (!state.open) return state
    return { ...state, open: false }
  }
  if (action.type === 'openTool') {
    if (!isRightDockToolEnabled(action.tool, flags)) return state
    const exists = state.openTools.includes(action.tool)
    return {
      open: true,
      activeTool: action.tool,
      openTools: exists ? state.openTools : [...state.openTools, action.tool],
    }
  }
  if (action.type === 'selectTool') {
    if (!state.openTools.includes(action.tool)) return state
    return { ...state, open: true, activeTool: action.tool }
  }
  if (action.type === 'closeTool') {
    if (!state.openTools.includes(action.tool)) return state
    const next = state.openTools.filter(id => id !== action.tool)
    const wasActive = state.activeTool === action.tool
    const fallback = wasActive ? (next[next.length - 1] ?? null) : state.activeTool
    const nextActive = fallback && next.includes(fallback) ? fallback : (next[0] ?? null)
    return {
      openTools: next,
      activeTool: nextActive,
      open: next.length === 0 ? false : state.open,
    }
  }
  return state
}
