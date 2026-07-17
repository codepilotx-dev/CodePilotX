import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDesktopLayout,
} from './useDesktopLayout.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchPanelState,
  type RightDockState,
  type RightDockToolId,
  type WorkbenchPanelState,
  type WorkbenchPanelTarget,
} from './rightDockState.js'
import type { RightDockPlan } from './rightDockTools.js'

export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 352
export const BOTTOM_PANEL_MIN_HEIGHT = 160
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 280

const RIGHT_DOCK_WIDTH_STORAGE_KEY = 'codepilotx.desktop.rightDockWidth'
const BOTTOM_PANEL_HEIGHT_STORAGE_KEY =
  'codepilotx.desktop.bottomPanelHeight'
const RIGHT_DOCK_DEFAULT_WIDTH = 600
const RIGHT_DOCK_RESPONSIVE_BREAKPOINT = 960

export function useWorkbenchShellController(debugMode: boolean) {
  const layout = useDesktopLayout()
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  } = layout
  const [workbenchPanelState, setWorkbenchPanelState] =
    useState<WorkbenchPanelState>(createDefaultWorkbenchPanelState)
  const [rightDockPlan, setRightDockPlan] = useState<RightDockPlan | null>(null)
  const [rightDockWidth, setRightDockWidth] = useState(() =>
    getInitialRightDockWidth(),
  )
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() =>
    getInitialBottomPanelHeight(),
  )
  const autoCollapsedRightRef = useRef(false)
  const rightDockState = workbenchPanelState.right
  const bottomPanelState = workbenchPanelState.bottom

  const setRightDockState = useCallback<
    React.Dispatch<React.SetStateAction<RightDockState>>
  >((next) => {
    setWorkbenchPanelState(current => {
      const right =
        typeof next === 'function' ? next(current.right) : next
      return applyWorkbenchPanelAction(current, {
        type: 'replaceRight',
        state: right,
      })
    })
  }, [])

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const openRightDockTool = useCallback(
    (tool: RightDockToolId): void => {
      autoCollapsedRightRef.current = false
      setWorkbenchPanelState(current =>
        applyWorkbenchPanelAction(
          current,
          { type: 'openTool', target: 'right', tool },
          { debugMode },
        ),
      )
    },
    [debugMode],
  )

  const selectRightDockTool = useCallback((tool: RightDockToolId): void => {
    setWorkbenchPanelState(current =>
      applyWorkbenchPanelAction(current, {
        type: 'selectTool',
        target: 'right',
        tool,
      }),
    )
  }, [])

  const closeRightDockTool = useCallback((tool: RightDockToolId): void => {
    setWorkbenchPanelState(current =>
      applyWorkbenchPanelAction(current, {
        type: 'closeTool',
        target: 'right',
        tool,
      }),
    )
  }, [])

  const closeRightDock = useCallback((): void => {
    autoCollapsedRightRef.current = false
    setWorkbenchPanelState(current =>
      applyWorkbenchPanelAction(current, {
        type: 'closePanel',
        target: 'right',
      }),
    )
  }, [])

  const dispatchPanelAction = useCallback(
    (
      action: Parameters<typeof applyWorkbenchPanelAction>[1],
    ): void => {
      setWorkbenchPanelState(current =>
        applyWorkbenchPanelAction(current, action, { debugMode }),
      )
    },
    [debugMode],
  )

  const openPanelTool = useCallback(
    (target: WorkbenchPanelTarget, tool: RightDockToolId): void => {
      if (target === 'right') autoCollapsedRightRef.current = false
      dispatchPanelAction({ type: 'openTool', target, tool })
    },
    [dispatchPanelAction],
  )

  const selectPanelTool = useCallback(
    (target: WorkbenchPanelTarget, tool: RightDockToolId): void => {
      dispatchPanelAction({ type: 'selectTool', target, tool })
    },
    [dispatchPanelAction],
  )

  const closePanelTool = useCallback(
    (target: WorkbenchPanelTarget, tool: RightDockToolId): void => {
      dispatchPanelAction({ type: 'closeTool', target, tool })
    },
    [dispatchPanelAction],
  )

  const togglePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      if (target === 'right') autoCollapsedRightRef.current = false
      setWorkbenchPanelState(current => {
        const opening = !current[target].open
        const next = applyWorkbenchPanelAction(
          current,
          { type: 'togglePanel', target },
          { debugMode },
        )
        if (opening) {
          requestAnimationFrame(() => {
            const panel = document.querySelector<HTMLElement>(
              `[role="tabpanel"][data-app-shell-tab-panel-controller="${target}"]`,
            )
            panel?.focus({ preventScroll: true })
          })
        }
        return next
      })
    },
    [debugMode],
  )

  const closePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      if (target === 'right') autoCollapsedRightRef.current = false
      dispatchPanelAction({ type: 'closePanel', target })
    },
    [dispatchPanelAction],
  )

  const movePanelTool = useCallback(
    (
      source: WorkbenchPanelTarget,
      target: WorkbenchPanelTarget,
      tool: RightDockToolId,
      index?: number,
    ): void => {
      dispatchPanelAction({ type: 'moveTool', source, target, tool, index })
    },
    [dispatchPanelAction],
  )

  const reorderPanelTool = useCallback(
    (
      target: WorkbenchPanelTarget,
      tool: RightDockToolId,
      index: number,
    ): void => {
      dispatchPanelAction({ type: 'reorderTool', target, tool, index })
    },
    [dispatchPanelAction],
  )

  const toggleRightFullWidth = useCallback((): void => {
    dispatchPanelAction({ type: 'toggleRightFullWidth' })
  }, [dispatchPanelAction])

  const handleSetRightDockWidth = useCallback((nextWidth: number): void => {
    setRightDockWidth(clampRightDockWidth(nextWidth))
  }, [])

  const handleResetRightDockWidth = useCallback((): void => {
    setRightDockWidth(clampRightDockWidth(RIGHT_DOCK_DEFAULT_WIDTH))
  }, [])

  const handleSetBottomPanelHeight = useCallback((nextHeight: number): void => {
    if (nextHeight < BOTTOM_PANEL_MIN_HEIGHT) {
      dispatchPanelAction({ type: 'closePanel', target: 'bottom' })
      return
    }
    setBottomPanelHeight(clampBottomPanelHeight(nextHeight))
  }, [dispatchPanelAction])

  const handleResetBottomPanelHeight = useCallback((): void => {
    setBottomPanelHeight(clampBottomPanelHeight(BOTTOM_PANEL_DEFAULT_HEIGHT))
  }, [])

  const handleOpenPlanDock = useCallback(
    (plan: RightDockPlan): void => {
      setRightDockPlan(plan)
      openRightDockTool('plan')
    },
    [openRightDockTool],
  )

  const toggleBottomPanelVisible = useCallback((): void => {
    togglePanel('bottom')
  }, [togglePanel])

  useEffect(() => {
    window.localStorage.setItem(
      RIGHT_DOCK_WIDTH_STORAGE_KEY,
      String(rightDockWidth),
    )
  }, [rightDockWidth])

  useEffect(() => {
    window.localStorage.setItem(
      BOTTOM_PANEL_HEIGHT_STORAGE_KEY,
      String(bottomPanelHeight),
    )
  }, [bottomPanelHeight])

  useEffect(() => {
    const onResize = (): void => {
      setRightDockWidth((current) => clampRightDockWidth(current))
      setBottomPanelHeight(current => clampBottomPanelHeight(current))
      if (window.innerWidth <= RIGHT_DOCK_RESPONSIVE_BREAKPOINT) {
        setWorkbenchPanelState(current => {
          if (!current.right.open) return current
          autoCollapsedRightRef.current = true
          return applyWorkbenchPanelAction(current, {
            type: 'closePanel',
            target: 'right',
            responsive: true,
          })
        })
      } else if (autoCollapsedRightRef.current) {
        autoCollapsedRightRef.current = false
        setWorkbenchPanelState(current =>
          applyWorkbenchPanelAction(current, {
            type: 'togglePanel',
            target: 'right',
          }),
        )
      }
    }
    window.addEventListener('resize', onResize)
    onResize()
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
    workbenchPanelState,
    setWorkbenchPanelState,
    rightDockState,
    setRightDockState,
    bottomPanelState,
    rightDockPlan,
    setRightDockPlan,
    bottomPanelVisible: bottomPanelState.open,
    rightDockWidth,
    bottomPanelHeight,
    openRightDockTool,
    selectRightDockTool,
    closeRightDockTool,
    closeRightDock,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleSetBottomPanelHeight,
    handleResetBottomPanelHeight,
    handleOpenPlanDock,
    toggleBottomPanelVisible,
    openPanelTool,
    selectPanelTool,
    closePanelTool,
    togglePanel,
    closePanel,
    movePanelTool,
    reorderPanelTool,
    toggleRightFullWidth,
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
  const safeWidth = Number.isFinite(width) ? width : RIGHT_DOCK_DEFAULT_WIDTH
  return Math.min(
    viewportMax,
    Math.max(RIGHT_DOCK_MIN_WIDTH, Math.round(safeWidth)),
  )
}

function getInitialBottomPanelHeight(): number {
  const stored = Number(
    window.localStorage.getItem(BOTTOM_PANEL_HEIGHT_STORAGE_KEY),
  )
  return clampBottomPanelHeight(stored || BOTTOM_PANEL_DEFAULT_HEIGHT)
}

function clampBottomPanelHeight(height: number): number {
  const viewportMax = Math.max(
    BOTTOM_PANEL_MIN_HEIGHT,
    Math.floor(window.innerHeight * 0.5),
  )
  const safeHeight = Number.isFinite(height)
    ? height
    : BOTTOM_PANEL_DEFAULT_HEIGHT
  return Math.min(
    viewportMax,
    Math.max(BOTTOM_PANEL_MIN_HEIGHT, Math.round(safeHeight)),
  )
}
