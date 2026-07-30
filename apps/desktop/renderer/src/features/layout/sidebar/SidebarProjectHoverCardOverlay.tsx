import type React from 'react'
import { FolderOpen, MessageSquare, Pin, PinOff, Settings2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import type {
  DesktopWorkspace,
  ProjectAppearance,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { ProjectAppearanceGlyph } from '../../projects/projectAppearance.js'
import {
  focusSidebarHoverCardAnchor,
  type SidebarHoverCardOverlayRenderProps,
} from './SidebarHoverCard.js'
import {
  SidebarHoverCardDivider,
  SidebarHoverCardFrame,
  SidebarHoverCardHeader,
  SidebarHoverCardRow,
} from './SidebarHoverCardLayout.js'
import { SidebarHoverCardSurface } from './SidebarHoverCardSurface.js'

type Props = SidebarHoverCardOverlayRenderProps & {
  appearance: ProjectAppearance
  conversationCount: number
  focusRequest: number
  openCount: number
  isPinned: boolean
  isUnavailable: boolean
  project: DesktopWorkspace
  projectKey: string
  unreadCount: number
  onFocusRequestHandled: () => void
  onEdit: () => void
  onOpenFolder: (path: string) => void
  onTogglePinned: () => void
}

export function SidebarProjectHoverCardOverlay({
  appearance,
  conversationCount,
  focusRequest,
  openCount,
  isPinned,
  isUnavailable,
  project,
  projectKey,
  unreadCount,
  onFocusRequestHandled,
  onEdit,
  onOpenFolder,
  onTogglePinned,
  ...interactionProps
}: Props): React.ReactNode {
  const initialFocusRef = useRef<HTMLButtonElement | null>(null)
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
    <SidebarHoverCardSurface
      {...interactionProps}
      ariaLabel="项目详情"
      className="sidebar-project-hover-card"
      focusRef={initialFocusRef}
      focusRequest={focusRequest}
      onFocusRequestHandled={onFocusRequestHandled}
      positionOutsideSidebar
    >
      <SidebarHoverCardFrame
        className="sidebar-project-hover-card-content"
        onClick={event => event.stopPropagation()}
      >
        <SidebarHoverCardHeader className="sidebar-project-hover-card-header">
          <ProjectAppearanceGlyph appearance={appearance} size={18} />
          <strong title={project.name}>{project.name}</strong>
          <IconButton
            className="sidebar-project-hover-card-pin"
            ref={initialFocusRef}
            title={isPinned ? '取消置顶项目' : '置顶项目'}
            onClick={() => {
              onTogglePinned()
              interactionProps.requestOpenChange(false)
              focusProjectAnchorAfterUpdate(projectKey, !isPinned)
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
          <span>
            <MessageSquare aria-hidden="true" size={APP_ICON_SIZE} />
            {conversationCount} 个对话
          </span>
          <span aria-hidden="true" className="sidebar-project-hover-card-stat-separator">·</span>
          <span>{unreadCount} 条未读</span>
          <span aria-hidden="true" className="sidebar-project-hover-card-stat-separator">·</span>
          <span>{openCount} 个已开启</span>
        </SidebarHoverCardRow>
        <SidebarHoverCardDivider className="sidebar-project-hover-card-divider" />
        <div className="sidebar-project-hover-card-folders">
          {folders.map(folder => (
            <Button
              className="sidebar-project-hover-card-folder"
              disabled={
                isUnavailable || folder.availability === 'missing'
              }
              key={folder.id}
              title={folder.path}
              onClick={() => {
                onOpenFolder(folder.path)
                interactionProps.requestOpenChange(false)
              }}
            >
              <FolderOpen aria-hidden="true" size={APP_ICON_SIZE} />
              <span>{folder.path}</span>
            </Button>
          ))}
        </div>
        <SidebarHoverCardDivider className="sidebar-project-hover-card-divider" />
        <Button
          className="sidebar-project-hover-card-edit"
          onClick={() => {
            onEdit()
            interactionProps.requestOpenChange(false)
          }}
        >
          <Settings2 aria-hidden="true" size={APP_ICON_SIZE} />
          编辑项目
        </Button>
      </SidebarHoverCardFrame>
    </SidebarHoverCardSurface>
  )
}

function focusProjectAnchorAfterUpdate(
  projectKey: string,
  willBePinned: boolean,
): void {
  requestAnimationFrame(() => {
    const projectAnchor = [
      ...document.querySelectorAll<HTMLElement>('.sidebar-project-button'),
    ].find(
      button => button.dataset.sidebarProjectKey === projectKey,
    )
    const preferredSection = willBePinned ? 'pinned' : 'projects'
    const sectionFallback =
      document.querySelector<HTMLElement>(
        `[data-sidebar-section-id="${preferredSection}"]`,
      ) ??
      document.querySelector<HTMLElement>(
        '[data-sidebar-section-id="recent"]',
      ) ??
      document.querySelector<HTMLElement>('.sidebar-section-header')
    focusSidebarHoverCardAnchor(projectAnchor ?? sectionFallback)
  })
}
