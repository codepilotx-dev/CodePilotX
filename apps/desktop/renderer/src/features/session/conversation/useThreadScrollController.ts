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

export function canReturnToThreadBottom(
  hasMeasuredBottom: boolean,
  isAtBottom: boolean,
): boolean {
  return hasMeasuredBottom && !isAtBottom
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

export function clampThreadScrollOffset(
  metrics: Pick<ScrollMetrics, 'scrollSize' | 'viewportSize'>,
  scrollOffset: number,
): number {
  return Math.min(
    Math.max(0, metrics.scrollSize - metrics.viewportSize),
    Math.max(0, scrollOffset),
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

export type SavedThreadScrollState = {
  distanceFromBottom: number
  mode: ThreadScrollMode
  scrollOffset: number
}

export const THREAD_SCROLL_STATE_CACHE_CAPACITY = 4
export const THREAD_SCROLL_STATE_CACHE_TTL_MS = 10 * 60 * 1_000

export type ThreadScrollStateCache = {
  clear(): void
  get(sessionKey: string): SavedThreadScrollState | null
  set(sessionKey: string, state: SavedThreadScrollState): void
  size(): number
}

export function createThreadScrollStateCache(options: {
  capacity?: number
  now?: () => number
  ttlMs?: number
} = {}): ThreadScrollStateCache {
  const capacity = Math.max(
    1,
    Math.floor(options.capacity ?? THREAD_SCROLL_STATE_CACHE_CAPACITY),
  )
  const now = options.now ?? Date.now
  const ttlMs = Math.max(0, options.ttlMs ?? THREAD_SCROLL_STATE_CACHE_TTL_MS)
  const entries = new Map<string, {
    lastAccessAt: number
    state: SavedThreadScrollState
  }>()

  function removeExpired(timestamp: number): void {
    for (const [sessionKey, entry] of entries) {
      if (timestamp - entry.lastAccessAt >= ttlMs) entries.delete(sessionKey)
    }
  }

  return {
    clear(): void {
      entries.clear()
    },
    get(sessionKey: string): SavedThreadScrollState | null {
      const timestamp = now()
      const entry = entries.get(sessionKey)
      if (!entry) {
        removeExpired(timestamp)
        return null
      }
      if (timestamp - entry.lastAccessAt >= ttlMs) {
        entries.delete(sessionKey)
        return null
      }
      entry.lastAccessAt = timestamp
      entries.delete(sessionKey)
      entries.set(sessionKey, entry)
      return entry.state
    },
    set(sessionKey: string, state: SavedThreadScrollState): void {
      const timestamp = now()
      removeExpired(timestamp)
      entries.delete(sessionKey)
      entries.set(sessionKey, { lastAccessAt: timestamp, state })
      while (entries.size > capacity) {
        const oldestSessionKey = entries.keys().next().value
        if (oldestSessionKey === undefined) break
        entries.delete(oldestSessionKey)
      }
    },
    size(): number {
      removeExpired(now())
      return entries.size
    },
  }
}

const savedThreadScrollStates = createThreadScrollStateCache()

type ThreadScrollController = {
  beginProgrammaticScroll: (smooth: boolean) => boolean
  bottomSentinelRef: (node: HTMLDivElement | null) => void
  handleScroll: (scrollTop: number) => void
  canReturnToBottom: boolean
  hasNewContent: boolean
  isAtBottom: boolean
  mode: ThreadScrollMode
  returnToBottom: () => void
}

export function isProgrammaticScrollActive(
  now: number,
  programmaticScrollUntil: number,
): boolean {
  return now <= programmaticScrollUntil
}

export function resolveThreadAtBottomDuringExplicitReturn({
  actualAtBottom,
  explicitReturnInProgress,
  now,
  programmaticScrollUntil,
}: {
  actualAtBottom: boolean
  explicitReturnInProgress: boolean
  now: number
  programmaticScrollUntil: number
}): boolean {
  return (
    actualAtBottom ||
    (explicitReturnInProgress &&
      isProgrammaticScrollActive(now, programmaticScrollUntil))
  )
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
  const [hasMeasuredBottom, setHasMeasuredBottom] = React.useState(false)
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
  const explicitReturnInProgressRef = React.useRef(false)
  const scrollFrameRef = React.useRef<number | null>(null)
  const sessionKeyRef = React.useRef(sessionKey)

  activeRef.current = active
  itemCountRef.current = itemCount

  const setMode = React.useCallback((nextMode: ThreadScrollMode): void => {
    modeRef.current = nextMode
    setModeState(nextMode)
  }, [])

  const updateAtBottom = React.useCallback((nextAtBottom: boolean): void => {
    setHasMeasuredBottom(true)
    atBottomRef.current = nextAtBottom
    setIsAtBottom((current) =>
      current === nextAtBottom ? current : nextAtBottom,
    )
  }, [])

  const resetBottomMeasurement = React.useCallback((): void => {
    atBottomRef.current = false
    setHasMeasuredBottom(false)
    setIsAtBottom(false)
  }, [])

  const beginProgrammaticScroll = React.useCallback(
    (smooth: boolean): boolean => {
      const useSmoothScroll = smooth && !reducedMotion
      programmaticScrollUntilRef.current =
        Date.now() + (useSmoothScroll ? 500 : 140)
      return useSmoothScroll
    },
    [reducedMotion],
  )

  const scrollToEnd = React.useCallback(
    (smooth: boolean, explicitReturn = false): void => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null
        const handle = listRef.current
        const viewport = scrollRef.current
        const metrics = readMetrics(handle, viewport)
        if (!handle || !metrics) {
          explicitReturnInProgressRef.current = false
          return
        }
        const target = Math.max(0, metrics.scrollSize - metrics.viewportSize)
        const useSmoothScroll = beginProgrammaticScroll(smooth)
        explicitReturnInProgressRef.current = explicitReturn
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
    [beginProgrammaticScroll, listRef, scrollRef, updateAtBottom],
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
      const actualAtBottom =
        distance <= THREAD_BOTTOM_THRESHOLD_PX ||
        intersectionAtBottomRef.current
      const atBottom = resolveThreadAtBottomDuringExplicitReturn({
        actualAtBottom,
        explicitReturnInProgress: explicitReturnInProgressRef.current,
        now: Date.now(),
        programmaticScrollUntil: programmaticScrollUntilRef.current,
      })
      if (actualAtBottom || !atBottom) {
        explicitReturnInProgressRef.current = false
      }
      const previousOffset = previousOffsetRef.current
      const userScrolledUp =
        scrollTop < previousOffset - 2 &&
        !isProgrammaticScrollActive(
          Date.now(),
          programmaticScrollUntilRef.current,
        )

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
    scrollToEnd(true, true)
  }, [applyDecision, scrollToEnd])

  React.useEffect(() => {
    sessionKeyRef.current = sessionKey
    const savedState = sessionKey
      ? savedThreadScrollStates.get(sessionKey)
      : null
    const restoredOffset = savedState?.scrollOffset ?? initialScrollOffset
    const preserveHistoricalPosition = savedState
      ? savedState.distanceFromBottom > THREAD_BOTTOM_THRESHOLD_PX
      : initialScrollOffset > 0

    setMode('static')
    setHasNewContent(false)
    explicitReturnInProgressRef.current = false
    intersectionAtBottomRef.current = false
    previousActiveRef.current = preserveHistoricalPosition
      ? activeRef.current
      : false
    const metrics = readMetrics(listRef.current, scrollRef.current)
    previousCountRef.current = itemCountRef.current
    previousOffsetRef.current = restoredOffset
    previousScrollSizeRef.current = metrics?.scrollSize ?? 0
    resetBottomMeasurement()

    if (restoredOffset > 0) {
      programmaticScrollUntilRef.current = Date.now() + 180
      const frame = requestAnimationFrame(() => {
        const currentMetrics = readMetrics(listRef.current, scrollRef.current)
        const targetOffset = currentMetrics
          ? clampThreadScrollOffset(currentMetrics, restoredOffset)
          : Math.max(0, restoredOffset)
        previousOffsetRef.current = targetOffset
        if (listRef.current) {
          listRef.current.scrollTo(targetOffset)
          return
        }
        if (scrollRef.current) scrollRef.current.scrollTop = targetOffset
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [
    initialScrollOffset,
    listRef,
    scrollRef,
    sessionKey,
    setMode,
    resetBottomMeasurement,
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
        const metrics = readMetrics(listRef.current, viewport)
        const actualAtBottom =
          visible ||
          (metrics !== null &&
            distanceFromThreadBottom(metrics) <= THREAD_BOTTOM_THRESHOLD_PX)
        const atBottom = resolveThreadAtBottomDuringExplicitReturn({
          actualAtBottom,
          explicitReturnInProgress: explicitReturnInProgressRef.current,
          now: Date.now(),
          programmaticScrollUntil: programmaticScrollUntilRef.current,
        })
        if (actualAtBottom || !atBottom) {
          explicitReturnInProgressRef.current = false
        }
        updateAtBottom(atBottom)
      },
      { root: viewport, threshold: 0.01 },
    )
    observer.observe(bottomSentinel)
    return () => {
      observer.disconnect()
      intersectionAtBottomRef.current = false
    }
  }, [bottomSentinel, listRef, scrollRef, sessionKey, updateAtBottom])

  React.useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current)
      }
    },
    [],
  )

  return {
    beginProgrammaticScroll,
    bottomSentinelRef: setBottomSentinel,
    canReturnToBottom: canReturnToThreadBottom(
      hasMeasuredBottom,
      isAtBottom,
    ),
    handleScroll,
    hasNewContent,
    isAtBottom,
    mode,
    returnToBottom,
  }
}
