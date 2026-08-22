import type React from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Play, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { TaskboardPriority, TaskboardWorkflowStatus, TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { canStartTask, TASKBOARD_ALL_STATUSES, TASKBOARD_PRIORITY_LABELS, taskboardStatusLabel } from '../taskboardConstants.js'
import { readTaskboardCollapsedStatuses, rememberTaskboardCollapsedStatuses } from '../state/taskboardViewPreferences.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  pendingTaskIds: ReadonlySet<string>
  projectId?: string
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onMove: (taskId: string, status: TaskboardWorkflowStatus) => Promise<void>
  onUpdate: (taskId: string, patch: { priority: TaskboardPriority }) => Promise<void>
}

export function TaskboardList(props: Props): React.ReactNode {
  const [collapsed, setCollapsed] = useState(() => new Set(readTaskboardCollapsedStatuses(props.projectId)))
  useEffect(() => setCollapsed(new Set(readTaskboardCollapsedStatuses(props.projectId))), [props.projectId])

  const toggle = (status: TaskboardWorkflowStatus): void => {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      rememberTaskboardCollapsedStatuses(next, props.projectId)
      return next
    })
  }

  return (
    <div className="taskboard-list" aria-label="任务列表">
      <div className="taskboard-list__columns" aria-hidden="true">
        <span>任务</span><span>状态</span><span>优先级</span><span>会话</span><span>开始</span><span>截止</span><span />
      </div>
      {TASKBOARD_ALL_STATUSES.map(status => {
        const statusTasks = props.tasks.filter(task => task.status === status)
        const closed = collapsed.has(status)
        return (
          <section className="taskboard-list__group" data-status={status} key={status}>
            <button aria-expanded={!closed} className="taskboard-list__group-header" type="button" onClick={() => toggle(status)}>
              {closed ? <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} /> : <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} />}
              <span className="taskboard-list__status-dot" aria-hidden="true" />
              <strong>{taskboardStatusLabel(status)}</strong><span>{statusTasks.length}</span>
            </button>
            {!closed ? (
              <div className="taskboard-list__rows">
                {statusTasks.map(task => {
                  const needsInput = task.threads.some(thread => thread.attention === 'needs_input')
                  return (
                    <article className="taskboard-list__row" data-unread={task.attention.unread || undefined} key={task.id}>
                      <button className="taskboard-list__open" type="button" onClick={() => props.onOpen(task.id)}>
                        <span className="taskboard-list__identity">
                          <small>{props.projectNames.get(task.projectId) ?? '项目已移除'} · #{task.number}</small>
                          <strong>{task.title}</strong>
                        </span>
                        {task.attention.unread ? <span className="taskboard-unread-dot" aria-label="待整理任务" /> : null}
                      </button>
                      <select aria-label={`${task.title}的状态`} disabled={props.pendingTaskIds.has(task.id)} value={task.status} onChange={event => void props.onMove(task.id, event.currentTarget.value as TaskboardWorkflowStatus)}>
                        {TASKBOARD_ALL_STATUSES.map(value => <option key={value} value={value}>{taskboardStatusLabel(value)}</option>)}
                      </select>
                      <select aria-label={`${task.title}的优先级`} disabled={props.pendingTaskIds.has(task.id)} value={task.priority} onChange={event => void props.onUpdate(task.id, { priority: event.currentTarget.value as TaskboardPriority })}>
                        {(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).map(value => <option key={value} value={value}>{TASKBOARD_PRIORITY_LABELS[value]}</option>)}
                      </select>
                      <span className="taskboard-list__threads">
                        {needsInput ? <TriangleAlert aria-label="等待处理" size={APP_ICON_SIZE - 2} /> : <MessageSquare aria-hidden="true" size={APP_ICON_SIZE - 2} />}{task.threads.length}
                      </span>
                      <span>{formatDate(task.startDate)}</span><span>{formatDate(task.dueDate)}</span>
                      {canStartTask(task) ? (
                        <IconButton color="ghostSecondary" disabled={props.pendingTaskIds.has(task.id)} size="toolbar" title="开始执行" onClick={() => props.onStart(task.id)}>
                          <Play aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                        </IconButton>
                      ) : null}
                    </article>
                  )
                })}
                {statusTasks.length === 0 ? <p className="taskboard-list__empty">暂无任务</p> : null}
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function formatDate(value: string | null): string {
  if (value === null) return '—'
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}
