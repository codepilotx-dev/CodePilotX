export type RightDockTool = 'review' | 'browser' | 'files' | 'sideChat' | 'toolProbe'
export type RightDockMenuTool = RightDockTool | 'terminal'

export type RightDockState = {
  open: boolean
  activeTool: RightDockTool
}

export type RightDockAction =
  | { type: 'openTool'; tool: RightDockMenuTool }
  | { type: 'close' }

export function applyRightDockAction(
  state: RightDockState,
  action: RightDockAction,
): RightDockState {
  if (action.type === 'close') {
    return { ...state, open: false }
  }
  if (action.tool === 'terminal') {
    return state
  }
  return {
    open: true,
    activeTool: action.tool,
  }
}
