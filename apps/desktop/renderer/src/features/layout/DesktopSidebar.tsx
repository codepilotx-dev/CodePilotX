import type React from "react";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesktopRemovedWorkspace,
  DesktopSessionCatalogStatus,
  DesktopWorkspace,
  SidebarSectionId,
} from "../../../shared/types.js";
import type { AppView, SessionListItem } from "../../uiTypes.js";
import { SidebarBody } from "./sidebar/SidebarBody.js";
import { SidebarFooter } from "./sidebar/SidebarFooter.js";
import { SidebarEmptyRow } from "./sidebar/SidebarRow.js";
import { SidebarHeader, SidebarTopNav } from "./sidebar/SidebarTopNav.js";
import {
  buildSidebarViewModel,
  buildSidebarFocusSections,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
} from './sidebar/sidebarViewModel.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { subscribeProjectCatalogChanges } from '../projects/projectCatalogEvents.js'

type Props = {
  activeSessionId: string | null;
  catalogStatus: DesktopSessionCatalogStatus;
  pendingPermissionSessionIds: ReadonlySet<string>;
  titleLoadingIds: ReadonlySet<string>;
  recentWorkspaces: DesktopWorkspace[];
  removedWorkspaces: DesktopRemovedWorkspace[];
  sessionFallbackTitles: Record<string, string>;
  sidebarWidth: number;
  sessions: SessionListItem[];
  unavailableWorkspacePaths: Set<string>;
  workspace: DesktopWorkspace | null;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onOpenCommandMenu: () => void;
  onOpenWhatsNew: (restoreFocusElement: HTMLElement | null) => void;
  onPinWorkspace: (workspace: DesktopWorkspace) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onArchiveSessions: (sessionIds: readonly string[]) => Promise<{
    failedSessionIds: string[]
    succeededSessionIds: string[]
  }>
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void;
  onReport: (message: string) => void
  collapsedSidebarSections: SidebarSectionId[];
  onToggleSidebarSection: (section: SidebarSectionId) => void;
};

export function DesktopSidebar({
  activeSessionId,
  catalogStatus,
  pendingPermissionSessionIds,
  titleLoadingIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionFallbackTitles,
  sidebarWidth,
  sessions,
  unavailableWorkspacePaths,
  workspace,
  onChooseWorkspace,
  onCreateSession,
  onOpenCommandMenu,
  onOpenWhatsNew,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onArchiveSessions,
  onRenameSession,
  onUnpinWorkspace,
  onReport,
  collapsedSidebarSections,
  onToggleSidebarSection,
}: Props): React.ReactNode {
  const location = useLocation();
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [catalogProjects, setCatalogProjects] = useState<DesktopWorkspace[]>([])
  const {
    collapsedSidebarProjectPaths,
    setCollapsedSidebarProjectPaths,
    setSidebarManualOrder,
    setSidebarOrganization,
    setSidebarProjectSort,
    sidebarSessionPins,
    setSidebarSessionPins,
    sidebarManualOrder,
    sidebarOrganization,
    sidebarProjectSort,
    sidebarSort,
    setSidebarSort,
    sidebarPriorityFilterEnabled,
  } = useDesktopSettings()
  const collapsedProjectPaths = useMemo(
    () => new Set(collapsedSidebarProjectPaths),
    [collapsedSidebarProjectPaths],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false
    let requestVersion = 0
    const refreshProjects = (): void => {
      const currentRequest = ++requestVersion
      void desktopClient
        .listProjects()
        .then(projects => {
          if (!cancelled && currentRequest === requestVersion) {
            setCatalogProjects(projects)
          }
        })
        .catch(error => {
          if (!cancelled && currentRequest === requestVersion) {
            onReport(error instanceof Error ? error.message : String(error))
          }
        })
    }
    refreshProjects()
    const unsubscribe = subscribeProjectCatalogChanges(refreshProjects)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [onReport])

  const mergedProjects = useMemo(
    () => mergeCatalogProjects(catalogProjects, recentWorkspaces),
    [catalogProjects, recentWorkspaces],
  )

  const viewModel = useMemo(
    () =>
      buildSidebarViewModel({
        manualOrderByScope: sidebarManualOrder,
        organization: sidebarOrganization,
        pendingPermissionSessionIds,
        recentWorkspaces: mergedProjects,
        removedWorkspaces,
        sessionPins: sidebarSessionPins,
        sessions,
      }),
    [
      pendingPermissionSessionIds,
      mergedProjects,
      removedWorkspaces,
      sessions,
      sidebarManualOrder,
      sidebarOrganization,
      sidebarSessionPins,
    ],
  )

  const focusSections = useMemo(
    () =>
      sidebarPriorityFilterEnabled
        ? buildSidebarFocusSections({
            now: relativeNow,
            sessions: viewModel.visibleSessions,
            sessionStateById: viewModel.sessionStateById,
          })
        : null,
    [
      relativeNow,
      sidebarPriorityFilterEnabled,
      viewModel.sessionStateById,
      viewModel.visibleSessions,
    ],
  )

  function isActiveView(view: AppView): boolean {
    if (view === "new") return location.pathname === "/new";
    if (view === "projects") return location.pathname.startsWith("/projects");
    if (view === "pullRequests") return location.pathname.startsWith("/pull-requests");
    return location.pathname === `/${view}`;
  }

  const toggleProjectCollapsed = useCallback((projectPath: string): void => {
    setCollapsedSidebarProjectPaths((current) => {
      const next = new Set(current)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      return [...next]
    });
  }, [setCollapsedSidebarProjectPaths]);

  function pinSession(session: SessionListItem): void {
    setSidebarSessionPins(current => ({
      ...current,
      [session.id]: new Date().toISOString(),
    }))
  }

  function unpinSession(session: SessionListItem): void {
    setSidebarSessionPins(current => {
      const { [session.id]: _removed, ...next } = current
      return next
    })
    removePinnedManualOrder([sidebarPinnedSessionKey(session)])
  }

  async function archiveSessions(targetSessions: readonly SessionListItem[]): Promise<boolean> {
    const result = await onArchiveSessions(targetSessions.map(session => session.id))
    if (result.succeededSessionIds.length > 0) {
      const removedIds = new Set(result.succeededSessionIds)
      setSidebarSessionPins(current =>
        Object.fromEntries(
          Object.entries(current).filter(([sessionId]) => !removedIds.has(sessionId)),
        ),
      )
      removePinnedManualOrder(
        result.succeededSessionIds.map(sessionId => `session:${sessionId}`),
      )
    }
    if (result.failedSessionIds.length > 0) {
      onReport(
        `已归档 ${result.succeededSessionIds.length} 个任务，${result.failedSessionIds.length} 个失败。`,
      )
      return false
    }
    if (result.succeededSessionIds.length > 1) {
      onReport(`已归档 ${result.succeededSessionIds.length} 个任务。`)
    }
    return true
  }

  const updateManualOrder = useCallback((
    scopeKey: string,
    order: string[],
  ): void => {
    setSidebarManualOrder(current => ({
      ...current,
      [scopeKey]: order,
    }))
  }, [setSidebarManualOrder])

  const removePinnedManualOrder = useCallback((keys: readonly string[]): void => {
    if (keys.length === 0) return
    const removedKeys = new Set(keys)
    setSidebarManualOrder(current => {
      const pinnedItems = current['pinned-items']
      if (!pinnedItems?.some(key => removedKeys.has(key))) return current
      const nextPinnedItems = pinnedItems.filter(key => !removedKeys.has(key))
      if (nextPinnedItems.length > 0) {
        return {
          ...current,
          'pinned-items': nextPinnedItems,
        }
      }
      const { ['pinned-items']: _removed, ...next } = current
      return next
    })
  }, [setSidebarManualOrder])

  return (
    <div className="sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:py-2">
      <SidebarHeader onOpenCommandMenu={onOpenCommandMenu} />
      <SidebarTopNav
        isActiveView={isActiveView}
        showProjects={sidebarOrganization === 'flat'}
      />
      {catalogStatus.state === 'loading' ? (
        <SidebarEmptyRow role="status">正在加载任务目录…</SidebarEmptyRow>
      ) : catalogStatus.state === 'unavailable' ? (
        <SidebarEmptyRow role="status">
          {catalogStatus.error ?? 'The app-server is unavailable. Please try again.'}
        </SidebarEmptyRow>
      ) : null}
      <SidebarBody
        activeSessionId={activeSessionId}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        collapsedProjectPaths={collapsedProjectPaths}
        organization={sidebarOrganization}
        focusSections={focusSections}
        now={relativeNow}
        pinnedSessions={viewModel.pinnedSessions}
        pinnedWorkspaces={viewModel.pinnedWorkspaces}
        projectSessionBuckets={viewModel.projectSessionBuckets}
        projectWorkspaces={viewModel.projectWorkspaces}
        projectSort={sidebarProjectSort}
        sessionFallbackTitles={sessionFallbackTitles}
        recentSessions={viewModel.recentSessions}
        sessionSort={sidebarSort}
        manualOrderByScope={sidebarManualOrder}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        workspace={workspace}
        onArchiveSessions={archiveSessions}
        onChooseWorkspace={onChooseWorkspace}
        onCreateSession={onCreateSession}
        onPinSession={pinSession}
        onPinWorkspace={onPinWorkspace}
        collapsedSidebarSections={collapsedSidebarSections}
        onToggleSidebarSection={onToggleSidebarSection}
        onRemoveWorkspace={target => {
          setCatalogProjects(current =>
            current.filter(project =>
              target.projectId
                ? project.projectId !== target.projectId
                : project.path !== target.path,
            ),
          )
          removePinnedManualOrder([sidebarPinnedProjectKey(target)])
          onRemoveWorkspace(target)
        }}
        onSelectSession={onSelectSession}
        onRenameSession={onRenameSession}
        onToggleProjectCollapsed={toggleProjectCollapsed}
        onUnpinSession={unpinSession}
        onUnpinWorkspace={target => {
          removePinnedManualOrder([sidebarPinnedProjectKey(target)])
          onUnpinWorkspace(target)
        }}
        onReport={onReport}
        onManualOrderChange={updateManualOrder}
        onOrganizationChange={setSidebarOrganization}
        onProjectSortChange={setSidebarProjectSort}
        onSessionSortChange={setSidebarSort}
      />
      <SidebarFooter
        sidebarWidth={sidebarWidth}
        onOpenWhatsNew={onOpenWhatsNew}
        onReport={onReport}
      />
    </div>
  );
}

function mergeCatalogProjects(
  catalogProjects: readonly DesktopWorkspace[],
  recentWorkspaces: readonly DesktopWorkspace[],
): DesktopWorkspace[] {
  const recentByKey = new Map(
    recentWorkspaces.map(project => [projectKey(project), project]),
  )
  const merged = catalogProjects.map(project => {
    const recent = recentByKey.get(projectKey(project))
    recentByKey.delete(projectKey(project))
    return {
      ...recent,
      ...project,
      pinnedAt: recent?.pinnedAt ?? project.pinnedAt ?? null,
    }
  })
  return [...merged, ...recentByKey.values()]
}

function projectKey(project: DesktopWorkspace): string {
  return project.projectId
    ? `id:${project.projectId}`
    : `path:${project.path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()}`
}
