import React from "react";
import type { EventEnvelope } from "@codepilotx/agent-protocol";
import {
  applyThreadEnvelope,
  createCanonicalThreadState,
  prependOlderThreadPage,
  selectRenderTurnEntries,
  type CanonicalThreadState,
  type RenderTurnEntry,
  type ThreadConversationScope,
  type ThreadHistoryPageLike,
} from "@codepilotx/session-view";

import { desktopClient } from "../../services/desktopClient.js";

const INITIAL_TURN_PAGE_SIZE = 10;

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
  scope: ThreadConversationScope = { type: "main" },
): CanonicalThreadConversation {
  const [state, setState] = React.useState<CanonicalThreadState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const stateRef = React.useRef<CanonicalThreadState | null>(null);
  const generationRef = React.useRef(0);
  const unsubscribeRef = React.useRef<(() => void) | null>(null);

  const commit = React.useCallback((next: CanonicalThreadState | null): void => {
    stateRef.current = next;
    setState(next);
  }, []);

  const readLatest = React.useCallback(async (): Promise<ThreadHistoryPageLike | null> => {
    if (!threadId) return null;
    return desktopClient.readThreadHistoryPage({
      threadId,
      limit: INITIAL_TURN_PAGE_SIZE,
    });
  }, [threadId]);

  const reload = React.useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current;
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
          onCursorExpired: async () => {
            const replacement = await readLatest();
            if (!replacement || generation !== generationRef.current) return;
            commit(createCanonicalThreadState(replacement));
            return replacement.streamPosition.sequence;
          },
        },
        (envelope: EventEnvelope) => {
          if (generation !== generationRef.current) return;
          const current = stateRef.current;
          if (!current) return;
          const next = applyThreadEnvelope(current, envelope);
          if (next !== current) commit(next);
        },
      );
    } catch (cause) {
      if (generation !== generationRef.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      commit(null);
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [commit, readLatest, threadId]);

  React.useEffect(() => {
    void reload();
    return () => {
      generationRef.current += 1;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [reload]);

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

  const turns = React.useMemo(
    () => (state ? selectRenderTurnEntries(state, scope) : []),
    [scope, state],
  );

  return {
    state,
    turns,
    loading,
    loadingOlder,
    error,
    hasOlder: Boolean(state?.history.hasOlder),
    loadOlder,
    reload,
  };
}
