import { useState } from 'react'
import type React from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Pencil,
  Play,
  Send,
  X,
} from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../components/ui/iconTokens.js'
import { IconButton } from '../../components/ui/IconButton.js'
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
  onSendNow: (followUpId: string) => void
  onReorder: (followUpIds: string[]) => void
  onResume: () => void
}

export function SessionFollowUpDock({
  items,
  pauseReason = null,
  onEdit,
  onRemove,
  onSendNow,
  onReorder,
  onResume,
}: SessionFollowUpDockProps): React.ReactNode {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)

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

  function moveItem(itemId: string, offset: -1 | 1): void {
    const from = items.findIndex(item => item.id === itemId)
    const to = from + offset
    if (from < 0 || to < 0 || to >= items.length) return
    const next = items.map(item => item.id)
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    onReorder(next)
  }

  function dropBefore(targetId: string): void {
    if (!draggingId || draggingId === targetId) return
    const next = items.map(item => item.id)
    const from = next.indexOf(draggingId)
    const target = next.indexOf(targetId)
    if (from < 0 || target < 0) return
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(from < target ? target - 1 : target, 0, moved)
    onReorder(next)
    setDraggingId(null)
  }

  return (
    <section aria-label="消息队列" className="session-follow-up-dock">
      <div className="session-follow-up-header">
        <span>已排队 {items.length} 条</span>
        {pauseReason ? (
          <button
            className="session-follow-up-resume"
            onClick={onResume}
            type="button"
          >
            <Play aria-hidden="true" size={12} />
            继续队列
          </button>
        ) : null}
      </div>
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
              className={[
                'session-follow-up-item',
                draggingId === item.id ? 'is-dragging' : '',
              ].join(' ')}
              key={item.id}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault()
                dropBefore(item.id)
              }}
              role="listitem"
            >
              <button
                aria-label="拖动以调整排队顺序"
                className="session-follow-up-drag-handle"
                draggable={!isEditing}
                onDragEnd={() => setDraggingId(null)}
                onDragStart={event => {
                  setDraggingId(item.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', item.id)
                }}
                title="拖动排序"
                type="button"
              >
                <GripVertical size={APP_ICON_SIZE} />
              </button>
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
                      aria-label="上移排队消息"
                      className="session-follow-up-action"
                      disabled={index === 0}
                      onClick={() => moveItem(item.id, -1)}
                      title="上移"
                    >
                      <ChevronUp size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="下移排队消息"
                      className="session-follow-up-action"
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(item.id, 1)}
                      title="下移"
                    >
                      <ChevronDown size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="编辑排队消息"
                      className="session-follow-up-action"
                      onClick={() => beginEdit(item)}
                      title="编辑"
                    >
                      <Pencil size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="将排队消息作为补充要求发送"
                      className="session-follow-up-action"
                      onClick={() => onSendNow(item.id)}
                      title="Steer：不中断当前任务"
                    >
                      <Send size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                    </IconButton>
                    <IconButton
                      aria-label="移除排队消息"
                      className="session-follow-up-action"
                      onClick={() => onRemove(item.id)}
                      title="移除"
                    >
                      <X size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
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
