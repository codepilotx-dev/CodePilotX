import {
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
import {
  applyWorkbenchLayoutAction,
  WORKBENCH_LAYOUT_SCHEMA_VERSION,
  type WorkbenchLayoutAction,
  type WorkbenchLayoutState,
} from './workbenchLayoutState.js'

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
    setSidebarWidth: setSidebarWidthLegacy,
    toggleSidebarCollapsed: toggleSidebarCollapsedLegacy,
  } = layout
  const [workbenchPanelState, setWorkbenchPanelState] =
    useState<WorkbenchTabsState>(createDefaultWorkbenchTabsState)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const workspaceMeasuredRef = useRef(false)
  const initSnapshotRef = useRef({
    sidebarCollapsed,
    sidebarWidth,
    rightOpen: workbenchPanelState.right.open,
    bottomOpen: workbenchPanelState.bottom.open,
    rightFullWidth: workbenchPanelState.rightFullWidth,
  })
  const [workspaceSize, setWorkspaceSize] = useState<WorkbenchSize>({
    width: 0,
    height: 0,
  })
  const [rightDockWidthRatio, setRightDockWidthRatio] =
    useState<number | null>(null)
  const responsiveRightDockWidth = rightDockWidthFromRatio(
    rightDockWidthRatio ?? 0,
    workspaceSize.width,
  )
  const [windowWidth, setWindowWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth,
  )
  const [bottomPanelHeightRatio, setBottomPanelHeightRatio] =
    useState<number | null>(null)
  const responsiveBottomPanelHeight = bottomPanelHeightFromRatio(
    bottomPanelHeightRatio ?? 0,
    workspaceSize.height,
  )
  const [rightDockResponsiveState, setRightDockResponsiveState] = useState({
    suppressed: true,
    manualOverride: false,
  })

  const [workbenchLayoutState, setWorkbenchLayoutState] =
    useState<WorkbenchLayoutState | null>(null)

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

  const dispatchLayoutAction = useCallback(
    (action: WorkbenchLayoutAction): void => {
      setWorkbenchLayoutState(current =>
        current != null ? applyWorkbenchLayoutAction(current, action) : current,
      )
    },
    [],
  )

  const updateRightDockManualState = useCallback(
    (type: 'manualOpen' | 'manualClose'): void => {
      setRightDockResponsiveState(current =>
        reduceRightDockResponsiveState(current, {
          type,
          windowWidth,
        }),
      )
    },
    [windowWidth],
  )

  const moveRightDockFocusToMain = useCallback((): void => {
    const activeElement = document.activeElement
    if (
      !(activeElement instanceof HTMLElement) ||
      !activeElement.closest(
        '[data-app-shell-tab-panel-controller="right"]',
      )
    )
      return
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
    [rightDockState.open, rightDockVisible, updateRightDockManualState],
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
      setRightDockWidthRatio(nextRatio)
      window.localStorage.setItem(
        RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
        String(nextRatio),
      )
    },
    [],
  )

  const commitBottomPanelHeightRatio = useCallback(
    (nextRatio: number): void => {
      setBottomPanelHeightRatio(nextRatio)
      window.localStorage.setItem(
        BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
        String(nextRatio),
      )
    },
    [],
  )

  const handleSetRightDockWidth = useCallback(
    (nextWidth: number): void => {
      const nextRatio = rightDockWidthToRatio(nextWidth, workspaceSize.width)
      commitRightDockWidthRatio(nextRatio)
      dispatchLayoutAction({
        type: 'commitAuxiliaryPanelSize',
        size: nextWidth,
        workspaceWidth: workspaceSize.width,
      })
    },
    [commitRightDockWidthRatio, dispatchLayoutAction, workspaceSize.width],
  )

  const handleResetRightDockWidth = useCallback((): void => {
    const defaultWidth = getResponsiveRightDockDefaultWidth(
      workspaceSize.width,
      workspaceSize.height,
    )
    commitRightDockWidthRatio(
      rightDockWidthToRatio(defaultWidth, workspaceSize.width),
    )
    dispatchLayoutAction({
      type: 'commitAuxiliaryPanelSize',
      size: defaultWidth,
      workspaceWidth: workspaceSize.width,
    })
  }, [
    commitRightDockWidthRatio,
    dispatchLayoutAction,
    workspaceSize.height,
    workspaceSize.width,
  ])

  const handleSetBottomPanelHeight = useCallback(
    (nextHeight: number): void => {
      const nextRatio = bottomPanelHeightToRatio(
        nextHeight,
        workspaceSize.height,
      )
      commitBottomPanelHeightRatio(nextRatio)
      dispatchLayoutAction({
        type: 'commitBottomPanelSize',
        size: nextHeight,
        workspaceHeight: workspaceSize.height,
      })
    },
    [commitBottomPanelHeightRatio, dispatchLayoutAction, workspaceSize.height],
  )

  const handleResetBottomPanelHeight = useCallback((): void => {
    commitBottomPanelHeightRatio(
      bottomPanelHeightToRatio(BOTTOM_PANEL_DEFAULT_HEIGHT, workspaceSize.height),
    )
    dispatchLayoutAction({
      type: 'commitBottomPanelSize',
      size: BOTTOM_PANEL_DEFAULT_HEIGHT,
      workspaceHeight: workspaceSize.height,
    })
  }, [commitBottomPanelHeightRatio, dispatchLayoutAction, workspaceSize.height])

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

  const setSidebarWidth = useCallback(
    (width: number): void => {
      setSidebarWidthLegacy(width)
      dispatchLayoutAction({ type: 'commitPrimarySidebarSize', size: width })
    },
    [setSidebarWidthLegacy, dispatchLayoutAction],
  )

  const toggleSidebarCollapsed = useCallback((): void => {
    toggleSidebarCollapsedLegacy()
  }, [toggleSidebarCollapsedLegacy])

  useEffect(() => {
    const workspaceElement = workspaceRef.current
    if (!workspaceElement) return

    const updateWorkspaceSize = (width: number, height: number): void => {
      if (width <= 0 || height <= 0) return
      const nextSize = {
        width: Math.round(width),
        height: Math.round(height),
      }
      setWindowWidth(window.innerWidth)

      if (!workspaceMeasuredRef.current) {
        workspaceMeasuredRef.current = true
        const captured = initSnapshotRef.current
        void import('./workbenchLayoutStorage.js').then(module => {
          const [rightRatio, bottomRatio] = module.default(
            nextSize.width,
            nextSize.height,
          )
          setRightDockWidthRatio(rightRatio)
          setBottomPanelHeightRatio(bottomRatio)

          const snapshot = module.readWorkbenchLayoutSnapshot({
            workspaceWidth: nextSize.width,
            workspaceHeight: nextSize.height,
            sidebarCollapsed: captured.sidebarCollapsed,
            sidebarWidth:
              captured.sidebarWidth ??
              (nextSize.width > 0
                ? Math.min(520, Math.max(240, nextSize.width * 0.2))
                : 275),
            rightDockRatio: rightRatio,
            bottomPanelRatio: bottomRatio,
          })

          let initialState: WorkbenchLayoutState = {
            visibility: {
              primarySidebar: !captured.sidebarCollapsed,
              mainContent: true,
              auxiliaryPanel: captured.rightOpen,
              bottomPanel: captured.bottomOpen,
            },
            primarySidebarWidth: snapshot.primarySidebarWidth,
            auxiliaryPanelWidth: snapshot.auxiliaryPanelWidth,
            bottomPanelHeight: snapshot.bottomPanelHeight,
            auxiliaryMaximized: snapshot.auxiliaryMaximized,
            beforeAuxiliaryMaximized: snapshot.beforeAuxiliaryMaximized,
            beforeAuxiliaryMaximizedAuxiliaryWidth:
              snapshot.beforeAuxiliaryMaximizedAuxiliaryWidth,
          }

          if (captured.rightFullWidth) {
            initialState = applyWorkbenchLayoutAction(initialState, {
              type: 'enterAuxiliaryMaximized',
            })
          } else if (
            initialState.auxiliaryMaximized ||
            initialState.visibility.auxiliaryPanel
          ) {
            initialState = applyWorkbenchLayoutAction(initialState, {
              type: 'exitAuxiliaryMaximized',
            })
          }

          setWorkbenchLayoutState(initialState)
        })
      }

      setWorkspaceSize(nextSize)
    }

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
    if (workspaceMeasuredRef.current) return
    initSnapshotRef.current = {
      sidebarCollapsed,
      sidebarWidth,
      rightOpen: rightDockState.open,
      bottomOpen: bottomPanelState.open,
      rightFullWidth: workbenchPanelState.rightFullWidth,
    }
  }, [
    sidebarCollapsed,
    sidebarWidth,
    rightDockState.open,
    bottomPanelState.open,
    workbenchPanelState.rightFullWidth,
  ])

  useEffect(() => {
    setRightDockResponsiveState(current => {
      const next = reduceRightDockResponsiveState(current, {
        type: 'resize',
        windowWidth,
      })
      if (
        rightDockState.open &&
        !next.manualOverride &&
        !current.suppressed &&
        next.suppressed
      )
        moveRightDockFocusToMain()
      return next.suppressed === current.suppressed &&
        next.manualOverride === current.manualOverride
        ? current
        : next
    })
  }, [moveRightDockFocusToMain, rightDockState.open, windowWidth])

  useEffect(() => {
    if (workbenchLayoutState == null) return

    setWorkbenchLayoutState(current => {
      if (current == null) return current
      let next = current

      if (
        workbenchPanelState.rightFullWidth &&
        rightDockVisible &&
        !next.auxiliaryMaximized
      ) {
        next = applyWorkbenchLayoutAction(next, {
          type: 'enterAuxiliaryMaximized',
        })
      } else if (
        (!workbenchPanelState.rightFullWidth || !rightDockVisible) &&
        next.auxiliaryMaximized
      ) {
        next = applyWorkbenchLayoutAction(next, {
          type: 'exitAuxiliaryMaximized',
        })
      }

      if (next.auxiliaryMaximized) return next

      const targetAuxVisible = rightDockVisible
      const targetBottomVisible = bottomPanelState.open
      const targetPrimaryVisible = !sidebarCollapsed

      if (
        next.visibility.auxiliaryPanel !== targetAuxVisible ||
        next.visibility.bottomPanel !== targetBottomVisible ||
        next.visibility.primarySidebar !== targetPrimaryVisible
      ) {
        next = {
          ...next,
          visibility: {
            ...next.visibility,
            auxiliaryPanel: targetAuxVisible,
            bottomPanel: targetBottomVisible,
            primarySidebar: targetPrimaryVisible,
            mainContent: true,
          },
        }
      } else if (next.visibility.mainContent !== true) {
        next = {
          ...next,
          visibility: { ...next.visibility, mainContent: true },
        }
      }

      return next
    })
  }, [
    workbenchPanelState.rightFullWidth,
    rightDockVisible,
    bottomPanelState.open,
    sidebarCollapsed,
    workbenchLayoutState,
  ])

  useEffect(() => {
    if (workspaceSize.width <= 0 || workspaceSize.height <= 0) return

    setWorkbenchLayoutState(current => {
      if (current == null) return current
      let next = current
      if (responsiveRightDockWidth !== next.auxiliaryPanelWidth) {
        next = applyWorkbenchLayoutAction(next, {
          type: 'commitAuxiliaryPanelSize',
          size: responsiveRightDockWidth,
          workspaceWidth: workspaceSize.width,
        })
      }
      if (responsiveBottomPanelHeight !== next.bottomPanelHeight) {
        next = applyWorkbenchLayoutAction(next, {
          type: 'commitBottomPanelSize',
          size: responsiveBottomPanelHeight,
          workspaceHeight: workspaceSize.height,
        })
      }
      return next
    })
  }, [
    workspaceSize.width,
    workspaceSize.height,
    responsiveRightDockWidth,
    responsiveBottomPanelHeight,
  ])

  useEffect(() => {
    if (workbenchLayoutState == null) return
    void import('./workbenchLayoutStorage.js').then(module => {
      module.saveWorkbenchLayoutSnapshot(
        {
          schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
          visibility: workbenchLayoutState.visibility,
          primarySidebarWidth: workbenchLayoutState.primarySidebarWidth,
          auxiliaryPanelWidth: workbenchLayoutState.auxiliaryPanelWidth,
          bottomPanelHeight: workbenchLayoutState.bottomPanelHeight,
          auxiliaryMaximized: workbenchLayoutState.auxiliaryMaximized,
          beforeAuxiliaryMaximized: workbenchLayoutState.beforeAuxiliaryMaximized,
          beforeAuxiliaryMaximizedAuxiliaryWidth:
            workbenchLayoutState.beforeAuxiliaryMaximizedAuxiliaryWidth,
        },
        { storage: window.localStorage },
      )
    })
  }, [workbenchLayoutState])

  return {
    sidebarCollapsed,
    sidebarWidth: workbenchLayoutState?.primarySidebarWidth ?? sidebarWidth,
    setSidebarWidth,
    toggleSidebarCollapsed,
    collapseSidebar,
    sidebarShell,
    sidebarMinWidth: SIDEBAR_MIN_WIDTH,
    sidebarMaxWidth: SIDEBAR_MAX_WIDTH,
    workbenchPanelState,
    setWorkbenchPanelState,
    rightDockState,
    bottomPanelState,
    bottomPanelVisible:
      workbenchLayoutState?.visibility.bottomPanel ?? bottomPanelState.open,
    workspaceRef,
    workspaceWidth: workspaceSize.width,
    rightDockVisible,
    rightDockMinWidth: RIGHT_DOCK_MIN_WIDTH,
    rightDockMaxWidth,
    rightDockWidth:
      workbenchLayoutState?.auxiliaryPanelWidth ?? responsiveRightDockWidth,
    bottomPanelMinHeight: BOTTOM_PANEL_MIN_HEIGHT,
    bottomPanelMaxHeight,
    bottomPanelHeight:
      workbenchLayoutState?.bottomPanelHeight ?? responsiveBottomPanelHeight,
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
    workbenchLayoutState,
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
