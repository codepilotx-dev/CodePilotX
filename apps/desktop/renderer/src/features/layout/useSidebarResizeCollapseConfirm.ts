import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_COLLAPSE_HOLD_MS = 600
export const SIDEBAR_COLLAPSE_TARGET_SIZE = 72
export const SIDEBAR_COLLAPSE_JITTER_TOLERANCE = 6

export type ResizePhase = 'idle' | 'dragging' | 'settling'

export type ResizeCollapseBehavior =
  | { kind: 'hold-target' }
  | { kind: 'threshold'; threshold: number }

export const DEFAULT_RESIZE_COLLAPSE_BEHAVIOR = {
  kind: 'hold-target',
} as const satisfies ResizeCollapseBehavior

export type SidebarCollapseConfirmTarget = {
  x: number
  y: number
}

type ResizeStart = {
  x: number
  width: number
}

type ComputeSidebarResizeCollapseConfirmInput = {
  rawWidth: number
  minWidth: number
  pointerX: number
  pointerY: number
  previousTarget: SidebarCollapseConfirmTarget | null
  jitterTolerance: number
}

type ComputeSidebarResizeCollapseConfirmResult = {
  width: number
  armed: boolean
  restartHold: boolean
  target: SidebarCollapseConfirmTarget | null
}

type ShouldRestartSidebarCollapseHoldInput = {
  previousTarget: SidebarCollapseConfirmTarget | null
  pointerX: number
  pointerY: number
  jitterTolerance: number
}

type UseSidebarResizeCollapseConfirmInput = {
  collapsed: boolean
  maxWidth: number
  minWidth: number
  width: number
  onCollapse: () => void
  collapseEnabled?: boolean
  onResetSize?: () => void
  onResizePhaseChange?: (phase: ResizePhase) => void
  onResizePreview?: (width: number | null) => void
  onSetWidth: (width: number) => void
  collapseBehavior?: ResizeCollapseBehavior
  /** `'left'` (default): drag right edge to resize, pointer right = wider.
   *  `'right'`: drag left edge to resize, pointer left = wider.
   *  `'bottom'`: drag top edge to resize, pointer up = taller. */
  direction?: 'left' | 'right' | 'bottom'
}

export type UseSidebarResizeCollapseConfirmResult = {
  collapseConfirmTarget: SidebarCollapseConfirmTarget | null
  collapseConfirmKey: number
  resizing: boolean
  handleLostPointerCapture: (
    event: React.PointerEvent<HTMLDivElement>,
  ) => void
  handlePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  handleResizeKey: (event: React.KeyboardEvent<HTMLDivElement>) => void
  startResize: (event: React.PointerEvent<HTMLDivElement>) => void
}

export function shouldRestartSidebarCollapseHold({
  previousTarget,
  pointerX,
  pointerY,
  jitterTolerance,
}: ShouldRestartSidebarCollapseHoldInput): boolean {
  if (!previousTarget) return true
  return (
    Math.hypot(previousTarget.x - pointerX, previousTarget.y - pointerY) >
    jitterTolerance
  )
}

export function computeSidebarResizeCollapseConfirm({
  rawWidth,
  minWidth,
  pointerX,
  pointerY,
  previousTarget,
  jitterTolerance,
}: ComputeSidebarResizeCollapseConfirmInput): ComputeSidebarResizeCollapseConfirmResult {
  if (rawWidth > minWidth) {
    return {
      width: rawWidth,
      armed: false,
      restartHold: false,
      target: null,
    }
  }

  const restartHold = shouldRestartSidebarCollapseHold({
    previousTarget,
    pointerX,
    pointerY,
    jitterTolerance,
  })

  return {
    width: minWidth,
    armed: true,
    restartHold,
    target: restartHold ? { x: pointerX, y: pointerY } : previousTarget,
  }
}

export function shouldCollapseSidebarResize(
  rawWidth: number,
  collapseBehavior: ResizeCollapseBehavior,
): boolean {
  return collapseBehavior.kind === 'threshold'
    && rawWidth < collapseBehavior.threshold
}

export function useSidebarResizeCollapseConfirm({
  collapsed,
  maxWidth,
  minWidth,
  width,
  onCollapse,
  collapseEnabled = true,
  onResetSize,
  onResizePhaseChange,
  onResizePreview,
  onSetWidth,
  collapseBehavior = DEFAULT_RESIZE_COLLAPSE_BEHAVIOR,
  direction = 'left',
}: UseSidebarResizeCollapseConfirmInput): UseSidebarResizeCollapseConfirmResult {
  const [resizing, setResizing] = useState(false)
  const startRef = useRef<ResizeStart>({ x: 0, width })
  const [collapseConfirmTarget, setCollapseConfirmTarget] =
    useState<SidebarCollapseConfirmTarget | null>(null)
  const [collapseConfirmKey, setCollapseConfirmKey] = useState(0)
  const collapseConfirmTargetRef =
    useRef<SidebarCollapseConfirmTarget | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const pointerTargetRef = useRef<HTMLDivElement | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const previewWidthRef = useRef<number | null>(null)
  const settlementFrameRef = useRef<number | null>(null)
  const settlementPaintFrameRef = useRef<number | null>(null)
  const pendingCommitWidthRef = useRef<number | null>(null)
  const resizePhaseRef = useRef<ResizePhase>('idle')
  const onResizePhaseChangeRef = useRef(onResizePhaseChange)
  const onResizePreviewRef = useRef(onResizePreview)

  onResizePhaseChangeRef.current = onResizePhaseChange
  onResizePreviewRef.current = onResizePreview

  const setResizePhase = useCallback((phase: ResizePhase): void => {
    if (resizePhaseRef.current === phase) return
    resizePhaseRef.current = phase
    onResizePhaseChangeRef.current?.(phase)
  }, [])

  const clearHoldTimer = useCallback((): void => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearCollapseConfirm = useCallback((): void => {
    const hadTimer = holdTimerRef.current !== null
    const hadTarget = collapseConfirmTargetRef.current !== null
    if (!hadTimer && !hadTarget) return
    clearHoldTimer()
    collapseConfirmTargetRef.current = null
    if (hadTarget) setCollapseConfirmTarget(null)
  }, [clearHoldTimer])

  const clearSettlementFrames = useCallback((): void => {
    if (settlementFrameRef.current !== null) {
      window.cancelAnimationFrame(settlementFrameRef.current)
      settlementFrameRef.current = null
    }
    if (settlementPaintFrameRef.current !== null) {
      window.cancelAnimationFrame(settlementPaintFrameRef.current)
      settlementPaintFrameRef.current = null
    }
  }, [])

  const flushPreview = useCallback((): void => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    if (previewWidthRef.current !== null) {
      onResizePreviewRef.current?.(previewWidthRef.current)
    }
  }, [])

  const queuePreview = useCallback((nextWidth: number): void => {
    previewWidthRef.current = nextWidth
    if (!onResizePreviewRef.current || previewFrameRef.current !== null) return
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null
      if (previewWidthRef.current !== null) {
        onResizePreviewRef.current?.(previewWidthRef.current)
      }
    })
  }, [])

  const stopResize = useCallback((commit: boolean): void => {
    if (resizePhaseRef.current !== 'dragging') {
      if (!commit && resizePhaseRef.current === 'settling') {
        pendingCommitWidthRef.current = null
        clearSettlementFrames()
        onResizePreviewRef.current?.(null)
        setResizePhase('idle')
      }
      return
    }

    const finalWidth = previewWidthRef.current
    const pointerId = pointerIdRef.current
    const pointerTarget = pointerTargetRef.current
    pointerIdRef.current = null
    pointerTargetRef.current = null
    if (
      pointerId !== null &&
      pointerTarget?.hasPointerCapture(pointerId)
    ) {
      pointerTarget.releasePointerCapture(pointerId)
    }
    flushPreview()
    previewWidthRef.current = null
    setResizing(false)
    clearCollapseConfirm()
    document.body.classList.remove(
      'right-dock-is-resizing',
      'bottom-panel-is-resizing',
    )
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    if (!onResizePreviewRef.current) {
      setResizePhase('idle')
      return
    }

    if (!commit || finalWidth === null) {
      pendingCommitWidthRef.current = null
      onResizePreviewRef.current(null)
      setResizePhase('idle')
      return
    }

    setResizePhase('settling')
    pendingCommitWidthRef.current = finalWidth
    onSetWidth(finalWidth)
  }, [
    clearCollapseConfirm,
    clearSettlementFrames,
    flushPreview,
    onSetWidth,
    setResizePhase,
  ])

  useEffect(() => {
    const pendingWidth = pendingCommitWidthRef.current
    if (
      resizePhaseRef.current !== 'settling'
      || pendingWidth === null
      || Math.abs(width - pendingWidth) > 1
    ) {
      return
    }
    pendingCommitWidthRef.current = null
    clearSettlementFrames()
    settlementFrameRef.current = window.requestAnimationFrame(() => {
      settlementFrameRef.current = null
      settlementPaintFrameRef.current = window.requestAnimationFrame(() => {
        settlementPaintFrameRef.current = null
        onResizePreviewRef.current?.(null)
        setResizePhase('idle')
      })
    })
  }, [clearSettlementFrames, setResizePhase, width])

  const scheduleCollapseHold = useCallback((): void => {
    clearHoldTimer()
    setCollapseConfirmKey(current => current + 1)
    holdTimerRef.current = window.setTimeout(() => {
      stopResize(false)
      onCollapse()
    }, SIDEBAR_COLLAPSE_HOLD_MS)
  }, [clearHoldTimer, onCollapse, stopResize])

  const processPointerMove = useCallback(
    (pointerX: number, pointerY: number): void => {
      if (resizePhaseRef.current !== 'dragging') return
      const pointerPosition =
        direction === 'bottom' ? pointerY : pointerX
      const start = startRef.current
      const rawWidth =
        direction === 'left'
          ? start.width + pointerPosition - start.x
          : start.width + start.x - pointerPosition
      if (!collapseEnabled) {
        const nextWidth = Math.min(
          maxWidth,
          Math.max(minWidth, rawWidth),
        )
        if (onResizePreview) queuePreview(nextWidth)
        return
      }
      if (shouldCollapseSidebarResize(rawWidth, collapseBehavior)) {
        stopResize(false)
        onCollapse()
        return
      }
      if (collapseBehavior.kind === 'threshold') {
        const nextWidth = Math.min(
          maxWidth,
          Math.max(minWidth, rawWidth),
        )
        if (onResizePreview) queuePreview(nextWidth)
        else onSetWidth(nextWidth)
        clearCollapseConfirm()
        return
      }
      const result = computeSidebarResizeCollapseConfirm({
        rawWidth,
        minWidth,
        pointerX,
        pointerY,
        previousTarget: collapseConfirmTargetRef.current,
        jitterTolerance: SIDEBAR_COLLAPSE_JITTER_TOLERANCE,
      })

      const nextWidth = Math.min(maxWidth, result.width)
      if (onResizePreview) queuePreview(nextWidth)
      else onSetWidth(nextWidth)

      if (!result.armed) {
        clearCollapseConfirm()
        return
      }
      if (result.restartHold && result.target) {
        collapseConfirmTargetRef.current = result.target
        setCollapseConfirmTarget(result.target)
        scheduleCollapseHold()
      }
    },
    [
      clearCollapseConfirm,
      collapseBehavior,
      collapseEnabled,
      direction,
      maxWidth,
      minWidth,
      onCollapse,
      onResizePreview,
      onSetWidth,
      queuePreview,
      scheduleCollapseHold,
      stopResize,
    ],
  )

  useEffect(() => {
    if (!resizing) return

    const handleWindowBlur = (): void => stopResize(false)
    window.addEventListener('blur', handleWindowBlur)
    if (direction === 'bottom') {
      document.body.classList.add('bottom-panel-is-resizing')
    } else if (direction === 'right') {
      document.body.classList.add('right-dock-is-resizing')
    }
    document.body.style.cursor =
      direction === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('blur', handleWindowBlur)
      document.body.classList.remove(
        'right-dock-is-resizing',
        'bottom-panel-is-resizing',
      )
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      clearHoldTimer()
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
    }
  }, [
    clearHoldTimer,
    direction,
    resizing,
    stopResize,
  ])

  useEffect(() => {
    return () => {
      clearSettlementFrames()
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
      onResizePreviewRef.current?.(null)
      resizePhaseRef.current = 'idle'
    }
  }, [clearSettlementFrames])

  useEffect(() => {
    if (collapsed) {
      stopResize(false)
    }
  }, [collapsed, stopResize])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerIdRef.current = event.pointerId
    pointerTargetRef.current = event.currentTarget
    clearSettlementFrames()
    startRef.current = {
      x: direction === 'bottom' ? event.clientY : event.clientX,
      width,
    }
    previewWidthRef.current = width
    onResizePreview?.(width)
    setResizePhase('dragging')
    setResizing(true)
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (pointerIdRef.current !== event.pointerId) return
    processPointerMove(event.clientX, event.clientY)
  }

  function handlePointerUp(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (pointerIdRef.current !== event.pointerId) return
    stopResize(true)
  }

  function handlePointerCancel(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (pointerIdRef.current !== event.pointerId) return
    stopResize(false)
  }

  function handleLostPointerCapture(
    event: React.PointerEvent<HTMLDivElement>,
  ): void {
    if (pointerIdRef.current !== event.pointerId) return
    stopResize(false)
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return
    const step =
      direction === 'bottom'
        ? event.shiftKey
          ? 40
          : 10
        : event.shiftKey
          ? 32
          : 8
    const decreaseKey =
      direction === 'left' ? 'ArrowLeft' : direction === 'right'
        ? 'ArrowRight'
        : 'ArrowDown'
    const increaseKey =
      direction === 'left' ? 'ArrowRight' : direction === 'right'
        ? 'ArrowLeft'
        : 'ArrowUp'
    if (event.key === decreaseKey) {
      event.preventDefault()
      onSetWidth(Math.max(minWidth, width - step))
    } else if (event.key === increaseKey) {
      event.preventDefault()
      onSetWidth(Math.min(maxWidth, width + step))
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (onResetSize) onResetSize()
      else onSetWidth(minWidth)
    } else if (event.key === 'End') {
      event.preventDefault()
      onSetWidth(maxWidth)
    }
  }

  return {
    collapseConfirmTarget,
    collapseConfirmKey,
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerMove,
    handlePointerUp,
    handleResizeKey,
    resizing,
    startResize,
  }
}
