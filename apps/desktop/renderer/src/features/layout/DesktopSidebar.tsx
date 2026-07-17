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
import { SidebarTopNav } from "./sidebar/SidebarTopNav.js";
import { buildSidebarViewModel } from './sidebar/sidebarViewModel.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'

type Props = {
  activeSessionId: string | null;
  catalogStatus: DesktopSessionCatalogStatus;
  pendingPermissionSessionIds: ReadonlySet<string>;
  recentWorkspaces: DesktopWorkspace[];
  removedWorkspaces: DesktopRemovedWorkspace[];
  sessionFallbackTitles: Record<string, string>;
  sessions: SessionListItem[];
  unavailableWorkspacePaths: Set<string>;
  workspace: DesktopWorkspace | null;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinWorkspace: (workspace: DesktopWorkspace) => void;
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onArchiveSessions: (sessionIds: readonly string[]) => Promise<{
    failedSessionIds: string[]
    succeededSessionIds: string[]
  }>
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onReport: (message: string) => void
  collapsedSidebarSections: SidebarSectionId[];
  onToggleSidebarSection: (section: SidebarSectionId) => void;
};

export function DesktopSidebar({
  activeSessionId,
  catalogStatus,
  pendingPermissionSessionIds,
  recentWorkspaces,
  removedWorkspaces,
  sessionFallbackTitles,
  sessions,
  unavailableWorkspacePaths,
  workspace,
  onChooseWorkspace,
  onCreateSession,
  onOpenWorkspace,
  onPinWorkspace,
  onUnpinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onArchiveSessions,
  onRenameSession,
  onReport,
  collapsedSidebarSections,
  onToggleSidebarSection,
}: Props): React.ReactNode {
  const location = useLocation();
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const {
    collapsedSidebarProjectPaths,
    setCollapsedSidebarProjectPaths,
    sidebarSessionPins,
    setSidebarSessionPins,
  } = useDesktopSettings()
  const collapsedProjectPaths = useMemo(
    () => new Set(collapsedSidebarProjectPaths),
    [collapsedSidebarProjectPaths],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const viewModel = useMemo(
    () =>
      buildSidebarViewModel({
        pendingPermissionSessionIds,
        recentWorkspaces,
        removedWorkspaces,
        sessionPins: sidebarSessionPins,
        sessions,
      }),
    [
      pendingPermissionSessionIds,
      recentWorkspaces,
      removedWorkspaces,
      sessions,
      sidebarSessionPins,
    ],
  )

  function isActiveView(view: AppView): boolean {
    if (view === "quickChat") return location.pathname === "/quick-chat";
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

  return (
    <div className="sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:py-2">
      <SidebarTopNav isActiveView={isActiveView} />
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
        collapsedProjectPaths={collapsedProjectPaths}
        now={relativeNow}
        pinnedSessions={viewModel.pinnedSessions}
        pinnedWorkspaces={viewModel.pinnedWorkspaces}
        projectWorkspaces={viewModel.projectWorkspaces}
        sessionFallbackTitles={sessionFallbackTitles}
        standaloneSessions={viewModel.standaloneSessions}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        unpinnedSessions={viewModel.unpinnedSessions}
        workspace={workspace}
        onArchiveSessions={archiveSessions}
        onChooseWorkspace={onChooseWorkspace}
        onCreateSession={onCreateSession}
        onOpenWorkspace={onOpenWorkspace}
        onPinSession={pinSession}
        onPinWorkspace={onPinWorkspace}
        onUnpinWorkspace={onUnpinWorkspace}
        collapsedSidebarSections={collapsedSidebarSections}
        onToggleSidebarSection={onToggleSidebarSection}
        onRemoveWorkspace={onRemoveWorkspace}
        onSelectSession={onSelectSession}
        onRenameSession={onRenameSession}
        onToggleProjectCollapsed={toggleProjectCollapsed}
        onUnpinSession={unpinSession}
      />
      <SidebarFooter />
    </div>
  );
}
