import * as React from "react";

export const THREAD_SUMMARY_PANEL_WIDTH = 272;
export const THREAD_SUMMARY_PANEL_GAP = 16;
export const THREAD_SUMMARY_READING_WIDTH = 640;
export const THREAD_SUMMARY_OVERLAY_MAX_WIDTH = 959;
export const THREAD_SUMMARY_SHIFT_MAX_WIDTH = 1535;
export const THREAD_SUMMARY_SHIFT_PX =
  -(THREAD_SUMMARY_PANEL_WIDTH + THREAD_SUMMARY_PANEL_GAP) / 2;

export type ThreadSummaryDisplayMode = "overlay" | "shift" | "gutter";

export type ThreadSummaryPreferenceState = {
  isPinned: boolean;
  isPopoverOpen: boolean;
};

export type ThreadSummaryState = ThreadSummaryPreferenceState & {
  displayMode: ThreadSummaryDisplayMode;
  shouldShowInline: boolean;
  contentShift: number;
};

const DEFAULT_PREFERENCE: ThreadSummaryPreferenceState = {
  isPinned: true,
  isPopoverOpen: false,
};

let preferenceSnapshot = DEFAULT_PREFERENCE;
const preferenceListeners = new Set<() => void>();

function publishPreference(next: ThreadSummaryPreferenceState): void {
  if (
    next.isPinned === preferenceSnapshot.isPinned &&
    next.isPopoverOpen === preferenceSnapshot.isPopoverOpen
  ) {
    return;
  }
  preferenceSnapshot = next;
  for (const listener of preferenceListeners) listener();
}

function subscribePreference(listener: () => void): () => void {
  preferenceListeners.add(listener);
  return () => preferenceListeners.delete(listener);
}

export function resolveThreadSummaryDisplayMode(
  containerWidth: number,
): ThreadSummaryDisplayMode {
  const width =
    Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 0;
  if (width <= THREAD_SUMMARY_OVERLAY_MAX_WIDTH) return "overlay";
  if (width <= THREAD_SUMMARY_SHIFT_MAX_WIDTH) return "shift";
  return "gutter";
}

export function deriveThreadSummaryState(
  containerWidth: number,
  preference: ThreadSummaryPreferenceState,
): ThreadSummaryState {
  const displayMode = resolveThreadSummaryDisplayMode(containerWidth);
  return {
    ...preference,
    displayMode,
    isPopoverOpen:
      displayMode === "overlay" ? preference.isPopoverOpen : false,
    shouldShowInline: preference.isPinned && displayMode !== "overlay",
    contentShift:
      preference.isPinned && displayMode === "shift"
        ? resolveThreadSummaryContentShift(containerWidth)
        : 0,
  };
}

export function resolveThreadSummaryContentShift(
  containerWidth: number,
): number {
  const centeredContentInset =
    (containerWidth - THREAD_SUMMARY_READING_WIDTH) / 2;
  const shiftForMinimumGap =
    centeredContentInset -
    (THREAD_SUMMARY_PANEL_WIDTH + THREAD_SUMMARY_PANEL_GAP * 2);
  return Math.min(
    0,
    Math.max(THREAD_SUMMARY_SHIFT_PX, shiftForMinimumGap),
  );
}

export function toggleThreadSummaryPreference(
  preference: ThreadSummaryPreferenceState,
  displayMode: ThreadSummaryDisplayMode,
): ThreadSummaryPreferenceState {
  if (displayMode === "overlay") {
    return {
      ...preference,
      isPopoverOpen: !preference.isPopoverOpen,
    };
  }
  return {
    isPinned: !preference.isPinned,
    isPopoverOpen: false,
  };
}

export function transitionThreadSummaryMode(
  preference: ThreadSummaryPreferenceState,
  previousMode: ThreadSummaryDisplayMode,
  nextMode: ThreadSummaryDisplayMode,
): ThreadSummaryPreferenceState {
  if (previousMode === "overlay" && nextMode !== "overlay") {
    return { ...preference, isPopoverOpen: false };
  }
  return preference;
}

export type ThreadSummaryController = ThreadSummaryState & {
  setPopoverOpen: (open: boolean) => void;
  toggle: () => void;
};

export function useThreadSummaryController(
  containerRef: React.RefObject<HTMLElement | null>,
): ThreadSummaryController {
  const preference = React.useSyncExternalStore(
    subscribePreference,
    () => preferenceSnapshot,
    () => DEFAULT_PREFERENCE,
  );
  const [containerWidth, setContainerWidth] = React.useState(0);
  const state = React.useMemo(
    () => deriveThreadSummaryState(containerWidth, preference),
    [containerWidth, preference],
  );
  const previousModeRef = React.useRef(state.displayMode);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = (width: number): void => {
      if (Number.isFinite(width)) setContainerWidth(Math.max(0, width));
    };
    updateWidth(container.getBoundingClientRect().width);

    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const width =
          entry.borderBoxSize?.[0]?.inlineSize ??
          entry.contentBoxSize?.[0]?.inlineSize ??
          entry.contentRect.width;
        updateWidth(width);
      });
      observer.observe(container);
    } catch {
      // The initial DOM measurement is a sufficient fallback.
    }
    return () => observer?.disconnect();
  }, [containerRef]);

  React.useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = state.displayMode;
    publishPreference(
      transitionThreadSummaryMode(
        preferenceSnapshot,
        previousMode,
        state.displayMode,
      ),
    );
  }, [state.displayMode]);

  const setPopoverOpen = React.useCallback(
    (open: boolean): void => {
      publishPreference({
        ...preferenceSnapshot,
        isPopoverOpen: state.displayMode === "overlay" && open,
      });
    },
    [state.displayMode],
  );

  const toggle = React.useCallback((): void => {
    publishPreference(
      toggleThreadSummaryPreference(preferenceSnapshot, state.displayMode),
    );
  }, [state.displayMode]);

  return {
    ...state,
    setPopoverOpen,
    toggle,
  };
}
