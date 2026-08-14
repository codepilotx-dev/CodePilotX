import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type {
  RpcParams,
  TaskboardStartExecution,
  TaskboardStartOperation,
} from '@codepilotx/agent-protocol'
import type {
  TaskboardPriority,
  TaskboardStatus,
  TaskboardTask,
  TaskboardTaskDetails,
  TaskboardTaskSummary,
} from '@codepilotx/shared/taskboard'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { AgentRpcError } from '../../../services/agentRpcClient.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../../services/desktop-client/eventSubscriptionFilters.js'
import {
  createTaskboardStore,
  type TaskboardViewState,
} from './taskboardStore.js'

export type TaskboardFilters = {
  projectId?: string
  query?: string
  labelIds?: readonly string[]
  priorities?: readonly TaskboardPriority[]
  archived: boolean
}

export type TaskMovePlacement = {
  beforeTaskId: string | null
  afterTaskId: string | null
}

export function useTaskboardController(
  filters: TaskboardFilters,
  selectedTaskId: string | undefined,
): TaskboardViewState & {
  refresh: () => Promise<void>
  createTask: (input: {
    projectId: string
    title: string
    description?: string
    priority: TaskboardPriority
  }) => Promise<string>
  moveTask: (
    taskId: string,
    status: TaskboardStatus,
    placement?: TaskMovePlacement,
  ) => Promise<void>
  archiveTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
  updateTask: (
    taskId: string,
    patch: RpcParams<'taskboard/task/update'>['patch'],
  ) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  addComment: (taskId: string, body: string) => Promise<void>
  updateComment: (commentId: string, body: string) => Promise<void>
  deleteComment: (commentId: string) => Promise<void>
  createLabel: (projectId: string, name: string) => Promise<void>
  updateLabel: (labelId: string, name: string) => Promise<void>
  deleteLabel: (labelId: string) => Promise<void>
  linkThread: (taskId: string, threadId: string) => Promise<void>
  unlinkThread: (taskId: string, threadId: string) => Promise<void>
  setPrimaryThread: (taskId: string, threadId: string) => Promise<void>
  startTask: (
    taskId: string,
    execution: TaskboardStartExecution,
  ) => Promise<TaskboardStartOperation>
  retryStartSetup: (operation: TaskboardStartOperation) => Promise<TaskboardStartOperation>
  continueStartWithoutSetup: (operation: TaskboardStartOperation) => Promise<TaskboardStartOperation>
} {
  const storeRef = useRef<ReturnType<typeof createTaskboardStore> | null>(null)
  storeRef.current ??= createTaskboardStore()
  const store = storeRef.current
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  )
  const filterKey = JSON.stringify(filters)
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++listRequestRef.current
    store.patch({ loading: true, error: null })
    try {
      const current = filtersRef.current
      const capabilities = await desktopClient.getRuntimeCapabilities()
      if (!capabilities.includes('taskboard.v1')) {
        throw new Error('当前 Agent 不支持任务看板。请更新 Agent 后重试。')
      }
      const [result, projects, sessions] = await Promise.all([
        desktopClient.listTaskboardTasks({
          ...(current.projectId ? { projectId: current.projectId } : {}),
          ...(current.query ? { query: current.query } : {}),
          ...(current.labelIds?.length ? { labelIds: [...current.labelIds] } : {}),
          ...(current.priorities?.length ? { priorities: [...current.priorities] } : {}),
          archived: current.archived,
          limit: 500,
        }),
        desktopClient.listProjects(),
        desktopClient.listSessions(),
      ])
      if (request !== listRequestRef.current) return
      store.patch({
        tasks: sortTasks(result.tasks),
        projects,
        sessions: sessions.map(session => session.item),
        loading: false,
      })
    } catch (error) {
      if (request !== listRequestRef.current) return
      store.patch({ loading: false, error: errorMessage(error) })
    }
  }, [filterKey, store])

  const refreshDetail = useCallback(async (taskId: string): Promise<void> => {
    const request = ++detailRequestRef.current
    store.patch({ detailLoading: true, detailError: null })
    try {
      const result = await desktopClient.readTaskboardTask({ taskId })
      let detailReadOnly = false
      const labels = await desktopClient.listTaskboardLabels({
        projectId: result.task.task.projectId,
      }).then(value => value.labels).catch(error => {
        const removed = error instanceof AgentRpcError
          && (error.errorCode === 'PROJECT_REMOVED' || error.errorCode === 'PROJECT_NOT_FOUND')
        if (!removed) throw error
        detailReadOnly = true
        return result.task.task.labels
      })
      if (request !== detailRequestRef.current) return
      store.patch({
        detail: result.task,
        labels,
        detailReadOnly,
        detailLoading: false,
      })
    } catch (error) {
      if (request !== detailRequestRef.current) return
      store.patch({
        detail: null,
        detailLoading: false,
        detailError: errorMessage(error),
      })
    }
  }, [store])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!selectedTaskId) {
      detailRequestRef.current += 1
      store.patch({ detail: null, labels: [], detailLoading: false, detailError: null, detailReadOnly: false })
      return
    }
    void refreshDetail(selectedTaskId)
  }, [refreshDetail, selectedTaskId, store])

  useEffect(() => desktopClient.subscribeAgentEventEnvelopes(
    { liveEventTypes: AGENT_LIVE_EVENT_FILTERS.taskboard },
    events => {
      if (!events.some(event => event.type === 'taskboard/changed')) return
      void refresh()
      if (selectedTaskId) void refreshDetail(selectedTaskId)
    },
  ), [refresh, refreshDetail, selectedTaskId])

  const applyDetails = useCallback((details: TaskboardTaskDetails): void => {
    const summary: TaskboardTaskSummary = {
      ...details.task,
      threads: details.threads,
    }
    const current = store.getSnapshot()
    store.patch({
      tasks: upsertTask(
        current.tasks,
        summary,
        filtersRef.current,
      ),
      ...(selectedTaskId === details.task.id ? { detail: details } : {}),
      error: null,
    })
  }, [selectedTaskId, store])

  const handleMutationError = useCallback(async (
    error: unknown,
    taskId: string,
  ): Promise<void> => {
    const conflict = error instanceof AgentRpcError && error.errorCode === 'CONFLICT'
    store.patch({
      error: conflict ? '任务已在其他窗口更新，已重新加载最新内容。' : errorMessage(error),
    })
    if (conflict) {
      await refresh()
      if (selectedTaskId === taskId) await refreshDetail(taskId)
    }
  }, [refresh, refreshDetail, selectedTaskId, store])

  const runTaskMutation = useCallback(async <T,>(
    taskId: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    store.setTaskPending(taskId, true)
    try {
      return await operation()
    } catch (error) {
      await handleMutationError(error, taskId)
      throw error
    } finally {
      store.setTaskPending(taskId, false)
    }
  }, [handleMutationError, store])

  return useMemo(() => ({
    ...state,
    refresh,
    createTask: async input => {
      const result = await desktopClient.createTaskboardTask({
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
      })
      applyDetails(result.task)
      return result.task.task.id
    },
    moveTask: async (taskId, status, placement) => {
      const task = state.tasks.find(candidate => candidate.id === taskId)
      if (!task || task.status === status && !placement) return
      const rollback = state.tasks
      store.patch({ tasks: optimisticallyMoveTask(rollback, task, status, placement) })
      try {
        const result = await runTaskMutation(taskId, () => desktopClient.moveTaskboardTask({
          taskId,
          status,
          expectedVersion: task.version,
          ...(placement ?? {}),
        }))
        applyDetails(result.task)
      } catch (error) {
        if (!(error instanceof AgentRpcError && error.errorCode === 'CONFLICT')) {
          store.patch({ tasks: rollback })
        }
        throw error
      }
    },
    archiveTask: async taskId => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.archiveTaskboardTask({
        taskId,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    restoreTask: async taskId => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.restoreTaskboardTask({
        taskId,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    updateTask: async (taskId, patch) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.updateTaskboardTask({
        taskId,
        patch,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    deleteTask: async taskId => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      await runTaskMutation(taskId, () => desktopClient.deleteTaskboardTask({
        taskId,
        expectedVersion: task.version,
      }))
      store.patch({
        tasks: store.getSnapshot().tasks.filter(candidate => candidate.id !== taskId),
        ...(selectedTaskId === taskId ? { detail: null } : {}),
      })
    },
    addComment: async (taskId, body) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.createTaskboardComment({
        taskId,
        body,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    updateComment: async (commentId, body) => {
      const comment = state.detail?.comments.find(candidate => candidate.id === commentId)
      if (!comment) return
      const result = await runTaskMutation(comment.taskId, () => desktopClient.updateTaskboardComment({
        commentId,
        body,
        expectedVersion: comment.version,
      }))
      applyDetails(result.task)
    },
    deleteComment: async commentId => {
      const comment = state.detail?.comments.find(candidate => candidate.id === commentId)
      if (!comment) return
      const result = await runTaskMutation(comment.taskId, () => desktopClient.deleteTaskboardComment({
        commentId,
        expectedVersion: comment.version,
      }))
      applyDetails(result.task)
    },
    createLabel: async (projectId, name) => {
      try {
        const result = await desktopClient.createTaskboardLabel({ projectId, name })
        store.patch({ labels: [...store.getSnapshot().labels, result.label] })
      } catch (error) {
        await handleMutationError(error, selectedTaskId ?? '')
        throw error
      }
    },
    updateLabel: async (labelId, name) => {
      const label = state.labels.find(candidate => candidate.id === labelId)
      if (!label) return
      try {
        const result = await desktopClient.updateTaskboardLabel({
          labelId,
          name,
          expectedVersion: label.version,
        })
        const snapshot = store.getSnapshot()
        store.patch({
          labels: snapshot.labels.map(candidate => candidate.id === labelId ? result.label : candidate),
          tasks: snapshot.tasks.map(task => ({
            ...task,
            labels: task.labels.map(candidate => candidate.id === labelId ? result.label : candidate),
          })),
          detail: snapshot.detail ? {
            ...snapshot.detail,
            task: {
              ...snapshot.detail.task,
              labels: snapshot.detail.task.labels.map(candidate => candidate.id === labelId ? result.label : candidate),
            },
          } : null,
        })
      } catch (error) {
        await handleMutationError(error, selectedTaskId ?? '')
        throw error
      }
    },
    deleteLabel: async labelId => {
      const label = state.labels.find(candidate => candidate.id === labelId)
      if (!label) return
      try {
        await desktopClient.deleteTaskboardLabel({
          labelId,
          expectedVersion: label.version,
        })
        const snapshot = store.getSnapshot()
        store.patch({
          labels: snapshot.labels.filter(candidate => candidate.id !== labelId),
          tasks: snapshot.tasks.map(task => ({
            ...task,
            labels: task.labels.filter(candidate => candidate.id !== labelId),
          })),
          detail: snapshot.detail ? {
            ...snapshot.detail,
            task: {
              ...snapshot.detail.task,
              labels: snapshot.detail.task.labels.filter(candidate => candidate.id !== labelId),
            },
          } : null,
        })
      } catch (error) {
        await handleMutationError(error, selectedTaskId ?? '')
        throw error
      }
    },
    linkThread: async (taskId, threadId) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.linkTaskboardThread({
        taskId,
        threadId,
        role: state.detail?.threads.length ? 'supporting' : 'primary',
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    unlinkThread: async (taskId, threadId) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.unlinkTaskboardThread({
        taskId,
        threadId,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    setPrimaryThread: async (taskId, threadId) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.setPrimaryTaskboardThread({
        taskId,
        threadId,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    startTask: async (taskId, execution) => {
      store.setTaskPending(taskId, true)
      try {
        const result = await desktopClient.startTaskboardTask({ taskId, execution })
        return await waitForStart(result.operation)
      } catch (error) {
        await handleMutationError(error, taskId)
        throw error
      } finally {
        store.setTaskPending(taskId, false)
      }
    },
    retryStartSetup: async operation => {
      const result = await desktopClient.retryTaskboardStartSetup({
        operationId: operation.operationId,
        revision: operation.revision,
      })
      return waitForStart(result.operation)
    },
    continueStartWithoutSetup: async operation => {
      const result = await desktopClient.continueTaskboardStartWithoutSetup({
        operationId: operation.operationId,
        revision: operation.revision,
      })
      return waitForStart(result.operation)
    },
  }), [applyDetails, handleMutationError, refresh, runTaskMutation, selectedTaskId, state, store])
}

async function waitForStart(
  initial: TaskboardStartOperation,
): Promise<TaskboardStartOperation> {
  let operation = initial
  while (operation.status === 'running') {
    await new Promise(resolve => window.setTimeout(resolve, 350))
    const result = await desktopClient.readTaskboardStartStatus({
      operationId: operation.operationId,
      afterRevision: operation.revision,
    })
    operation = result.operation
  }
  return operation
}

function sortTasks(tasks: readonly TaskboardTaskSummary[]): TaskboardTaskSummary[] {
  const statusOrder: Record<TaskboardStatus, number> = {
    backlog: 0,
    todo: 1,
    in_progress: 2,
    in_review: 3,
    done: 4,
  }
  return [...tasks].sort((left, right) =>
    statusOrder[left.status] - statusOrder[right.status]
    || left.projectId.localeCompare(right.projectId)
    || left.position - right.position
    || left.id.localeCompare(right.id),
  )
}

function upsertTask(
  tasks: readonly TaskboardTaskSummary[],
  task: TaskboardTaskSummary,
  filters: TaskboardFilters,
): TaskboardTaskSummary[] {
  const withoutTask = tasks.filter(candidate => candidate.id !== task.id)
  return taskMatchesFilters(task, filters)
    ? sortTasks([...withoutTask, task])
    : sortTasks(withoutTask)
}

function taskMatchesFilters(
  task: TaskboardTaskSummary,
  filters: TaskboardFilters,
): boolean {
  if ((task.archivedAt !== null) !== filters.archived) return false
  if (filters.projectId && task.projectId !== filters.projectId) return false
  if (filters.priorities?.length && !filters.priorities.includes(task.priority)) return false
  if (
    filters.labelIds?.length
    && !filters.labelIds.every(id => task.labels.some(label => label.id === id))
  ) return false
  const query = filters.query?.trim().toLocaleLowerCase('zh-CN')
  return !query || `${task.title}\n${task.description}`.toLocaleLowerCase('zh-CN').includes(query)
}

export function optimisticallyMoveTask(
  tasks: readonly TaskboardTaskSummary[],
  task: TaskboardTaskSummary,
  status: TaskboardStatus,
  placement?: TaskMovePlacement,
): TaskboardTaskSummary[] {
  const withoutTask = tasks.filter(candidate => candidate.id !== task.id)
  const moved = { ...task, status }
  if (!placement) return sortTasks([...withoutTask, moved])
  const beforeIndex = placement.beforeTaskId
    ? withoutTask.findIndex(candidate => candidate.id === placement.beforeTaskId)
    : -1
  const afterIndex = placement.afterTaskId
    ? withoutTask.findIndex(candidate => candidate.id === placement.afterTaskId)
    : -1
  const index = beforeIndex >= 0
    ? beforeIndex + 1
    : afterIndex >= 0
      ? afterIndex
      : withoutTask.length
  const next = [...withoutTask]
  next.splice(index, 0, moved)
  return next
}

function findTask(
  tasks: readonly TaskboardTaskSummary[],
  detailTask: TaskboardTask | undefined,
  taskId: string,
): Pick<TaskboardTask, 'id' | 'version'> | undefined {
  return tasks.find(task => task.id === taskId)
    ?? (detailTask?.id === taskId ? detailTask : undefined)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
