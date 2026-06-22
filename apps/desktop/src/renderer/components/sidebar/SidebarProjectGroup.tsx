import type React from "react";
import { useState } from "react";
import {
  Archive,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  FolderOpen,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Pin,
  SquarePen,
  X,
} from "lucide-react";
import { APP_ICON_SIZE } from '../ui/iconTokens.js'
import type { DesktopWorkspace } from "../../../shared/types.js";
import { desktopClient } from "../../services/desktopClient.js";
import type { SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { PopoverItem } from "../ui/PopoverItem.js";
import { PopoverMenu } from "../ui/PopoverMenu.js";
import { SidebarRow } from "./SidebarRow.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  collapsedProjectPaths: Set<string>;
  now: number;
  project: DesktopWorkspace;
  sessions: SessionListItem[];
  workspace: DesktopWorkspace | null;
  onArchiveSession: (session: SessionListItem) => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinSession: (session: SessionListItem) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleProjectCollapsed: (projectPath: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarProjectGroup({
  activeSessionId,
  collapsedProjectPaths,
  now,
  project,
  sessions,
  workspace,
  onArchiveSession,
  onCreateSession,
  onOpenWorkspace,
  onPinSession,
  onRemoveWorkspace,
  onSelectSession,
  onToggleProjectCollapsed,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const groupKey = `project:${project.path}`;
  const projectSessions = sessions.filter(
    (session) => !session.standalone && session.workspacePath === project.path,
  );
  const actionsVisible = hovered || menuOpen;
  const isExpanded = !collapsedProjectPaths.has(project.path);
  const isCurrent = workspace?.path === project.path;

  return (
    <section className="sidebar-project" onMouseLeave={() => setHovered(false)}>
      <SidebarRow
        aria-current={isCurrent ? "page" : undefined}
        aria-expanded={isExpanded}
        className="sidebar-project-header"
        labelClassName="sidebar-project-name"
        leading={
          project.isGitRepo === true && hovered ? (
            <FolderGit2 size={APP_ICON_SIZE} />
          ) : (
            <FolderOpen size={APP_ICON_SIZE} />
          )
        }
        onClick={() => onToggleProjectCollapsed(project.path)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleProjectCollapsed(project.path);
          }
        }}
        onMouseEnter={() => setHovered(true)}
        role="button"
        tabIndex={0}
        trailing={
          <div
            className={
              actionsVisible
                ? "sidebar-project-actions is-visible"
                : "sidebar-project-actions"
            }
          >
            {projectSessions.length > 0 ? (
              <ChevronDown
                aria-hidden="true"
                className={
                  isExpanded
                    ? "sidebar-project-chevron is-expanded"
                    : "sidebar-project-chevron"
                }
                size={APP_ICON_SIZE}
              />
            ) : null}
            <div
              className="sidebar-project-action-items"
              onClick={(event) => event.stopPropagation()}
            >
              <PopoverMenu
                autoWidth
                className="popover-sidebar-project"
                open={menuOpen}
                side="bottom"
                trigger={
                  <button
                    aria-label="更多"
                    className="icon-button sidebar-project-action-button"
                    type="button"
                  >
                    <MoreHorizontal size={APP_ICON_SIZE} />
                  </button>
                }
                onOpenChange={setMenuOpen}
              >
                <PopoverItem
                  icon={<ExternalLink size={APP_ICON_SIZE} />}
                  onClick={() => onOpenWorkspace(project)}
                >
                  打开项目
                </PopoverItem>
                <PopoverItem icon={<Pin size={APP_ICON_SIZE} />} onClick={() => {}}>
                  置顶项目
                </PopoverItem>
                <PopoverItem
                  icon={<FolderOpen size={APP_ICON_SIZE} />}
                  onClick={() => {
                    void desktopClient.openPathWithDefaultTarget(project.path);
                  }}
                >
                  在资源管理器中打开
                </PopoverItem>
                <PopoverItem icon={<FolderTree size={APP_ICON_SIZE} />} onClick={() => {}}>
                  创建永久工作树
                </PopoverItem>
                <PopoverItem icon={<Pencil size={APP_ICON_SIZE} />} onClick={() => {}}>
                  重命名项目
                </PopoverItem>
                <PopoverItem
                  disabled={projectSessions.length === 0}
                  icon={<Archive size={APP_ICON_SIZE} />}
                  onClick={() => {
                    projectSessions.forEach((session) => onArchiveSession(session));
                  }}
                >
                  归档对话
                </PopoverItem>
                <PopoverItem
                  icon={<X size={APP_ICON_SIZE} />}
                  onClick={() => onRemoveWorkspace(project)}
                >
                  移除
                </PopoverItem>
              </PopoverMenu>

              <IconButton
                className="icon-button sidebar-project-action-button"
                onClick={() => onCreateSession(project)}
                title="新建对话"
              >
                <SquarePen size={APP_ICON_SIZE} />
              </IconButton>
            </div>
          </div>
        }
      >
        {project.name}
      </SidebarRow>

      {projectSessions.length > 0 && isExpanded ? (
        <SidebarSessionGroup
          activeSessionId={activeSessionId}
          groupKey={groupKey}
          now={now}
          sessions={projectSessions}
          onArchiveSession={onArchiveSession}
          onPinSession={onPinSession}
          onSelectSession={onSelectSession}
          onUnpinSession={onUnpinSession}
        />
      ) : null}
    </section>
  );
}
