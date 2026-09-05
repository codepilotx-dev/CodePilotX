import type React from 'react'
import { useMemo } from 'react'
import { FolderOpen, MessageSquare, Pin, PinOff, Settings } from 'lucide-react'
import type { DesktopWorkspace, ProjectAppearance } from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../components/ui/iconTokens.js'
import { ProjectAppearanceGlyph } from './projectAppearance.js'
import { SidebarHoverCardFrame, SidebarHoverCardHeader, SidebarHoverCardRow } from '../layout/sidebar/SidebarHoverCardLayout.js'

type Props = {
  appearance: ProjectAppearance
  conversationCount: number
  openCount: number
  unreadCount: number
  isPinned: boolean
  isUnavailable: boolean
  project: DesktopWorkspace
  pinRef?: React.Ref<HTMLButtonElement>
  onEdit: () => void
  onOpenFolder: (path: string) => void
  onTogglePinned: () => void
}

export function ProjectDetailsCard({ appearance, conversationCount, openCount, unreadCount,
  isPinned, isUnavailable, project, pinRef, onEdit, onOpenFolder, onTogglePinned,
}: Props): React.ReactNode {
  const folders = useMemo(
    () =>
      project.folders?.length
        ? [...project.folders].sort(
            (left, right) =>
              left.order - right.order || left.name.localeCompare(right.name),
          )
        : [{
            id: `path:${project.path}`,
            name: project.name,
            path: project.path,
            role: 'primary' as const,
            availability: 'available' as const,
            order: 0,
            createdAt: 0,
            updatedAt: 0,
          }],
    [project],
  )

  return (
      <SidebarHoverCardFrame
        className="sidebar-project-hover-card-content"
        onClick={event => event.stopPropagation()}
      >
        <SidebarHoverCardHeader className="sidebar-project-hover-card-header">
          <ProjectAppearanceGlyph appearance={appearance} />
          <strong title={project.name}>{project.name}</strong>
          <IconButton
            className="sidebar-project-hover-card-pin"
            color={isPinned ? "ghostActive" : "ghostSecondary"}
            ref={pinRef}
            size="toolbar"
            title={isPinned ? '取消置顶项目' : '置顶项目'}
            onClick={() => {
              onTogglePinned()
            }}
          >
            {isPinned ? (
              <PinOff size={APP_ICON_SIZE} />
            ) : (
              <Pin size={APP_ICON_SIZE} />
            )}
          </IconButton>
        </SidebarHoverCardHeader>
        <SidebarHoverCardRow className="sidebar-project-hover-card-stats">
          <MessageSquare aria-hidden="true" size={APP_ICON_SIZE} />
          <span className="sidebar-project-hover-card-stats-content">
            <span>{conversationCount} 个任务</span>
            {unreadCount > 0 ? (
              <>
                <span aria-hidden="true" className="sidebar-project-hover-card-stat-separator">·</span>
                <span>{unreadCount} 条未读</span>
              </>
            ) : null}
            <span aria-hidden="true" className="sidebar-project-hover-card-stat-separator">·</span>
            <span>{openCount} 个已开启</span>
          </span>
        </SidebarHoverCardRow>
        <div className="sidebar-project-hover-card-folders">
          {folders.map(folder => (
            folder.path ? (
              <button
                className="sidebar-project-hover-card-folder"
                disabled={
                  isUnavailable || folder.availability === 'missing'
                }
                key={folder.id}
                type="button"
                title={folder.path}
                onClick={() => {
                  onOpenFolder(folder.path)
                }}
              >
                <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} />
                <span className="sidebar-project-hover-card-folder-path">{folder.path}</span>
              </button>
            ) : null
          ))}
        </div>
        <Button
          color="ghostSecondary"
          className="sidebar-project-hover-card-edit"
          size="compact"
          onClick={() => {
            onEdit()
          }}
        >
          <Settings aria-hidden="true" size={APP_ICON_SIZE} />
          <span>编辑项目</span>
        </Button>
      </SidebarHoverCardFrame>
  )
}
