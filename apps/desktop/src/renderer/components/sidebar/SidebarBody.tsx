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
import type { DesktopWorkspace } from "../../../shared/types.js";
import type { SessionListItem } from "../../uiTypes.js";
import { IconButton } from "../ui/IconButton.js";
import { PopoverItem } from "../ui/PopoverItem.js";
import { PopoverMenu } from "../ui/PopoverMenu.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  expandedGroups: Record<string, boolean>;
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
  onToggleExpanded: (groupKey: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
};

export function SidebarBody({
  activeSessionId,
  expandedGroups,
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
  onToggleExpanded,
  onUnpinSession,
}: Props): React.ReactNode {
  return (
    <div className="sidebar-body">
      {pinnedSessions.length > 0 ? (
        <section className="sidebar-section">
          <h2 className="sidebar-section-title">置顶</h2>
          <SidebarSessionGroup
            activeSessionId={activeSessionId}
            groupKey="pinned"
            isExpanded={expandedGroups.pinned === true}
            now={now}
            sessions={pinnedSessions}
            onArchiveSession={onArchiveSession}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleExpanded={onToggleExpanded}
            onUnpinSession={onUnpinSession}
          />
        </section>
      ) : null}

      <section className="sidebar-section sidebar-projects-section">
        <SidebarSectionHeader
          actionIcon={<FolderOpen size={14} />}
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
              expandedGroups={expandedGroups}
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
              onToggleExpanded={onToggleExpanded}
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
            isExpanded={expandedGroups.standalone === true}
            now={now}
            sessions={standaloneSessions}
            onArchiveSession={onArchiveSession}
            onPinSession={onPinSession}
            onSelectSession={onSelectSession}
            onToggleExpanded={onToggleExpanded}
            onUnpinSession={onUnpinSession}
          />
        )}
      </section>
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
              <MoreHorizontal size={14} />
            </button>
          }
          onOpenChange={setMenuOpen}
        >
          <PopoverItem icon={<Archive size={14} />} onClick={() => {}}>
            归档所有聊天
          </PopoverItem>
          <div className="popover-divider" />
          <SidebarSubmenu icon={<Folder size={14} />} label="整理侧边栏">
            <PopoverItem icon={<Folder size={14} />} selected withCheck>
              按项目
            </PopoverItem>
            <PopoverItem icon={<Folder size={14} />}>近期项目</PopoverItem>
            <PopoverItem icon={<Clock3 size={14} />}>按时间顺序</PopoverItem>
            <PopoverItem icon={<ArrowDown size={14} />}>下移</PopoverItem>
          </SidebarSubmenu>
          <SidebarSubmenu icon={<Clock3 size={14} />} label="排序条件">
            <PopoverItem icon={<CirclePlus size={14} />}>创建时间</PopoverItem>
            <PopoverItem icon={<PenLine size={14} />} selected withCheck>
              更新时间
            </PopoverItem>
          </SidebarSubmenu>
        </PopoverMenu>
        <IconButton onClick={onAction} title={actionTitle}>
          {actionIcon ?? <SquarePen size={14} />}
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
        <ChevronRight className="popover-item-arrow" size={14} />
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
