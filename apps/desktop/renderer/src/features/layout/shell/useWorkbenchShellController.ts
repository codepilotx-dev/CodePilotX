import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
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
import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_DOCK_MIN_WIDTH,
  RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
  bottomPanelHeightFromRatio,
  bottomPanelHeightToRatio,
  getBottomPanelMaxHeight,
  getResponsiveRightDockDefaultWidth,
  getRightDockMaxWidth,
  reduceRightDockResponsiveState,
  rightDockWidthFromRatio,
  rightDockWidthToRatio,
  type WorkbenchSize,
} from './workbenchLayoutSizing.js'

export {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_MIN_HEIGHT,
  RIGHT_DOCK_MAIN_MIN_WIDTH,
  RIGHT_DOCK_MIN_WIDTH,
  getResponsiveRightDockDefaultWidth,
  rightDockWidthFromRatio,
  rightDockWidthToRatio,
} from './workbenchLayoutSizing.js'

export function useWorkbenchShellController() {
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
  const workspaceRef = useRef<HTMLDivElement>(null)
  const workspaceMeasuredRef = useRef(false)
  const [workspaceSize, setWorkspaceSize] = useState<WorkbenchSize>({
    width: 0,
    height: 0,
  })
  const [rightDockWidthRatio, setRightDockWidthRatio] =
    useState<number | null>(null)
  const rightDockWidth = rightDockWidthFromRatio(
    rightDockWidthRatio ?? 0,
    workspaceSize.width,
  )
  const [bottomPanelHeightRatio, setBottomPanelHeightRatio] =
    useState<number | null>(null)
  const bottomPanelHeight = bottomPanelHeightFromRatio(
    bottomPanelHeightRatio ?? 0,
    workspaceSize.height,
  )
  const [rightDockResponsiveState, setRightDockResponsiveState] = useState({
    suppressed: true,
    manualOverride: false,
  })
  const sidebarShell = useSidebarShellController({
    desktopCollapsed: sidebarCollapsed,
    sidebarWidth,
    setDesktopCollapsed: setSidebarCollapsed,
  })
  const rightDockState = workbenchPanelState.right
  const bottomPanelState = workbenchPanelState.bottom
  const rightDockVisible =
    rightDockWidthRatio !== null &&
    rightDockState.open &&
    (!rightDockResponsiveState.suppressed ||
      rightDockResponsiveState.manualOverride)
  const rightDockMaxWidth = getRightDockMaxWidth(workspaceSize.width)
  const bottomPanelMaxHeight = getBottomPanelMaxHeight(workspaceSize.height)

  const collapseSidebar = useCallback((): void => {
    setSidebarCollapsed(true)
  }, [setSidebarCollapsed])

  const dispatchPanelAction = useCallback(
    (action: WorkbenchPanelAction): void => {
      setWorkbenchPanelState(current =>
        applyWorkbenchTabsAction(current, action),
      )
    },
    [],
  )

  const updateRightDockManualState = useCallback(
    (type: 'manualOpen' | 'manualClose'): void => {
      setRightDockResponsiveState(current =>
        reduceRightDockResponsiveState(current, {
          type,
          workspaceWidth: workspaceSize.width,
        }),
      )
    },
    [workspaceSize.width],
  )

  const moveRightDockFocusToMain = useCallback((): void => {
    const activeElement = document.activeElement
    if (
      !(activeElement instanceof HTMLElement) ||
      !activeElement.closest(
        '[data-app-shell-tab-panel-controller="right"]',
      )
    ) return
    activeElement.blur()
    dispatchPanelAction({ type: 'focusPanel', target: 'main' })
  }, [dispatchPanelAction])

  const openPanelTab = useCallback(
    (
      target: WorkbenchPanelTarget,
      tab: WorkbenchTabDescriptor,
      index?: number,
    ): void => {
      if (target === 'right') updateRightDockManualState('manualOpen')
      dispatchPanelAction({ type: 'openTab', target, tab, index })
    },
    [dispatchPanelAction, updateRightDockManualState],
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
    updateRightDockManualState('manualClose')
    dispatchPanelAction({ type: 'closePanel', target: 'right' })
  }, [dispatchPanelAction, updateRightDockManualState])

  const togglePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      if (target === 'right' && rightDockState.open && !rightDockVisible) {
        updateRightDockManualState('manualOpen')
        focusPanelController('right')
        return
      }

      if (target === 'right') {
        if (rightDockState.open) {
          updateRightDockManualState('manualClose')
        } else {
          updateRightDockManualState('manualOpen')
        }
      }
      setWorkbenchPanelState(current => {
        const opening = !current[target].open
        const next = applyWorkbenchTabsAction(
          current,
          { type: 'togglePanel', target },
        )
        if (opening) {
          focusPanelController(target)
        }
        return next
      })
    },
    [
      rightDockState.open,
      rightDockVisible,
      updateRightDockManualState,
    ],
  )

  const closePanel = useCallback(
    (target: WorkbenchPanelTarget): void => {
      if (target === 'right') updateRightDockManualState('manualClose')
      dispatchPanelAction({ type: 'closePanel', target })
    },
    [dispatchPanelAction, updateRightDockManualState],
  )

  const movePanelTab = useCallback(
    (
      source: WorkbenchPanelTarget,
      target: WorkbenchPanelTarget,
      tabId: WorkbenchTabId,
      index?: number,
    ): void => {
      if (target === 'right') updateRightDockManualState('manualOpen')
      dispatchPanelAction({ type: 'moveTab', source, target, tabId, index })
    },
    [dispatchPanelAction, updateRightDockManualState],
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
    updateRightDockManualState('manualOpen')
    dispatchPanelAction({ type: 'toggleRightFullWidth' })
  }, [dispatchPanelAction, updateRightDockManualState])

  const commitRightDockWidthRatio = useCallback(
    (nextRatio: number): void => {
      startTransition(() => setRightDockWidthRatio(nextRatio))
      window.localStorage.setItem(
        RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
        String(nextRatio),
      )
    },
    [],
  )

  const commitBottomPanelHeightRatio = useCallback(
    (nextRatio: number): void => {
      startTransition(() => setBottomPanelHeightRatio(nextRatio))
      window.localStorage.setItem(
        BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
        String(nextRatio),
      )
    },
    [],
  )

  const handleSetRightDockWidth = useCallback(
    (nextWidth: number): void => {
      commitRightDockWidthRatio(
        rightDockWidthToRatio(nextWidth, workspaceSize.width),
      )
    },
    [commitRightDockWidthRatio, workspaceSize.width],
  )

  const handleResetRightDockWidth = useCallback((): void => {
    commitRightDockWidthRatio(
      rightDockWidthToRatio(
        getResponsiveRightDockDefaultWidth(
          workspaceSize.width,
          workspaceSize.height,
        ),
        workspaceSize.width,
      ),
    )
  }, [
    commitRightDockWidthRatio,
    workspaceSize.height,
    workspaceSize.width,
  ])

  const handleSetBottomPanelHeight = useCallback(
    (nextHeight: number): void => {
      commitBottomPanelHeightRatio(
        bottomPanelHeightToRatio(nextHeight, workspaceSize.height),
      )
    },
    [commitBottomPanelHeightRatio, workspaceSize.height],
  )

  const handleResetBottomPanelHeight = useCallback((): void => {
    commitBottomPanelHeightRatio(
      bottomPanelHeightToRatio(
        BOTTOM_PANEL_DEFAULT_HEIGHT,
        workspaceSize.height,
      ),
    )
  }, [commitBottomPanelHeightRatio, workspaceSize.height])

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
    const workspaceElement = workspaceRef.current

    const updateWorkspaceSize = (
      width: number,
      height: number,
    ): void => {
      if (width <= 0 || height <= 0) return
      const nextSize = {
        width: Math.round(width),
        height: Math.round(height),
      }
      if (!workspaceMeasuredRef.current) {
        workspaceMeasuredRef.current = true
        void import('./workbenchLayoutStorage.js').then(module => {
          const [rightRatio, bottomRatio] = module.default(
            nextSize.width,
            nextSize.height,
          )
          setRightDockWidthRatio(rightRatio)
          setBottomPanelHeightRatio(bottomRatio)
        })
      }
      setWorkspaceSize(nextSize)
    }

    if (!workspaceElement) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        updateWorkspaceSize(
          entry.contentRect.width,
          entry.contentRect.height,
        )
      }
    })
    observer.observe(workspaceElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setRightDockResponsiveState(current => {
      const next = reduceRightDockResponsiveState(current, {
        type: 'resize',
        workspaceWidth: workspaceSize.width,
      })
      if (
        rightDockState.open &&
        !next.manualOverride &&
        !current.suppressed &&
        next.suppressed
      ) moveRightDockFocusToMain()
      return next.suppressed === current.suppressed &&
        next.manualOverride === current.manualOverride
        ? current
        : next
    })
  }, [
    moveRightDockFocusToMain,
    rightDockState.open,
    workspaceSize.width,
  ])

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
    workspaceRef,
    workspaceWidth: workspaceSize.width,
    rightDockVisible,
    rightDockMinWidth: RIGHT_DOCK_MIN_WIDTH,
    rightDockMaxWidth,
    rightDockWidth,
    bottomPanelMinHeight: BOTTOM_PANEL_MIN_HEIGHT,
    bottomPanelMaxHeight,
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

function focusPanelController(target: WorkbenchPanelTarget): void {
  let attempts = 0
  const focusWhenMounted = (): void => {
    const controller = document.querySelector<HTMLElement>(
      `[data-app-shell-tab-panel-controller="${target}"]`,
    )
    if (controller) {
      controller.focus({ preventScroll: true })
      return
    }
    if (attempts++ < 60) requestAnimationFrame(focusWhenMounted)
  }
  requestAnimationFrame(focusWhenMounted)
}
