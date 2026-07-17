import { useCallback, useEffect, useState } from 'react'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDesktopLayout,
} from './useDesktopLayout.js'
import {
  applyRightDockAction,
  type RightDockState,
  type RightDockToolId,
} from './rightDockState.js'
import type { RightDockPlan } from './rightDockTools.js'

export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAX_WIDTH = 850

const RIGHT_DOCK_WIDTH_STORAGE_KEY = 'codepilotx.desktop.rightDockWidth'
const RIGHT_DOCK_DEFAULT_WIDTH = 600
const RIGHT_DOCK_MAIN_MIN_WIDTH = 520

export function useWorkbenchShellController(debugMode: boolean) {
  const layout = useDesktopLayout()
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  } = layout
  const [rightDockState, setRightDockState] = useState<RightDockState>({
    open: false,
    activeTool: null,
    openTools: [],
  })
  const [rightDockPlan, setRightDockPlan] = useState<RightDockPlan | null>(null)
  const [bottomPanelVisible, setBottomPanelVisible] = useState(false)
  const [rightDockWidth, setRightDockWidth] = useState(() =>
    getInitialRightDockWidth(),
  )

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const openRightDockTool = useCallback(
    (tool: RightDockToolId): void => {
      setRightDockState((current) =>
        applyRightDockAction(
          current,
          { type: 'openTool', tool },
          { debugMode },
        ),
      )
    },
    [debugMode],
  )

  const selectRightDockTool = useCallback((tool: RightDockToolId): void => {
    setRightDockState((current) =>
      applyRightDockAction(current, { type: 'selectTool', tool }),
    )
  }, [])

  const closeRightDockTool = useCallback((tool: RightDockToolId): void => {
    setRightDockState((current) =>
      applyRightDockAction(current, { type: 'closeTool', tool }),
    )
  }, [])

  const closeRightDock = useCallback((): void => {
    setRightDockState((current) =>
      applyRightDockAction(current, { type: 'close' }),
    )
  }, [])

  const handleSetRightDockWidth = useCallback((nextWidth: number): void => {
    setRightDockWidth(clampRightDockWidth(nextWidth))
  }, [])

  const handleResetRightDockWidth = useCallback((): void => {
    setRightDockWidth(clampRightDockWidth(RIGHT_DOCK_DEFAULT_WIDTH))
  }, [])

  const handleOpenPlanDock = useCallback(
    (plan: RightDockPlan): void => {
      setRightDockPlan(plan)
      openRightDockTool('plan')
    },
    [openRightDockTool],
  )

  const toggleBottomPanelVisible = useCallback((): void => {
    setBottomPanelVisible((current) => !current)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(
      RIGHT_DOCK_WIDTH_STORAGE_KEY,
      String(rightDockWidth),
    )
  }, [rightDockWidth])

  useEffect(() => {
    const onResize = (): void => {
      setRightDockWidth((current) => clampRightDockWidth(current))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebarCollapsed,
    collapseSidebar,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    rightDockState,
    setRightDockState,
    rightDockPlan,
    setRightDockPlan,
    bottomPanelVisible,
    rightDockWidth,
    openRightDockTool,
    selectRightDockTool,
    closeRightDockTool,
    closeRightDock,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleOpenPlanDock,
    toggleBottomPanelVisible,
  }
}

function getInitialRightDockWidth(): number {
  const stored = Number(
    window.localStorage.getItem(RIGHT_DOCK_WIDTH_STORAGE_KEY),
  )
  return clampRightDockWidth(stored || RIGHT_DOCK_DEFAULT_WIDTH)
}

function clampRightDockWidth(width: number): number {
  const viewportMax = Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    window.innerWidth - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
  const maxWidth = Math.min(RIGHT_DOCK_MAX_WIDTH, viewportMax)
  const safeWidth = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return Math.min(
    maxWidth,
    Math.max(RIGHT_DOCK_MIN_WIDTH, Math.round(safeWidth)),
  )
}
