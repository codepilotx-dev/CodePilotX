import React from "react";
import type { EventEnvelope } from "@codepilotx/agent-protocol";
import {
  applyThreadEnvelopes,
  createCanonicalThreadState,
  prependOlderThreadPage,
  selectRenderTurnEntries,
  type CanonicalThreadState,
  type RenderTurnEntry,
  type ThreadConversationScope,
  type ThreadHistoryPageLike,
} from "@codepilotx/session-view";

import { desktopClient } from "../../../services/desktop-client/index.js";
import { AGENT_LIVE_EVENT_FILTERS } from "../../../services/desktop-client/eventSubscriptionFilters.js";
import {
  recordCanonicalBatch,
  recordCanonicalProjection,
} from "../../debug/performanceDiagnosticsBridge.js";

const INITIAL_TURN_PAGE_SIZE = 10;
const MAX_ENVELOPES_PER_FLUSH = 256;
const BACKGROUND_FLUSH_DELAY_MS = 50;
const MAIN_CONVERSATION_SCOPE = { type: "main" } as const;

export type CanonicalThreadConversation = {
  state: CanonicalThreadState | null;
  turns: RenderTurnEntry[];
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  hasOlder: boolean;
  loadOlder: () => Promise<void>;
  reload: () => Promise<void>;
};

export function useCanonicalThreadConversation(
  threadId: string | null,
  scope: ThreadConversationScope = MAIN_CONVERSATION_SCOPE,
): CanonicalThreadConversation {
  const [state, setState] = React.useState<CanonicalThreadState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const stateRef = React.useRef<CanonicalThreadState | null>(null);
  const generationRef = React.useRef(0);
  const unsubscribeRef = React.useRef<(() => void) | null>(null);
  const pendingEnvelopesRef = React.useRef<EventEnvelope[]>([]);
  const flushFrameRef = React.useRef<number | null>(null);
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = React.useRef<() => void>(() => undefined);

  const commit = React.useCallback((next: CanonicalThreadState | null): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const cancelScheduledFlush = React.useCallback((): void => {
    if (flushFrameRef.current !== null) {
      cancelAnimationFrame(flushFrameRef.current);
      flushFrameRef.current = null;
    }
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const clearPendingEnvelopes = React.useCallback((): void => {
    cancelScheduledFlush();
    pendingEnvelopesRef.current = [];
  }, [cancelScheduledFlush]);

  const scheduleFlush = React.useCallback((): void => {
    if (flushFrameRef.current !== null || flushTimerRef.current !== null) return;
    const run = (): void => {
      cancelScheduledFlush();
      flushPendingRef.current();
    };
    flushFrameRef.current = requestAnimationFrame(run);
    flushTimerRef.current = setTimeout(run, BACKGROUND_FLUSH_DELAY_MS);
  }, [cancelScheduledFlush]);

  const readLatest = React.useCallback(async (): Promise<ThreadHistoryPageLike | null> => {
    if (!threadId) return null;
    return desktopClient.readThreadHistoryPage({
      threadId,
      limit: INITIAL_TURN_PAGE_SIZE,
    });
  }, [threadId]);

  const reload = React.useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;
    clearPendingEnvelopes();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (!threadId) {
      commit(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const page = await readLatest();
      if (!page || generation !== generationRef.current) return;
      commit(createCanonicalThreadState(page));
      unsubscribeRef.current = desktopClient.subscribeAgentEventEnvelopes(
        {
          threadId,
          after: page.streamPosition.sequence,
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.canonical,
          onCursorExpired: async () => {
            if (generation !== generationRef.current) return;
            clearPendingEnvelopes();
            const replacement = await readLatest();
            if (!replacement || generation !== generationRef.current) return;
            commit(createCanonicalThreadState(replacement));
            return replacement.streamPosition.sequence;
          },
        },
        (envelope: EventEnvelope) => {
          if (generation !== generationRef.current) return;
          pendingEnvelopesRef.current.push(envelope);
          scheduleFlush();
        },
      );
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      commit(null);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [
    clearPendingEnvelopes,
    commit,
    readLatest,
    scheduleFlush,
    threadId,
  ]);

  const flushPending = React.useCallback((): void => {
    const current = stateRef.current;
    if (!current) {
      pendingEnvelopesRef.current = [];
      return;
    }
    const batch = pendingEnvelopesRef.current.splice(0, MAX_ENVELOPES_PER_FLUSH);
    if (batch.length === 0) return;
    try {
      const applyStartedAt = performance.now();
      const next = applyThreadEnvelopes(current, batch);
      recordCanonicalBatch({
        eventCount: batch.length,
        applyMs: performance.now() - applyStartedAt,
        liveEventIds: next.stream.appliedEventIds.size,
      });
      if (next !== current) commit(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const first = batch[0];
      console.error("会话事件投影失败，正在从历史记录对账", {
        eventId: first?.eventId,
        type: first?.type,
        batchSize: batch.length,
        cause,
      });
      setError(`会话事件投影失败：${message}`);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      clearPendingEnvelopes();
      void reload();
      return;
    }
    if (pendingEnvelopesRef.current.length > 0) scheduleFlush();
  }, [clearPendingEnvelopes, commit, reload, scheduleFlush]);

  React.useLayoutEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  React.useEffect(() => {
    void reload();
    return () => {
      generationRef.current += 1;
      clearPendingEnvelopes();
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [clearPendingEnvelopes, reload]);

  const loadOlder = React.useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const cursor = current?.history.olderCursor;
    if (!threadId || !current || !current.history.hasOlder || !cursor || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    try {
      const page = await desktopClient.readThreadHistoryPage({
        threadId,
        before: cursor,
        limit: INITIAL_TURN_PAGE_SIZE,
      });
      const latest = stateRef.current;
      if (!latest || latest.thread.id !== threadId) return;
      commit(prependOlderThreadPage(latest, page));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoadingOlder(false);
    }
  }, [commit, loadingOlder, threadId]);

  const projection = React.useMemo(
    () => {
      const startedAt = performance.now();
      const turns = state ? selectRenderTurnEntries(state, scope) : [];
      return {
        durationMs: state ? performance.now() - startedAt : 0,
        turns,
      };
    },
    [scope, state],
  );
  React.useEffect(() => {
    if (state) recordCanonicalProjection(projection.durationMs);
  }, [projection, state]);

  return {
    state,
    turns: projection.turns,
    loading,
    loadingOlder,
    error,
    hasOlder: Boolean(state?.history.hasOlder),
    loadOlder,
    reload,
  };
}
