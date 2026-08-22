import type { TaskboardLayout } from './taskboardViewPreferences.js'

const PENDING_RETURN_TOKEN_KEY = 'codepilotx.taskboard.return.pending'

export type TaskboardReturnSnapshot = {
  view: TaskboardLayout
  search: string
  taskId: string
  scrollLeft: number
  scrollTop: number
}

export function markTaskboardReturnPending(
  snapshot: TaskboardReturnSnapshot,
  storage?: Pick<Storage, 'setItem'>,
): void {
  try {
    const target = storage ?? window.sessionStorage
    target.setItem(PENDING_RETURN_TOKEN_KEY, JSON.stringify(snapshot))
  } catch {
    // Browser history still preserves the route when session storage is disabled.
  }
}

export function readPendingTaskboardReturnSnapshot(
  storage?: Pick<Storage, 'getItem' | 'removeItem'>,
): TaskboardReturnSnapshot | null {
  try {
    const target = storage ?? window.sessionStorage
    const raw = target.getItem(PENDING_RETURN_TOKEN_KEY)
    if (!raw) return null
    target.removeItem(PENDING_RETURN_TOKEN_KEY)
    const value = JSON.parse(raw) as Partial<TaskboardReturnSnapshot>
    return isTaskboardReturnSnapshot(value) ? value : null
  } catch {
    return null
  }
}

export function taskboardReturnToken(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null
  const token = (state as { taskboardReturnToken?: unknown }).taskboardReturnToken
  return typeof token === 'string' && token ? token : null
}

export function taskboardReturnSnapshot(state: unknown): TaskboardReturnSnapshot | null {
  if (!state || typeof state !== 'object') return null
  const snapshot = (state as { taskboardReturnSnapshot?: unknown }).taskboardReturnSnapshot
  return snapshot && typeof snapshot === 'object' && isTaskboardReturnSnapshot(snapshot as Partial<TaskboardReturnSnapshot>)
    ? snapshot as TaskboardReturnSnapshot
    : null
}

export function applyTaskboardReturnScroll(
  snapshot: Pick<TaskboardReturnSnapshot, 'scrollLeft' | 'scrollTop'>,
  horizontalContainer: Pick<HTMLElement, 'scrollLeft' | 'scrollTop'>,
  verticalContainer: Pick<HTMLElement, 'scrollTop'> = horizontalContainer,
): void {
  horizontalContainer.scrollLeft = snapshot.scrollLeft
  verticalContainer.scrollTop = snapshot.scrollTop
}

export function focusTaskboardReturnAnchor(
  taskId: string,
  getTaskNode: (taskId: string) => HTMLElement | null,
  selectTask?: (taskId: string) => void,
): boolean {
  const node = getTaskNode(taskId)
  if (!node) {
    if (!selectTask) return false
    selectTask(taskId)
    return true
  }
  node.dataset.taskboardReturnAnchor = taskId
  node.tabIndex = -1
  node.focus({ preventScroll: true })
  return true
}

function isTaskboardReturnSnapshot(value: Partial<TaskboardReturnSnapshot>): value is TaskboardReturnSnapshot {
  return (value.view === 'board' || value.view === 'list' || value.view === 'gantt')
    && typeof value.search === 'string'
    && typeof value.taskId === 'string'
    && Number.isFinite(value.scrollLeft)
    && Number.isFinite(value.scrollTop)
}
