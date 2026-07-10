import type React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import {
  Archive,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Clock3,
  CirclePlus,
  Folder,
  FolderOpen,
  MoreHorizontal,
  PenLine,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { DesktopWorkspace, SidebarSectionId } from "../../../../shared/types.js";
import type { SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";

type Props = {
  activeSessionId: string | null;
  collapsedProjectPaths: Set<string>;
  now: number;
  pendingPermissionSessionIds: ReadonlySet<string>;
  pinnedSessions: SessionListItem[];
  pinnedWorkspaces: DesktopWorkspace[];
  projectWorkspaces: DesktopWorkspace[];
  sessionFallbackTitles: Record<string, string>;
  standaloneSessions: SessionListItem[];
  unavailableWorkspacePaths: Set<string>;
  unpinnedSessions: SessionListItem[];
  workspace: DesktopWorkspace | null;
  onArchiveSession: (session: SessionListItem) => void;
  onChooseWorkspace: () => void;
  onCreateSession: (workspace?: DesktopWorkspace | null) => void;
  onOpenWorkspace: (workspace: DesktopWorkspace) => void;
  onPinSession: (session: SessionListItem) => void;
  onPinWorkspace: (workspace: DesktopWorkspace) => void;
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void;
  onSelectSession: (session: SessionListItem) => void;
  onToggleProjectCollapsed: (projectPath: string) => void;
  onUnpinSession: (session: SessionListItem) => void;
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void;
  collapsedSidebarSections: SidebarSectionId[];
  onToggleSidebarSection: (section: SidebarSectionId) => void;
};

export function SidebarBody({
  activeSessionId,
  collapsedProjectPaths,
  now,
  pendingPermissionSessionIds,
  pinnedSessions,
  pinnedWorkspaces,
  projectWorkspaces,
  sessionFallbackTitles,
  standaloneSessions,
  unavailableWorkspacePaths,
  unpinnedSessions,
  workspace,
  onArchiveSession,
  onChooseWorkspace,
  onCreateSession,
  onOpenWorkspace,
  onPinSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onToggleProjectCollapsed,
  onUnpinSession,
  onUnpinWorkspace,
  collapsedSidebarSections,
  onToggleSidebarSection,
}: Props): React.ReactNode {
  return (
    <ScrollArea
      className="sidebar-scroll-area"
      contentClassName="sidebar-scroll-content"
    >
      <div className="sidebar-section-group">
        {pinnedSessions.length > 0 || pinnedWorkspaces.length > 0 ? (
          <section className="sidebar-section">
            <SidebarSectionHeader
              title="置顶"
              sectionId="pinned"
              isCollapsed={collapsedSidebarSections.includes('pinned')}
              onAction={() => {}}
              onToggle={onToggleSidebarSection}
            />
            {!collapsedSidebarSections.includes('pinned') ? (
              <>
                {pinnedSessions.length > 0 ? (
                  <SidebarSessionGroup
                    activeSessionId={activeSessionId}
                    pendingPermissionSessionIds={pendingPermissionSessionIds}
                    groupKey="pinned"
                    now={now}
                    sessionFallbackTitles={sessionFallbackTitles}
                    sessions={pinnedSessions}
                    onArchiveSession={onArchiveSession}
                    onPinSession={onPinSession}
                    onSelectSession={onSelectSession}
                    onUnpinSession={onUnpinSession}
                  />
                ) : null}
                {pinnedWorkspaces.map((project) => (
                  <SidebarProjectGroup
                    activeSessionId={activeSessionId}
                    pendingPermissionSessionIds={pendingPermissionSessionIds}
                    collapsedProjectPaths={collapsedProjectPaths}
                    key={project.path}
                    isUnavailable={unavailableWorkspacePaths.has(project.path)}
                    now={now}
                    project={project}
                    sessionFallbackTitles={sessionFallbackTitles}
                    sessions={unpinnedSessions}
                    workspace={workspace}
                    onArchiveSession={onArchiveSession}
                    onCreateSession={onCreateSession}
                    onOpenWorkspace={onOpenWorkspace}
                    onPinSession={onPinSession}
                    onPinWorkspace={onPinWorkspace}
                    onUnpinWorkspace={onUnpinWorkspace}
                    onRemoveWorkspace={onRemoveWorkspace}
                    onSelectSession={onSelectSession}
                    onToggleProjectCollapsed={onToggleProjectCollapsed}
                    onUnpinSession={onUnpinSession}
                  />
                ))}
              </>
            ) : null}
          </section>
        ) : null}

        <section className="sidebar-section sidebar-projects-section">
          <SidebarSectionHeader
            actionIcon={<FolderOpen size={APP_ICON_SIZE} />}
            actionTitle="选择项目"
            title="项目"
            sectionId="projects"
            isCollapsed={collapsedSidebarSections.includes('projects')}
            onAction={onChooseWorkspace}
            onToggle={onToggleSidebarSection}
          />
          {!collapsedSidebarSections.includes('projects') ? (
            projectWorkspaces.length === 0 ? (
              <p className="sidebar-empty">暂无最近项目</p>
            ) : (
              projectWorkspaces.map((project) => (
                <SidebarProjectGroup
                  activeSessionId={activeSessionId}
                  pendingPermissionSessionIds={pendingPermissionSessionIds}
                  collapsedProjectPaths={collapsedProjectPaths}
                  key={project.path}
                  isUnavailable={unavailableWorkspacePaths.has(project.path)}
                  now={now}
                  project={project}
                  sessionFallbackTitles={sessionFallbackTitles}
                  sessions={unpinnedSessions}
                  workspace={workspace}
                  onArchiveSession={onArchiveSession}
                  onCreateSession={onCreateSession}
                  onOpenWorkspace={onOpenWorkspace}
                  onPinSession={onPinSession}
                  onPinWorkspace={onPinWorkspace}
                  onUnpinWorkspace={onUnpinWorkspace}
                  onRemoveWorkspace={onRemoveWorkspace}
                  onSelectSession={onSelectSession}
                  onToggleProjectCollapsed={onToggleProjectCollapsed}
                  onUnpinSession={onUnpinSession}
                />
              ))
            )
          ) : null}
        </section>

        <section className="sidebar-section">
          <SidebarSectionHeader
            title="对话"
            sectionId="conversations"
            isCollapsed={collapsedSidebarSections.includes('conversations')}
            onAction={() => onCreateSession(null)}
            onToggle={onToggleSidebarSection}
          />
          {!collapsedSidebarSections.includes('conversations') ? (
            standaloneSessions.length === 0 ? (
              <p className="sidebar-empty">暂无对话</p>
            ) : (
              <SidebarSessionGroup
                activeSessionId={activeSessionId}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                groupKey="standalone"
                now={now}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={standaloneSessions}
                onArchiveSession={onArchiveSession}
                onPinSession={onPinSession}
                onSelectSession={onSelectSession}
                onUnpinSession={onUnpinSession}
              />
            )
          ) : null}
        </section>
      </div>
    </ScrollArea>
  );
}

function SidebarSectionHeader({
  actionIcon,
  actionTitle = "新建对话",
  title,
  sectionId,
  isCollapsed,
  onAction,
  onToggle,
}: {
  actionIcon?: React.ReactNode;
  actionTitle?: string;
  title: string;
  sectionId: SidebarSectionId;
  isCollapsed: boolean;
  onAction: () => void;
  onToggle: (sectionId: SidebarSectionId) => void;
}): React.ReactNode {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const actionsVisible = hovered || menuOpen;
  return (
    <div
      className="sidebar-section-header"
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      onClick={() => onToggle(sectionId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(sectionId);
        }
      }}
    >
      <h2 className="sidebar-section-title">
        <span className="sidebar-section-label">{title}</span>
        <ChevronDown
          className={
            "sidebar-section-chevron" +
            (isCollapsed ? "" : " is-expanded")
          }
          size={APP_ICON_SIZE}
        />
      </h2>
      <div className="sidebar-section-trailing">
        <div
          className={
            "sidebar-section-actions" +
            (actionsVisible ? " is-visible" : "")
          }
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
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
          className="popover-surface popover popover-sub-content popover-auto-width"
          sideOffset={8}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
