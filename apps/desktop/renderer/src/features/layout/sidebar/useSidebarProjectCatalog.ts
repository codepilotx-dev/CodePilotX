import { useCallback, useEffect, useState } from 'react'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { subscribeProjectCatalogChanges } from '../../projects/projectCatalogEvents.js'

export type SidebarProjectCatalogState =
  | { status: 'loading'; projects: readonly DesktopWorkspace[] }
  | { status: 'ready'; projects: readonly DesktopWorkspace[] }
  | {
      status: 'unavailable'
      projects: readonly DesktopWorkspace[]
      error: string
    }

export function useSidebarProjectCatalog({
  onReport,
}: {
  onReport: (message: string) => void
}): {
  projectCatalogState: SidebarProjectCatalogState
  removeCatalogProject: (project: DesktopWorkspace) => void
} {
  const [projectCatalogState, setProjectCatalogState] =
    useState<SidebarProjectCatalogState>({
      status: 'loading',
      projects: [],
    })

  useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    const refreshProjects = (): void => {
      const currentRequest = ++requestVersion
      void desktopClient
        .listProjects()
        .then(projects => {
          if (cancelled || currentRequest !== requestVersion) return
          setProjectCatalogState({ status: 'ready', projects })
        })
        .catch(error => {
          if (cancelled || currentRequest !== requestVersion) return
          const message = error instanceof Error ? error.message : String(error)
          setProjectCatalogState(current => ({
            status: 'unavailable',
            projects: current.projects,
            error: message,
          }))
          onReport(message)
        })
    }

    refreshProjects()
    const unsubscribe = subscribeProjectCatalogChanges(refreshProjects)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [onReport])

  const removeCatalogProject = useCallback((target: DesktopWorkspace): void => {
    setProjectCatalogState(current => ({
      ...current,
      projects: current.projects.filter(project =>
        target.projectId
          ? project.projectId !== target.projectId
          : project.path !== target.path,
      ),
    }))
  }, [])

  return { projectCatalogState, removeCatalogProject }
}
