import type React from 'react'
import { Pencil, Send, X } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { IconButton } from '../../components/ui/IconButton.js'
import type { DesktopQueuedFollowUp } from '../../../shared/types.js'

export type SessionFollowUpDockProps = {
  items: DesktopQueuedFollowUp[]
  onEdit: (followUpId: string) => void
  onRemove: (followUpId: string) => void
  onSendNow: (followUpId: string) => void
}

export function SessionFollowUpDock({
  items,
  onEdit,
  onRemove,
  onSendNow,
}: SessionFollowUpDockProps): React.ReactNode {
  if (items.length === 0) return null

  return (
    <div className="session-follow-up-dock">
      <div className="session-follow-up-header">
        已排队 {items.length} 条
      </div>
      <div className="session-follow-up-list">
        {items.map(item => (
          <div key={item.id} className="session-follow-up-item">
            <span
              className="session-follow-up-preview"
              title={item.previewText}
            >
              {item.previewText}
            </span>
            <div className="session-follow-up-actions">
              <IconButton
                aria-label={`编辑：${item.previewText}`}
                className="icon-button session-follow-up-action"
                title="编辑"
                onClick={() => onEdit(item.id)}
              >
                <Pencil
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </IconButton>
              <IconButton
                aria-label={`立即发送：${item.previewText}`}
                className="icon-button session-follow-up-action"
                title="立即发送"
                onClick={() => onSendNow(item.id)}
              >
                <Send
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </IconButton>
              <IconButton
                aria-label={`删除：${item.previewText}`}
                className="icon-button session-follow-up-action"
                title="删除"
                onClick={() => onRemove(item.id)}
              >
                <X
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </IconButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
