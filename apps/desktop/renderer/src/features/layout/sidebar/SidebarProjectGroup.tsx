import type React from 'react'
import { memo, useEffect, useId, useState } from 'react'
import {
  Archive,
  FolderOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings2,
  SquarePen,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type {
  DesktopSidebarSort,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { SessionListItem } from '../../../uiTypes.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  type KeyedDisclosureStore,
  useDisclosureExpanded,
} from '../../../components/ui/keyedDisclosureStore.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SidebarRow } from './SidebarRow.js'
import { SidebarSessionGroup } from './SidebarSessionGroup.js'
import {
  AppContextMenu as SidebarContextMenu,
  type AppContextMenuAction as ContextMenuAction,
} from '../../../components/ui/AppContextMenu.js'
import { cx } from '../../../utils/cx.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  ProjectAppearanceGlyph,
} from '../../projects/projectAppearance.js'
import {
  type SidebarProjectSessionBucket,
  sidebarProjectKey,
  normalizeSidebarPath,
} from './sidebarViewModel.js'
import { SidebarProjectHoverCard } from './SidebarProjectHoverCard.js'
import { ProjectManagementDialogs } from '../../projects/ProjectManagementDialogs.js'
import { sidebarProjectDisclosureKey } from './sidebarDisclosureStore.js'

type Props = {
  activeSessionId: string | null
  bucket: SidebarProjectSessionBucket
  disclosureStore: KeyedDisclosureStore
  isUnavailable: boolean
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  project: DesktopWorkspace
  sessionFallbackTitles: Record<string, string>
  sort?: DesktopSidebarSort
  manualOrderByScope?: Record<string, string[]>
  workspace: DesktopWorkspace | null
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onManualOrderChange?: (scopeKey: string, order: string[]) => void
  onSortChange?: (sort: 'manual') => void
  onPinSession: (session: SessionListItem) => void
  onUnpinSession: (session: SessionListItem) => void
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport?: (message: string) => void
}

function SidebarProjectGroupComponent({
  activeSessionId,
  bucket,
  disclosureStore,
  isUnavailable,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  project,
  sessionFallbackTitles,
  sort = 'priority',
  manualOrderByScope = {},
  workspace,
  onArchiveSessions,
  onCreateSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onManualOrderChange,
  onSortChange,
  onPinSession,
  onUnpinSession,
  onUnpinWorkspace,
  onReport = () => undefined,
}: Props): React.ReactNode {
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managedProject, setManagedProject] = useState(project)
  const [processingAction, setProcessingAction] = useState<
    'archive' | null
  >(null)
  const { projectAppearances } = useDesktopSettings()

  useEffect(() => setManagedProject(project), [project])

  const projectKey = sidebarProjectKey(managedProject)
  const disclosureKey = sidebarProjectDisclosureKey(managedProject)
  const isExpanded = useDisclosureExpanded(disclosureStore, disclosureKey)
  const projectSessionsId = useId()
  const projectSessions = bucket.displaySessions
  const countedProjectSessions = bucket.allSessions
  const unreadCount = bucket.unreadCount
  const openCount = bucket.openCount
  const isCurrent =
    workspace?.projectId && managedProject.projectId
      ? workspace.projectId === managedProject.projectId
      : normalizeSidebarPath(workspace?.path ?? '') ===
        normalizeSidebarPath(managedProject.path)
  const actionsVisible = hovered || menuOpen
  const isPinned = Boolean(managedProject.pinnedAt)
  const appearance = managedProject.projectId
    ? projectAppearances[managedProject.projectId]
      ?? DEFAULT_PROJECT_APPEARANCE
    : DEFAULT_PROJECT_APPEARANCE

  function archiveAll(): void {
    setProcessingAction('archive')
    void onArchiveSessions(countedProjectSessions).finally(() =>
      setProcessingAction(null),
    )
  }

  function togglePinned(): void {
    if (isPinned) {
      onUnpinWorkspace(managedProject)
    } else {
      onPinWorkspace(managedProject)
    }
  }

  function contextActions(): ContextMenuAction[] {
    return [
      {
        kind: 'item',
        label: isPinned ? '取消置顶项目' : '置顶项目',
        icon: isPinned
          ? <PinOff size={APP_ICON_SIZE} />
          : <Pin size={APP_ICON_SIZE} />,
        onSelect: togglePinned,
      },
      {
        kind: 'item',
        label: '在资源管理器中打开',
        icon: <FolderOpen size={APP_ICON_SIZE} />,
        disabled: isUnavailable,
        onSelect: () => {
          void desktopClient.openPathWithDefaultTarget(managedProject.path)
        },
      },
      {
        kind: 'item',
        label: '编辑项目',
        icon: <Settings2 size={APP_ICON_SIZE} />,
        onSelect: () => setManagerOpen(true),
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '归档任务',
        icon: <Archive size={APP_ICON_SIZE} />,
        disabled: countedProjectSessions.length === 0 || processingAction !== null,
        onSelect: archiveAll,
      },
      {
        kind: 'item',
        label: '移除',
        icon: <X size={APP_ICON_SIZE} />,
        color: 'red',
        onSelect: () => setConfirmRemoveOpen(true),
      },
    ]
  }

  const projectButton = (
    <button
      aria-controls={projectSessionsId}
      aria-expanded={isExpanded}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown ArrowRight"
      aria-label={`${managedProject.name}，${isExpanded ? '折叠项目任务' : '展开项目任务'}`}
      className="sidebar-project-button"
      data-current={isCurrent || undefined}
      data-sidebar-project-key={projectKey}
      type="button"
      onClick={() => disclosureStore.setExpanded(disclosureKey, !isExpanded)}
    >
      <span className="sidebar-project-title-text">
        {managedProject.name}
      </span>
    </button>
  )

  return (
    <section
      className={cx(
        'sidebar-project',
        'u-flex',
        'u-flex-col',
        'tw:flex tw:flex-col',
      )}
      onMouseLeave={() => setHovered(false)}
    >
      <SidebarContextMenu
        actions={contextActions()}
        layout="grid"
        width={240}
        trigger={
          <SidebarRow
            className={cx(
              'sidebar-project-header',
              isUnavailable && 'sidebar-project-header--unavailable',
            )}
            labelClassName="sidebar-project-name"
            layout="grid"
            leading={
              <ProjectAppearanceGlyph
                appearance={appearance}
                className="project-appearance-marker"
              />
            }
            onMouseEnter={() => setHovered(true)}
            trailing={
              <div
                className={cx(
                  'sidebar-project-actions',
                  actionsVisible && 'is-visible',
                )}
                onClick={event => event.stopPropagation()}
              >
                <PopoverMenu
                  className="popover-sidebar-project popover-menu--grid"
                  open={menuOpen}
                  side="bottom"
                  width="auto"
                  trigger={
                    <IconButton
                      className="sidebar-project-action-button"
                      color="ghostSecondary"
                      size="iconMd"
                      title="更多"
                    >
                      <MoreHorizontal size={APP_ICON_SIZE} />
                    </IconButton>
                  }
                  onOpenChange={setMenuOpen}
                >
                  <PopoverItem
                    icon={isPinned
                      ? <PinOff size={APP_ICON_SIZE} />
                      : <Pin size={APP_ICON_SIZE} />}
                    onClick={togglePinned}
                  >
                    {isPinned ? '取消置顶项目' : '置顶项目'}
                  </PopoverItem>
                  <PopoverItem
                    disabled={isUnavailable}
                    icon={<FolderOpen size={APP_ICON_SIZE} />}
                    onClick={() => {
                      void desktopClient.openPathWithDefaultTarget(
                        managedProject.path,
                      )
                    }}
                  >
                    在资源管理器中打开
                  </PopoverItem>
                  <PopoverItem
                    icon={<Settings2 size={APP_ICON_SIZE} />}
                    onClick={() => setManagerOpen(true)}
                  >
                    编辑项目
                  </PopoverItem>
                  <PopoverItem
                    disabled={
                      countedProjectSessions.length === 0 ||
                      processingAction !== null
                    }
                    icon={<Archive size={APP_ICON_SIZE} />}
                    onClick={archiveAll}
                  >
                    {processingAction === 'archive' ? '归档中…' : '归档任务'}
                  </PopoverItem>
                  <PopoverItem
                    icon={<X size={APP_ICON_SIZE} />}
                    onClick={() => setConfirmRemoveOpen(true)}
                  >
                    移除
                  </PopoverItem>
                </PopoverMenu>
                <IconButton
                  aria-label="新建对话"
                  className="sidebar-project-action-button"
                  color="ghostSecondary"
                  disabled={isUnavailable}
                  size="iconMd"
                  title="新建对话"
                  onClick={() => onCreateSession(managedProject)}
                >
                  <SquarePen size={APP_ICON_SIZE} />
                </IconButton>
              </div>
            }
          >
            <SidebarProjectHoverCard
              appearance={appearance}
              conversationCount={countedProjectSessions.length}
              openCount={openCount}
              unreadCount={unreadCount}
              isPinned={isPinned}
              isUnavailable={isUnavailable}
              project={managedProject}
              projectKey={projectKey}
              onEdit={() => setManagerOpen(true)}
              onOpenFolder={path => {
                void desktopClient.openPathWithDefaultTarget(path)
              }}
              onTogglePinned={togglePinned}
            >
              {projectButton}
            </SidebarProjectHoverCard>
          </SidebarRow>
        }
      />

      <DisclosureContent
        className="sidebar-project-sessions-disclosure"
        contentClassName="sidebar-project-sessions-disclosure__content"
        expanded={projectSessions.length > 0 && isExpanded}
        id={projectSessionsId}
        mountPolicy="always"
      >
        {projectSessions.length > 0 ? <SidebarSessionGroup
          activeSessionId={activeSessionId}
          pendingPermissionSessionIds={pendingPermissionSessionIds}
          titleLoadingIds={titleLoadingIds}
          groupKey={`project:${projectKey}`}
          manualOrderByScope={manualOrderByScope}
          now={now}
          sessionFallbackTitles={sessionFallbackTitles}
          sessions={projectSessions}
          sort={sort}
          onArchiveSessions={onArchiveSessions}
          onManualOrderChange={onManualOrderChange}
          onPinSession={onPinSession}
          onSelectSession={onSelectSession}
          onToggleSessionUnread={onToggleSessionUnread}
          onRenameSession={onRenameSession}
          onSortChange={onSortChange}
          onUnpinSession={onUnpinSession}
        /> : null}
      </DisclosureContent>

      <ProjectManagementDialogs
        project={managedProject}
        managerOpen={managerOpen}
        confirmRemoveOpen={confirmRemoveOpen}
        busy={processingAction !== null}
        setManagerOpen={setManagerOpen}
        setConfirmRemoveOpen={setConfirmRemoveOpen}
        onProjectChange={setManagedProject}
        onArchiveSessions={() => onArchiveSessions(countedProjectSessions)}
        onRemoveWorkspace={onRemoveWorkspace}
        onReport={onReport}
      />
    </section>
  )
}

export const SidebarProjectGroup = memo(SidebarProjectGroupComponent)
