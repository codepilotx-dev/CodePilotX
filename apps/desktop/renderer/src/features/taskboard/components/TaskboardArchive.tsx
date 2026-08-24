import type React from 'react'
import { Archive, MessageSquare } from 'lucide-react'
import type { TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { TASKBOARD_PRIORITY_LABELS, taskboardStatusLabel } from '../taskboardConstants.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  onOpen: (taskId: string) => void
}

export function TaskboardArchive({ tasks, projectNames, onOpen }: Props): React.ReactNode {
  const archivedTasks = sortArchivedTasks(tasks)
  return (
    <section className="taskboard-archive" aria-label="已归档任务">
      <div className="taskboard-archive__columns" aria-hidden="true">
        <span>任务</span>
        <span>原状态</span>
        <span>优先级</span>
        <span>项目</span>
        <span>会话</span>
        <span>归档时间</span>
      </div>
      <div className="taskboard-archive__rows">
        {archivedTasks.map(task => (
          <button
            aria-label={`打开已归档任务：${task.title}`}
            className="interactive-row interactive-row--adaptive taskboard-archive__row"
            data-taskboard-task-id={task.id}
            key={task.id}
            type="button"
            onClick={() => onOpen(task.id)}
          >
            <span className="taskboard-archive__identity">
              <Archive aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span>
                <strong>{task.title}</strong>
                <small>#{task.number}</small>
              </span>
            </span>
            <span>{taskboardStatusLabel(task.status)}</span>
            <span>{TASKBOARD_PRIORITY_LABELS[task.priority]}</span>
            <span className="taskboard-archive__project" title={projectNames.get(task.projectId) ?? '项目已移除'}>
              {projectNames.get(task.projectId) ?? '项目已移除'}
            </span>
            <span className="taskboard-archive__threads">
              <MessageSquare aria-hidden="true" size={APP_ICON_SIZE - 2} />
              {task.threads.length}
            </span>
            <time dateTime={task.archivedAt === null ? undefined : new Date(task.archivedAt).toISOString()}>
              {formatArchivedAt(task.archivedAt)}
            </time>
          </button>
        ))}
        {archivedTasks.length === 0 ? (
          <div className="taskboard-archive__empty">
            <Archive aria-hidden="true" size={APP_ICON_SIZE + 4} />
            <strong>暂无归档任务</strong>
            <span>归档后的任务会按最近归档时间显示在这里。</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function sortArchivedTasks<T extends Pick<TaskboardWorkflowTaskSummary, 'archivedAt' | 'id'>>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort((left, right) => (
    (right.archivedAt ?? Number.NEGATIVE_INFINITY) - (left.archivedAt ?? Number.NEGATIVE_INFINITY)
    || left.id.localeCompare(right.id)
  ))
}

function formatArchivedAt(value: number | null): string {
  if (value === null) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}
