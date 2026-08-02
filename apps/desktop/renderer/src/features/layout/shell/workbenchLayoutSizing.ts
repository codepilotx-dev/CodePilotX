export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 352
export const RIGHT_DOCK_DEFAULT_WIDTH = 600
export const RIGHT_DOCK_CONSTRAINED_WIDTH = 672
export const RIGHT_DOCK_REOPEN_WIDTH = 696

export const BOTTOM_PANEL_MIN_HEIGHT = 160
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 220
export const BOTTOM_PANEL_UPPER_MIN_HEIGHT = 240

export const RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY =
  'codepilotx.desktop.rightDockWidthRatio.v2'
export const BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY =
  'codepilotx.desktop.bottomPanelHeightRatio.v3'
export interface WorkbenchSize {
  width: number
  height: number
}

export interface RightDockResponsiveState {
  suppressed: boolean
  manualOverride: boolean
}

export type RightDockResponsiveAction =
  | { type: 'resize'; workspaceWidth: number }
  | { type: 'manualOpen'; workspaceWidth: number }
  | { type: 'manualClose'; workspaceWidth: number }

export function rightDockWidthFromRatio(
  ratio: number,
  workspaceWidth: number,
): number {
  const safeWorkspaceWidth = normalizeDimension(workspaceWidth)
  const preferredWidth = safeWorkspaceWidth * clampUnitInterval(ratio)
  return Math.round(
    clamp(
      preferredWidth,
      RIGHT_DOCK_MIN_WIDTH,
      getRightDockMaxWidth(safeWorkspaceWidth),
    ),
  )
}

export function rightDockWidthToRatio(
  width: number,
  workspaceWidth: number,
): number {
  const safeWorkspaceWidth = normalizeDimension(workspaceWidth)
  if (safeWorkspaceWidth === 0) return 0
  const safeWidth = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return clampUnitInterval(safeWidth / safeWorkspaceWidth)
}

export function getRightDockMaxWidth(workspaceWidth: number): number {
  return Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    normalizeDimension(workspaceWidth) - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
}

export function getResponsiveRightDockDefaultWidth(
  workspaceWidth: number,
  workspaceHeight: number,
): number {
  const safeWorkspaceWidth = normalizeDimension(workspaceWidth)
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  return Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    Math.min(safeWorkspaceHeight * 1.6, safeWorkspaceWidth - 500),
    Math.min(640, safeWorkspaceWidth - RIGHT_DOCK_MAIN_MIN_WIDTH),
  )
}

export function bottomPanelHeightFromRatio(
  ratio: number,
  workspaceHeight: number,
): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  const preferredHeight = safeWorkspaceHeight * clampUnitInterval(ratio)
  return Math.round(
    clamp(
      preferredHeight,
      BOTTOM_PANEL_MIN_HEIGHT,
      getBottomPanelMaxHeight(safeWorkspaceHeight),
    ),
  )
}

export function bottomPanelHeightToRatio(
  height: number,
  workspaceHeight: number,
): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  if (safeWorkspaceHeight === 0) return 0
  const safeHeight = Number.isFinite(height)
    ? height
    : BOTTOM_PANEL_DEFAULT_HEIGHT
  return clampUnitInterval(safeHeight / safeWorkspaceHeight)
}

export function getBottomPanelMaxHeight(workspaceHeight: number): number {
  const safeWorkspaceHeight = normalizeDimension(workspaceHeight)
  return Math.floor(
    Math.max(
      BOTTOM_PANEL_MIN_HEIGHT,
      Math.min(
        safeWorkspaceHeight * 0.5,
        safeWorkspaceHeight - BOTTOM_PANEL_UPPER_MIN_HEIGHT,
      ),
    ),
  )
}

export function createRightDockResponsiveState(
  workspaceWidth: number,
): RightDockResponsiveState {
  return {
    suppressed: normalizeDimension(workspaceWidth) < RIGHT_DOCK_CONSTRAINED_WIDTH,
    manualOverride: false,
  }
}

export function reduceRightDockResponsiveState(
  state: RightDockResponsiveState,
  action: RightDockResponsiveAction,
): RightDockResponsiveState {
  const workspaceWidth = normalizeDimension(action.workspaceWidth)
  return {
    suppressed: state.suppressed
      ? workspaceWidth < RIGHT_DOCK_REOPEN_WIDTH
      : workspaceWidth < RIGHT_DOCK_CONSTRAINED_WIDTH,
    manualOverride:
      action.type === 'manualClose'
        ? false
        : action.type === 'manualOpen'
          ? state.suppressed ||
            workspaceWidth < RIGHT_DOCK_CONSTRAINED_WIDTH
          : state.manualOverride,
  }
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function clampUnitInterval(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
