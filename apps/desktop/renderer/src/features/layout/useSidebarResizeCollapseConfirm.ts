import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export const SIDEBAR_COLLAPSE_HOLD_MS = 600
export const SIDEBAR_COLLAPSE_TARGET_SIZE = 72
export const SIDEBAR_COLLAPSE_JITTER_TOLERANCE = 6

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
  onResizePreview?: (width: number) => void
  onSetWidth: (width: number) => void
  /** `'left'` (default): drag right edge to resize, pointer right = wider.
   *  `'right'`: drag left edge to resize, pointer left = wider.
   *  `'bottom'`: drag top edge to resize, pointer up = taller. */
  direction?: 'left' | 'right' | 'bottom'
}

export type UseSidebarResizeCollapseConfirmResult = {
  collapseConfirmTarget: SidebarCollapseConfirmTarget | null
  collapseConfirmKey: number
  resizing: boolean
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

export function useSidebarResizeCollapseConfirm({
  collapsed,
  maxWidth,
  minWidth,
  width,
  onCollapse,
  collapseEnabled = true,
  onResetSize,
  onResizePreview,
  onSetWidth,
  direction = 'left',
}: UseSidebarResizeCollapseConfirmInput): UseSidebarResizeCollapseConfirmResult {
  const [resizing, setResizing] = useState(false)
  const [start, setStart] = useState<ResizeStart>({ x: 0, width })
  const [collapseConfirmTarget, setCollapseConfirmTarget] =
    useState<SidebarCollapseConfirmTarget | null>(null)
  const [collapseConfirmKey, setCollapseConfirmKey] = useState(0)
  const collapseConfirmTargetRef =
    useRef<SidebarCollapseConfirmTarget | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const previewFrameRef = useRef<number | null>(null)
  const previewWidthRef = useRef<number | null>(null)

  const clearHoldTimer = useCallback((): void => {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  const clearCollapseConfirm = useCallback((): void => {
    clearHoldTimer()
    collapseConfirmTargetRef.current = null
    setCollapseConfirmTarget(null)
  }, [clearHoldTimer])

  const flushPreview = useCallback((): void => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current)
      previewFrameRef.current = null
    }
    if (previewWidthRef.current !== null) {
      onResizePreview?.(previewWidthRef.current)
    }
  }, [onResizePreview])

  const queuePreview = useCallback((nextWidth: number): void => {
    previewWidthRef.current = nextWidth
    if (!onResizePreview || previewFrameRef.current !== null) return
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null
      if (previewWidthRef.current !== null) {
        onResizePreview(previewWidthRef.current)
      }
    })
  }, [onResizePreview])

  const stopResize = useCallback((commit: boolean): void => {
    const finalWidth = previewWidthRef.current
    flushPreview()
    previewWidthRef.current = null
    setResizing(false)
    clearCollapseConfirm()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (onResizePreview) {
      if (commit && finalWidth !== null) onSetWidth(finalWidth)
      if (!commit) onResizePreview(width)
    }
  }, [
    clearCollapseConfirm,
    flushPreview,
    onResizePreview,
    onSetWidth,
    width,
  ])

  const scheduleCollapseHold = useCallback((): void => {
    clearHoldTimer()
    setCollapseConfirmKey(current => current + 1)
    holdTimerRef.current = window.setTimeout(() => {
      stopResize(false)
      onCollapse()
    }, SIDEBAR_COLLAPSE_HOLD_MS)
  }, [clearHoldTimer, onCollapse, stopResize])

  useEffect(() => {
    if (!resizing) return

    function handlePointerMove(event: PointerEvent): void {
      const pointerPosition =
        direction === 'bottom' ? event.clientY : event.clientX
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
      const result = computeSidebarResizeCollapseConfirm({
        rawWidth,
        minWidth,
        pointerX: event.clientX,
        pointerY: event.clientY,
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
    }

    document.addEventListener('pointermove', handlePointerMove)
    const handlePointerUp = (): void => stopResize(true)
    const handlePointerCancel = (): void => stopResize(false)
    const handleWindowBlur = (): void => stopResize(false)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('blur', handleWindowBlur)
    if (direction === 'bottom') {
      document.body.classList.add('bottom-panel-is-resizing')
    }
    document.body.style.cursor =
      direction === 'bottom' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('blur', handleWindowBlur)
      document.body.classList.remove('bottom-panel-is-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      clearHoldTimer()
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current)
        previewFrameRef.current = null
      }
    }
  }, [
    clearCollapseConfirm,
    clearHoldTimer,
    collapseEnabled,
    direction,
    minWidth,
    maxWidth,
    onResizePreview,
    onSetWidth,
    queuePreview,
    resizing,
    scheduleCollapseHold,
    start.width,
    start.x,
    stopResize,
  ])

  useEffect(() => {
    if (collapsed) {
      stopResize(false)
    }
  }, [collapsed, stopResize])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed || event.button !== 0) return
    event.preventDefault()
    setStart({
      x: direction === 'bottom' ? event.clientY : event.clientX,
      width,
    })
    previewWidthRef.current = width
    setResizing(true)
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
      onSetWidth(width - step)
    } else if (event.key === increaseKey) {
      event.preventDefault()
      onSetWidth(width + step)
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
    resizing,
    handleResizeKey,
    startResize,
  }
}
