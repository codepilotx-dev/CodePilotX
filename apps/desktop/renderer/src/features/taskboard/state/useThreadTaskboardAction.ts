import { useCallback, useState } from 'react'
import type { TaskboardWorkflowThreadLookup } from '@codepilotx/shared/taskboard'
import { desktopClient } from '../../../services/desktop-client/index.js'

export function useThreadTaskboardAction(): {
  lookup: TaskboardWorkflowThreadLookup | null
  loading: boolean
  load: (threadId: string, projectId?: string | null) => Promise<TaskboardWorkflowThreadLookup | null>
  reset: () => void
} {
  const [lookup, setLookup] = useState<TaskboardWorkflowThreadLookup | null>(null)
  const [loading, setLoading] = useState(false)

  const reset = useCallback(() => {
    setLookup(null)
    setLoading(false)
  }, [])

  const load = useCallback(async (threadId: string, projectId?: string | null) => {
    setLoading(true)
    setLookup(null)
    try {
      const result = await desktopClient.findTaskboardWorkflowTaskByThread!({
        threadId,
        ...(projectId ? { projectId } : {}),
      })
      setLookup(result.lookup)
      return result.lookup
    } catch {
      const unavailable: TaskboardWorkflowThreadLookup = {
        threadId,
        taskId: null,
        eligible: false,
        ineligibleReason: null,
      }
      setLookup(unavailable)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  return { lookup, loading, load, reset }
}
