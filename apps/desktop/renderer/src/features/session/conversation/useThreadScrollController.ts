import React from 'react'
import type { VirtualizerHandle } from 'virtua'

import { usePrefersReducedMotion } from '../../../hooks/usePrefersReducedMotion.js'

export const THREAD_BOTTOM_THRESHOLD_PX = 24
export const LATEST_TURN_PLACEMENT_THRESHOLD_PX = 300

export type ThreadScrollMode =
  | 'static'
  | 'prework_watch'
  | 'prework_follow'
  | 'user_follow'

type ScrollMetrics = {
  scrollOffset: number
  scrollSize: number
  viewportSize: number
}

type ScrollModeInput = {
  mode: ThreadScrollMode
  active: boolean
  atBottom: boolean
  userScrolledUp: boolean
  contentChanged: boolean
  explicitFollow?: boolean
}

export type ScrollModeDecision = {
  mode: ThreadScrollMode
  hasNewContent: boolean
}

export function distanceFromThreadBottom(metrics: ScrollMetrics): number {
  return Math.max(
    0,
    metrics.scrollSize - metrics.viewportSize - metrics.scrollOffset,
  )
}

export function scrollOffsetForThreadBottomDistance(
  metrics: Pick<ScrollMetrics, 'scrollSize' | 'viewportSize'>,
  distanceFromBottom: number,
): number {
  return Math.max(
    0,
    metrics.scrollSize - metrics.viewportSize - Math.max(0, distanceFromBottom),
  )
}

export function resolveThreadScrollMode({
  mode,
  active,
  atBottom,
  userScrolledUp,
  contentChanged,
  explicitFollow = false,
}: ScrollModeInput): ScrollModeDecision {
  if (!active) {
    return { mode: 'static', hasNewContent: false }
  }
  if (explicitFollow) {
    return { mode: 'user_follow', hasNewContent: false }
  }
  if (userScrolledUp && !atBottom) {
    return { mode: 'static', hasNewContent: contentChanged }
  }
  if (atBottom) {
    return {
      mode: mode === 'user_follow' ? 'user_follow' : 'prework_follow',
      hasNewContent: false,
    }
  }
  if (contentChanged && mode === 'static') {
    return { mode: 'static', hasNewContent: true }
  }
  return { mode, hasNewContent: false }
}

type UseThreadScrollControllerOptions = {
  active: boolean
  initialScrollOffset?: number
  itemCount: number
  listRef: React.RefObject<VirtualizerHandle | null>
  onScroll?: (scrollTop: number) => void
  scrollRef: React.RefObject<HTMLElement | null>
  sessionKey?: string
}

type SavedThreadScrollState = {
  distanceFromBottom: number
  mode: ThreadScrollMode
  scrollOffset: number
}

const savedThreadScrollStates = new Map<string, SavedThreadScrollState>()

type ThreadScrollController = {
  bottomSentinelRef: (node: HTMLDivElement | null) => void
  handleScroll: (scrollTop: number) => void
  hasNewContent: boolean
  isAtBottom: boolean
  mode: ThreadScrollMode
  returnToBottom: () => void
}

function readMetrics(
  handle: VirtualizerHandle | null,
  scrollElement?: HTMLElement | null,
): ScrollMetrics | null {
  if (scrollElement) {
    return {
      scrollOffset: scrollElement.scrollTop,
      scrollSize: scrollElement.scrollHeight,
      viewportSize: scrollElement.clientHeight,
    }
  }
  if (!handle) return null
  return {
    scrollOffset: handle.scrollOffset,
    scrollSize: handle.scrollSize,
    viewportSize: handle.viewportSize,
  }
}

export function useThreadScrollController({
  active,
  initialScrollOffset = 0,
  itemCount,
  listRef,
  onScroll,
  scrollRef,
  sessionKey,
}: UseThreadScrollControllerOptions): ThreadScrollController {
  const reducedMotion = usePrefersReducedMotion()
  const [mode, setModeState] = React.useState<ThreadScrollMode>('static')
  const [hasNewContent, setHasNewContent] = React.useState(false)
  const [isAtBottom, setIsAtBottom] = React.useState(false)
  const [bottomSentinel, setBottomSentinel] =
    React.useState<HTMLDivElement | null>(null)
  const modeRef = React.useRef<ThreadScrollMode>('static')
  const activeRef = React.useRef(active)
  const atBottomRef = React.useRef(false)
  const intersectionAtBottomRef = React.useRef(false)
  const previousActiveRef = React.useRef(active)
  const previousCountRef = React.useRef(itemCount)
  const itemCountRef = React.useRef(itemCount)
  const previousOffsetRef = React.useRef(0)
  const previousScrollSizeRef = React.useRef(0)
  const programmaticScrollUntilRef = React.useRef(0)
  const scrollFrameRef = React.useRef<number | null>(null)
  const sessionKeyRef = React.useRef(sessionKey)

  activeRef.current = active
  itemCountRef.current = itemCount

  const setMode = React.useCallback((nextMode: ThreadScrollMode): void => {
    modeRef.current = nextMode
    setModeState(nextMode)
  }, [])

  const updateAtBottom = React.useCallback((nextAtBottom: boolean): void => {
    atBottomRef.current = nextAtBottom
    setIsAtBottom((current) =>
      current === nextAtBottom ? current : nextAtBottom,
    )
  }, [])

  const scrollToEnd = React.useCallback(
    (smooth: boolean): void => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        const handle = listRef.current
        const viewport = scrollRef.current
        const metrics = readMetrics(handle, viewport)
        if (!handle || !metrics) return
        const target = Math.max(0, metrics.scrollSize - metrics.viewportSize)
        const useSmoothScroll = smooth && !reducedMotion
        programmaticScrollUntilRef.current =
          Date.now() + (useSmoothScroll ? 500 : 140)
        if (viewport) {
          viewport.scrollTo({
            top: target,
            behavior: useSmoothScroll ? 'smooth' : 'auto',
          })
        } else {
          handle.scrollTo(target)
        }
        updateAtBottom(true)
      })
    },
    [listRef, reducedMotion, scrollRef, updateAtBottom],
  )

  const applyDecision = React.useCallback(
    (decision: ScrollModeDecision): void => {
      setMode(decision.mode)
      setHasNewContent(decision.hasNewContent)
    },
    [setMode],
  )

  const handleScroll = React.useCallback(
    (scrollTop: number): void => {
      onScroll?.(scrollTop)
      const metrics = readMetrics(listRef.current, scrollRef.current)
      if (!metrics) return

      const distance = distanceFromThreadBottom({
        ...metrics,
        scrollOffset: scrollTop,
      })
      const atBottom =
        distance <= THREAD_BOTTOM_THRESHOLD_PX ||
        intersectionAtBottomRef.current
      const previousOffset = previousOffsetRef.current
      const userScrolledUp =
        scrollTop < previousOffset - 2 &&
        Date.now() > programmaticScrollUntilRef.current

      previousOffsetRef.current = scrollTop
      updateAtBottom(atBottom)
      const decision = resolveThreadScrollMode({
        mode: modeRef.current,
        active: activeRef.current,
        atBottom,
        userScrolledUp,
        contentChanged: userScrolledUp,
      })
      applyDecision(decision)
      const currentSessionKey = sessionKeyRef.current
      if (currentSessionKey) {
        savedThreadScrollStates.set(currentSessionKey, {
          distanceFromBottom: distance,
          mode: decision.mode,
          scrollOffset: scrollTop,
        })
      }
    },
    [applyDecision, listRef, onScroll, scrollRef, updateAtBottom],
  )

  const handleContentResize = React.useCallback((): void => {
    const metrics = readMetrics(listRef.current, scrollRef.current)
    if (!metrics) return
    const previousSize = previousScrollSizeRef.current
    previousScrollSizeRef.current = metrics.scrollSize
    if (previousSize === 0 || metrics.scrollSize <= previousSize + 0.5) return

    const shouldFollow =
      modeRef.current === 'prework_follow' ||
      modeRef.current === 'user_follow' ||
      (activeRef.current && atBottomRef.current)
    if (shouldFollow) {
      setHasNewContent(false)
      scrollToEnd(false)
      return
    }
    if (activeRef.current) {
      setHasNewContent(true)
    }
    const currentSessionKey = sessionKeyRef.current
    if (currentSessionKey) {
      savedThreadScrollStates.set(currentSessionKey, {
        distanceFromBottom: distanceFromThreadBottom(metrics),
        mode: modeRef.current,
        scrollOffset: metrics.scrollOffset,
      })
    }
  }, [listRef, scrollRef, scrollToEnd])

  const returnToBottom = React.useCallback((): void => {
    applyDecision(
      resolveThreadScrollMode({
        mode: modeRef.current,
        active: activeRef.current,
        atBottom: true,
        userScrolledUp: false,
        contentChanged: false,
        explicitFollow: true,
      }),
    )
    scrollToEnd(true)
  }, [applyDecision, scrollToEnd])

  React.useEffect(() => {
    sessionKeyRef.current = sessionKey
    const savedState = sessionKey
      ? savedThreadScrollStates.get(sessionKey)
      : undefined
    const restoredOffset = savedState?.scrollOffset ?? initialScrollOffset
    const preserveHistoricalPosition = savedState
      ? savedState.distanceFromBottom > THREAD_BOTTOM_THRESHOLD_PX
      : initialScrollOffset > 0

    setMode('static')
    setHasNewContent(false)
    intersectionAtBottomRef.current = false
    previousActiveRef.current = preserveHistoricalPosition
      ? activeRef.current
      : false
    const metrics = readMetrics(listRef.current, scrollRef.current)
    previousCountRef.current = itemCountRef.current
    previousOffsetRef.current = restoredOffset
    previousScrollSizeRef.current = metrics?.scrollSize ?? 0
    updateAtBottom(false)

    if (restoredOffset > 0) {
      programmaticScrollUntilRef.current = Date.now() + 180
      const frame = requestAnimationFrame(() => {
        if (listRef.current) {
          listRef.current.scrollTo(restoredOffset)
          return
        }
        if (scrollRef.current) scrollRef.current.scrollTop = restoredOffset
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [
    initialScrollOffset,
    listRef,
    scrollRef,
    sessionKey,
    setMode,
    updateAtBottom,
  ])

  React.useEffect(() => {
    const wasActive = previousActiveRef.current
    previousActiveRef.current = active
    if (!active) {
      setMode('static')
      setHasNewContent(false)
      return
    }
    if (wasActive) return

    setMode('prework_watch')
    const frame = requestAnimationFrame(() => {
      const handle = listRef.current
      const metrics = readMetrics(handle, scrollRef.current)
      if (!handle || !metrics) return
      const atBottom =
        distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX
      setMode('prework_follow')
      setHasNewContent(false)
      if (atBottom) {
        scrollToEnd(false)
        return
      }

      try {
        const latestTurnIndex = Math.max(0, itemCount - 1)
        const latestTurnDistance =
          handle.getItemOffset(latestTurnIndex) - metrics.scrollOffset
        programmaticScrollUntilRef.current = Date.now() + 180
        if (latestTurnDistance > LATEST_TURN_PLACEMENT_THRESHOLD_PX) {
          handle.scrollToIndex(latestTurnIndex, { align: 'start' })
          return
        }
      } catch {
        // The virtualizer can still be measuring the new row; bottom anchoring
        // is the safe fallback and the ResizeObserver will correct it again.
      }
      if (activeRef.current) {
        scrollToEnd(false)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [active, itemCount, listRef, scrollRef, scrollToEnd, sessionKey, setMode])

  React.useEffect(() => {
    if (itemCount <= previousCountRef.current) {
      previousCountRef.current = itemCount
      return
    }
    previousCountRef.current = itemCount
    if (
      modeRef.current === 'prework_follow' ||
      modeRef.current === 'user_follow'
    ) {
      scrollToEnd(false)
    } else if (activeRef.current) {
      setHasNewContent(true)
    }
  }, [itemCount, scrollToEnd])

  React.useEffect(() => {
    const content = scrollRef.current?.querySelector<HTMLElement>(
      '.session-timeline-virtualizer',
    )
    if (!content || typeof ResizeObserver === 'undefined') return
    const metrics = readMetrics(listRef.current, scrollRef.current)
    previousScrollSizeRef.current = metrics?.scrollSize ?? 0
    const observer = new ResizeObserver(handleContentResize)
    observer.observe(content)
    return () => observer.disconnect()
  }, [handleContentResize, itemCount, listRef, scrollRef, sessionKey])

  React.useEffect(() => {
    const viewport = scrollRef.current
    intersectionAtBottomRef.current = false
    if (
      !viewport ||
      !bottomSentinel ||
      typeof IntersectionObserver === 'undefined'
    ) {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting)
        intersectionAtBottomRef.current = visible
        if (visible) updateAtBottom(true)
      },
      { root: viewport, threshold: 0.01 },
    )
    observer.observe(bottomSentinel)
    return () => {
      observer.disconnect()
      intersectionAtBottomRef.current = false
    }
  }, [bottomSentinel, scrollRef, sessionKey, updateAtBottom])

  React.useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    [],
  )

  return {
    bottomSentinelRef: setBottomSentinel,
    handleScroll,
    hasNewContent,
    isAtBottom,
    mode,
    returnToBottom,
  }
}
