/**
 * SessionTimelineView — Virtual-scrolling container for session timeline.
 *
 * Wraps virtua's Virtualizer and handles scroll management, bottom anchoring,
 * and hash navigation. Row rendering is done by the parent via children,
 * avoiding circular import issues with ConversationPage's renderers.
 *
 * Layout follows opencode's turn/part spirit via data-* attributes
 * on the container.
 */

import React from 'react';
import { Virtualizer, type VirtualizerHandle } from 'virtua';

import { useThreadScrollController } from '../conversation/useThreadScrollController.js';

const TIMELINE_BOTTOM_SENTINEL = Symbol('timeline-bottom-sentinel');

/* ── Props ──────────────────────────────────────────────── */

export type SessionTimelineViewProps<T> = {
  /** Timeline rows; the virtualizer asks for React elements only near the viewport. */
  items: readonly T[];
  /** Lazily renders a row. Returned elements must have stable keys. */
  renderItem: (item: T, index: number) => React.ReactElement;
  /** Ref to the VirtualizerHandle for imperative scroll control. */
  listRef?: React.RefObject<VirtualizerHandle | null>;
  /** Commands used by overlays that navigate within the virtual timeline. */
  navigationRef?: React.Ref<ThreadTimelineNavigationHandle>;
  /** The single overflow element owned by ThreadScrollLayout. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Called when the user scrolls (for scroll-position persistence). */
  onScroll?: (scrollTop: number) => void;
  /** Reports whether the timeline has been measured away from the bottom. */
  onCanReturnToBottomChange?: (canReturnToBottom: boolean) => void;
  /** Persisted scroll offset to restore when mounting this session. */
  initialScrollOffset?: number;
  /**
   * If true, scroll to the end whenever the child count changes.
   * Used during streaming to keep the latest content visible.
   */
  scrollToBottom?: boolean;
  /** Number of children — used to detect additions for auto-scroll. */
  count: number;
  /** Stable session identity used to reset and restore per-session scroll state. */
  sessionKey?: string;
};

export type ThreadTimelineNavigationHandle = {
  revealTurn: (
    index: number,
    behavior: 'smooth' | 'instant',
  ) => boolean;
  returnToBottom: () => void;
};

/* ── Main component ─────────────────────────────────────── */

export function SessionTimelineView<T>({
  items,
  renderItem,
  listRef: externalListRef,
  navigationRef,
  scrollRef,
  onScroll,
  onCanReturnToBottomChange,
  initialScrollOffset,
  scrollToBottom,
  count,
  sessionKey,
}: SessionTimelineViewProps<T>): React.ReactNode {
  const internalListRef = React.useRef<VirtualizerHandle>(null);
  const listHandle = externalListRef ?? internalListRef;
  const virtualItems = React.useMemo(
    () => [...items, TIMELINE_BOTTOM_SENTINEL],
    [items],
  );
  const scrollController = useThreadScrollController({
    active: Boolean(scrollToBottom),
    initialScrollOffset,
    itemCount: count,
    listRef: listHandle,
    onScroll,
    scrollRef,
    sessionKey,
  });

  React.useImperativeHandle(
    navigationRef,
    () => ({
      revealTurn: (
        index: number,
        behavior: 'smooth' | 'instant',
      ): boolean => {
        const handle = listHandle.current;
        if (!handle) return false;
        const smooth = scrollController.beginProgrammaticScroll(
          behavior === 'smooth',
        );
        try {
          handle.scrollToIndex(index, { align: 'start', smooth });
          return true;
        } catch {
          return false;
        }
      },
      returnToBottom: scrollController.returnToBottom,
    }),
    [
      listHandle,
      scrollController.beginProgrammaticScroll,
      scrollController.returnToBottom,
    ],
  );

  React.useEffect(() => {
    onCanReturnToBottomChange?.(scrollController.canReturnToBottom);
  }, [onCanReturnToBottomChange, scrollController.canReturnToBottom]);

  React.useEffect(
    () => () => {
      onCanReturnToBottomChange?.(false);
    },
    [onCanReturnToBottomChange],
  );

  return (
    <div
      className="session-timeline-container tw:mx-auto tw:min-w-0"
      data-component="session-timeline"
      data-scroll-mode={scrollController.mode}
    >
      <div className="session-timeline-virtualizer">
        <Virtualizer
          data={virtualItems}
          key={sessionKey}
          ref={listHandle}
          scrollRef={scrollRef}
          onScroll={scrollController.handleScroll}
        >
          {(item, index) =>
            item === TIMELINE_BOTTOM_SENTINEL ? (
              <div
                ref={scrollController.bottomSentinelRef}
                aria-hidden="true"
                className="session-timeline-bottom-sentinel"
                key="timeline-bottom-sentinel"
              />
            ) : (
              renderItem(item as T, index)
            )
          }
        </Virtualizer>
      </div>
    </div>
  );
}

/* ── Scroll helpers ─────────────────────────────────────── */

/**
 * Imperative scroll to a given index.
 */
export function scrollToIndex(
  handle: VirtualizerHandle | null,
  index: number,
  align: 'start' | 'end' | 'center' = 'start',
): void {
  if (!handle) return;
  try {
    handle.scrollToIndex(index, { align });
  } catch {
    // Virtualizer may not be mounted yet
  }
}
