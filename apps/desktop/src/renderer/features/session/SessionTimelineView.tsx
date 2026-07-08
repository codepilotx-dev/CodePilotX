/**
 * SessionTimelineView — Virtual-scrolling container for session timeline.
 *
 * Wraps virtua's VList and handles scroll management, bottom anchoring,
 * and hash navigation. Row rendering is done by the parent via children,
 * avoiding circular import issues with ConversationPage's renderers.
 *
 * Layout follows opencode's turn/part spirit via data-* attributes
 * on the container.
 */

import React from 'react';
import { VList, type VListHandle } from 'virtua';

/* ── Props ──────────────────────────────────────────────── */

export type SessionTimelineViewProps = {
  /** Rendered row elements. Each must have a stable `key` prop. */
  children: React.ReactNode;
  /** Ref to the VListHandle for imperative scroll control. */
  listRef?: React.RefObject<VListHandle | null>;
  /** Called when the user scrolls (for scroll-position persistence). */
  onScroll?: (scrollTop: number) => void;
  /**
   * If true, scroll to the end whenever the child count changes.
   * Used during streaming to keep the latest content visible.
   */
  scrollToBottom?: boolean;
  /** Number of children — used to detect additions for auto-scroll. */
  count: number;
};

/* ── Constants ──────────────────────────────────────────── */

const CHECK_INTERVAL_MS = 120;
const MAX_CHECK_ATTEMPTS = 15;

/* ── Main component ─────────────────────────────────────── */

export function SessionTimelineView({
  children,
  listRef: externalListRef,
  onScroll,
  scrollToBottom,
  count,
}: SessionTimelineViewProps): React.ReactNode {
  const internalListRef = React.useRef<VListHandle>(null);
  const listHandle = externalListRef ?? internalListRef;
  const prevCountRef = React.useRef(count);
  const scrollAttemptRef = React.useRef(0);

  // Auto-scroll to bottom when new items arrive and scrollToBottom is true
  React.useEffect(() => {
    if (!scrollToBottom) return;

    if (count > prevCountRef.current) {
      // New items added — scroll to end with retry for VList layout settling
      scrollAttemptRef.current = 0;
      const attemptScroll = (): void => {
        if (scrollAttemptRef.current >= MAX_CHECK_ATTEMPTS) return;
        scrollAttemptRef.current++;
        try {
          listHandle.current?.scrollToIndex(count - 1, { align: 'end' });
        } catch {
          // VList may not be ready yet; retry
          setTimeout(attemptScroll, CHECK_INTERVAL_MS);
          return;
        }
        // Single attempt should suffice, but retry once more for safety
        if (scrollAttemptRef.current < 2) {
          requestAnimationFrame(() => {
            listHandle.current?.scrollToIndex(count - 1, { align: 'end' });
          });
        }
      };
      attemptScroll();
    }

    prevCountRef.current = count;
  }, [count, scrollToBottom, listHandle]);

  return (
    <div
      className="session-timeline-container"
      data-component="session-timeline"
    >
      <VList
        ref={listHandle}
        className="session-timeline-vlist"
        onScroll={onScroll}
        style={{ height: '100%', width: '100%' }}
      >
        {children}
      </VList>
    </div>
  );
}

/* ── Scroll helpers ─────────────────────────────────────── */

/**
 * Imperative scroll to a given index.
 */
export function scrollToIndex(
  handle: VListHandle | null,
  index: number,
  align: 'start' | 'end' | 'center' = 'start',
): void {
  if (!handle) return;
  try {
    handle.scrollToIndex(index, { align });
  } catch {
    // VList may not be mounted yet
  }
}
