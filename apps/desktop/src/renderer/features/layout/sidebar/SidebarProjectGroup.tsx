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
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { DesktopWorkspace } from "../../../../shared/types.js";
import { desktopClient } from "../../../services/desktopClient.js";
import type { SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { SidebarRow } from "./SidebarRow.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from "./SidebarContextMenu.js";

type Props = {
  activeSessionId: string | null;
  collapsedProjectPaths: Set<string>;
  isUnavailable: boolean;
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
  isUnavailable,
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
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const groupKey = `project:${project.path}`;
  const projectSessions = sessions.filter(
    (session) => !session.standalone && session.workspacePath === project.path,
  );
  const actionsVisible = hovered || menuOpen;
  const isExpanded = !collapsedProjectPaths.has(project.path);
  const isCurrent = workspace?.path === project.path;

  function getProjectContextMenuActions(): ContextMenuAction[] {
    return [
      {
        kind: 'item',
        label: '在资源管理器中打开',
        icon: <FolderOpen size={APP_ICON_SIZE} />,
        disabled: isUnavailable,
        onSelect: () => {
          void desktopClient.openPathWithDefaultTarget(project.path);
        },
      },
      {
        kind: 'item',
        label: '重命名项目',
        icon: <Pencil size={APP_ICON_SIZE} />,
        onSelect: () => {
          // eslint-disable-next-line no-console
          console.log('[TODO] rename project', project.path);
        },
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '归档所有对话',
        icon: <Archive size={APP_ICON_SIZE} />,
        disabled: projectSessions.length === 0,
        onSelect: () => {
          projectSessions.forEach((session) => onArchiveSession(session));
        },
      },
      {
        kind: 'item',
        label: '移除',
        icon: <X size={APP_ICON_SIZE} />,
        color: 'red',
        onSelect: () => setConfirmRemoveOpen(true),
      },
    ];
  }

  return (
    <section className="sidebar-project" onMouseLeave={() => setHovered(false)}>
      <SidebarContextMenu
        actions={getProjectContextMenuActions()}
        trigger={
          <SidebarRow
            aria-current={isCurrent ? "page" : undefined}
            aria-disabled={isUnavailable ? true : undefined}
            aria-expanded={isExpanded}
            className={
              isUnavailable
                ? "sidebar-project-header sidebar-project-header--unavailable"
                : "sidebar-project-header"
            }
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
                      disabled={isUnavailable}
                      onClick={() => onOpenWorkspace(project)}
                    >
                      打开项目
                    </PopoverItem>
                    <PopoverItem icon={<Pin size={APP_ICON_SIZE} />} onClick={() => {}}>
                      置顶项目
                    </PopoverItem>
                    <PopoverItem
                      icon={<FolderOpen size={APP_ICON_SIZE} />}
                      disabled={isUnavailable}
                      onClick={() => {
                        void desktopClient.openPathWithDefaultTarget(project.path);
                      }}
                    >
                      在资源管理器中打开
                    </PopoverItem>
                    <PopoverItem
                      disabled={isUnavailable}
                      icon={<FolderTree size={APP_ICON_SIZE} />}
                      onClick={() => {}}
                    >
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
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmRemoveOpen(true);
                      }}
                    >
                      移除
                    </PopoverItem>
                  </PopoverMenu>

                  <ConfirmationDialog
                    actionLabel="移除"
                    cancelLabel="取消"
                    description="该项目将从 Codex 中移除，其下的对话将一并归档。磁盘上的文件不会被删除。"
                    open={confirmRemoveOpen}
                    title={`移除 ${project.name}?`}
                    tone="danger"
                    onAction={() => {
                      setConfirmRemoveOpen(false);
                      projectSessions.forEach((session) => onArchiveSession(session));
                      onRemoveWorkspace(project);
                    }}
                    onCancel={() => {
                      setConfirmRemoveOpen(false);
                    }}
                  />

                  <IconButton
                    className="icon-button sidebar-project-action-button"
                    disabled={isUnavailable}
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
        }
      />

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
