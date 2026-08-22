import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskboardWorkflowThreadCandidate } from '@codepilotx/shared/taskboard'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function useTaskboardThreadCandidates({
  open,
  projectId,
  query,
  initialThread,
}: {
  open: boolean
  projectId: string
  query: string
  initialThread?: TaskboardWorkflowThreadCandidate
}): {
  threads: readonly TaskboardWorkflowThreadCandidate[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => Promise<void>
} {
  const [threads, setThreads] = useState<readonly TaskboardWorkflowThreadCandidate[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestRef = useRef(0)
  const trimmedQuery = query.trim()

  useEffect(() => {
    if (!open || !projectId) {
      requestRef.current += 1
      setThreads([])
      setCursor(null)
      setLoading(false)
      return
    }
    const request = ++requestRef.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      void desktopClient.listTaskboardWorkflowThreadCandidates!({
        projectId,
        ...(trimmedQuery ? { query: trimmedQuery } : {}),
        limit: 30,
      }).then(result => {
        if (request !== requestRef.current) return
        setThreads(mergeCandidates(result.threads, initialThread, projectId, trimmedQuery))
        setCursor(result.nextCursor)
      }).catch(() => {
        if (request !== requestRef.current) return
        setThreads(mergeCandidates([], initialThread, projectId, trimmedQuery))
        setCursor(null)
      }).finally(() => {
        if (request === requestRef.current) setLoading(false)
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [initialThread, open, projectId, trimmedQuery])

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const result = await desktopClient.listTaskboardWorkflowThreadCandidates!({
        projectId,
        ...(trimmedQuery ? { query: trimmedQuery } : {}),
        cursor,
        limit: 30,
      })
      setThreads(current => mergeUniqueCandidates(current, result.threads))
      setCursor(result.nextCursor)
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, loadingMore, projectId, trimmedQuery])

  return { threads, loading, loadingMore, hasMore: cursor !== null, loadMore }
}

function mergeCandidates(
  threads: readonly TaskboardWorkflowThreadCandidate[],
  initialThread: TaskboardWorkflowThreadCandidate | undefined,
  projectId: string,
  query: string,
): readonly TaskboardWorkflowThreadCandidate[] {
  const includeInitial = initialThread?.projectId === projectId
    && (!query || initialThread.title.toLocaleLowerCase('zh-CN').includes(query.toLocaleLowerCase('zh-CN')))
  return mergeUniqueCandidates(includeInitial ? [initialThread] : [], threads)
}

function mergeUniqueCandidates(
  first: readonly TaskboardWorkflowThreadCandidate[],
  second: readonly TaskboardWorkflowThreadCandidate[],
): readonly TaskboardWorkflowThreadCandidate[] {
  const byId = new Map(first.map(thread => [thread.threadId, thread]))
  for (const thread of second) byId.set(thread.threadId, thread)
  return [...byId.values()]
}
