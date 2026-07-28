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
  recordConversationSwitchCanonicalReady,
  recordConversationSwitchRequest,
  recordConversationSwitchSkeleton,
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

export function selectVisibleCanonicalState(
  state: CanonicalThreadState | null,
  threadId: string | null,
): CanonicalThreadState | null {
  return state?.thread.id === threadId ? state : null;
}

export function isCurrentCanonicalThreadRequest(
  activeThreadId: string | null,
  currentGeneration: number,
  requestedThreadId: string,
  requestGeneration: number,
): boolean {
  return activeThreadId === requestedThreadId
    && currentGeneration === requestGeneration;
}

export function useCanonicalThreadConversation(
  threadId: string | null,
  scope: ThreadConversationScope = MAIN_CONVERSATION_SCOPE,
): CanonicalThreadConversation {
  const [state, setState] = React.useState<CanonicalThreadState | null>(null);
  const [loadingThreadId, setLoadingThreadId] = React.useState<string | null>(null);
  const [loadingOlderThreadId, setLoadingOlderThreadId] = React.useState<string | null>(null);
  const [errorState, setErrorState] = React.useState<{
    threadId: string;
    message: string;
  } | null>(null);
  const stateRef = React.useRef<CanonicalThreadState | null>(null);
  const activeThreadIdRef = React.useRef(threadId);
  const generationRef = React.useRef(0);
  const unsubscribeRef = React.useRef<(() => void) | null>(null);
  const pendingEnvelopesRef = React.useRef<EventEnvelope[]>([]);
  const flushFrameRef = React.useRef<number | null>(null);
  const flushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = React.useRef<() => void>(() => undefined);
  const diagnosticsThreadIdRef = React.useRef<string | null>(null);
  const diagnosticsReadyRef = React.useRef(false);

  activeThreadIdRef.current = threadId;

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
    recordConversationSwitchRequest("history-read");
    return desktopClient.readThreadHistoryPage({
      threadId,
      limit: INITIAL_TURN_PAGE_SIZE,
    });
  }, [threadId]);

  const reload = React.useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;
    const requestedThreadId = threadId;
    clearPendingEnvelopes();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setLoadingOlderThreadId(null);
    if (!requestedThreadId) {
      commit(null);
      setErrorState(null);
      setLoadingThreadId(null);
      return;
    }

    setLoadingThreadId(requestedThreadId);
    setErrorState(null);
    try {
      const page = await readLatest();
      if (
        !page
        || !isCurrentCanonicalThreadRequest(
          activeThreadIdRef.current,
          generationRef.current,
          requestedThreadId,
          generation,
        )
      ) {
        return;
      }
      const next = createCanonicalThreadState(page);
      if (next.thread.id !== requestedThreadId) {
        throw new Error("历史记录返回了不匹配的会话");
      }
      commit(next);
      const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
        {
          threadId: requestedThreadId,
          after: page.streamPosition.sequence,
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.canonical,
          onCursorExpired: async () => {
            if (!isCurrentCanonicalThreadRequest(
              activeThreadIdRef.current,
              generationRef.current,
              requestedThreadId,
              generation,
            )) {
              return;
            }
            clearPendingEnvelopes();
            const replacement = await readLatest();
            if (
              !replacement
              || !isCurrentCanonicalThreadRequest(
                activeThreadIdRef.current,
                generationRef.current,
                requestedThreadId,
                generation,
              )
            ) {
              return;
            }
            const replacementState = createCanonicalThreadState(replacement);
            if (replacementState.thread.id !== requestedThreadId) return;
            commit(replacementState);
            return replacement.streamPosition.sequence;
          },
        },
        (envelope: EventEnvelope) => {
          if (!isCurrentCanonicalThreadRequest(
            activeThreadIdRef.current,
            generationRef.current,
            requestedThreadId,
            generation,
          )) {
            return;
          }
          pendingEnvelopesRef.current.push(envelope);
          scheduleFlush();
        },
      );
      if (!isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        unsubscribe();
        return;
      }
      unsubscribeRef.current = unsubscribe;
    } catch (cause) {
      if (!isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        return;
      }
      setErrorState({
        threadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
      commit(null);
    } finally {
      if (isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        setLoadingThreadId((currentThreadId) =>
          currentThreadId === requestedThreadId ? null : currentThreadId
        );
      }
    }
  }, [
    clearPendingEnvelopes,
    commit,
    readLatest,
    scheduleFlush,
    threadId,
  ]);

  const flushPending = React.useCallback((): void => {
    const expectedThreadId = activeThreadIdRef.current;
    const generation = generationRef.current;
    const current = stateRef.current;
    if (!expectedThreadId || !current || current.thread.id !== expectedThreadId) {
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
      if (
        next !== current
        && isCurrentCanonicalThreadRequest(
          activeThreadIdRef.current,
          generationRef.current,
          expectedThreadId,
          generation,
        )
        && next.thread.id === expectedThreadId
      ) {
        commit(next);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const first = batch[0];
      console.error("会话事件投影失败，正在从历史记录对账", {
        eventId: first?.eventId,
        type: first?.type,
        batchSize: batch.length,
        cause,
      });
      setErrorState({
        threadId: expectedThreadId,
        message: `会话事件投影失败：${message}`,
      });
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
    const requestedThreadId = threadId;
    const generation = generationRef.current;
    if (
      !requestedThreadId
      || !current
      || current.thread.id !== requestedThreadId
      || !current.history.hasOlder
      || !cursor
      || loadingOlderThreadId === requestedThreadId
    ) {
      return;
    }
    setLoadingOlderThreadId(requestedThreadId);
    try {
      recordConversationSwitchRequest("history-read");
      const page = await desktopClient.readThreadHistoryPage({
        threadId: requestedThreadId,
        before: cursor,
        limit: INITIAL_TURN_PAGE_SIZE,
      });
      const latest = stateRef.current;
      if (
        !isCurrentCanonicalThreadRequest(
          activeThreadIdRef.current,
          generationRef.current,
          requestedThreadId,
          generation,
        )
        || !latest
        || latest.thread.id !== requestedThreadId
      ) {
        return;
      }
      const next = prependOlderThreadPage(latest, page);
      if (next.thread.id !== requestedThreadId) return;
      commit(next);
    } catch (cause) {
      if (!isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        return;
      }
      setErrorState({
        threadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      setLoadingOlderThreadId((currentThreadId) =>
        currentThreadId === requestedThreadId ? null : currentThreadId
      );
    }
  }, [commit, loadingOlderThreadId, threadId]);

  const visibleState = selectVisibleCanonicalState(state, threadId);
  const visibleError =
    errorState?.threadId === threadId ? errorState.message : null;
  const visibleLoading = Boolean(
    threadId
    && !visibleState
    && !visibleError
  ) || loadingThreadId === threadId;
  const visibleLoadingOlder = Boolean(
    threadId && loadingOlderThreadId === threadId
  );

  const projection = React.useMemo(
    () => {
      const startedAt = performance.now();
      const turns = visibleState ? selectRenderTurnEntries(visibleState, scope) : [];
      return {
        durationMs: visibleState ? performance.now() - startedAt : 0,
        turns,
      };
    },
    [scope, visibleState],
  );
  React.useEffect(() => {
    if (visibleState) recordCanonicalProjection(projection.durationMs);
  }, [projection, visibleState]);

  React.useLayoutEffect(() => {
    if (diagnosticsThreadIdRef.current !== threadId) {
      diagnosticsThreadIdRef.current = threadId;
      diagnosticsReadyRef.current = false;
      if (threadId && visibleLoading && !visibleState) {
        recordConversationSwitchSkeleton();
      }
    }
    if (visibleState && !diagnosticsReadyRef.current) {
      diagnosticsReadyRef.current = true;
      recordConversationSwitchCanonicalReady({
        turnCount: visibleState.turnOrder.length,
        itemCount: visibleState.itemsById.size,
      });
    }
  }, [threadId, visibleLoading, visibleState]);

  return {
    state: visibleState,
    turns: projection.turns,
    loading: visibleLoading,
    loadingOlder: visibleLoadingOlder,
    error: visibleError,
    hasOlder: Boolean(visibleState?.history.hasOlder),
    loadOlder,
    reload,
  };
}
