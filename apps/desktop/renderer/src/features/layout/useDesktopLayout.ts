import { useCallback, useEffect, useState } from "react";

export const SIDEBAR_WIDTH_STORAGE_KEY = "layout.sidebarWidth";
export const SIDEBAR_COLLAPSED_STORAGE_KEY = "layout.sidebarCollapsed";
export const SIDEBAR_MIN_WIDTH = 240;
export const SIDEBAR_MAX_WIDTH = 520;
export const DEFAULT_SIDEBAR_WIDTH = 275;

export function clampSidebarWidth(value: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  );
}

export function readStoredSidebarWidth(): number {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  } catch {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
  }
  if (!raw) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
  }
  return clampSidebarWidth(parsed);
}

export function readStoredSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
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
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() =>
    readStoredSidebarCollapsed(),
  );
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
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      /* localStorage full or disabled; keep the in-memory width. */
    }
  }, []);

  const setSidebarCollapsed = useCallback((collapsed: boolean): void => {
    setSidebarCollapsedState(collapsed);
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_STORAGE_KEY,
        collapsed ? "true" : "false",
      );
    } catch {
      /* localStorage full or disabled; keep the in-memory state. */
    }
  }, []);

  const toggleSidebarCollapsed = useCallback((): void => {
    setSidebarCollapsedState((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          SIDEBAR_COLLAPSED_STORAGE_KEY,
          next ? "true" : "false",
        );
      } catch {
        /* localStorage full or disabled; keep the in-memory state. */
      }
      return next;
    });
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
