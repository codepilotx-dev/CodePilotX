import type React from 'react'
import { ChevronDown, FolderOpen, SquarePen } from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type {
  DesktopWorkspace,
  SidebarSectionId,
} from '../../../../shared/types.js'
import type { SessionListItem } from '../../../uiTypes.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { SidebarEmptyRow } from './SidebarRow.js'
import { SidebarProjectGroup } from './SidebarProjectGroup.js'
import { SidebarSessionGroup } from './SidebarSessionGroup.js'
import { cx } from '../../../utils/cx.js'

type Props = {
  activeSessionId: string | null
  collapsedProjectPaths: Set<string>
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  pinnedSessions: SessionListItem[]
  pinnedWorkspaces: DesktopWorkspace[]
  projectWorkspaces: DesktopWorkspace[]
  sessionFallbackTitles: Record<string, string>
  standaloneSessions: SessionListItem[]
  unavailableWorkspacePaths: Set<string>
  unpinnedSessions: SessionListItem[]
  workspace: DesktopWorkspace | null
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onChooseWorkspace: () => void
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onPinSession: (session: SessionListItem) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onToggleProjectCollapsed: (projectKey: string) => void
  onUnpinSession: (session: SessionListItem) => void
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  collapsedSidebarSections: SidebarSectionId[]
  onToggleSidebarSection: (section: SidebarSectionId) => void
  onReport: (message: string) => void
}

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
  onArchiveSessions,
  onChooseWorkspace,
  onCreateSession,
  onPinSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onRenameSession,
  onToggleProjectCollapsed,
  onUnpinSession,
  onUnpinWorkspace,
  collapsedSidebarSections,
  onToggleSidebarSection,
  onReport,
}: Props): React.ReactNode {
  return (
    <ScrollArea
      className="sidebar-scroll-area tw:mt-4.5 tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="sidebar-scroll-content"
    >
      <div className="sidebar-section-group tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-1.5">
        {pinnedSessions.length > 0 || pinnedWorkspaces.length > 0 ? (
          <SidebarSection
            collapsed={collapsedSidebarSections.includes('pinned')}
            sectionId="pinned"
            title="置顶"
            onToggle={onToggleSidebarSection}
          >
            {pinnedWorkspaces.map(project => (
              <SidebarProjectGroup
                activeSessionId={activeSessionId}
                collapsedProjectPaths={collapsedProjectPaths}
                isUnavailable={unavailableWorkspacePaths.has(project.path)}
                key={project.projectId ?? project.path}
                now={now}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                project={project}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={unpinnedSessions}
                workspace={workspace}
                onArchiveSessions={onArchiveSessions}
                onCreateSession={onCreateSession}
                onPinSession={onPinSession}
                onPinWorkspace={onPinWorkspace}
                onRemoveWorkspace={onRemoveWorkspace}
                onReport={onReport}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onToggleProjectCollapsed={onToggleProjectCollapsed}
                onUnpinSession={onUnpinSession}
                onUnpinWorkspace={onUnpinWorkspace}
              />
            ))}
            {pinnedSessions.length > 0 ? (
              <SidebarSessionGroup
                activeSessionId={activeSessionId}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                groupKey="pinned"
                now={now}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={pinnedSessions}
                onArchiveSessions={onArchiveSessions}
                onPinSession={onPinSession}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onUnpinSession={onUnpinSession}
              />
            ) : null}
          </SidebarSection>
        ) : null}

        <SidebarSection
          action={
            <IconButton onClick={onChooseWorkspace} title="选择项目">
              <FolderOpen size={APP_ICON_SIZE} />
            </IconButton>
          }
          collapsed={collapsedSidebarSections.includes('projects')}
          sectionId="projects"
          title="项目"
          onToggle={onToggleSidebarSection}
        >
          {projectWorkspaces.length === 0 ? (
            <SidebarEmptyRow>暂无项目</SidebarEmptyRow>
          ) : (
            projectWorkspaces.map(project => (
              <SidebarProjectGroup
                activeSessionId={activeSessionId}
                collapsedProjectPaths={collapsedProjectPaths}
                isUnavailable={unavailableWorkspacePaths.has(project.path)}
                key={project.projectId ?? project.path}
                now={now}
                pendingPermissionSessionIds={pendingPermissionSessionIds}
                project={project}
                sessionFallbackTitles={sessionFallbackTitles}
                sessions={unpinnedSessions}
                workspace={workspace}
                onArchiveSessions={onArchiveSessions}
                onCreateSession={onCreateSession}
                onPinSession={onPinSession}
                onPinWorkspace={onPinWorkspace}
                onRemoveWorkspace={onRemoveWorkspace}
                onReport={onReport}
                onSelectSession={onSelectSession}
                onRenameSession={onRenameSession}
                onToggleProjectCollapsed={onToggleProjectCollapsed}
                onUnpinSession={onUnpinSession}
                onUnpinWorkspace={onUnpinWorkspace}
              />
            ))
          )}
        </SidebarSection>

        <SidebarSection
          action={
            <IconButton
              onClick={() => onCreateSession(null)}
              title="新建无项目任务"
            >
              <SquarePen size={APP_ICON_SIZE} />
            </IconButton>
          }
          collapsed={collapsedSidebarSections.includes('recent')}
          sectionId="recent"
          title="任务"
          onToggle={onToggleSidebarSection}
        >
          {standaloneSessions.length === 0 ? (
            <SidebarEmptyRow>暂无无项目任务</SidebarEmptyRow>
          ) : (
            <SidebarSessionGroup
              activeSessionId={activeSessionId}
              pendingPermissionSessionIds={pendingPermissionSessionIds}
              groupKey="standalone"
              now={now}
              sessionFallbackTitles={sessionFallbackTitles}
              sessions={standaloneSessions}
              onArchiveSessions={onArchiveSessions}
              onPinSession={onPinSession}
              onSelectSession={onSelectSession}
              onRenameSession={onRenameSession}
              onUnpinSession={onUnpinSession}
            />
          )}
        </SidebarSection>
      </div>
    </ScrollArea>
  )
}

function SidebarSection({
  action,
  children,
  collapsed,
  sectionId,
  title,
  onToggle,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  collapsed: boolean
  sectionId: SidebarSectionId
  title: string
  onToggle: (section: SidebarSectionId) => void
}): React.ReactNode {
  return (
    <section className="sidebar-section tw:grid tw:gap-1">
      <div
        aria-expanded={!collapsed}
        className="sidebar-section-header tw:rounded-md tw:px-2 tw:py-1.25 tw:text-sm tw:text-app-text-soft"
        role="button"
        tabIndex={0}
        onClick={() => onToggle(sectionId)}
        onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onToggle(sectionId)
        }}
      >
        <h2 className="sidebar-section-title">
          <span className={cx('sidebar-section-label', 'u-min-w-0', 'u-truncate')}>
            {title}
          </span>
        </h2>
        <span className="sidebar-section-main">
          <ChevronDown
            aria-hidden="true"
            className={cx(
              'sidebar-section-chevron',
              !collapsed && 'is-expanded',
            )}
            size={APP_ICON_SIZE}
          />
        </span>
        <div
          className="sidebar-section-trailing"
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          {action}
        </div>
      </div>
      {!collapsed ? children : null}
    </section>
  )
}
