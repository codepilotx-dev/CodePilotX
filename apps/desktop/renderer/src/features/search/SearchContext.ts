import { createContext, useContext } from 'react'
import type { DesktopWorkspace } from '../../../shared/types.js'
import type { SessionListItem } from '../../uiTypes.js'

export type SearchContextValue = {
  query: string
  workspaces: DesktopWorkspace[]
  sessions: SessionListItem[]
  onQueryChange: (value: string) => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
}

export const SearchContext = createContext<SearchContextValue | null>(null)

export function useSearchContext(): SearchContextValue {
  const context = useContext(SearchContext)
  if (!context) {
    throw new Error('useSearchContext must be used within SearchContext.Provider')
  }
  return context
}
