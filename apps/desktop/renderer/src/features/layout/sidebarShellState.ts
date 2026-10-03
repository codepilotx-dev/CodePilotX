import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { SidebarPane } from './sidebar/sidebarNavigation.js'

export const SIDEBAR_RESPONSIVE_BREAKPOINT = 720
export const SIDEBAR_EDGE_HIT_WIDTH = 12
export const SIDEBAR_TRIGGER_HOVER_DELAY = 100

export type SidebarShellMode = 'docked' | 'collapsed' | 'preview'

export type SidebarEscapeAction = 'none' | 'settings-back'

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

export function isSidebarEdgeHit(pointerX: number | null, railWidth = 0): boolean {
  return (
    pointerX !== null && pointerX >= railWidth && pointerX <= railWidth + SIDEBAR_EDGE_HIT_WIDTH
  )
}

export function isSidebarPanelHit(
  pointerX: number | null,
  sidebarWidth: number,
  railWidth = 0,
): boolean {
  return pointerX !== null && pointerX >= railWidth && pointerX <= sidebarWidth
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
  railWidth = 0,
  sidebarHidden = true,
}: {
  delayedTriggerHover: boolean
  pointerX: number | null
  previewOpen: boolean
  rearmBlocked: boolean
  resizing: boolean
  sidebarWidth: number
  railWidth?: number
  sidebarHidden?: boolean
}): boolean {
  if (railWidth > 0 || !sidebarHidden) return false
  if (resizing) return previewOpen
  if (rearmBlocked) return false
  if (previewOpen) {
    return isSidebarPanelHit(pointerX, sidebarWidth, railWidth) || delayedTriggerHover
  }
  return isSidebarEdgeHit(pointerX, railWidth) || delayedTriggerHover
}

export function canShowSidebarTooltip(mode: SidebarShellMode, previewPending: boolean): boolean {
  return mode !== 'preview' && !previewPending
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
  pane: SidebarPane | null
  dockedVisible: boolean
  onFloatingResizeChange: (resizing: boolean) => void
  onTriggerPointerEnter: () => void
  onTriggerPointerLeave: () => void
  pin: () => void
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
  railWidth = 0,
  activePane,
}: {
  desktopCollapsed: boolean
  setDesktopCollapsed: (collapsed: boolean) => void
  sidebarWidth: number
  railWidth?: number
  activePane?: SidebarPane | null
}): SidebarShellController {
  const appBodyRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && isSidebarNarrow(window.innerWidth),
  )
  const observedNarrowRef = useRef(narrow)
  const [responsiveAutoHidden, setResponsiveAutoHidden] = useState(
    () => typeof window !== 'undefined' && isSidebarNarrow(window.innerWidth) && !desktopCollapsed,
  )
  const modern = railWidth > 0
  const paneAvailable = !modern || activePane != null
  const [previewOpen, setPreviewOpen] = useState(false)
  const [delayedTriggerHover, setDelayedTriggerHover] = useState(false)
  const [floatingResizing, setFloatingResizing] = useState(false)
  const [pointerHits, setPointerHits] = useState<PointerHits>(EMPTY_POINTER_HITS)
  const [rearmBlocked, setRearmBlocked] = useState(false)
  const triggerHoveredRef = useRef(false)
  const triggerTimerRef = useRef<number | null>(null)
  const pointerXRef = useRef<number | null>(null)
  const pointerHitsRef = useRef(pointerHits)
  const previewOpenRef = useRef(previewOpen)
  const rearmBlockedRef = useRef(rearmBlocked)
  const sidebarWidthRef = useRef(sidebarWidth)
  const narrowOverrideOpenRef = useRef(false)
  const previousNarrowRef = useRef(narrow)
  const sidebarHidden = desktopCollapsed || responsiveAutoHidden || !paneAvailable
  const sidebarHiddenRef = useRef(sidebarHidden)
  const previousSidebarHiddenRef = useRef(sidebarHidden)

  pointerHitsRef.current = pointerHits
  previewOpenRef.current = previewOpen
  rearmBlockedRef.current = rearmBlocked
  sidebarWidthRef.current = sidebarWidth
  sidebarHiddenRef.current = sidebarHidden

  const dockedVisible = !desktopCollapsed && !responsiveAutoHidden && paneAvailable
  const mode = deriveSidebarShellMode({
    desktopCollapsed: desktopCollapsed || !paneAvailable,
    previewOpen: !modern && previewOpen,
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

  const updatePointerX = useCallback(
    (pointerX: number | null): void => {
      pointerXRef.current = pointerX
      const next = {
        edge: isSidebarEdgeHit(pointerX, railWidth),
        panel: isSidebarPanelHit(pointerX, sidebarWidthRef.current, railWidth),
      }
      const current = pointerHitsRef.current
      if (current.edge === next.edge && current.panel === next.panel) {
        return
      }
      pointerHitsRef.current = next
      setPointerHits(next)
    },
    [railWidth],
  )

  useEffect(() => {
    const root = appBodyRef.current
    if (!root) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0) return
      const nextNarrow = isSidebarNarrow(entry.contentRect.width)
      if (nextNarrow === observedNarrowRef.current) return
      observedNarrowRef.current = nextNarrow
      setNarrow(nextNarrow)
    })
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
    if (modern) {
      updatePointerX(null)
      return
    }
    const onPointerMove = (event: PointerEvent): void => updatePointerX(event.clientX)
    const onPointerOut = (event: PointerEvent): void => {
      if (event.relatedTarget === null) updatePointerX(null)
    }
    const clearPointer = (): void => updatePointerX(null)
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
    window.addEventListener('pointerout', onPointerOut, { capture: true, passive: true })
    window.addEventListener('blur', clearPointer)
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerout', onPointerOut, true)
      window.removeEventListener('blur', clearPointer)
    }
  }, [modern, updatePointerX])

  useEffect(() => {
    updatePointerX(pointerXRef.current)
  }, [sidebarWidth, railWidth, updatePointerX])

  useEffect(() => {
    const wasHidden = previousSidebarHiddenRef.current
    previousSidebarHiddenRef.current = sidebarHidden
    if (wasHidden || !sidebarHidden) return
    const hits = pointerHitsRef.current
    updateRearmBlocked(triggerHoveredRef.current || hits.edge || hits.panel)
  }, [sidebarHidden, updateRearmBlocked])

  useEffect(() => {
    if (modern || !sidebarHidden) {
      cancelTriggerTimer()
      setDelayedTriggerHover(false)
      updatePreviewOpen(false)
      if (rearmBlocked) updateRearmBlocked(false)
      return
    }
    if (rearmBlockedRef.current && !floatingResizing) {
      updatePreviewOpen(false)
      if (!triggerHoveredRef.current) {
        updateRearmBlocked(false)
      }
      return
    }

    updatePreviewOpen(
      shouldShowSidebarPreview({
        delayedTriggerHover,
        pointerX: pointerXRef.current,
        previewOpen: previewOpenRef.current,
        rearmBlocked: rearmBlockedRef.current,
        resizing: floatingResizing,
        sidebarWidth,
        railWidth,
        sidebarHidden,
      }),
    )
  }, [
    cancelTriggerTimer,
    delayedTriggerHover,
    floatingResizing,
    modern,
    railWidth,
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
      if (resizing && previewOpenRef.current) updatePreviewOpen(true)
    },
    [updatePreviewOpen],
  )

  const onTriggerPointerEnter = useCallback((): void => {
    if (modern) return
    triggerHoveredRef.current = true
    cancelTriggerTimer()
    if (!sidebarHiddenRef.current || rearmBlockedRef.current) return
    triggerTimerRef.current = window.setTimeout(() => {
      triggerTimerRef.current = null
      if (triggerHoveredRef.current && sidebarHiddenRef.current && !rearmBlockedRef.current) {
        setDelayedTriggerHover(true)
      }
    }, SIDEBAR_TRIGGER_HOVER_DELAY)
  }, [cancelTriggerTimer, modern])

  useEffect(() => {
    cancelTriggerTimer()
    updatePreviewOpen(false)
  }, [activePane, modern, cancelTriggerTimer, updatePreviewOpen])

  const onTriggerPointerLeave = useCallback((): void => {
    triggerHoveredRef.current = false
    cancelTriggerTimer()
    setDelayedTriggerHover(false)
    updateRearmBlocked(false)
  }, [cancelTriggerTimer, updateRearmBlocked])

  const pin = useCallback((): void => {
    cancelTriggerTimer()
    setDelayedTriggerHover(false)
    narrowOverrideOpenRef.current = narrow
    setResponsiveAutoHidden(false)
    updateRearmBlocked(false)
    updatePreviewOpen(false)
    setDesktopCollapsed(false)
  }, [cancelTriggerTimer, narrow, setDesktopCollapsed, updatePreviewOpen, updateRearmBlocked])

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
    updateRearmBlocked(triggerHoveredRef.current || hits.edge || hits.panel)
    narrowOverrideOpenRef.current = false
    setResponsiveAutoHidden(false)
    updatePreviewOpen(false)
    setDesktopCollapsed(true)
  }, [cancelTriggerTimer, narrow, setDesktopCollapsed, updatePreviewOpen, updateRearmBlocked])

  return {
    appBodyRef,
    mode,
    pane: activePane ?? null,
    dockedVisible,
    onFloatingResizeChange,
    onTriggerPointerEnter,
    onTriggerPointerLeave,
    pin,
    toggle,
  }
}
