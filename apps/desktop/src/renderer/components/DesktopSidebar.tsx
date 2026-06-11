import type React from "react";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  FolderOpen,
  FolderGit2,
  History,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Smartphone,
  SquarePen,
} from "lucide-react";
import type {
  DesktopSessionMetadataPatch,
  DesktopWorkspace,
} from "../../shared/types.js";
import type { AppView, SessionListItem } from "../uiTypes.js";
import { IconButton } from "./ui/IconButton.js";

type Props = {
  activeSessionId: string | null;
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  recentWorkspaces: DesktopWorkspace[];
  sessions: SessionListItem[];
  width: number;
  workspace: DesktopWorkspace | null;
  onChooseWorkspace: () => void;
  onCreateSession: () => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onSetWidth: (width: number) => void;
  onUpdateSessionMetadata: (
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ) => void;
};

const PRIMARY_ITEMS: Array<{
  view: AppView;
  label: string;
  icon: React.ReactNode;
  path: string;
}> = [
  {
    view: "quickChat",
    label: "新对话",
    icon: <SquarePen size={16} />,
    path: "/",
  },
  {
    view: "search",
    label: "搜索",
    icon: <Search size={16} />,
    path: "/search",
  },
  {
    view: "plugins",
    label: "插件",
    icon: <Boxes size={16} />,
    path: "/plugins",
  },
  {
    view: "automation",
    label: "自动化",
    icon: <Clock3 size={16} />,
    path: "/automation",
  },
];

const GROUP_LIMIT = 5;

export function DesktopSidebar({
  activeSessionId,
  collapsed,
  maxWidth,
  minWidth,
  recentWorkspaces,
  sessions,
  width,
  workspace,
  onChooseWorkspace,
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
  const [hoveredProjectPath, setHoveredProjectPath] = useState<string | null>(null);

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

  function visibleGroupItems(
    groupKey: string,
    groupSessions: SessionListItem[],
  ): SessionListItem[] {
    return expandedGroups[groupKey]
      ? groupSessions
      : groupSessions.slice(0, GROUP_LIMIT);
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
      <div className="sidebar-content">
        <section className="nav-section primary">
          {PRIMARY_ITEMS.map((item) => (
            <Link
              className={
                isActiveView(item.view) ? "nav-item active" : "nav-item"
              }
              key={item.view}
              to={item.path}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </section>

        {pinnedSessions.length > 0 ? (
          <section className="nav-section conversations">
            <h2 className="section-title">固定</h2>
            <SessionGroup
              activeSessionId={activeSessionId}
              groupKey="pinned"
              isExpanded={expandedGroups.pinned === true}
              now={relativeNow}
              sessions={visibleGroupItems("pinned", pinnedSessions)}
              totalCount={pinnedSessions.length}
              onArchiveSession={archiveSession}
              onPinSession={pinSession}
              onSelectSession={onSelectSession}
              onToggleExpanded={toggleGroup}
              onUnpinSession={unpinSession}
            />
          </section>
        ) : null}

        <section className="nav-section project-actions">
          <div className="sidebar-section-header">
            <h2 className="section-title">项目</h2>
            <div className="sidebar-action-row">
              <IconButton onClick={onChooseWorkspace} title="选择项目">
                <FolderOpen size={15} />
              </IconButton>
              <IconButton
                disabled={!workspace}
                onClick={onCreateSession}
                title="新建对话"
              >
                <Plus size={15} />
              </IconButton>
            </div>
          </div>

          {projectWorkspaces.length === 0 ? (
            <p className="sidebar-empty">暂无最近项目</p>
          ) : (
            projectWorkspaces.map((item) => {
              const groupKey = `project:${item.path}`;
              const workspaceSessions = unpinnedSessions.filter(
                (session) =>
                  !session.standalone && session.workspacePath === item.path,
              );
              return (
                <div className="project-block" key={item.path}>
                  <button
                    aria-current={
                      workspace?.path === item.path ? "page" : undefined
                    }
                    className="project-row"
                    onMouseEnter={() => setHoveredProjectPath(item.path)}
                    onMouseLeave={() =>
                      setHoveredProjectPath(current =>
                        current === item.path ? null : current,
                      )
                    }
                    onClick={() => onOpenWorkspace(item)}
                    type="button"
                  >
                    <span className="nav-icon">
                      {item.isGitRepo === true &&
                      hoveredProjectPath === item.path ? (
                        <FolderGit2 size={15} />
                      ) : (
                        <FolderOpen size={15} />
                      )}
                    </span>
                    <span className="project-name">{item.name}</span>
                  </button>
                  {workspaceSessions.length > 0 ? (
                    <SessionGroup
                      activeSessionId={activeSessionId}
                      groupKey={groupKey}
                      isExpanded={expandedGroups[groupKey] === true}
                      now={relativeNow}
                      sessions={visibleGroupItems(groupKey, workspaceSessions)}
                      totalCount={workspaceSessions.length}
                      onArchiveSession={archiveSession}
                      onPinSession={pinSession}
                      onSelectSession={onSelectSession}
                      onToggleExpanded={toggleGroup}
                      onUnpinSession={unpinSession}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </section>

        <section className="nav-section conversations">
          <h2 className="section-title">对话</h2>
          {standaloneSessions.length === 0 ? (
            <p className="sidebar-empty">暂无对话</p>
          ) : (
            <SessionGroup
              activeSessionId={activeSessionId}
              groupKey="standalone"
              isExpanded={expandedGroups.standalone === true}
              now={relativeNow}
              sessions={visibleGroupItems("standalone", standaloneSessions)}
              totalCount={standaloneSessions.length}
              onArchiveSession={archiveSession}
              onPinSession={pinSession}
              onSelectSession={onSelectSession}
              onToggleExpanded={toggleGroup}
              onUnpinSession={unpinSession}
            />
          )}
        </section>
      </div>

      <div className="sidebar-footer">
        <Link className="footer-button" to="/settings">
          <span className="nav-icon">
            <Settings2 size={17} />
          </span>
          <span>设置</span>
        </Link>
        <IconButton className="mobile-button" onClick={() => {}} title="移动端">
          <Smartphone size={17} />
        </IconButton>
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

function SessionGroup({
  activeSessionId,
  groupKey,
  isExpanded,
  now,
  sessions,
  totalCount,
  onArchiveSession,
  onPinSession,
  onSelectSession,
  onToggleExpanded,
  onUnpinSession,
}: {
  activeSessionId: string | null;
  groupKey: string;
  isExpanded: boolean;
  now: number;
  sessions: SessionListItem[];
  totalCount: number;
  onArchiveSession: (session: SessionListItem) => void;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleExpanded: (groupKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
}): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);

  return (
    <>
      <ul className="task-list">
        {sessions.map((session) => (
          <li
            className={
              session.id === activeSessionId ? "task-row active" : "task-row"
            }
            key={session.id}
            onMouseEnter={() => setHoveredSessionId(session.id)}
            onMouseLeave={() =>
              setHoveredSessionId((current) =>
                current === session.id ? null : current,
              )
            }
          >
            <button
              className="task-button"
              onClick={() => onSelectSession(session)}
              type="button"
            >
              <span className="task-title">{conversationTitle(session)}</span>
            </button>
            <div className="task-trailing">
              {session.status === "running" ? (
                <Loader2 aria-label="???" className="task-spinner" size={12} />
              ) : hoveredSessionId === session.id ? (
                <div className="session-inline-actions">
                  {session.pinnedAt ? (
                    <IconButton
                      className="task-close-button"
                      onClick={() => onUnpinSession(session)}
                      title="????"
                    >
                      <PinOff size={12} />
                    </IconButton>
                  ) : (
                    <IconButton
                      className="task-close-button"
                      onClick={() => onPinSession(session)}
                      title="??"
                    >
                      <Pin size={12} />
                    </IconButton>
                  )}
                  <IconButton
                    className="task-close-button"
                    onClick={() => onArchiveSession(session)}
                    title="??"
                  >
                    <Archive size={12} />
                  </IconButton>
                </div>
              ) : (
                <span className="task-time">
                  {formatRelativeConversationTime(
                    session.lastMessageAt ?? session.createdAt,
                    now,
                  )}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {totalCount > GROUP_LIMIT ? (
        <button
          className="show-more-button"
          onClick={() => onToggleExpanded(groupKey)}
          type="button"
        >
          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span>{isExpanded ? "??" : "????"}</span>
        </button>
      ) : null}
    </>
  );
}

function conversationTitle(session: SessionListItem): string {
  return session.sessionName ?? session.workspaceName;
}

function compareTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function formatRelativeConversationTime(
  timestamp: string | null | undefined,
  now: number,
): string {
  const time = new Date(timestamp ?? "").getTime();
  if (Number.isNaN(time)) return "刚刚";

  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return "刚刚";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 时`;
  return `${Math.floor(elapsed / DAY_MS)} 天`;
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
