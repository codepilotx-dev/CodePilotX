import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_WIDTH_STORAGE_KEY = "layout.sidebarWidth";
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 500;
export const DEFAULT_SIDEBAR_WIDTH = 260;

export function clampSidebarWidth(value: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

export function readStoredSidebarWidth(): number {
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  if (!raw) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }
  return clampSidebarWidth(parsed);
}

export type UseDesktopLayoutResult = {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  viewportWidth: number;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarCollapsed: () => void;
};

export function useDesktopLayout(): UseDesktopLayoutResult {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidthState] = useState(() =>
    readStoredSidebarWidth(),
  );

  useEffect(() => {
    function handleResize(): void {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const setSidebarWidth = useCallback((nextWidth: number): void => {
    const clamped = clampSidebarWidth(nextWidth);
    setSidebarWidthState(clamped);
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
  }, []);

  const toggleSidebarCollapsed = useCallback((): void => {
    setSidebarCollapsed((current) => !current);
  }, []);

  return {
    sidebarCollapsed,
    sidebarWidth,
    viewportWidth,
    setSidebarCollapsed,
    setSidebarWidth,
    toggleSidebarCollapsed,
  };
}
