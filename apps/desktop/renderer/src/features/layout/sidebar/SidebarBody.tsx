import type React from "react";
import { useState } from "react";
import {
  ChevronDown,
  FolderOpen,
  MoreHorizontal,
  SquarePen,
} from "lucide-react";
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { DesktopWorkspace, SidebarSectionId } from "../../../../shared/types.js";
import type { SessionListItem } from "../../../uiTypes.js";
import { IconButton } from "../../../components/ui/IconButton.js";
import { PopoverItem } from "../../../components/ui/PopoverItem.js";
import { ScrollArea } from "../../../components/ui/ScrollArea.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { SidebarEmptyRow } from "./SidebarRow.js";
import { SidebarProjectGroup } from "./SidebarProjectGroup.js";
import { SidebarSessionGroup } from "./SidebarSessionGroup.js";
import { useDesktopSettings } from "../../settings/useDesktopSettings.js";
import { cx } from "../../../utils/cx.js";

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
  const {
    sidebarOrganization,
    sidebarSort,
    setSidebarOrganization,
    setSidebarSort,
  } = useDesktopSettings();
  const isProjectOrganization = sidebarOrganization === 'projects';

  return (
    <ScrollArea
      className="sidebar-scroll-area tw:mt-4.5 tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="sidebar-scroll-content"
    >
      <div className="sidebar-section-group tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-1.5">
        {pinnedSessions.length > 0 || pinnedWorkspaces.length > 0 ? (
          <section className="sidebar-section tw:grid tw:gap-1">
            <SidebarSectionHeader
              sidebarOrganization={sidebarOrganization}
              sidebarSort={sidebarSort}
              setSidebarOrganization={setSidebarOrganization}
              setSidebarSort={setSidebarSort}
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

        {isProjectOrganization ? (
        <section className="sidebar-section sidebar-projects-section tw:grid tw:gap-1">
          <SidebarSectionHeader
            sidebarOrganization={sidebarOrganization}
            sidebarSort={sidebarSort}
            setSidebarOrganization={setSidebarOrganization}
            setSidebarSort={setSidebarSort}
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
              <SidebarEmptyRow>暂无最近项目</SidebarEmptyRow>
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
        ) : null}

        <section className="sidebar-section tw:grid tw:gap-1">
          <SidebarSectionHeader
            sidebarOrganization={sidebarOrganization}
            sidebarSort={sidebarSort}
            setSidebarOrganization={setSidebarOrganization}
            setSidebarSort={setSidebarSort}
            title="对话"
            sectionId="conversations"
            isCollapsed={collapsedSidebarSections.includes('conversations')}
            onAction={() => onCreateSession(null)}
            onToggle={onToggleSidebarSection}
          />
          {!collapsedSidebarSections.includes('conversations') ? (
            (isProjectOrganization ? standaloneSessions : unpinnedSessions).length === 0 ? (
              <SidebarEmptyRow>暂无对话</SidebarEmptyRow>
            ) : (
              <SidebarSessionGroup
                activeSessionId={activeSessionId}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                groupKey={isProjectOrganization ? 'standalone' : 'flat'}
                now={now}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={isProjectOrganization ? standaloneSessions : unpinnedSessions}
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
  sidebarOrganization,
  sidebarSort,
  setSidebarOrganization,
  setSidebarSort,
  title,
  sectionId,
  isCollapsed,
  onAction,
  onToggle,
}: {
  actionIcon?: React.ReactNode;
  actionTitle?: string;
  sidebarOrganization: 'projects' | 'flat';
  sidebarSort: 'priority' | 'recent' | 'manual';
  setSidebarOrganization: (value: 'projects' | 'flat') => void;
  setSidebarSort: (value: 'priority' | 'recent' | 'manual') => void;
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
      className="sidebar-section-header tw:grid tw:w-full tw:grid-cols-[auto_minmax(0,1fr)_var(--sidebar-trailing-width)] tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:py-1.25 tw:text-sm tw:text-app-text-soft tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-app-panel tw:hover:text-app-text tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
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
      <h2 className="sidebar-section-title tw:m-0 tw:flex tw:min-w-0 tw:items-center tw:text-xs tw:font-[var(--font-weight-label)] tw:text-app-text-soft">
        <span className={cx('sidebar-section-label', 'u-min-w-0', 'u-truncate')}>
          {title}
        </span>
      </h2>
      <span className={cx('sidebar-section-main', 'u-min-w-0', 'u-flex', 'u-items-center')}>
        <ChevronDown
          className={
            "sidebar-section-chevron" +
            (isCollapsed ? "" : " is-expanded")
          }
          size={APP_ICON_SIZE}
        />
      </span>
      <div className="sidebar-section-trailing tw:flex tw:min-h-4 tw:min-w-0 tw:items-center tw:justify-end">
        <div
          className={
            "sidebar-section-actions" +
            (actionsVisible ? " is-visible" : "")
          }
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <PopoverMenu
            open={menuOpen}
            side="top"
            width={165}
            trigger={
              <button aria-label="更多" className="icon-button" type="button">
                <MoreHorizontal size={APP_ICON_SIZE} />
              </button>
            }
            onOpenChange={setMenuOpen}
          >
            <p className="popover-menu-heading">整理</p>
            <PopoverItem
              selected={sidebarOrganization === 'projects'}
              withCheck
              onClick={() => setSidebarOrganization('projects')}
            >
              按项目
            </PopoverItem>
            <PopoverItem
              selected={sidebarOrganization === 'flat'}
              withCheck
              onClick={() => setSidebarOrganization('flat')}
            >
              在一个列表中
            </PopoverItem>
            <div className="popover-menu-separator" role="separator" />
            <p className="popover-menu-heading">排序方式</p>
            <PopoverItem
              selected={sidebarSort === 'priority'}
              withCheck
              onClick={() => setSidebarSort('priority')}
            >
              优先级
            </PopoverItem>
            <PopoverItem
              selected={sidebarSort === 'recent'}
              withCheck
              onClick={() => setSidebarSort('recent')}
            >
              最近更新
            </PopoverItem>
            <PopoverItem
              selected={sidebarSort === 'manual'}
              withCheck
              onClick={() => setSidebarSort('manual')}
            >
              手动排序
            </PopoverItem>
          </PopoverMenu>
          <IconButton onClick={onAction} title={actionTitle}>
            {actionIcon ?? <SquarePen size={APP_ICON_SIZE} />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
