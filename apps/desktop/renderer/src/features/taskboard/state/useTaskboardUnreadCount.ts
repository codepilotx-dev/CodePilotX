import { useCallback, useEffect, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'

export function useTaskboardUnreadCount(enabled: boolean): number {
  const [count, setCount] = useState(0)
  const refresh = useCallback(async () => {
    if (!enabled) {
      setCount(0)
      return
    }
    try {
      const result = await desktopClient.listTaskboardWorkflowTasks!({
        archived: false,
        limit: 1,
      })
      setCount(result.unreadCount)
    } catch {
      setCount(0)
    }
  }, [enabled])

  useEffect(() => {
    void refresh()
    if (!enabled) return
    return desktopClient.subscribeAgentEventEnvelopes(
      { liveEventTypes: AGENT_LIVE_EVENT_FILTERS.taskboard },
      events => {
        if (events.some(event => (
          event.type === 'taskboard/workflow/changed'
          || event.type === 'turn/statusChanged'
        ))) void refresh()
      },
    )
  }, [enabled, refresh])

  return count
}
