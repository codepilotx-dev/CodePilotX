import type React from "react";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  SidebarHeader,
  SidebarNewTaskNav,
  SidebarTopNav,
  type SidebarCapabilityState,
  UNKNOWN_SIDEBAR_CAPABILITY_STATE,
} from "./sidebar/SidebarTopNav.js";
import {
  buildSidebarViewModel,
  buildSidebarTimelineModel,
  sidebarArchivableAttentionSessions,
  sidebarAttentionUnreadSessions,
  sidebarProjectKey,
  sidebarPinnedProjectKey,
  sidebarPinnedSessionKey,
} from './sidebar/sidebarViewModel.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import {
  getSidebarScrollModeKey,
  type SidebarScrollModeKey,
} from './sidebar/useSidebarScrollController.js'
import { useSidebarProjectCatalog } from './sidebar/useSidebarProjectCatalog.js'

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
  const [sidebarScrollOverlapping, setSidebarScrollOverlapping] =
    useState(false)
  const [sidebarCapabilityState, setSidebarCapabilityState] =
    useState<SidebarCapabilityState>(UNKNOWN_SIDEBAR_CAPABILITY_STATE)
  const sidebarScrollPositionsRef = useRef<Map<SidebarScrollModeKey, number>>(
    new Map(),
  )
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
    sidebarTimelineEnabled,
  } = useDesktopSettings()
  const collapsedProjectPaths = useMemo(
    () => new Set(collapsedSidebarProjectPaths),
    [collapsedSidebarProjectPaths],
  )
  const { projectCatalogState, removeCatalogProject } =
    useSidebarProjectCatalog({ onReport })

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false
    void desktopClient
      .getRuntimeCapabilities()
      .then(capabilities => {
        if (!cancelled) {
          setSidebarCapabilityState({
            status: 'ready',
            capabilities: new Set(capabilities),
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSidebarCapabilityState({
            status: 'unavailable',
            capabilities: null,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const mergedProjects = useMemo(
    () => mergeCatalogProjects(projectCatalogState.projects, recentWorkspaces),
    [projectCatalogState.projects, recentWorkspaces],
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

  const [showTimelinePinned, setShowTimelinePinned] = useState(false)
  const [archiveAttentionOpen, setArchiveAttentionOpen] = useState(false)
  const [archivingAttention, setArchivingAttention] = useState(false)

  // 始终构建时间线投影，使铃铛在时间线关闭时也能获得关注状态
  const timelineModel = useMemo(
    () =>
      buildSidebarTimelineModel({
        now: relativeNow,
        sessions: viewModel.visibleSessions,
        showPinned: showTimelinePinned,
      }),
    [relativeNow, showTimelinePinned, viewModel.visibleSessions],
  )
  const timeline = sidebarTimelineEnabled ? timelineModel : null
  const hasAttention = timelineModel.attentionSessions.length > 0
  const attentionUnreadSessions = useMemo(
    () => sidebarAttentionUnreadSessions(timelineModel.attentionSessions),
    [timelineModel],
  )
  const archivableAttentionSessions = useMemo(
    () => sidebarArchivableAttentionSessions(timelineModel.attentionSessions),
    [timelineModel],
  )
  const sidebarScrollModeKey = getSidebarScrollModeKey({
    organization: sidebarOrganization,
    timelineEnabled: timeline !== null,
  })

  const markAttentionRead = useCallback(async (): Promise<void> => {
    if (attentionUnreadSessions.length === 0) return
    const readThroughAt = new Date().toISOString()
    const results = await Promise.allSettled(
      attentionUnreadSessions.map(session =>
        desktopClient.markSessionRead(session.id, readThroughAt),
      ),
    )
    const failedCount = results.filter(
      result => result.status === 'rejected',
    ).length
    if (failedCount > 0) {
      onReport(
        `已标记 ${attentionUnreadSessions.length - failedCount} 个任务为已读，${failedCount} 个失败。`,
      )
    }
  }, [attentionUnreadSessions, onReport])

  const requestArchiveAttention = useCallback((): void => {
    if (archivableAttentionSessions.length === 0) return
    setArchiveAttentionOpen(true)
  }, [archivableAttentionSessions.length])

  const confirmArchiveAttention = useCallback(async (): Promise<void> => {
    if (archivingAttention) return
    setArchivingAttention(true)
    try {
      await archiveSessions(archivableAttentionSessions)
    } finally {
      setArchivingAttention(false)
      setArchiveAttentionOpen(false)
    }
  }, [archivableAttentionSessions, archivingAttention, archiveSessions])

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

  const previousActiveSessionIdRef = useRef<string | null | undefined>(undefined)
  const pendingContainerRevealIdRef = useRef<string | null>(activeSessionId)
  useEffect(() => {
    if (previousActiveSessionIdRef.current !== activeSessionId) {
      previousActiveSessionIdRef.current = activeSessionId
      pendingContainerRevealIdRef.current = activeSessionId
    }
    if (
      !activeSessionId ||
      pendingContainerRevealIdRef.current !== activeSessionId
    ) {
      return
    }

    if (timeline) {
      pendingContainerRevealIdRef.current = null
      return
    }

    const sessionExists = viewModel.visibleSessions.some(
      session => session.id === activeSessionId,
    )
    if (!sessionExists) return
    const pinnedSession = viewModel.pinnedSessions.some(
      session => session.id === activeSessionId,
    )
    const pinnedProject = viewModel.pinnedWorkspaces.find(project =>
      viewModel.projectSessionBuckets
        .get(sidebarProjectKey(project))
        ?.displaySessions.some(session => session.id === activeSessionId),
    )
    const project = sidebarOrganization === 'projects'
      ? viewModel.projectWorkspaces.find(projectEntry =>
          viewModel.projectSessionBuckets
            .get(sidebarProjectKey(projectEntry))
            ?.displaySessions.some(session => session.id === activeSessionId),
        )
      : undefined
    const recent = viewModel.recentSessions.some(
      session => session.id === activeSessionId,
    )

    if (!pinnedSession && !pinnedProject && !project && !recent) return
    pendingContainerRevealIdRef.current = null

    if (pinnedSession || pinnedProject) {
      if (collapsedSidebarSections.includes('pinned')) {
        onToggleSidebarSection('pinned')
      }
      if (pinnedProject) {
        expandSidebarProject(pinnedProject, setCollapsedSidebarProjectPaths)
      }
      return
    }
    if (project) {
      if (collapsedSidebarSections.includes('projects')) {
        onToggleSidebarSection('projects')
      }
      expandSidebarProject(project, setCollapsedSidebarProjectPaths)
      return
    }
    if (recent && collapsedSidebarSections.includes('recent')) {
      onToggleSidebarSection('recent')
    }
  }, [
    activeSessionId,
    collapsedSidebarSections,
    onToggleSidebarSection,
    setCollapsedSidebarProjectPaths,
    sidebarOrganization,
    timeline,
    viewModel,
  ])

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
      <SidebarHeader
        hasAttention={hasAttention}
        onOpenCommandMenu={onOpenCommandMenu}
      />
      <SidebarNewTaskNav
        isActiveView={isActiveView}
        scrollOverlapping={sidebarScrollOverlapping}
      />
      <SidebarBody
        onScrollOverlapChange={setSidebarScrollOverlapping}
        scrollHeader={
          <>
            <SidebarTopNav
              capabilityState={sidebarCapabilityState}
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
          </>
        }
        projectCatalogState={projectCatalogState}
        scrollModeKey={sidebarScrollModeKey}
        scrollPositions={sidebarScrollPositionsRef.current}
        activeSessionId={activeSessionId}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        collapsedProjectPaths={collapsedProjectPaths}
        organization={sidebarOrganization}
        timeline={timeline}
        showTimelinePinned={showTimelinePinned}
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
          removeCatalogProject(target)
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
        hasUnreadAttention={attentionUnreadSessions.length > 0}
        hasArchivableAttention={archivableAttentionSessions.length > 0}
        onMarkAttentionRead={() => void markAttentionRead()}
        onRequestArchiveAttention={requestArchiveAttention}
        onShowTimelinePinnedChange={setShowTimelinePinned}
      />
      <SidebarFooter
        sidebarWidth={sidebarWidth}
        onOpenWhatsNew={onOpenWhatsNew}
        onReport={onReport}
      />
      <ConfirmationDialog
        actionDisabled={archivingAttention}
        actionLabel={archivingAttention ? '归档中…' : '归档任务'}
        description={`将归档 ${archivableAttentionSessions.length} 个已完成的任务；等待问题、权限或计划审批的任务不会被归档。`}
        open={archiveAttentionOpen}
        title="归档需要关注的任务？"
        tone="danger"
        onAction={() => void confirmArchiveAttention()}
        onCancel={() => setArchiveAttentionOpen(false)}
      />
    </div>
  );
}

function expandSidebarProject(
  project: DesktopWorkspace,
  setCollapsedPaths: React.Dispatch<React.SetStateAction<string[]>>,
): void {
  const projectId = sidebarProjectKey(project)
  setCollapsedPaths(current => {
    if (!current.includes(projectId) && !current.includes(project.path)) {
      return current
    }
    return current.filter(path => path !== projectId && path !== project.path)
  })
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
