import { useCallback, useEffect, useState } from 'react'

export const SIDEBAR_WIDTH_STORAGE_KEY = 'layout.sidebarWidth'
export const SIDEBAR_MIN_RATIO = 0.12
export const SIDEBAR_MAX_RATIO = 0.2
export const DEFAULT_SIDEBAR_WIDTH = 250

export function clampSidebarWidth(value: number, viewportWidth: number): number {
  const min = Math.round(viewportWidth * SIDEBAR_MIN_RATIO)
  const max = Math.round(viewportWidth * SIDEBAR_MAX_RATIO)
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function readStoredSidebarWidth(viewportWidth: number): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  if (!raw) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth)
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth)
  }
  return clampSidebarWidth(parsed, viewportWidth)
}

export type UseDesktopLayoutResult = {
  sidebarCollapsed: boolean
  sidebarWidth: number
  viewportWidth: number
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void
  toggleSidebarCollapsed: () => void
}

export function useDesktopLayout(): UseDesktopLayoutResult {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    window.matchMedia('(max-width: 900px)').matches,
  )
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    readStoredSidebarWidth(window.innerWidth),
  )

  useEffect(() => {
    function handleResize(): void {
      const nextViewportWidth = window.innerWidth
      setViewportWidth(nextViewportWidth)
      setSidebarWidthState(current =>
        clampSidebarWidth(current, nextViewportWidth),
      )
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const setSidebarWidth = useCallback(
    (nextWidth: number): void => {
      const clamped = clampSidebarWidth(nextWidth, viewportWidth)
      setSidebarWidthState(clamped)
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped))
    },
    [viewportWidth],
  )

  const toggleSidebarCollapsed = useCallback((): void => {
    setSidebarCollapsed(current => !current)
  }, [])

  return {
    sidebarCollapsed,
    sidebarWidth,
    viewportWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  }
}
