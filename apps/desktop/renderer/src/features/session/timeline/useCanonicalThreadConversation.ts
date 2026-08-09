import React from 'react'
import type { EventEnvelope } from '@codepilotx/agent-protocol'
import {
  createRenderTurnEntriesSelector,
  type CanonicalThreadState,
  type PendingHookTrustInteraction,
  type RenderTurnEntry,
  type ThreadConversationScope,
  type ThreadHistoryPageLike,
} from '@codepilotx/session-view'

import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'
import { canonicalThreadCache } from '../state/canonicalThreadCache.js'
import { CanonicalThreadIngestionCoordinator } from './CanonicalThreadIngestionCoordinator.js'

const INITIAL_TURN_PAGE_SIZE = 10
const MAIN_CONVERSATION_SCOPE = { type: 'main' } as const
const EMPTY_RENDER_TURNS = Object.freeze([]) as unknown as RenderTurnEntry[]

export type CanonicalThreadConversation = {
  state: CanonicalThreadState | null
  turns: RenderTurnEntry[]
  loading: boolean
  loadingOlder: boolean
  error: string | null
  hasOlder: boolean
  loadOlder: () => Promise<void>
  reload: () => Promise<void>
}

export function selectVisibleCanonicalState(
  state: CanonicalThreadState | null,
  threadId: string | null,
): CanonicalThreadState | null {
  return state?.thread.id === threadId ? state : null
}

export function isCurrentCanonicalThreadRequest(
  activeThreadId: string | null,
  currentGeneration: number,
  requestedThreadId: string,
  requestGeneration: number,
): boolean {
  return activeThreadId === requestedThreadId
    && currentGeneration === requestGeneration
}

export function useCanonicalThreadConversation(
  threadId: string | null,
  scope: ThreadConversationScope = MAIN_CONVERSATION_SCOPE,
): CanonicalThreadConversation {
  const [loadingOlderThreadId, setLoadingOlderThreadId] = React.useState<string | null>(null)
  const [errorState, setErrorState] = React.useState<{
    threadId: string
    message: string
  } | null>(null)
  const activeThreadIdRef = React.useRef(threadId)
  const generationRef = React.useRef(0)
  const unsubscribeRef = React.useRef<(() => void) | null>(null)
  const renderTurnEntriesSelector = React.useMemo(
    () => createRenderTurnEntriesSelector(),
    [],
  )
  const coordinator = React.useMemo(() => {
    if (!threadId) return null
    return new CanonicalThreadIngestionCoordinator({
      threadId,
      initialState: canonicalThreadCache.get(threadId),
      onCommit: next => canonicalThreadCache.set(next),
    })
  }, [threadId])
  const subscribeToProjection = React.useCallback(
    (listener: () => void) => coordinator?.subscribe(listener) ?? (() => undefined),
    [coordinator],
  )
  const getProjectionSnapshot = React.useCallback(
    () => coordinator?.getSnapshot() ?? null,
    [coordinator],
  )
  const state = React.useSyncExternalStore(
    subscribeToProjection,
    getProjectionSnapshot,
    getProjectionSnapshot,
  )

  activeThreadIdRef.current = threadId

  const readLatest = React.useCallback(async (): Promise<ThreadHistoryPageLike | null> => {
    if (!threadId) return null
    const page = await desktopClient.readThreadHistoryPage({
      threadId,
      limit: INITIAL_TURN_PAGE_SIZE,
    })
    // Read pending interactions after the history fence. This ordering avoids
    // reintroducing a hook that resolved before the returned stream position.
    const pending = await desktopClient.listPendingAgentInteractions({
      threadId,
      limit: 500,
    })
    return {
      ...page,
      pendingHookTrusts: pending.interactions.filter(
        (interaction): interaction is PendingHookTrustInteraction =>
          interaction.kind === 'hookTrust',
      ),
    }
  }, [threadId])

  const reload = React.useCallback(async (): Promise<void> => {
    const generation = ++generationRef.current
    const requestedThreadId = threadId
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    setLoadingOlderThreadId(null)
    if (!requestedThreadId || !coordinator) {
      setErrorState(null)
      return
    }

    setErrorState(null)
    const isCurrent = (): boolean => isCurrentCanonicalThreadRequest(
      activeThreadIdRef.current,
      generationRef.current,
      requestedThreadId,
      generation,
    )
    const rehydrate = async (cause?: unknown): Promise<number | undefined> => {
      if (!isCurrent()) return undefined
      if (cause !== undefined) {
        console.error('会话事件消费失败，正在从历史记录对账。')
      }
      try {
        const replacement = await readLatest()
        if (!replacement || !isCurrent()) return undefined
        coordinator.rehydrate(replacement)
        setErrorState(null)
        return replacement.streamPosition.sequence
      } catch (error) {
        if (!isCurrent()) return undefined
        setErrorState({
          threadId: requestedThreadId,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }

    try {
      const page = await readLatest()
      if (!page || !isCurrent()) return
      coordinator.rehydrate(page)
      const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
        {
          threadId: requestedThreadId,
          after: page.streamPosition.sequence,
          liveEventTypes: AGENT_LIVE_EVENT_FILTERS.canonical,
          onCursorExpired: () => rehydrate(),
          onDeliveryError: error => rehydrate(error),
        },
        async (envelopes: readonly EventEnvelope[]) => {
          if (!isCurrent()) {
            throw new Error('会话已切换，拒绝确认旧订阅事件。')
          }
          await coordinator.deliverBatch(envelopes)
        },
      )
      if (!isCurrent()) {
        unsubscribe()
        return
      }
      unsubscribeRef.current = unsubscribe
    } catch (cause) {
      if (!isCurrent()) return
      setErrorState({
        threadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      canonicalThreadCache.invalidate(requestedThreadId)
    }
  }, [coordinator, readLatest, threadId])

  React.useEffect(() => {
    void reload()
    return () => {
      generationRef.current += 1
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      coordinator?.dispose()
    }
  }, [coordinator, reload])

  const loadOlder = React.useCallback(async (): Promise<void> => {
    const current = coordinator?.getSnapshot() ?? null
    const cursor = current?.history.olderCursor
    const requestedThreadId = threadId
    const generation = generationRef.current
    if (
      !requestedThreadId
      || !coordinator
      || !current
      || current.thread.id !== requestedThreadId
      || !current.history.hasOlder
      || !cursor
      || loadingOlderThreadId === requestedThreadId
    ) {
      return
    }
    setLoadingOlderThreadId(requestedThreadId)
    try {
      const page = await desktopClient.readThreadHistoryPage({
        threadId: requestedThreadId,
        before: cursor,
        limit: INITIAL_TURN_PAGE_SIZE,
      })
      if (!isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        return
      }
      coordinator.prependOlder(page)
    } catch (cause) {
      if (!isCurrentCanonicalThreadRequest(
        activeThreadIdRef.current,
        generationRef.current,
        requestedThreadId,
        generation,
      )) {
        return
      }
      setErrorState({
        threadId: requestedThreadId,
        message: cause instanceof Error ? cause.message : String(cause),
      })
    } finally {
      setLoadingOlderThreadId(currentThreadId =>
        currentThreadId === requestedThreadId ? null : currentThreadId
      )
    }
  }, [coordinator, loadingOlderThreadId, threadId])

  const visibleError = errorState?.threadId === threadId
    ? errorState.message
    : null
  const visibleState = visibleError
    ? null
    : selectVisibleCanonicalState(state, threadId)
  const visibleLoading = Boolean(threadId && !visibleState && !visibleError)
  const visibleLoadingOlder = Boolean(
    threadId && loadingOlderThreadId === threadId,
  )
  const turns = React.useMemo(
    () => visibleState
      ? renderTurnEntriesSelector(visibleState, scope)
      : EMPTY_RENDER_TURNS,
    [renderTurnEntriesSelector, scope, visibleState],
  )

  return {
    state: visibleState,
    turns,
    loading: visibleLoading,
    loadingOlder: visibleLoadingOlder,
    error: visibleError,
    hasOlder: Boolean(visibleState?.history.hasOlder),
    loadOlder,
    reload,
  }
}
