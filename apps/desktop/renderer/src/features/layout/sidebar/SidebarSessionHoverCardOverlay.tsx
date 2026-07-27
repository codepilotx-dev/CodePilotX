import type React from 'react'
import { Folder, GitBranch } from 'lucide-react'
import type { SidebarHoverCardOverlayRenderProps } from './SidebarHoverCard.js'
import { SidebarHoverCardSurface } from './SidebarHoverCardSurface.js'
import type { SidebarSessionHoverCardModel } from './SidebarSessionHoverCard.js'

type Props = SidebarHoverCardOverlayRenderProps & {
  editing: boolean
  focusRequest: number
  inputRef: React.RefObject<HTMLInputElement | null>
  model: SidebarSessionHoverCardModel
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
      className="sidebar-session-hover-card"
      focusRef={editing ? inputRef : undefined}
      focusRequest={editing ? focusRequest : 0}
      onFocusRequestHandled={onFocusRequestHandled}
      positionOutsideSidebar
    >
      <div className="sidebar-session-hover-card-content">
        <div className="sidebar-session-hover-card-header">
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
            <span
              className="sidebar-session-hover-card-title"
              title="双击重命名"
              onDoubleClick={onStartRename}
            >
              {model.title}
            </span>
          )}
          <span className="sidebar-session-hover-card-time">{model.relativeTime}</span>
        </div>
        <div className="sidebar-session-hover-card-row">
          <Folder aria-hidden="true" size={16} />
          <span>{model.projectLabel}</span>
        </div>
        {model.gitBranch ? (
          <div className="sidebar-session-hover-card-row">
            <GitBranch aria-hidden="true" size={16} />
            <span>{model.gitBranch}</span>
          </div>
        ) : null}
      </div>
    </SidebarHoverCardSurface>
  )
}
