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
