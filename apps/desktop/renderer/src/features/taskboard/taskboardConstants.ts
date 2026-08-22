import type {
  TaskboardPriority,
  TaskboardWorkflowTaskSummary,
  TaskboardWorkflowStatus,
} from '@codepilotx/shared/taskboard'

export const TASKBOARD_ALL_COLUMNS: readonly {
  status: TaskboardWorkflowStatus
  label: string
}[] = [
  { status: 'backlog', label: '待立项' },
  { status: 'todo', label: '等待认领' },
  { status: 'in_progress', label: '处理中' },
  { status: 'blocked', label: '遇到阻碍' },
  { status: 'in_review', label: '等你确认' },
  { status: 'done', label: '完成' },
  { status: 'canceled', label: '取消' },
]

export const TASKBOARD_COLUMNS = TASKBOARD_ALL_COLUMNS.filter(column => (
  column.status === 'todo'
  || column.status === 'in_progress'
  || column.status === 'blocked'
  || column.status === 'in_review'
))

export const TASKBOARD_OTHER_STATUSES = ['backlog', 'done', 'canceled'] as const satisfies readonly TaskboardWorkflowStatus[]
export const TASKBOARD_ALL_STATUSES = TASKBOARD_ALL_COLUMNS.map(column => column.status)

export const TASKBOARD_PRIORITY_LABELS: Record<TaskboardPriority, string> = {
  none: '无优先级',
  urgent: '紧急',
  high: '高',
  medium: '中',
  low: '低',
}

export const TASKBOARD_PRIORITY_ORDER: Record<TaskboardPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
}

export function taskboardStatusLabel(status: TaskboardWorkflowStatus): string {
  return TASKBOARD_ALL_COLUMNS.find(column => column.status === status)?.label ?? status
}

export function canStartTask(task: {
  status: TaskboardWorkflowStatus
  archivedAt: number | null
}): boolean {
  return task.archivedAt === null && task.status !== 'done' && task.status !== 'canceled'
}

export function activeTaskboardPrimaryThreadId(
  task: Pick<TaskboardWorkflowTaskSummary, 'threads'>,
): string | null {
  const primary = task.threads.find(thread => thread.role === 'primary')
  return primary?.attention === 'running' || primary?.attention === 'needs_input'
    ? primary.threadId
    : null
}
