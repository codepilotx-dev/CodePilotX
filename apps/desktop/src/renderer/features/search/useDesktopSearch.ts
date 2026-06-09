import { useMemo } from 'react'
import type { SessionListItem } from '../../uiTypes.js'
import type { DesktopWorkspace } from '../../../shared/types.js'

export type UseDesktopSearchOptions = {
  query: string
  recentWorkspaces: DesktopWorkspace[]
  sessions: SessionListItem[]
}

export type UseDesktopSearchResult = {
  filteredWorkspaces: DesktopWorkspace[]
  filteredSessions: SessionListItem[]
}

export function useDesktopSearch(
  options: UseDesktopSearchOptions,
): UseDesktopSearchResult {
  const { query, recentWorkspaces, sessions } = options
  const keyword = query.trim().toLowerCase()

  const filteredWorkspaces = useMemo(() => {
    if (!keyword) return recentWorkspaces
    return recentWorkspaces.filter(item =>
      [item.name, item.path, item.branchName ?? ''].join(' ').toLowerCase().includes(keyword),
    )
  }, [keyword, recentWorkspaces])

  const filteredSessions = useMemo(() => {
    if (!keyword) return sessions
    return sessions.filter(session =>
      [
        session.sessionName ?? '',
        session.workspaceName,
        session.createdAt,
        session.status,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    )
  }, [keyword, sessions])

  return { filteredWorkspaces, filteredSessions }
}
