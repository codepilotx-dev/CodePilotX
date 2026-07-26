import { useState } from 'react'
import type React from 'react'
import {
  Check,
  MoreHorizontal,
  Play,
  Trash2,
  X,
} from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Button } from '../../components/ui/Button.js'
import type {
  DesktopQueuedFollowUp,
  DesktopQueuePauseReason,
  DesktopUserMessageInput,
} from '../../../shared/types.js'

export type SessionFollowUpDockProps = {
  items: DesktopQueuedFollowUp[]
  pauseReason?: DesktopQueuePauseReason | null
  onEdit: (followUpId: string, input: DesktopUserMessageInput) => void
  onRemove: (followUpId: string) => void
  onResume: () => void
}

export function SessionFollowUpDock({
  items,
  pauseReason = null,
  onEdit,
  onRemove,
  onResume,
}: SessionFollowUpDockProps): React.ReactNode {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')

  if (items.length === 0) return null

  function beginEdit(item: DesktopQueuedFollowUp): void {
    setEditingId(item.id)
    setEditingText(item.input.text)
  }

  function finishEdit(item: DesktopQueuedFollowUp): void {
    const text = editingText.trim()
    if (!text) return
    onEdit(item.id, { ...item.input, text })
    setEditingId(null)
    setEditingText('')
  }

  return (
    <section aria-label="消息队列" className="session-follow-up-dock">
      {pauseReason ? (
        <div className="session-follow-up-header">
          <span>已排队 {items.length} 条</span>
          <Button
            className="session-follow-up-resume"
            onClick={onResume}
          >
            <Play aria-hidden="true" size={12} />
            继续队列
          </Button>
        </div>
      ) : null}
      {pauseReason ? (
        <div className="session-follow-up-paused" role="status">
          {pauseReason === 'interrupted'
            ? '队列因你中断了任务而暂停'
            : '队列因上一项执行失败而暂停'}
        </div>
      ) : null}
      <div className="session-follow-up-list" role="list">
        {items.map((item, index) => {
          const isEditing = editingId === item.id
          return (
            <div
              aria-label={`排队消息 ${index + 1}：${item.previewText}`}
              className="session-follow-up-item"
              key={item.id}
              role="listitem"
            >
              {isEditing ? (
                <input
                  aria-label="编辑排队消息"
                  autoFocus
                  className="session-follow-up-edit-input"
                  onChange={event => setEditingText(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      finishEdit(item)
                    } else if (event.key === 'Escape') {
                      setEditingId(null)
                    }
                  }}
                  value={editingText}
                />
              ) : (
                <span className="session-follow-up-preview" title={item.previewText}>
                  {item.previewText}
                </span>
              )}
              <div aria-label="队列操作" className="session-follow-up-actions">
                {isEditing ? (
                  <>
                    <IconButton
                      aria-label="保存编辑"
                      className="session-follow-up-action"
                      disabled={!editingText.trim()}
                      onClick={() => finishEdit(item)}
                      title="保存编辑"
                    >
                      <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="取消编辑"
                      className="session-follow-up-action"
                      onClick={() => setEditingId(null)}
                      title="取消编辑"
                    >
                      <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <IconButton
                      aria-label="移除排队消息"
                      className="session-follow-up-action"
                      onClick={() => onRemove(item.id)}
                      title="移除"
                    >
                      <Trash2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="编辑排队消息"
                      className="session-follow-up-action"
                      onClick={() => beginEdit(item)}
                      title="更多：编辑消息"
                    >
                      <MoreHorizontal
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    </IconButton>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
