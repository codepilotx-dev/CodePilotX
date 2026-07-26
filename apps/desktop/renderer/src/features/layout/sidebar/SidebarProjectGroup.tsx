import type React from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'
import {
  Archive,
  ChevronDown,
  FolderOpen,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings2,
  SquarePen,
  X,
} from 'lucide-react'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import type { SessionListItem } from '../../../uiTypes.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { SidebarRow } from './SidebarRow.js'
import { SidebarSessionGroup } from './SidebarSessionGroup.js'
import {
  SidebarContextMenu,
  type ContextMenuAction,
} from './SidebarContextMenu.js'
import { cx } from '../../../utils/cx.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import {
  DEFAULT_PROJECT_APPEARANCE,
  ProjectAppearanceGlyph,
} from '../../projects/projectAppearance.js'

const ProjectEditDialog = lazy(async () => {
  const module = await import('../../projects/ProjectEditDialog.js')
  return { default: module.ProjectEditDialog }
})

type Props = {
  activeSessionId: string | null
  collapsedProjectPaths: Set<string>
  isUnavailable: boolean
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  project: DesktopWorkspace
  sessionFallbackTitles: Record<string, string>
  sessions: SessionListItem[]
  workspace: DesktopWorkspace | null
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onCreateSession: (workspace?: DesktopWorkspace | null) => void
  onPinWorkspace: (workspace: DesktopWorkspace) => void
  onRemoveWorkspace: (workspace: DesktopWorkspace) => void
  onSelectSession: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onToggleProjectCollapsed: (projectKey: string) => void
  onPinSession: (session: SessionListItem) => void
  onUnpinSession: (session: SessionListItem) => void
  onUnpinWorkspace: (workspace: DesktopWorkspace) => void
  onReport?: (message: string) => void
}

export function SidebarProjectGroup({
  activeSessionId,
  collapsedProjectPaths,
  isUnavailable,
  now,
  pendingPermissionSessionIds,
  project,
  sessionFallbackTitles,
  sessions,
  workspace,
  onArchiveSessions,
  onCreateSession,
  onPinWorkspace,
  onRemoveWorkspace,
  onSelectSession,
  onRenameSession,
  onToggleProjectCollapsed,
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
    'archive' | 'remove' | null
  >(null)
  const { projectAppearances, setProjectAppearances } = useDesktopSettings()

  useEffect(() => setManagedProject(project), [project])

  const projectKey = managedProject.projectId
    ? `id:${managedProject.projectId}`
    : `path:${managedProject.path.replace(/\\/g, '/').toLowerCase()}`
  const projectSessions = sessions
    .filter(
      session =>
        !session.standalone &&
        (managedProject.projectId
          ? session.projectId === managedProject.projectId
          : session.workspacePath === managedProject.path),
    )
    .sort(
      (left, right) =>
        sessionRecencyMs(right) - sessionRecencyMs(left) ||
        right.id.localeCompare(left.id),
    )
  const isExpanded =
    !collapsedProjectPaths.has(projectKey) &&
    !collapsedProjectPaths.has(managedProject.path)
  const collapseKey = collapsedProjectPaths.has(managedProject.path)
    ? managedProject.path
    : projectKey
  const isCurrent =
    workspace?.projectId && managedProject.projectId
      ? workspace.projectId === managedProject.projectId
      : workspace?.path === managedProject.path
  const actionsVisible = hovered || menuOpen
  const isPinned = Boolean(managedProject.pinnedAt)
  const appearance = managedProject.projectId
    ? projectAppearances[managedProject.projectId]
      ?? DEFAULT_PROJECT_APPEARANCE
    : DEFAULT_PROJECT_APPEARANCE

  function openProject(): void {
    if (projectSessions[0]) {
      onSelectSession(projectSessions[0])
    } else {
      onCreateSession(managedProject)
    }
  }

  function archiveAll(): void {
    setProcessingAction('archive')
    void onArchiveSessions(projectSessions).finally(() =>
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
        label: isPinned ? '取消置顶' : '置顶项目',
        icon: isPinned
          ? <PinOff size={APP_ICON_SIZE} />
          : <Pin size={APP_ICON_SIZE} />,
        onSelect: togglePinned,
      },
      {
        kind: 'item',
        label: '新建任务',
        icon: <SquarePen size={APP_ICON_SIZE} />,
        disabled: isUnavailable,
        onSelect: () => onCreateSession(managedProject),
      },
      {
        kind: 'item',
        label: '编辑项目',
        icon: <Settings2 size={APP_ICON_SIZE} />,
        onSelect: () => setManagerOpen(true),
      },
      {
        kind: 'item',
        label: '在资源管理器中打开主目录',
        icon: <FolderOpen size={APP_ICON_SIZE} />,
        disabled: isUnavailable,
        onSelect: () => {
          void desktopClient.openPathWithDefaultTarget(managedProject.path)
        },
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '归档所有任务',
        icon: <Archive size={APP_ICON_SIZE} />,
        disabled: projectSessions.length === 0 || processingAction !== null,
        onSelect: archiveAll,
      },
      {
        kind: 'item',
        label: '移除项目',
        icon: <X size={APP_ICON_SIZE} />,
        color: 'red',
        onSelect: () => setConfirmRemoveOpen(true),
      },
    ]
  }

  return (
    <section
      className={cx(
        'sidebar-project',
        'u-flex',
        'u-flex-col',
        'tw:flex tw:flex-col tw:gap-0.5',
      )}
      onMouseLeave={() => setHovered(false)}
    >
      <SidebarContextMenu
        actions={contextActions()}
        width={240}
        trigger={
          <SidebarRow
            aria-current={isCurrent ? 'page' : undefined}
            aria-disabled={isUnavailable ? true : undefined}
            className={cx(
              'sidebar-project-header',
              isUnavailable && 'sidebar-project-header--unavailable',
            )}
            labelClassName="sidebar-project-name"
            leading={
              <ProjectAppearanceGlyph
                appearance={appearance}
                className="project-appearance-marker"
              />
            }
            onClick={openProject}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openProject()
              }
            }}
            onMouseEnter={() => setHovered(true)}
            role="button"
            tabIndex={0}
            trailing={
              <div className={cx(
                  'sidebar-project-actions',
                  actionsVisible && 'is-visible',
                )}
                onClick={event => event.stopPropagation()}
              >
                  <PopoverMenu
                    className="popover-sidebar-project"
                    open={menuOpen}
                    side="bottom"
                    width="auto"
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
                    icon={isPinned
                      ? <PinOff size={APP_ICON_SIZE} />
                      : <Pin size={APP_ICON_SIZE} />}
                    onClick={togglePinned}
                  >
                    {isPinned ? '取消置顶' : '置顶项目'}
                  </PopoverItem>
                  <PopoverItem
                    icon={<SquarePen size={APP_ICON_SIZE} />}
                    onClick={() => onCreateSession(managedProject)}
                  >
                    新建任务
                  </PopoverItem>
                  <PopoverItem
                    icon={<Settings2 size={APP_ICON_SIZE} />}
                    onClick={() => setManagerOpen(true)}
                  >
                    编辑项目
                  </PopoverItem>
                  <PopoverItem
                    icon={<FolderOpen size={APP_ICON_SIZE} />}
                    onClick={() => {
                      void desktopClient.openPathWithDefaultTarget(
                        managedProject.path,
                      )
                    }}
                  >
                    在资源管理器中打开主目录
                  </PopoverItem>
                  <PopoverItem
                    disabled={
                      projectSessions.length === 0 || processingAction !== null
                    }
                    icon={<Archive size={APP_ICON_SIZE} />}
                    onClick={archiveAll}
                  >
                    {processingAction === 'archive' ? '归档中…' : '归档所有任务'}
                  </PopoverItem>
                  <PopoverItem
                    icon={<X size={APP_ICON_SIZE} />}
                    onClick={() => setConfirmRemoveOpen(true)}
                  >
                    移除项目
                  </PopoverItem>
                  </PopoverMenu>
                <button
                  aria-label="新建任务"
                  className="icon-button sidebar-project-action-button"
                  disabled={isUnavailable}
                  type="button"
                  onClick={() => onCreateSession(managedProject)}
                >
                  <SquarePen size={APP_ICON_SIZE} />
                </button>
              </div>
            }
          >
            <span
              className={cx(
                'sidebar-project-title-text',
                'u-min-w-0',
                'u-truncate',
              )}
            >
              {managedProject.name}
            </span>
            <button
              aria-label={isExpanded ? '折叠项目任务' : '展开项目任务'}
              aria-expanded={isExpanded}
              className="icon-button sidebar-project-collapse-button"
              type="button"
              onClick={event => {
                event.stopPropagation()
                onToggleProjectCollapsed(collapseKey)
              }}
            >
              <ChevronDown
                className={cx(
                  'sidebar-project-chevron',
                  isExpanded && 'is-expanded',
                )}
                size={APP_ICON_SIZE}
              />
            </button>
          </SidebarRow>
        }
      />

      {projectSessions.length > 0 && isExpanded ? (
        <SidebarSessionGroup
          activeSessionId={activeSessionId}
          pendingPermissionSessionIds={pendingPermissionSessionIds}
          groupKey={`project:${projectKey}`}
          now={now}
          sessionFallbackTitles={sessionFallbackTitles}
          sessions={projectSessions}
          onArchiveSessions={onArchiveSessions}
          onPinSession={onPinSession}
          onSelectSession={onSelectSession}
          onRenameSession={onRenameSession}
          onUnpinSession={onUnpinSession}
        />
      ) : null}

      <ConfirmationDialog
        actionDisabled={processingAction !== null}
        actionLabel={processingAction === 'remove' ? '处理中…' : '移除'}
        description="项目任务将一并归档。磁盘上的目录与文件不会被删除。"
        open={confirmRemoveOpen}
        title={`移除 ${managedProject.name}?`}
        tone="danger"
        onAction={() => {
          if (processingAction) return
          setProcessingAction('remove')
          void (managedProject.projectId
            ? desktopClient
                .removeProject(managedProject.projectId)
                .then(() => true)
            : onArchiveSessions(projectSessions)
          )
            .then(success => {
              if (!success) return
              setConfirmRemoveOpen(false)
              if (managedProject.projectId) {
                setProjectAppearances(current => {
                  const {
                    [managedProject.projectId as string]: _removed,
                    ...next
                  } = current
                  return next
                })
              }
              onRemoveWorkspace(managedProject)
            })
            .catch(error => onReport(
              error instanceof Error ? error.message : String(error),
            ))
            .finally(() => setProcessingAction(null))
        }}
        onCancel={() => setConfirmRemoveOpen(false)}
      />

      {managerOpen ? (
        <Suspense fallback={null}>
          <ProjectEditDialog
            appearance={appearance}
            open
            project={managedProject}
            onAppearanceChange={nextAppearance => {
              if (!managedProject.projectId) return
              setProjectAppearances(current => ({
                ...current,
                [managedProject.projectId as string]: nextAppearance,
              }))
            }}
            onOpenChange={setManagerOpen}
            onProjectChange={setManagedProject}
            onReport={onReport}
            onRequestRemove={() => {
              setManagerOpen(false)
              setConfirmRemoveOpen(true)
            }}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

function sessionRecencyMs(session: SessionListItem): number {
  const value = session.lastMessageAt ?? session.createdAt
  const result = new Date(value).getTime()
  return Number.isNaN(result) ? 0 : result
}
