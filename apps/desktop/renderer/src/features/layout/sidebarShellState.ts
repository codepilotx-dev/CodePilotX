import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

export const SIDEBAR_RESPONSIVE_BREAKPOINT = 720
export const SIDEBAR_EDGE_HIT_WIDTH = 12
export const SIDEBAR_TRIGGER_HOVER_DELAY = 100

export type SidebarShellMode = 'docked' | 'collapsed' | 'preview'

export type SidebarEscapeAction =
  | 'none'
  | 'settings-back'

export function resolveSidebarEscapeAction({
  defaultPrevented,
  isDialogOpen,
  isSettingsRoute,
  isTextEntry,
}: {
  defaultPrevented: boolean
  isDialogOpen: boolean
  isSettingsRoute: boolean
  isTextEntry: boolean
  mode: SidebarShellMode
}): SidebarEscapeAction {
  if (defaultPrevented) return 'none'
  if (!isSettingsRoute || isDialogOpen || isTextEntry) return 'none'
  return 'settings-back'
}

export function isSidebarNarrow(containerWidth: number): boolean {
  return containerWidth <= SIDEBAR_RESPONSIVE_BREAKPOINT
}

export function isSidebarEdgeHit(pointerX: number | null): boolean {
  return (
    pointerX !== null &&
    pointerX >= 0 &&
    pointerX <= SIDEBAR_EDGE_HIT_WIDTH
  )
}

export function isSidebarPanelHit(
  pointerX: number | null,
  sidebarWidth: number,
): boolean {
  return (
    pointerX !== null &&
    pointerX >= 0 &&
    pointerX <= sidebarWidth
  )
}

export function isSidebarTriggerHoverReady(elapsedMs: number): boolean {
  return elapsedMs >= SIDEBAR_TRIGGER_HOVER_DELAY
}

export function shouldShowSidebarPreview({
  delayedTriggerHover,
  pointerX,
  previewOpen,
  rearmBlocked,
  resizing,
  sidebarWidth,
}: {
  delayedTriggerHover: boolean
  pointerX: number | null
  previewOpen: boolean
  rearmBlocked: boolean
  resizing: boolean
  sidebarWidth: number
}): boolean {
  if (resizing) return true
  if (rearmBlocked) return false
  if (previewOpen) {
    return (
      isSidebarPanelHit(pointerX, sidebarWidth) ||
      delayedTriggerHover
    )
  }
  return isSidebarEdgeHit(pointerX) || delayedTriggerHover
}

export function deriveSidebarShellMode({
  desktopCollapsed,
  previewOpen,
  responsiveAutoHidden,
}: {
  desktopCollapsed: boolean
  previewOpen: boolean
  responsiveAutoHidden: boolean
}): SidebarShellMode {
  if (!desktopCollapsed && !responsiveAutoHidden) return 'docked'
  return previewOpen ? 'preview' : 'collapsed'
}

export type SidebarShellController = {
  appBodyRef: RefObject<HTMLDivElement | null>
  mode: SidebarShellMode
  onFloatingResizeChange: (resizing: boolean) => void
  onTriggerPointerEnter: () => void
  onTriggerPointerLeave: () => void
  toggle: () => void
}

type PointerHits = {
  edge: boolean
  panel: boolean
}

const EMPTY_POINTER_HITS: PointerHits = {
  edge: false,
  panel: false,
}

export function useSidebarShellController({
  desktopCollapsed,
  setDesktopCollapsed,
  sidebarWidth,
}: {
  desktopCollapsed: boolean
  setDesktopCollapsed: (collapsed: boolean) => void
  sidebarWidth: number
}): SidebarShellController {
  const appBodyRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth)
  const [responsiveAutoHidden, setResponsiveAutoHidden] = useState(
    () => isSidebarNarrow(window.innerWidth) && !desktopCollapsed,
  )
  const [previewOpen, setPreviewOpen] = useState(false)
  const [delayedTriggerHover, setDelayedTriggerHover] = useState(false)
  const [floatingResizing, setFloatingResizing] = useState(false)
  const [pointerHits, setPointerHits] =
    useState<PointerHits>(EMPTY_POINTER_HITS)
  const [rearmBlocked, setRearmBlocked] = useState(false)
  const triggerHoveredRef = useRef(false)
  const triggerTimerRef = useRef<number | null>(null)
  const pointerXRef = useRef<number | null>(null)
  const pointerHitsRef = useRef(pointerHits)
  const previewOpenRef = useRef(previewOpen)
  const rearmBlockedRef = useRef(rearmBlocked)
  const sidebarWidthRef = useRef(sidebarWidth)
  const narrowOverrideOpenRef = useRef(false)
  const previousNarrowRef = useRef(isSidebarNarrow(window.innerWidth))
  const narrow = isSidebarNarrow(containerWidth)
  const sidebarHidden = desktopCollapsed || responsiveAutoHidden
  const sidebarHiddenRef = useRef(sidebarHidden)
  const previousSidebarHiddenRef = useRef(sidebarHidden)

  pointerHitsRef.current = pointerHits
  previewOpenRef.current = previewOpen
  rearmBlockedRef.current = rearmBlocked
  sidebarWidthRef.current = sidebarWidth
  sidebarHiddenRef.current = sidebarHidden

  const mode = deriveSidebarShellMode({
    desktopCollapsed,
    previewOpen,
    responsiveAutoHidden,
  })

  const cancelTriggerTimer = useCallback((): void => {
    if (triggerTimerRef.current === null) return
    window.clearTimeout(triggerTimerRef.current)
    triggerTimerRef.current = null
  }, [])

  const updatePreviewOpen = useCallback((open: boolean): void => {
    previewOpenRef.current = open
    setPreviewOpen(open)
  }, [])

  const updateRearmBlocked = useCallback((blocked: boolean): void => {
    rearmBlockedRef.current = blocked
    setRearmBlocked(blocked)
  }, [])

  const updatePointerX = useCallback((pointerX: number | null): void => {
    pointerXRef.current = pointerX
    const next = {
      edge: isSidebarEdgeHit(pointerX),
      panel: isSidebarPanelHit(pointerX, sidebarWidthRef.current),
    }
    const current = pointerHitsRef.current
    if (
      current.edge === next.edge &&
      current.panel === next.panel
    ) {
      return
    }
    pointerHitsRef.current = next
    setPointerHits(next)
  }, [])

  useEffect(() => {
    const root = appBodyRef.current
    if (!root) return
    const update = (): void => setContainerWidth(root.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (previousNarrowRef.current === narrow) return
    previousNarrowRef.current = narrow
    if (narrow) {
      if (!desktopCollapsed && !narrowOverrideOpenRef.current) {
        setResponsiveAutoHidden(true)
      }
      return
    }
    narrowOverrideOpenRef.current = false
    setResponsiveAutoHidden(false)
  }, [desktopCollapsed, narrow])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      updatePointerX(event.clientX)
    }
    const onPointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) updatePointerX(null)
    }
    const clearPointer = (): void => updatePointerX(null)

    window.addEventListener('pointermove', onPointerMove, {
      capture: true,
      passive: true,
    })
    window.addEventListener('pointerout', onPointerOut, {
      capture: true,
      passive: true,
    })
    window.addEventListener('blur', clearPointer)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerout', onPointerOut, true)
      window.removeEventListener('blur', clearPointer)
    }
  }, [updatePointerX])

  useEffect(() => {
    updatePointerX(pointerXRef.current)
  }, [sidebarWidth, updatePointerX])

  useEffect(() => {
    const wasHidden = previousSidebarHiddenRef.current
    previousSidebarHiddenRef.current = sidebarHidden
    if (wasHidden || !sidebarHidden) return
    const hits = pointerHitsRef.current
    updateRearmBlocked(
      triggerHoveredRef.current || hits.edge || hits.panel,
    )
  }, [sidebarHidden, updateRearmBlocked])

  useEffect(() => {
    if (!sidebarHidden) {
      cancelTriggerTimer()
      setDelayedTriggerHover(false)
      updatePreviewOpen(false)
      if (rearmBlocked) updateRearmBlocked(false)
      return
    }

    if (rearmBlockedRef.current && !floatingResizing) {
      updatePreviewOpen(false)
      if (
        !triggerHoveredRef.current &&
        !pointerHits.edge &&
        !pointerHits.panel
      ) {
        updateRearmBlocked(false)
      }
      return
    }

    updatePreviewOpen(shouldShowSidebarPreview({
      delayedTriggerHover,
      pointerX: pointerXRef.current,
      previewOpen: previewOpenRef.current,
      rearmBlocked: rearmBlockedRef.current,
      resizing: floatingResizing,
      sidebarWidth,
    }))
  }, [
    cancelTriggerTimer,
    delayedTriggerHover,
    floatingResizing,
    pointerHits,
    rearmBlocked,
    sidebarHidden,
    sidebarWidth,
    updatePreviewOpen,
    updateRearmBlocked,
  ])

  useEffect(
    () => () => {
      cancelTriggerTimer()
    },
    [cancelTriggerTimer],
  )

  const onFloatingResizeChange = useCallback(
    (resizing: boolean): void => {
      setFloatingResizing(resizing)
      if (resizing) updatePreviewOpen(true)
    },
    [updatePreviewOpen],
  )

  const onTriggerPointerEnter = useCallback((): void => {
    triggerHoveredRef.current = true
    cancelTriggerTimer()
    if (!sidebarHiddenRef.current || rearmBlockedRef.current) return
    triggerTimerRef.current = window.setTimeout(() => {
      triggerTimerRef.current = null
      if (
        triggerHoveredRef.current &&
        sidebarHiddenRef.current &&
        !rearmBlockedRef.current
      ) {
        setDelayedTriggerHover(true)
      }
    }, SIDEBAR_TRIGGER_HOVER_DELAY)
  }, [cancelTriggerTimer])

  const onTriggerPointerLeave = useCallback((): void => {
    triggerHoveredRef.current = false
    cancelTriggerTimer()
    setDelayedTriggerHover(false)
  }, [cancelTriggerTimer])

  const toggle = useCallback((): void => {
    cancelTriggerTimer()
    setDelayedTriggerHover(false)

    if (sidebarHiddenRef.current) {
      narrowOverrideOpenRef.current = narrow
      setResponsiveAutoHidden(false)
      updateRearmBlocked(false)
      updatePreviewOpen(false)
      setDesktopCollapsed(false)
      return
    }

    const hits = pointerHitsRef.current
    updateRearmBlocked(
      triggerHoveredRef.current || hits.edge || hits.panel,
    )
    narrowOverrideOpenRef.current = false
    setResponsiveAutoHidden(false)
    updatePreviewOpen(false)
    setDesktopCollapsed(true)
  }, [
    cancelTriggerTimer,
    narrow,
    setDesktopCollapsed,
    updatePreviewOpen,
    updateRearmBlocked,
  ])

  return {
    appBodyRef,
    mode,
    onFloatingResizeChange,
    onTriggerPointerEnter,
    onTriggerPointerLeave,
    toggle,
  }
}
