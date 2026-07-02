import type React from 'react'
import { createContext, useContext, useEffect } from 'react'

export type WorkspaceHeaderContent = {
  title: React.ReactNode
  actions: React.ReactNode
  dockActions?: React.ReactNode
}

type WorkspaceHeaderContextValue = {
  setHeaderContent: (content: WorkspaceHeaderContent | null) => void
}

export const WorkspaceHeaderContext =
  createContext<WorkspaceHeaderContextValue | null>(null)

export function useWorkspaceHeader(content: WorkspaceHeaderContent | null): void {
  const context = useContext(WorkspaceHeaderContext)

  useEffect(() => {
    if (!context) return
    context.setHeaderContent(content)
    return () => context.setHeaderContent(null)
  }, [context, content])
}
