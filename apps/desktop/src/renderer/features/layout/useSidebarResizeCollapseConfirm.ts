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
  onSetWidth: (width: number) => void
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
  onSetWidth,
}: UseSidebarResizeCollapseConfirmInput): UseSidebarResizeCollapseConfirmResult {
  const [resizing, setResizing] = useState(false)
  const [start, setStart] = useState<ResizeStart>({ x: 0, width })
  const [collapseConfirmTarget, setCollapseConfirmTarget] =
    useState<SidebarCollapseConfirmTarget | null>(null)
  const [collapseConfirmKey, setCollapseConfirmKey] = useState(0)
  const collapseConfirmTargetRef =
    useRef<SidebarCollapseConfirmTarget | null>(null)
  const holdTimerRef = useRef<number | null>(null)

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

  const stopResize = useCallback((): void => {
    setResizing(false)
    clearCollapseConfirm()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [clearCollapseConfirm])

  const scheduleCollapseHold = useCallback((): void => {
    clearHoldTimer()
    setCollapseConfirmKey(current => current + 1)
    holdTimerRef.current = window.setTimeout(() => {
      stopResize()
      onCollapse()
    }, SIDEBAR_COLLAPSE_HOLD_MS)
  }, [clearHoldTimer, onCollapse, stopResize])

  useEffect(() => {
    if (!resizing) return

    function handlePointerMove(event: PointerEvent): void {
      const rawWidth = start.width + event.clientX - start.x
      const result = computeSidebarResizeCollapseConfirm({
        rawWidth,
        minWidth,
        pointerX: event.clientX,
        pointerY: event.clientY,
        previousTarget: collapseConfirmTargetRef.current,
        jitterTolerance: SIDEBAR_COLLAPSE_JITTER_TOLERANCE,
      })

      onSetWidth(result.width)

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
    document.addEventListener('pointerup', stopResize)
    document.addEventListener('pointercancel', stopResize)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', stopResize)
      document.removeEventListener('pointercancel', stopResize)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      clearHoldTimer()
    }
  }, [
    clearCollapseConfirm,
    clearHoldTimer,
    minWidth,
    onSetWidth,
    resizing,
    scheduleCollapseHold,
    start.width,
    start.x,
    stopResize,
  ])

  useEffect(() => {
    if (collapsed) {
      stopResize()
    }
  }, [collapsed, stopResize])

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed) return
    event.preventDefault()
    setStart({ x: event.clientX, width })
    setResizing(true)
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return
    const step = event.shiftKey ? 32 : 8
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onSetWidth(width - step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onSetWidth(width + step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      onSetWidth(minWidth)
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
