import { useState } from 'react'
import type React from 'react'
import {
  Check,
  CornerDownLeft,
  GripVertical,
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
  const [dropTarget, setDropTarget] = useState<{
    id: string
    edge: 'before' | 'after'
  } | null>(null)

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

  function dropAt(targetId: string, edge: 'before' | 'after'): void {
    if (!draggingId || draggingId === targetId) return
    const next = items.map(item => item.id)
    const from = next.indexOf(draggingId)
    if (from < 0) return
    const [moved] = next.splice(from, 1)
    if (!moved) return
    const target = next.indexOf(targetId)
    if (target < 0) return
    next.splice(edge === 'after' ? target + 1 : target, 0, moved)
    onReorder(next)
    setDraggingId(null)
    setDropTarget(null)
  }

  return (
    <section aria-label="消息队列" className="session-follow-up-dock">
      {pauseReason ? (
        <div className="session-follow-up-header">
          <span>已排队 {items.length} 条</span>
          <button
            className="session-follow-up-resume"
            onClick={onResume}
            type="button"
          >
            <Play aria-hidden="true" size={12} />
            继续队列
          </button>
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
              className={[
                'session-follow-up-item',
                draggingId === item.id ? 'is-dragging' : '',
                dropTarget?.id === item.id
                  ? `is-drop-${dropTarget.edge}`
                  : '',
              ].join(' ')}
              key={item.id}
              onDragLeave={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDropTarget(current =>
                    current?.id === item.id ? null : current,
                  )
                }
              }}
              onDragOver={event => {
                event.preventDefault()
                if (!draggingId || draggingId === item.id) return
                const bounds = event.currentTarget.getBoundingClientRect()
                const edge =
                  event.clientY < bounds.top + bounds.height / 2
                    ? 'before'
                    : 'after'
                setDropTarget({ id: item.id, edge })
                event.dataTransfer.dropEffect = 'move'
              }}
              onDrop={event => {
                event.preventDefault()
                dropAt(item.id, dropTarget?.id === item.id
                  ? dropTarget.edge
                  : 'before')
              }}
              role="listitem"
            >
              <button
                aria-label="拖动以调整排队顺序"
                className="session-follow-up-drag-handle"
                draggable={!isEditing}
                onDragEnd={() => {
                  setDraggingId(null)
                  setDropTarget(null)
                }}
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
                    <button
                      aria-label="将排队消息作为补充要求发送"
                      className="session-follow-up-action session-follow-up-action--guide"
                      onClick={() => onSendNow(item.id)}
                      title="Steer：不中断当前任务"
                      type="button"
                    >
                      <CornerDownLeft
                        aria-hidden="true"
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                      <span>引导</span>
                    </button>
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
