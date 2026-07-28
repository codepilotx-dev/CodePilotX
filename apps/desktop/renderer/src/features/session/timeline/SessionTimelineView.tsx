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
import { ArrowDown } from 'lucide-react';
import { Virtualizer, type VirtualizerHandle } from 'virtua';

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js';
import { useThreadScrollController } from '../conversation/useThreadScrollController.js';

/* ── Props ──────────────────────────────────────────────── */

export type SessionTimelineViewProps = {
  /** Rendered row elements. Each must have a stable `key` prop. */
  children: React.ReactNode;
  /** Ref to the VirtualizerHandle for imperative scroll control. */
  listRef?: React.RefObject<VirtualizerHandle | null>;
  /** Commands used by overlays that navigate within the virtual timeline. */
  navigationRef?: React.Ref<ThreadTimelineNavigationHandle>;
  /** The single overflow element owned by ThreadScrollLayout. */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** Called when the user scrolls (for scroll-position persistence). */
  onScroll?: (scrollTop: number) => void;
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
};

/* ── Main component ─────────────────────────────────────── */

export function SessionTimelineView({
  children,
  listRef: externalListRef,
  navigationRef,
  scrollRef,
  onScroll,
  initialScrollOffset,
  scrollToBottom,
  count,
  sessionKey,
}: SessionTimelineViewProps): React.ReactNode {
  const internalListRef = React.useRef<VirtualizerHandle>(null);
  const listHandle = externalListRef ?? internalListRef;
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
    }),
    [listHandle, scrollController.beginProgrammaticScroll],
  );

  return (
    <div
      className="session-timeline-container tw:mx-auto tw:min-w-0"
      data-component="session-timeline"
      data-scroll-mode={scrollController.mode}
    >
      {scrollController.mode === 'static' &&
      !scrollController.isAtBottom &&
      Boolean(scrollToBottom) ? (
        <div className="session-timeline-floating-controls">
          <button
            type="button"
            className="session-timeline-return-button"
            onClick={scrollController.returnToBottom}
            aria-label={
              scrollController.hasNewContent
                ? '回到底部，有新内容'
                : '回到底部'
            }
          >
            <ArrowDown
              aria-hidden="true"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span>
              回到底部{scrollController.hasNewContent ? ' · 新内容' : ''}
            </span>
          </button>
        </div>
      ) : null}
      <div className="session-timeline-virtualizer">
        <Virtualizer
          key={sessionKey}
          ref={listHandle}
          scrollRef={scrollRef}
          onScroll={scrollController.handleScroll}
        >
          {children}
          <div
            ref={scrollController.bottomSentinelRef}
            aria-hidden="true"
            className="session-timeline-bottom-sentinel"
          />
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
