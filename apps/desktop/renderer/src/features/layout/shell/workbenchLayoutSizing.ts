import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth as clampPrimarySidebarWidth,
} from '../useDesktopLayout.js'

export const PRIMARY_SIDEBAR_MIN_WIDTH = SIDEBAR_MIN_WIDTH
export const PRIMARY_SIDEBAR_MAX_WIDTH = SIDEBAR_MAX_WIDTH
export const DEFAULT_PRIMARY_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH
export { clampPrimarySidebarWidth }

export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 352
export const RIGHT_DOCK_DEFAULT_WIDTH = 600
/** 右栏自动收起按整个窗口宽度计算。 */
export const RIGHT_DOCK_RESPONSIVE_WINDOW_WIDTH = 960
/** 恢复右栏需要越过阈值的回差，避免窗口拖动时反复开关。 */
export const RIGHT_DOCK_RESPONSIVE_HYSTERESIS = 24

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
  | { type: 'resize'; windowWidth: number }
  | { type: 'manualOpen'; windowWidth: number }
  | { type: 'manualClose'; windowWidth: number }

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
  mainContentWidth: number,
  shellHeight: number,
): number {
  const safeWidth = normalizeDimension(mainContentWidth)
  const safeHeight = normalizeDimension(shellHeight)
  const computed = Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    Math.min(safeHeight * 1.6, safeWidth - 500),
    Math.min(640, safeWidth - RIGHT_DOCK_MAIN_MIN_WIDTH),
  )
  return Math.round(
    clamp(computed, RIGHT_DOCK_MIN_WIDTH, getRightDockMaxWidth(safeWidth)),
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
  windowWidth: number,
): RightDockResponsiveState {
  return {
    suppressed: normalizeDimension(windowWidth) < RIGHT_DOCK_RESPONSIVE_WINDOW_WIDTH,
    manualOverride: false,
  }
}

export function reduceRightDockResponsiveState(
  state: RightDockResponsiveState,
  action: RightDockResponsiveAction,
): RightDockResponsiveState {
  const windowWidth = normalizeDimension(action.windowWidth)
  return {
    suppressed: state.suppressed
      ? windowWidth < RIGHT_DOCK_RESPONSIVE_WINDOW_WIDTH + RIGHT_DOCK_RESPONSIVE_HYSTERESIS
      : windowWidth < RIGHT_DOCK_RESPONSIVE_WINDOW_WIDTH,
    manualOverride:
      action.type === 'manualClose'
        ? false
        : action.type === 'manualOpen'
          ? state.suppressed ||
            windowWidth < RIGHT_DOCK_RESPONSIVE_WINDOW_WIDTH
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

export function clampWorkbenchSize(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.round(clamp(value, minimum, maximum))
}
