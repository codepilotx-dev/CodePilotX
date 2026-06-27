import type React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import {
  Archive,
  ArrowDown,
  ChevronRight,
  Clock3,
  CirclePlus,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PenLine,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../ui/iconTokens.js'
import type { DesktopWorkspace } from "../../../shared/types.js";
import type { SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { PopoverItem } from "../ui/PopoverItem.js";
import { PopoverMenu } from "../ui/PopoverMenu.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  collapsedProjectPaths: Set<string>;
  now: number;
  pinnedSessions: SessionListItem[];
  projectWorkspaces: DesktopWorkspace[];
  standaloneSessions: SessionListItem[];
  unpinnedSessions: SessionListItem[];
  workspace: DesktopWorkspace | null;
  onArchiveSession: (session: SessionListItem) => void;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinSession: (session: SessionListItem) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleProjectCollapsed: (projectPath: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarBody({
  activeSessionId,
  collapsedProjectPaths,
  now,
  pinnedSessions,
  projectWorkspaces,
  standaloneSessions,
  unpinnedSessions,
  workspace,
  onArchiveSession,
  onChooseWorkspace,
  onCreateSession,
  onOpenWorkspace,
  onPinSession,
  onRemoveWorkspace,
  onSelectSession,
  onToggleProjectCollapsed,
  onUnpinSession,
}: Props): React.ReactNode {
  return (
    <div className="sidebar-body">
      <div className="sidebar-section-group">
        {pinnedSessions.length > 0 ? (
          <section className="sidebar-section">
            <h2 className="sidebar-section-title">置顶</h2>
            <SidebarSessionGroup
              activeSessionId={activeSessionId}
              groupKey="pinned"
              now={now}
              sessions={pinnedSessions}
              onArchiveSession={onArchiveSession}
              onPinSession={onPinSession}
              onSelectSession={onSelectSession}
              onUnpinSession={onUnpinSession}
            />
          </section>
        ) : null}

        <section className="sidebar-section sidebar-projects-section">
          <SidebarSectionHeader
            actionIcon={<FolderOpen size={APP_ICON_SIZE} />}
            actionTitle="选择项目"
            title="项目"
            onAction={onChooseWorkspace}
          />
          {projectWorkspaces.length === 0 ? (
            <p className="sidebar-empty">暂无最近项目</p>
          ) : (
            projectWorkspaces.map((project) => (
              <SidebarProjectGroup
                activeSessionId={activeSessionId}
                collapsedProjectPaths={collapsedProjectPaths}
                key={project.path}
                now={now}
                project={project}
                sessions={unpinnedSessions}
                workspace={workspace}
                onArchiveSession={onArchiveSession}
                onCreateSession={onCreateSession}
                onOpenWorkspace={onOpenWorkspace}
                onPinSession={onPinSession}
                onRemoveWorkspace={onRemoveWorkspace}
                onSelectSession={onSelectSession}
                onToggleProjectCollapsed={onToggleProjectCollapsed}
                onUnpinSession={onUnpinSession}
              />
            ))
          )}
        </section>

        <section className="sidebar-section">
          <SidebarSectionHeader
            title="对话"
            onAction={() => onCreateSession(null)}
          />
          {standaloneSessions.length === 0 ? (
            <p className="sidebar-empty">暂无对话</p>
          ) : (
            <SidebarSessionGroup
              activeSessionId={activeSessionId}
              groupKey="standalone"
              now={now}
              sessions={standaloneSessions}
              onArchiveSession={onArchiveSession}
              onPinSession={onPinSession}
              onSelectSession={onSelectSession}
              onUnpinSession={onUnpinSession}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function SidebarSectionHeader({
  actionIcon,
  actionTitle = "新建对话",
  title,
  onAction,
}: {
  actionIcon?: React.ReactNode;
  actionTitle?: string;
  title: string;
  onAction: () => void;
}): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="sidebar-section-header">
      <h2 className="sidebar-section-title">{title}</h2>
      <div
        className={
          menuOpen
            ? "sidebar-section-actions is-visible"
            : "sidebar-section-actions"
        }
      >
        <PopoverMenu
          autoWidth
          className="popover-sidebar-section"
          open={menuOpen}
          side="top"
          trigger={
            <button aria-label="更多" className="icon-button" type="button">
              <MoreHorizontal size={APP_ICON_SIZE} />
            </button>
          }
          onOpenChange={setMenuOpen}
        >
          <PopoverItem icon={<Archive size={APP_ICON_SIZE} />} onClick={() => {}}>
            归档所有聊天
          </PopoverItem>
          <div className="popover-divider" />
          <SidebarSubmenu icon={<Folder size={APP_ICON_SIZE} />} label="整理侧边栏">
            <PopoverItem icon={<Folder size={APP_ICON_SIZE} />} selected withCheck>
              按项目
            </PopoverItem>
            <PopoverItem icon={<Folder size={APP_ICON_SIZE} />}>近期项目</PopoverItem>
            <PopoverItem icon={<Clock3 size={APP_ICON_SIZE} />}>按时间顺序</PopoverItem>
            <PopoverItem icon={<ArrowDown size={APP_ICON_SIZE} />}>下移</PopoverItem>
          </SidebarSubmenu>
          <SidebarSubmenu icon={<Clock3 size={APP_ICON_SIZE} />} label="排序条件">
            <PopoverItem icon={<CirclePlus size={APP_ICON_SIZE} />}>创建时间</PopoverItem>
            <PopoverItem icon={<PenLine size={APP_ICON_SIZE} />} selected withCheck>
              更新时间
            </PopoverItem>
          </SidebarSubmenu>
        </PopoverMenu>
        <IconButton onClick={onAction} title={actionTitle}>
          {actionIcon ?? <SquarePen size={APP_ICON_SIZE} />}
        </IconButton>
      </div>
    </div>
  );
}

function SidebarSubmenu({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  label: string;
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        tabIndex={-1}
      >
        <span className="popover-item-icon">{icon}</span>
        <span className="popover-item-label">{label}</span>
        <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZE} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-6}
          className="popover popover-sub-content popover-auto-width"
          sideOffset={8}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
