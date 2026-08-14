import type {
  TaskboardPriority,
  TaskboardStatus,
} from '@codepilotx/shared/taskboard'

export const TASKBOARD_COLUMNS: readonly {
  status: TaskboardStatus
  label: string
  shortLabel: string
}[] = [
  { status: 'backlog', label: '待整理', shortLabel: 'BACKLOG' },
  { status: 'todo', label: '待办', shortLabel: 'TODO' },
  { status: 'in_progress', label: '进行中', shortLabel: 'RUNNING' },
  { status: 'in_review', label: '待审核', shortLabel: 'REVIEW' },
  { status: 'done', label: '已完成', shortLabel: 'DONE' },
]

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

export function taskboardStatusLabel(status: TaskboardStatus): string {
  return TASKBOARD_COLUMNS.find(column => column.status === status)?.label ?? status
}
