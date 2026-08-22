import type { TaskboardWorkflowStatus } from '@codepilotx/shared/taskboard'
import type { TaskboardGanttZoom } from '../taskboardGanttModel.js'
export type { TaskboardGanttZoom } from '../taskboardGanttModel.js'

export type TaskboardLayout = 'board' | 'list' | 'gantt'

const VIEW_STORAGE_PREFIX = 'codepilotx.taskboard.view.'
const COLLAPSED_STORAGE_PREFIX = 'codepilotx.taskboard.list.collapsed.'

export function readTaskboardLayout(
  params: URLSearchParams,
  projectId?: string,
): TaskboardLayout {
  const routeView = params.get('view')
  if (routeView === 'board' || routeView === 'list' || routeView === 'gantt') return routeView
  try {
    const stored = window.localStorage.getItem(`${VIEW_STORAGE_PREFIX}${projectId ?? 'all'}`)
    return stored === 'list' || stored === 'gantt' ? stored : 'board'
  } catch {
    return 'board'
  }
}

export function readTaskboardGanttZoom(params: URLSearchParams): TaskboardGanttZoom {
  const value = params.get('zoom')
  return value === 'day' || value === 'month' ? value : 'week'
}

export function readTaskboardGanttHideCompleted(params: URLSearchParams): boolean {
  return params.get('hideCompleted') === '1'
}

export function readTaskboardCollapsedStatuses(
  projectId?: string,
): ReadonlySet<TaskboardWorkflowStatus> {
  try {
    const raw = window.localStorage.getItem(`${COLLAPSED_STORAGE_PREFIX}${projectId ?? 'all'}`)
    if (!raw) return new Set(['backlog', 'done', 'canceled'])
    const values = JSON.parse(raw) as unknown
    return new Set(Array.isArray(values) ? values.filter(isWorkflowStatus) : [])
  } catch {
    return new Set(['backlog', 'done', 'canceled'])
  }
}

export function rememberTaskboardCollapsedStatuses(
  statuses: ReadonlySet<TaskboardWorkflowStatus>,
  projectId?: string,
): void {
  try {
    window.localStorage.setItem(
      `${COLLAPSED_STORAGE_PREFIX}${projectId ?? 'all'}`,
      JSON.stringify([...statuses]),
    )
  } catch {
    // The in-memory state remains usable when storage is unavailable.
  }
}

function isWorkflowStatus(value: unknown): value is TaskboardWorkflowStatus {
  return value === 'backlog' || value === 'todo' || value === 'in_progress'
    || value === 'blocked' || value === 'in_review' || value === 'done' || value === 'canceled'
}

export function rememberTaskboardLayout(
  view: TaskboardLayout,
  projectId?: string,
): void {
  try {
    window.localStorage.setItem(`${VIEW_STORAGE_PREFIX}${projectId ?? 'all'}`, view)
  } catch {
    // Storage may be disabled. The URL remains the source of truth for this visit.
  }
}
