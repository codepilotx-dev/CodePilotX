import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
  bottomPanelHeightToRatio,
  getResponsiveRightDockDefaultWidth,
  rightDockWidthToRatio,
} from './workbenchLayoutSizing.js'

const LEGACY_RIGHT_DOCK_WIDTH_STORAGE_KEY =
  'codepilotx.desktop.rightDockWidth'
const LEGACY_BOTTOM_PANEL_HEIGHT_STORAGE_KEY =
  'codepilotx.desktop.bottomPanelHeight'

export default function resolveStoredWorkbenchRatios(
  workspaceWidth: number,
  workspaceHeight: number,
): [number, number] {
  return [
    resolveInitialRightDockWidthRatio(
      window.localStorage.getItem(RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY),
      window.localStorage.getItem(LEGACY_RIGHT_DOCK_WIDTH_STORAGE_KEY),
      workspaceWidth,
      workspaceHeight,
    ),
    resolveInitialBottomPanelHeightRatio(
      window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY),
      window.localStorage.getItem(LEGACY_BOTTOM_PANEL_HEIGHT_STORAGE_KEY),
      workspaceHeight,
    ),
  ]
}

export function resolveInitialRightDockWidthRatio(
  storedRatioValue: string | null,
  legacyStoredWidthValue: string | null,
  workspaceWidth: number,
  workspaceHeight: number,
): number {
  const storedRatio = parseUnitInterval(storedRatioValue)
  if (storedRatio != null) return storedRatio

  const legacyStoredWidth = parseFiniteNumber(legacyStoredWidthValue)
  if (legacyStoredWidth != null && legacyStoredWidth >= 0) {
    const legacyWidth =
      legacyStoredWidth <= 1
        ? legacyRightDockWidthFromRatio(
            legacyStoredWidth,
            workspaceWidth,
          )
        : legacyStoredWidth
    return rightDockWidthToRatio(legacyWidth, workspaceWidth)
  }

  return rightDockWidthToRatio(
    getResponsiveRightDockDefaultWidth(workspaceWidth, workspaceHeight),
    workspaceWidth,
  )
}

export function resolveInitialBottomPanelHeightRatio(
  storedRatioValue: string | null,
  legacyStoredHeightValue: string | null,
  workspaceHeight: number,
): number {
  const storedRatio = parseUnitInterval(storedRatioValue)
  if (storedRatio != null) return storedRatio

  const legacyStoredHeight = parseFiniteNumber(legacyStoredHeightValue)
  if (legacyStoredHeight != null && legacyStoredHeight > 0) {
    return bottomPanelHeightToRatio(legacyStoredHeight, workspaceHeight)
  }

  return bottomPanelHeightToRatio(
    BOTTOM_PANEL_DEFAULT_HEIGHT,
    workspaceHeight,
  )
}

function legacyRightDockWidthFromRatio(
  ratio: number,
  workspaceWidth: number,
): number {
  const maximum = Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    workspaceWidth - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
  return Math.round(
    RIGHT_DOCK_MIN_WIDTH + ratio * (maximum - RIGHT_DOCK_MIN_WIDTH),
  )
}

function parseUnitInterval(value: string | null): number | null {
  const parsed = parseFiniteNumber(value)
  return parsed != null && parsed >= 0 && parsed <= 1 ? parsed : null
}

function parseFiniteNumber(value: string | null): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
