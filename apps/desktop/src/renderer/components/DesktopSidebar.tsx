import type React from "react";
import { useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { Bot, History } from "lucide-react";
import type {
  DesktopSessionMetadataPatch,
  DesktopWorkspace,
} from "../../shared/types.js";
import type { AppView, SessionListItem } from "../uiTypes.js";
import { SidebarBody } from "./sidebar/SidebarBody.js";
import { SidebarFooter } from "./sidebar/SidebarFooter.js";
import { SidebarTopNav } from "./sidebar/SidebarTopNav.js";

type Props = {
  activeSessionId: string | null;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  recentWorkspaces: DesktopWorkspace[];
  sessions: SessionListItem[];
  width: number;
  workspace: DesktopWorkspace | null;
  onCreateSession: () => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onSetWidth: (width: number) => void;
  onUpdateSessionMetadata: (
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => void;
};

export function DesktopSidebar({
  activeSessionId,
  collapsed,
  maxWidth,
  minWidth,
  recentWorkspaces,
  sessions,
  width,
  workspace,
  onCreateSession,
  onOpenWorkspace,
  onSelectSession,
  onSetWidth,
  onUpdateSessionMetadata,
}: Props): React.ReactNode {
  const location = useLocation();
  const [resizing, setResizing] = useState(false);
  const [relativeNow, setRelativeNow] = useState(() => Date.now());
  const [start, setStart] = useState({ x: 0, width });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    {},
  );

  useEffect(() => {
    const timer = window.setInterval(() => setRelativeNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    function handlePointerMove(event: PointerEvent): void {
      onSetWidth(start.width + event.clientX - start.x);
    }

    function stopResize(): void {
      setResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", stopResize);
    document.addEventListener("pointercancel", stopResize);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", stopResize);
      document.removeEventListener("pointercancel", stopResize);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [onSetWidth, resizing, start.width, start.x]);

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
    () => mergeProjectWorkspaces(recentWorkspaces, unpinnedSessions),
    [recentWorkspaces, unpinnedSessions],
  );

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (collapsed) return;
    event.preventDefault();
    setStart({ x: event.clientX, width });
    setResizing(true);
  }

  function handleResizeKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return;
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onSetWidth(width - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onSetWidth(width + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      onSetWidth(minWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      onSetWidth(maxWidth);
    }
  }

  function isActiveView(view: AppView): boolean {
    if (view === "quickChat") return location.pathname === "/";
    return location.pathname === `/${view}`;
  }

  function toggleGroup(groupKey: string): void {
    setExpandedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }

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
    <aside
      aria-label="侧边栏"
      className={[
        "desktop-sidebar",
        collapsed ? "is-collapsed" : "",
        resizing ? "is-resizing" : "",
      ].join(" ")}
      style={{ "--sidebar-current-w": `${width}px` } as React.CSSProperties}
    >
      <div className="sidebar-layout">
        <SidebarTopNav isActiveView={isActiveView} />
        <SidebarBody
          activeSessionId={activeSessionId}
          expandedGroups={expandedGroups}
          now={relativeNow}
          pinnedSessions={pinnedSessions}
          projectWorkspaces={projectWorkspaces}
          standaloneSessions={standaloneSessions}
          unpinnedSessions={unpinnedSessions}
          workspace={workspace}
          onArchiveSession={archiveSession}
          onCreateSession={onCreateSession}
          onOpenWorkspace={onOpenWorkspace}
          onPinSession={pinSession}
          onSelectSession={onSelectSession}
          onToggleExpanded={toggleGroup}
          onUnpinSession={unpinSession}
        />
        <SidebarFooter />
      </div>

      <div
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemax={maxWidth}
        aria-valuemin={minWidth}
        aria-valuenow={width}
        className="sidebar-resizer"
        onKeyDown={handleResizeKey}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      />
      <div className="sidebar-brand-floating">
        <Bot size={16} />
      </div>
      <History className="sidebar-history-watermark" size={14} />
    </aside>
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
): DesktopWorkspace[] {
  const byPath = new Map<string, DesktopWorkspace>();
  for (const workspace of recentWorkspaces) {
    byPath.set(workspace.path, workspace);
  }
  for (const session of sessions) {
    if (session.standalone || byPath.has(session.workspacePath)) continue;
    byPath.set(session.workspacePath, {
      name: session.workspaceName,
      path: session.workspacePath,
    });
  }
  return [...byPath.values()];
}
