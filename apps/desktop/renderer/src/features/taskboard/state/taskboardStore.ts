import type {
  TaskboardLabel,
  TaskboardPlanAggregate,
  TaskboardPlanReadiness,
  TaskboardPlanStep,
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import type { SessionListItem } from '../../../uiTypes.js'

export type TaskboardPlanningNode = {
  parentTaskId: string | null
  depth: number
  aggregate: TaskboardPlanAggregate
  readiness: TaskboardPlanReadiness
  loaded: boolean
}

export type TaskboardViewState = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projects: readonly DesktopWorkspace[]
  sessions: readonly SessionListItem[]
  labels: readonly TaskboardLabel[]
  detail: TaskboardWorkflowTaskDetails | null
  unreadCount: number
  loading: boolean
  detailLoading: boolean
  error: string | null
  detailError: string | null
  detailReadOnly: boolean
  pendingTaskIds: ReadonlySet<string>
  planningNodes: Readonly<Record<string, TaskboardPlanningNode>>
  planningSteps: readonly TaskboardPlanStep[]
}

const INITIAL_STATE: TaskboardViewState = {
  tasks: [],
  projects: [],
  sessions: [],
  labels: [],
  detail: null,
  unreadCount: 0,
  loading: true,
  detailLoading: false,
  error: null,
  detailError: null,
  detailReadOnly: false,
  pendingTaskIds: new Set(),
  planningNodes: {},
  planningSteps: [],
}

export class TaskboardStore {
  #state: TaskboardViewState = INITIAL_STATE
  #listeners = new Set<() => void>()

  getSnapshot = (): TaskboardViewState => this.#state
  getServerSnapshot = (): TaskboardViewState => INITIAL_STATE

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  patch(patch: Partial<TaskboardViewState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#emit()
  }

  setTaskPending(taskId: string, pending: boolean): void {
    const next = new Set(this.#state.pendingTaskIds)
    if (pending) next.add(taskId)
    else next.delete(taskId)
    this.patch({ pendingTaskIds: next })
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }
}

export function createTaskboardStore(): TaskboardStore {
  return new TaskboardStore()
}
