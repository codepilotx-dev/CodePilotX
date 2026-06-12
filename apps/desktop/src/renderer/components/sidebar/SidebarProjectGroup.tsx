import type React from "react";
import { useState } from "react";
import {
  Archive,
  FolderGit2,
  FolderOpen,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Pin,
  SquarePen,
  X,
} from "lucide-react";
import type { DesktopWorkspace } from "../../../shared/types.js";
import type { SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { PopoverItem } from "../ui/PopoverItem.js";
import { PopoverMenu } from "../ui/PopoverMenu.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  expandedGroups: Record<string, boolean>;
  now: number;
  project: DesktopWorkspace;
  sessions: SessionListItem[];
  workspace: DesktopWorkspace | null;
  onArchiveSession: (session: SessionListItem) => void;
  onCreateSession: () => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinSession: (session: SessionListItem) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleExpanded: (groupKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarProjectGroup({
  activeSessionId,
  expandedGroups,
  now,
  project,
  sessions,
  workspace,
  onArchiveSession,
  onCreateSession,
  onOpenWorkspace,
  onPinSession,
  onSelectSession,
  onToggleExpanded,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const groupKey = `project:${project.path}`;
  const projectSessions = sessions.filter(
    (session) => !session.standalone && session.workspacePath === project.path,
  );
  const actionsVisible = hovered || menuOpen;

  return (
    <section className="sidebar-project" onMouseLeave={() => setHovered(false)}>
      <div
        className="sidebar-project-header"
        onMouseEnter={() => setHovered(true)}
      >
        <button
          aria-current={workspace?.path === project.path ? "page" : undefined}
          className="sidebar-project-button"
          onClick={() => onOpenWorkspace(project)}
          type="button"
        >
          <span className="sidebar-item-icon">
            {project.isGitRepo === true && hovered ? (
              <FolderGit2 size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
          </span>
          <span className="sidebar-project-name">{project.name}</span>
        </button>
        <div
          className={
            actionsVisible
              ? "sidebar-project-actions is-visible"
              : "sidebar-project-actions"
          }
        >
          <PopoverMenu
            open={menuOpen}
            trigger={
              <button
                aria-label="更多"
                className="icon-button sidebar-project-action-button"
                type="button"
              >
                <MoreHorizontal size={14} />
              </button>
            }
            onOpenChange={setMenuOpen}
          >
            <PopoverItem icon={<Pin size={14} />} onClick={() => {}}>
              置顶项目
            </PopoverItem>
            <PopoverItem
              icon={<FolderOpen size={14} />}
              onClick={() => {
                void window.desktopApi.openPathWithDefaultTarget(project.path);
              }}
            >
              在资源管理器中打开
            </PopoverItem>
            <PopoverItem icon={<FolderTree size={14} />} onClick={() => {}}>
              创建永久工作树
            </PopoverItem>
            <PopoverItem icon={<Pencil size={14} />} onClick={() => {}}>
              重命名项目
            </PopoverItem>
            <PopoverItem icon={<Archive size={14} />} onClick={() => {}}>
              归档对话
            </PopoverItem>
            <PopoverItem icon={<X size={14} />} onClick={() => {}}>
              移除
            </PopoverItem>
          </PopoverMenu>

          <IconButton
            className="sidebar-project-action-button"
            disabled={!workspace}
            onClick={onCreateSession}
            title="新建对话"
          >
            <SquarePen size={14} />
          </IconButton>
        </div>
      </div>

      {projectSessions.length > 0 ? (
        <SidebarSessionGroup
          activeSessionId={activeSessionId}
          groupKey={groupKey}
          isExpanded={expandedGroups[groupKey] === true}
          now={now}
          sessions={projectSessions}
          onArchiveSession={onArchiveSession}
          onPinSession={onPinSession}
          onSelectSession={onSelectSession}
          onToggleExpanded={onToggleExpanded}
          onUnpinSession={onUnpinSession}
        />
      ) : null}
    </section>
  );
}
