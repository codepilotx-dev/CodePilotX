/**
 * SessionTimelineView — Normal-flow container for the session timeline.
 *
 * Conversation rows contain streaming Markdown and expandable tool output, so
 * their heights are intentionally left to the browser's document flow. Scroll
 * management and bottom anchoring are owned by the outer ThreadScrollLayout.
 *
 * Layout follows opencode's turn/part spirit via data-* attributes
 * on the container.
 */

import React from 'react';
import { ArrowDown } from 'lucide-react';

import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js';
import { useThreadScrollController } from './useThreadScrollController.js';

/* ── Props ──────────────────────────────────────────────── */

export type SessionTimelineViewProps = {
  /** Rendered row elements. Each must have a stable `key` prop. */
  children: React.ReactNode;
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

/* ── Main component ─────────────────────────────────────── */

export function SessionTimelineView({
  children,
  scrollRef,
  onScroll,
  initialScrollOffset,
  scrollToBottom,
  count,
  sessionKey,
}: SessionTimelineViewProps): React.ReactNode {
  const scrollController = useThreadScrollController({
    active: Boolean(scrollToBottom),
    initialScrollOffset,
    itemCount: count,
    onScroll,
    scrollRef,
    sessionKey,
  });

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
      <div className="session-timeline-content">
        {children}
        <div
          ref={scrollController.bottomSentinelRef}
          aria-hidden="true"
          className="session-timeline-bottom-sentinel"
        />
      </div>
    </div>
  );
}
