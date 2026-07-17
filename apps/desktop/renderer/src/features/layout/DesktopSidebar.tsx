import type React from "react";
import { useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesktopRemovedWorkspace,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopWorkspace,
  SidebarSectionId,
} from "../../../shared/types.js";
import type { AppView, SessionListItem } from "../../uiTypes.js";
import { SidebarBody } from "./sidebar/SidebarBody.js";
import { SidebarFooter } from "./sidebar/SidebarFooter.js";
import { SidebarEmptyRow } from "./sidebar/SidebarRow.js";
import { SidebarTopNav } from "./sidebar/SidebarTopNav.js";

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
  onUpdateSessionMetadata: (
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => void;
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
  onUpdateSessionMetadata,
  collapsedSidebarSections,
  onToggleSidebarSection,
}: Props): React.ReactNode {
  const location = useLocation();
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<
    Set<string>
  >(() => new Set());

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session.archivedAt),
    [sessions],
  );
  const pinnedSessions = useMemo(
    () =>
      visibleSessions
        .filter((session) => session.pinnedAt)
        .sort((left, right) => compareTimestamp(right.pinnedAt, left.pinnedAt)),
    [visibleSessions],
  );
  const unpinnedSessions = useMemo(
    () => visibleSessions.filter((session) => !session.pinnedAt),
    [visibleSessions],
  );
  const standaloneSessions = useMemo(
    () => unpinnedSessions.filter((session) => session.standalone),
    [unpinnedSessions],
  );
  const projectWorkspaces = useMemo(
    () => mergeProjectWorkspaces(recentWorkspaces, unpinnedSessions, removedWorkspaces),
    [recentWorkspaces, unpinnedSessions, removedWorkspaces],
  );
  const pinnedWorkspaces = useMemo(
    () =>
      projectWorkspaces
        .filter(w => w.pinnedAt)
        .sort((a, b) => compareTimestamp(b.pinnedAt, a.pinnedAt)),
    [projectWorkspaces],
  );
  const unpinnedWorkspaces = useMemo(
    () => projectWorkspaces.filter(w => !w.pinnedAt),
    [projectWorkspaces],
  );

  function isActiveView(view: AppView): boolean {
    if (view === "quickChat") return location.pathname === "/quick-chat";
    return location.pathname === `/${view}`;
  }

  const toggleProjectCollapsed = useCallback((projectPath: string): void => {
    setCollapsedProjectPaths((current) => {
      const next = new Set(current);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }, []);

  function pinSession(session: SessionListItem): void {
    onUpdateSessionMetadata(session.id, { pinnedAt: new Date().toISOString() });
  }

  function unpinSession(session: SessionListItem): void {
    onUpdateSessionMetadata(session.id, { pinnedAt: null });
  }

  function archiveSession(session: SessionListItem): void {
    onUpdateSessionMetadata(session.id, {
      archivedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="sidebar-layout tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-1 tw:flex-col tw:overflow-hidden tw:bg-app-chrome tw:py-2">
      <SidebarTopNav isActiveView={isActiveView} />
      {catalogStatus.state === 'unavailable' ? (
        <SidebarEmptyRow role="status">
          {catalogStatus.error ?? 'The app-server is unavailable. Please try again.'}
        </SidebarEmptyRow>
      ) : null}
      <SidebarBody
        activeSessionId={activeSessionId}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        collapsedProjectPaths={collapsedProjectPaths}
        now={relativeNow}
        pinnedSessions={pinnedSessions}
        pinnedWorkspaces={pinnedWorkspaces}
        projectWorkspaces={unpinnedWorkspaces}
        sessionFallbackTitles={sessionFallbackTitles}
        standaloneSessions={standaloneSessions}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        unpinnedSessions={unpinnedSessions}
        workspace={workspace}
        onArchiveSession={archiveSession}
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
        onToggleProjectCollapsed={toggleProjectCollapsed}
        onUnpinSession={unpinSession}
      />
      <SidebarFooter />
    </div>
  );
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}

function mergeProjectWorkspaces(
  recentWorkspaces: DesktopWorkspace[],
  sessions: SessionListItem[],
  removedWorkspaces: DesktopRemovedWorkspace[],
): DesktopWorkspace[] {
  const removedPaths = new Set(removedWorkspaces.map(r => r.path));
  const byPath = new Map<string, DesktopWorkspace>();
  for (const workspace of recentWorkspaces) {
    if (removedPaths.has(workspace.path)) continue;
    byPath.set(workspace.path, workspace);
  }
  for (const session of sessions) {
    if (session.standalone || byPath.has(session.workspacePath)) continue;
    if (removedPaths.has(session.workspacePath)) continue;
    byPath.set(session.workspacePath, {
      name: session.workspaceName,
      path: session.workspacePath,
    });
  }
  return [...byPath.values()];
}
