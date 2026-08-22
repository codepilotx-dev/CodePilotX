import type { TaskboardWorkflowStatus } from '@codepilotx/shared/taskboard'

export const TASKBOARD_GANTT_ZOOMS = ['day', 'week', 'month'] as const
export type TaskboardGanttZoom = (typeof TASKBOARD_GANTT_ZOOMS)[number]

export const TASKBOARD_GANTT_GROUPS = [
  { status: 'todo', label: '等待认领' },
  { status: 'in_progress', label: '处理中' },
  { status: 'blocked', label: '遇到阻碍' },
  { status: 'in_review', label: '等你确认' },
  { status: 'backlog', label: '待立项' },
  { status: 'done', label: '完成' },
  { status: 'canceled', label: '取消' },
] as const satisfies readonly {
  status: TaskboardWorkflowStatus
  label: string
}[]

export interface TaskboardGanttTaskInput {
  id: string
  number: number
  title: string
  status: TaskboardWorkflowStatus
  startDate: string | null
  dueDate: string | null
}

export type TaskboardGanttProjectedTask<T extends TaskboardGanttTaskInput = TaskboardGanttTaskInput> =
  | {
      task: T
      scheduled: true
      startDate: Date
      endDateExclusive: Date
    }
  | {
      task: T
      scheduled: false
      startDate: null
      endDateExclusive: null
    }

export interface TaskboardGanttGroupProjection<T extends TaskboardGanttTaskInput = TaskboardGanttTaskInput> {
  status: TaskboardWorkflowStatus
  label: string
  tasks: TaskboardGanttProjectedTask<T>[]
}

export function parseTaskboardLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null

  return date
}

export function formatTaskboardLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function taskboardExclusiveEndDate(dueDate: string): Date | null {
  const date = parseTaskboardLocalDate(dueDate)
  if (!date) return null
  date.setDate(date.getDate() + 1)
  return date
}

export function taskboardInclusiveDatesFromGanttRange(
  startDate: Date,
  endDateExclusive: Date,
): { startDate: string; dueDate: string } {
  const dueDate = new Date(endDateExclusive)
  dueDate.setDate(dueDate.getDate() - 1)
  return {
    startDate: formatTaskboardLocalDate(startDate),
    dueDate: formatTaskboardLocalDate(dueDate),
  }
}

export function projectTaskboardGanttTask<T extends TaskboardGanttTaskInput>(
  task: T,
): TaskboardGanttProjectedTask<T> {
  const startDate = task.startDate ? parseTaskboardLocalDate(task.startDate) : null
  const dueDate = task.dueDate ? parseTaskboardLocalDate(task.dueDate) : null
  if (!startDate || !dueDate || startDate.getTime() > dueDate.getTime()) {
    return {
      task,
      scheduled: false,
      startDate: null,
      endDateExclusive: null,
    }
  }

  const endDateExclusive = new Date(dueDate)
  endDateExclusive.setDate(endDateExclusive.getDate() + 1)
  return {
    task,
    scheduled: true,
    startDate,
    endDateExclusive,
  }
}

export function taskboardGanttUnscheduledReason(
  task: Pick<TaskboardGanttTaskInput, 'startDate' | 'dueDate'>,
): '未设置日期' | '缺少开始日期' | '缺少截止日期' | '日期范围无效' | null {
  if (!task.startDate && !task.dueDate) return '未设置日期'
  if (!task.startDate) return '缺少开始日期'
  if (!task.dueDate) return '缺少截止日期'
  return projectTaskboardGanttTask({
    id: '',
    number: 0,
    title: '',
    status: 'backlog',
    startDate: task.startDate,
    dueDate: task.dueDate,
  }).scheduled ? null : '日期范围无效'
}

export function projectTaskboardGanttGroups<T extends TaskboardGanttTaskInput>(
  tasks: readonly T[],
  hideCompleted = false,
): TaskboardGanttGroupProjection<T>[] {
  const visibleTasks = hideCompleted
    ? tasks.filter(task => task.status !== 'done' && task.status !== 'canceled')
    : tasks

  return TASKBOARD_GANTT_GROUPS.flatMap(group => {
    const groupTasks = visibleTasks
      .filter(task => task.status === group.status)
      .map(projectTaskboardGanttTask)
    return groupTasks.length > 0
      ? [{ status: group.status, label: group.label, tasks: groupTasks }]
      : []
  })
}
