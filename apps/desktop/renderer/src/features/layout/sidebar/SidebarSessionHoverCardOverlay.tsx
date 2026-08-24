import type React from 'react'
import { Folder, GitBranch, Laptop } from 'lucide-react'
import { SkeletonBlock } from '../../../components/ui/Skeleton.js'
import type { SidebarHoverCardOverlayRenderProps } from './SidebarHoverCard.js'
import {
  SidebarHoverCardFrame,
  SidebarHoverCardHeader,
  SidebarHoverCardRow,
} from './SidebarHoverCardLayout.js'
import { SidebarHoverCardSurface } from './SidebarHoverCardSurface.js'
import type { SidebarSessionHoverCardModel } from './SidebarSessionHoverCard.js'

type Props = SidebarHoverCardOverlayRenderProps & {
  editing: boolean
  focusRequest: number
  inputRef: React.RefObject<HTMLInputElement | null>
  model: SidebarSessionHoverCardModel
  regeneratingTitle: boolean
  renameValue: string
  saving: boolean
  onCancelRename: () => void
  onFocusRequestHandled: () => void
  onRenameValueChange: (value: string) => void
  onSaveRename: () => void
  onStartRename: () => void
}

export function SidebarSessionHoverCardOverlay({
  editing,
  focusRequest,
  inputRef,
  model,
  regeneratingTitle,
  renameValue,
  saving,
  onCancelRename,
  onFocusRequestHandled,
  onRenameValueChange,
  onSaveRename,
  onStartRename,
  ...interactionProps
}: Props): React.ReactNode {
  return (
    <SidebarHoverCardSurface
      {...interactionProps}
      ariaLabel="会话详情"
      className="sidebar-session-hover-card"
      focusRef={editing ? inputRef : undefined}
      focusRequest={editing ? focusRequest : 0}
      onFocusRequestHandled={onFocusRequestHandled}
      positionOutsideSidebar
    >
      <SidebarHoverCardFrame className="sidebar-session-hover-card-content">
        <SidebarHoverCardHeader className="sidebar-session-hover-card-header">
          {editing ? (
            <input
              aria-label="任务名称"
              aria-busy={saving}
              className="sidebar-session-hover-card-rename-input"
              maxLength={160}
              readOnly={saving}
              ref={inputRef}
              value={renameValue}
              onBlur={onCancelRename}
              onChange={event => onRenameValueChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSaveRename()
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancelRename()
                  interactionProps.returnFocusToAnchor()
                }
              }}
            />
          ) : (
            <button
              aria-busy={regeneratingTitle}
              aria-live="polite"
              className="sidebar-session-hover-card-title-group"
              disabled={regeneratingTitle}
              title="单击重命名"
              type="button"
              onClick={onStartRename}
            >
              {regeneratingTitle ? (
                <>
                  <SkeletonBlock className="sidebar-session-hover-card-title__skeleton" />
                  <span className="u-sr-only">正在更新会话标题</span>
                </>
              ) : (
                <>
                  <span className="sidebar-session-hover-card-title">{model.title}</span>
                  <Laptop aria-hidden="true" className="sidebar-session-hover-card-device-icon" size={14} strokeWidth={1.75} />
                </>
              )}
            </button>
          )}
          <span className="sidebar-session-hover-card-trailing">
            <span className="sidebar-session-hover-card-time">
              {model.relativeTime}
            </span>
            {model.isRunning ? (
              <>
                <span aria-hidden="true" className="sidebar-session-hover-card-time-dot">·</span>
                <span
                  aria-label="运行中"
                  className="sidebar-session-running-dot"
                />
              </>
            ) : null}
            {model.unread ? (
              <span
                aria-hidden="true"
                className="sidebar-session-unread-dot"
              />
            ) : null}
          </span>
        </SidebarHoverCardHeader>
        <div className="sidebar-session-hover-card-meta">
          <SidebarHoverCardRow className="sidebar-session-hover-card-row">
            <Folder aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>{model.projectLabel}</span>
            {model.gitBranch ? (
              <>
                <span aria-hidden="true" className="sidebar-session-hover-card-stat-separator">·</span>
                <GitBranch aria-hidden="true" size={13} strokeWidth={1.75} />
                <span>{model.gitBranch}</span>
              </>
            ) : null}
          </SidebarHoverCardRow>
        </div>
      </SidebarHoverCardFrame>
    </SidebarHoverCardSurface>
  )
}
