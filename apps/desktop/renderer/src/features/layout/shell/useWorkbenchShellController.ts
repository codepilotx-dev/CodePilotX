import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useDesktopLayout,
} from '../useDesktopLayout.js'
import {
  applyWorkbenchTabsAction,
  createDefaultWorkbenchTabsState,
  type WorkbenchPanelAction,
  type WorkbenchPanelTarget,
  type MarkdownFileViewMode,
  type WorkbenchTabDescriptor,
  type WorkbenchTabId,
  type WorkbenchTabsState,
} from '../dock/rightDockState.js'
import type { OpenPlanInDockRequest } from '../../session/workflow/WorkflowPlanCard.js'
import { useSidebarShellController } from '../sidebarShellState.js'

export const RIGHT_DOCK_MIN_WIDTH = 320
export const RIGHT_DOCK_MAIN_MIN_WIDTH = 352
export const RIGHT_DOCK_DEFAULT_WIDTH = 600
export const BOTTOM_PANEL_MIN_HEIGHT = 160
export const BOTTOM_PANEL_DEFAULT_HEIGHT = 280

const RIGHT_DOCK_WIDTH_STORAGE_KEY = 'codepilotx.desktop.rightDockWidth'
const BOTTOM_PANEL_HEIGHT_STORAGE_KEY =
  'codepilotx.desktop.bottomPanelHeight'
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
    useState<WorkbenchTabsState>(createDefaultWorkbenchTabsState)
  const [rightDockViewport, setRightDockViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  const rightDockMainContentWidth = getRightDockMainContentWidth(
    rightDockViewport.width,
    sidebarCollapsed,
    sidebarWidth,
  )
  const [rightDockWidthRatio, setRightDockWidthRatio] = useState(() =>
    getInitialRightDockWidthRatio(
      rightDockMainContentWidth,
      rightDockViewport.height,
    ),
  )
  const rightDockWidth = rightDockWidthFromRatio(
    rightDockWidthRatio,
    rightDockMainContentWidth,
  )
  const [bottomPanelHeight, setBottomPanelHeight] = useState(
    getInitialBottomPanelHeight,
  )
  const sidebarShell = useSidebarShellController({
    desktopCollapsed: sidebarCollapsed,
    sidebarWidth,
    setDesktopCollapsed: setSidebarCollapsed,
  })
  const autoCollapsedRightRef = useRef(false)
  const rightDockState = workbenchPanelState.right
  const bottomPanelState = workbenchPanelState.bottom

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const dispatchPanelAction = useCallback(
    (action: WorkbenchPanelAction): void => {
      setWorkbenchPanelState(current =>
        applyWorkbenchTabsAction(current, action, { debugMode }),
      )
    },
    [debugMode],
  )

  const openPanelTab = useCallback(
    (
      target: WorkbenchPanelTarget,
      tab: WorkbenchTabDescriptor,
      index?: number,
    ): void => {
      if (target === 'right') autoCollapsedRightRef.current = false
      dispatchPanelAction({ type: 'openTab', target, tab, index })
    },
    [dispatchPanelAction],
  )

  const openRightDockTab = useCallback(
    (tab: WorkbenchTabDescriptor): void => {
      openPanelTab('right', tab)
    },
    [openPanelTab],
  )

  const selectPanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'selectTab', target, tabId })
    },
    [dispatchPanelAction],
  )

  const closePanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeTab', target, tabId })
    },
    [dispatchPanelAction],
  )

  const closeRightDock = useCallback((): void => {
    autoCollapsedRightRef.current = false
    dispatchPanelAction({ type: 'closePanel', target: 'right' })
  }, [dispatchPanelAction])

  const togglePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      if (target === 'right') autoCollapsedRightRef.current = false
      setWorkbenchPanelState(current => {
        const opening = !current[target].open
        const next = applyWorkbenchTabsAction(
          current,
          { type: 'togglePanel', target },
          { debugMode },
        )
        if (opening) {
          requestAnimationFrame(() => {
            document
              .querySelector<HTMLElement>(
                `[data-app-shell-tab-panel-controller="${target}"]`,
              )
              ?.focus({ preventScroll: true })
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

  const movePanelTab = useCallback(
    (
      source: WorkbenchPanelTarget,
      target: WorkbenchPanelTarget,
      tabId: WorkbenchTabId,
      index?: number,
    ): void => {
      dispatchPanelAction({ type: 'moveTab', source, target, tabId, index })
    },
    [dispatchPanelAction],
  )

  const reorderPanelTab = useCallback(
    (
      target: WorkbenchPanelTarget,
      tabId: WorkbenchTabId,
      index: number,
    ): void => {
      dispatchPanelAction({ type: 'reorderTab', target, tabId, index })
    },
    [dispatchPanelAction],
  )

  const closeOtherTabs = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeOtherTabs', target, tabId })
    },
    [dispatchPanelAction],
  )

  const closeTabsToRight = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'closeTabsToRight', target, tabId })
    },
    [dispatchPanelAction],
  )

  const pinTab = useCallback(
    (tabId: WorkbenchTabId): void => {
      dispatchPanelAction({ type: 'pinTab', tabId })
    },
    [dispatchPanelAction],
  )

  const setFileMarkdownViewMode = useCallback(
    (tabId: WorkbenchTabId, mode: MarkdownFileViewMode): void => {
      dispatchPanelAction({ type: 'setFileMarkdownViewMode', tabId, mode })
    },
    [dispatchPanelAction],
  )

  const toggleRightFullWidth = useCallback((): void => {
    dispatchPanelAction({ type: 'toggleRightFullWidth' })
  }, [dispatchPanelAction])

  const handleSetRightDockWidth = useCallback(
    (nextWidth: number): void => {
      setRightDockWidthRatio(
        rightDockWidthToRatio(nextWidth, rightDockMainContentWidth),
      )
    },
    [rightDockMainContentWidth],
  )

  const handleResetRightDockWidth = useCallback((): void => {
    setRightDockWidthRatio(
      rightDockWidthToRatio(
        getResponsiveRightDockDefaultWidth(
          rightDockMainContentWidth,
          rightDockViewport.height,
        ),
        rightDockMainContentWidth,
      ),
    )
  }, [rightDockMainContentWidth, rightDockViewport.height])

  const handleSetBottomPanelHeight = useCallback(
    (nextHeight: number): void => {
      if (nextHeight < BOTTOM_PANEL_MIN_HEIGHT) {
        dispatchPanelAction({ type: 'closePanel', target: 'bottom' })
        return
      }
      setBottomPanelHeight(clampBottomPanelHeight(nextHeight))
    },
    [dispatchPanelAction],
  )

  const handleResetBottomPanelHeight = useCallback((): void => {
    setBottomPanelHeight(clampBottomPanelHeight(BOTTOM_PANEL_DEFAULT_HEIGHT))
  }, [])

  const handleOpenPlanDock = useCallback(
    (plan: OpenPlanInDockRequest): void => {
      openRightDockTab({
        id: `plan:${plan.eventId}`,
        kind: 'plan',
        eventId: plan.eventId,
        title: plan.title,
      })
    },
    [openRightDockTab],
  )

  useEffect(() => {
    window.localStorage.setItem(
      RIGHT_DOCK_WIDTH_STORAGE_KEY,
      String(rightDockWidthRatio),
    )
  }, [rightDockWidthRatio])

  useEffect(() => {
    window.localStorage.setItem(
      BOTTOM_PANEL_HEIGHT_STORAGE_KEY,
      String(bottomPanelHeight),
    )
  }, [bottomPanelHeight])

  useEffect(() => {
    const onResize = (): void => {
      setRightDockViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      })
      setBottomPanelHeight(current => clampBottomPanelHeight(current))
      if (window.innerWidth <= RIGHT_DOCK_RESPONSIVE_BREAKPOINT) {
        setWorkbenchPanelState(current => {
          if (!current.right.open) return current
          autoCollapsedRightRef.current = true
          return applyWorkbenchTabsAction(current, {
            type: 'closePanel',
            target: 'right',
            responsive: true,
          })
        })
      } else if (autoCollapsedRightRef.current) {
        autoCollapsedRightRef.current = false
        setWorkbenchPanelState(current =>
          applyWorkbenchTabsAction(current, {
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
    toggleSidebarCollapsed: sidebarShell.toggle,
    collapseSidebar,
    sidebarShell,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    workbenchPanelState,
    setWorkbenchPanelState,
    rightDockState,
    bottomPanelState,
    bottomPanelVisible: bottomPanelState.open,
    rightDockWidth,
    bottomPanelHeight,
    openRightDockTab,
    openPanelTab,
    selectPanelTab,
    closePanelTab,
    closeRightDock,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleSetBottomPanelHeight,
    handleResetBottomPanelHeight,
    handleOpenPlanDock,
    toggleBottomPanelVisible: () => togglePanel('bottom'),
    togglePanel,
    closePanel,
    movePanelTab,
    reorderPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    pinTab,
    setFileMarkdownViewMode,
    toggleRightFullWidth,
  }
}

function getInitialRightDockWidthRatio(
  mainContentWidth: number,
  shellHeight: number,
): number {
  const storedValue = window.localStorage.getItem(RIGHT_DOCK_WIDTH_STORAGE_KEY)
  const stored = storedValue == null ? Number.NaN : Number(storedValue)
  if (Number.isFinite(stored) && stored >= 0 && stored <= 1) {
    return clampUnitInterval(stored)
  }
  return rightDockWidthToRatio(
    Number.isFinite(stored) && stored > 1
      ? stored
      : getResponsiveRightDockDefaultWidth(mainContentWidth, shellHeight),
    mainContentWidth,
  )
}

export function rightDockWidthFromRatio(
  ratio: number,
  mainContentWidth: number,
): number {
  const { minimum, maximum } = getRightDockWidthRange(mainContentWidth)
  return Math.round(
    minimum + clampUnitInterval(ratio) * (maximum - minimum),
  )
}

export function rightDockWidthToRatio(
  width: number,
  mainContentWidth: number,
): number {
  const { minimum, maximum } = getRightDockWidthRange(mainContentWidth)
  const range = maximum - minimum
  if (range === 0) return 0
  const safeWidth = Number.isFinite(width)
    ? width
    : RIGHT_DOCK_DEFAULT_WIDTH
  return clampUnitInterval(
    (Math.min(maximum, Math.max(minimum, safeWidth)) - minimum) / range,
  )
}

function getRightDockWidthRange(mainContentWidth: number): {
  minimum: number
  maximum: number
} {
  const maximum = Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    mainContentWidth - RIGHT_DOCK_MAIN_MIN_WIDTH,
  )
  return {
    minimum: Math.min(RIGHT_DOCK_MIN_WIDTH, maximum),
    maximum,
  }
}

export function getResponsiveRightDockDefaultWidth(
  mainContentWidth: number,
  shellHeight: number,
): number {
  return Math.max(
    RIGHT_DOCK_MIN_WIDTH,
    Math.min(shellHeight * 1.6, mainContentWidth - 500),
    Math.min(640, mainContentWidth - RIGHT_DOCK_MAIN_MIN_WIDTH),
  )
}

function getRightDockMainContentWidth(
  viewportWidth: number,
  sidebarCollapsed: boolean,
  sidebarWidth: number,
): number {
  return Math.max(
    0,
    viewportWidth - (sidebarCollapsed ? 0 : sidebarWidth),
  )
}

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value))
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
