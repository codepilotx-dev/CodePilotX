import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type {
  RpcParams,
  TaskboardStartExecution,
  TaskboardStartOperation,
} from '@codepilotx/agent-protocol'
import type {
  TaskboardPriority,
  TaskboardWorkflowDatePreset,
  TaskboardWorkflowSort,
  TaskboardWorkflowStartMode,
  TaskboardWorkflowStatus,
  TaskboardWorkflowTask,
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
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
  unread?: boolean
  datePreset?: TaskboardWorkflowDatePreset
  sort?: TaskboardWorkflowSort
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
    status: TaskboardWorkflowStatus
    priority: TaskboardPriority
    startDate?: string | null
    dueDate?: string | null
    threadLinks?: readonly { threadId: string; role: 'primary' | 'supporting' }[]
  }) => Promise<string>
  moveTask: (
    taskId: string,
    status: TaskboardWorkflowStatus,
    placement?: TaskMovePlacement,
  ) => Promise<void>
  transitionTask: (
    taskId: string,
    action: RpcParams<'taskboard/workflow/transition'>['action'],
    note?: string,
  ) => Promise<void>
  archiveTask: (taskId: string) => Promise<void>
  restoreTask: (taskId: string) => Promise<void>
  updateTask: (
    taskId: string,
    patch: RpcParams<'taskboard/workflow/update'>['patch'],
  ) => Promise<void>
  deleteTask: (taskId: string) => Promise<void>
  addComment: (taskId: string, body: string) => Promise<void>
  updateComment: (commentId: string, body: string) => Promise<void>
  deleteComment: (commentId: string) => Promise<void>
  createLabel: (projectId: string, name: string) => Promise<void>
  updateLabel: (labelId: string, name: string) => Promise<void>
  deleteLabel: (labelId: string) => Promise<void>
  linkThread: (taskId: string, threadId: string) => Promise<void>
  linkThreadByDrop: (
    taskId: string,
    threadId: string,
  ) => Promise<'primary' | 'supporting' | 'already_linked'>
  unlinkThread: (taskId: string, threadId: string) => Promise<void>
  setPrimaryThread: (taskId: string, threadId: string) => Promise<void>
  startTask: (
    taskId: string,
    execution: TaskboardStartExecution,
    mode?: TaskboardWorkflowStartMode,
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
      if (!capabilities.includes('taskboard.workflow.v1')) {
        throw new Error('当前 Agent 不支持任务看板。请更新 Agent 后重试。')
      }
      const [result, projects, sessions] = await Promise.all([
        collectTaskboardWorkflowPages(cursor => desktopClient.listTaskboardWorkflowTasks!({
          ...(current.projectId ? { projectId: current.projectId } : {}),
          ...(current.query ? { query: current.query } : {}),
          ...(current.labelIds?.length ? { labelIds: [...current.labelIds] } : {}),
          ...(current.priorities?.length ? { priorities: [...current.priorities] } : {}),
          ...(current.unread !== undefined ? { unread: current.unread } : {}),
          ...(current.datePreset ? { datePreset: current.datePreset } : {}),
          ...(current.sort ? { sort: current.sort } : {}),
          ...(cursor ? { cursor } : {}),
          archived: current.archived,
          limit: 500,
        })),
        desktopClient.listProjects(),
        desktopClient.listSessions(),
      ])
      if (request !== listRequestRef.current) return
      store.patch({
        tasks: sortTasks(result.tasks, current.sort),
        unreadCount: result.unreadCount,
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
      let result = await desktopClient.readTaskboardWorkflowTask!({ taskId })
      if (result.task.task.attention.unread) {
        try {
          result = await desktopClient.markTaskboardWorkflowTaskRead!({
            taskId,
            ...(result.task.task.attention.unreadAt !== null
              ? { expectedUnreadAt: result.task.task.attention.unreadAt }
              : {}),
          })
        } catch {
          // A concurrent activity may supersede this read marker. Keep the detail usable;
          // the durable workflow event will reconcile the latest attention state.
        }
      }
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
        tasks: upsertTask(store.getSnapshot().tasks, {
          ...result.task.task,
          threads: result.task.threads,
        }, filtersRef.current),
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
      if (!events.some(event => (
        event.type === 'taskboard/changed'
        || event.type === 'taskboard/workflow/changed'
        || event.type === 'turn/statusChanged'
      ))) return
      void refresh()
      if (selectedTaskId) void refreshDetail(selectedTaskId)
    },
  ), [refresh, refreshDetail, selectedTaskId])

  const applyDetails = useCallback((details: TaskboardWorkflowTaskDetails): void => {
    const summary: TaskboardWorkflowTaskSummary = {
      ...details.task,
      threads: details.threads,
    }
    const current = store.getSnapshot()
    const previous = current.tasks.find(task => task.id === summary.id)
    store.patch({
      tasks: upsertTask(
        current.tasks,
        summary,
        filtersRef.current,
      ),
      ...(selectedTaskId === details.task.id ? { detail: details } : {}),
      unreadCount: previous?.attention.unread && !summary.attention.unread
        ? Math.max(0, current.unreadCount - 1)
        : current.unreadCount,
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
      const result = await desktopClient.createTaskboardWorkflowTask!(
        taskboardCreateTaskRpcInput(input),
      )
      applyDetails(result.task)
      return result.task.task.id
    },
    moveTask: async (taskId, status, placement) => {
      const task = state.tasks.find(candidate => candidate.id === taskId)
      if (!task || task.status === status && !placement) return
      const rollback = state.tasks
      store.patch({ tasks: optimisticallyMoveTask(rollback, task, status, placement) })
      try {
        const result = await runTaskMutation(taskId, () => desktopClient.moveTaskboardWorkflowTask!({
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
    transitionTask: async (taskId, action, note) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.transitionTaskboardWorkflowTask!(
        taskboardTransitionRpcInput(taskId, task.version, action, note),
      ))
      applyDetails(result.task)
    },
    archiveTask: async taskId => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      await runTaskMutation(taskId, () => desktopClient.archiveTaskboardTask({
        taskId,
        expectedVersion: task.version,
      }))
      await refresh()
    },
    restoreTask: async taskId => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      await runTaskMutation(taskId, () => desktopClient.restoreTaskboardTask({
        taskId,
        expectedVersion: task.version,
      }))
      await refresh()
      if (selectedTaskId === taskId) await refreshDetail(taskId)
    },
    updateTask: async (taskId, patch) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.updateTaskboardWorkflowTask!({
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
      await runTaskMutation(taskId, () => desktopClient.createTaskboardComment({
        taskId,
        body,
        expectedVersion: task.version,
      }))
      await refresh()
      await refreshDetail(taskId)
    },
    updateComment: async (commentId, body) => {
      const comment = state.detail?.comments.find(candidate => candidate.id === commentId)
      if (!comment) return
      await runTaskMutation(comment.taskId, () => desktopClient.updateTaskboardComment({
        commentId,
        body,
        expectedVersion: comment.version,
      }))
      await refresh()
      await refreshDetail(comment.taskId)
    },
    deleteComment: async commentId => {
      const comment = state.detail?.comments.find(candidate => candidate.id === commentId)
      if (!comment) return
      await runTaskMutation(comment.taskId, () => desktopClient.deleteTaskboardComment({
        commentId,
        expectedVersion: comment.version,
      }))
      await refresh()
      await refreshDetail(comment.taskId)
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
      const prepared = taskboardThreadLinksForDrop(
        taskThreads(state.tasks, state.detail, taskId),
        threadId,
      )
      if (prepared.role === 'already_linked') return
      const result = await runTaskMutation(taskId, () => desktopClient.linkTaskboardWorkflowThreads!({
        taskId,
        links: prepared.links,
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    linkThreadByDrop: async (taskId, threadId) => {
      const task = state.tasks.find(candidate => candidate.id === taskId)
      if (!task || task.archivedAt !== null) throw new Error('该任务当前不可关联会话。')
      const prepared = taskboardThreadLinksForDrop(task.threads, threadId)
      if (prepared.role === 'already_linked') return prepared.role
      store.setTaskPending(taskId, true)
      try {
        const result = await desktopClient.linkTaskboardWorkflowThreads!({
          taskId,
          links: prepared.links,
          expectedVersion: task.version,
        })
        applyDetails(result.task)
        return prepared.role
      } catch (error) {
        if (error instanceof AgentRpcError && error.errorCode === 'CONFLICT') {
          await refresh()
          if (selectedTaskId === taskId) await refreshDetail(taskId)
        }
        throw error
      } finally {
        store.setTaskPending(taskId, false)
      }
    },
    unlinkThread: async (taskId, threadId) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const remaining = state.detail?.threads.filter(thread => thread.threadId !== threadId) ?? []
      const result = await runTaskMutation(taskId, () => desktopClient.linkTaskboardWorkflowThreads!({
        taskId,
        links: remaining.map((thread, index) => ({
          threadId: thread.threadId,
          role: index === 0 && !remaining.some(candidate => candidate.role === 'primary')
            ? 'primary' as const
            : thread.role,
        })),
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    setPrimaryThread: async (taskId, threadId) => {
      const task = findTask(state.tasks, state.detail?.task, taskId)
      if (!task) return
      const result = await runTaskMutation(taskId, () => desktopClient.linkTaskboardWorkflowThreads!({
        taskId,
        links: state.detail?.threads.map(thread => ({
          threadId: thread.threadId,
          role: thread.threadId === threadId ? 'primary' as const : 'supporting' as const,
        })) ?? [],
        expectedVersion: task.version,
      }))
      applyDetails(result.task)
    },
    startTask: async (taskId, execution, mode) => {
      store.setTaskPending(taskId, true)
      try {
        const task = findTask(state.tasks, state.detail?.task, taskId)
        if (!task) throw new Error('任务不存在或已移除。')
        const result = await desktopClient.startTaskboardWorkflowTask!({
          taskId,
          expectedVersion: task.version,
          execution,
          mode: mode ?? taskboardStartMode(
            state.tasks.find(candidate => candidate.id === taskId)?.threads
              ?? (state.detail?.task.id === taskId ? state.detail.threads : []),
          ),
          authorizeBacklog: true,
        })
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

export async function collectTaskboardWorkflowPages<T>(
  loadPage: (cursor?: string) => Promise<{
    tasks: readonly T[]
    unreadCount: number
    nextCursor: string | null
  }>,
): Promise<{ tasks: T[]; unreadCount: number }> {
  const tasks: T[] = []
  let cursor: string | undefined
  let unreadCount = 0
  do {
    const page = await loadPage(cursor)
    tasks.push(...page.tasks)
    unreadCount = page.unreadCount
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return { tasks, unreadCount }
}

/** 把创建任务的 UI 输入映射为 workflow/create 参数。 */
export function taskboardCreateTaskRpcInput(input: {
  projectId: string
  title: string
  description?: string
  status: TaskboardWorkflowStatus
  priority: TaskboardPriority
  startDate?: string | null
  dueDate?: string | null
  threadLinks?: readonly { threadId: string; role: 'primary' | 'supporting' }[]
}): Omit<RpcParams<'taskboard/workflow/create'>, 'operationId'> {
  return {
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    status: input.status,
    priority: input.priority,
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.threadLinks?.length ? { threadLinks: [...input.threadLinks] } : {}),
  }
}

export function taskboardStartMode(
  threads: readonly { role: 'primary' | 'supporting' }[],
): 'continue_primary' | 'new_primary' {
  return threads.some(thread => thread.role === 'primary')
    ? 'continue_primary'
    : 'new_primary'
}

export function taskboardThreadLinksForDrop(
  threads: readonly { threadId: string; role: 'primary' | 'supporting' }[],
  threadId: string,
): {
  role: 'primary' | 'supporting' | 'already_linked'
  links: Array<{ threadId: string; role: 'primary' | 'supporting' }>
} {
  const links = threads.map(thread => ({
    threadId: thread.threadId,
    role: thread.role,
  }))
  if (links.some(thread => thread.threadId === threadId)) {
    return { role: 'already_linked', links }
  }
  const role = links.some(thread => thread.role === 'primary')
    ? 'supporting' as const
    : 'primary' as const
  return { role, links: [...links, { threadId, role }] }
}

export function taskboardTransitionRpcInput(
  taskId: string,
  expectedVersion: number,
  action: RpcParams<'taskboard/workflow/transition'>['action'],
  note?: string,
): Omit<RpcParams<'taskboard/workflow/transition'>, 'operationId'> {
  const trimmedNote = note?.trim()
  return {
    taskId,
    expectedVersion,
    action,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  }
}

async function waitForStart(
  initial: TaskboardStartOperation,
): Promise<TaskboardStartOperation> {  let operation = initial
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

function sortTasks(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  sort: TaskboardWorkflowSort = 'position',
): TaskboardWorkflowTaskSummary[] {
  const statusOrder: Record<TaskboardWorkflowStatus, number> = {
    backlog: 0,
    todo: 1,
    in_progress: 2,
    blocked: 3,
    in_review: 4,
    done: 5,
    canceled: 6,
  }
  return [...tasks].sort((left, right) => {
    const statusDifference = statusOrder[left.status] - statusOrder[right.status]
    if (statusDifference !== 0) return statusDifference
    if (sort === 'due_date') {
      const dueDifference = nullableDateValue(left.dueDate) - nullableDateValue(right.dueDate)
      if (dueDifference !== 0) return dueDifference
    }
    if (sort === 'updated_at') {
      const updatedDifference = right.updatedAt - left.updatedAt
      if (updatedDifference !== 0) return updatedDifference
    }
    return left.projectId.localeCompare(right.projectId)
      || left.position - right.position
      || left.id.localeCompare(right.id)
  })
}

function upsertTask(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  task: TaskboardWorkflowTaskSummary,
  filters: TaskboardFilters,
): TaskboardWorkflowTaskSummary[] {
  const withoutTask = tasks.filter(candidate => candidate.id !== task.id)
  return taskMatchesFilters(task, filters)
    ? sortTasks([...withoutTask, task], filters.sort)
    : sortTasks(withoutTask, filters.sort)
}

function taskMatchesFilters(
  task: TaskboardWorkflowTaskSummary,
  filters: TaskboardFilters,
): boolean {
  if ((task.archivedAt !== null) !== filters.archived) return false
  if (filters.projectId && task.projectId !== filters.projectId) return false
  if (filters.priorities?.length && !filters.priorities.includes(task.priority)) return false
  if (filters.unread !== undefined && task.attention.unread !== filters.unread) return false
  if (filters.datePreset && !matchesDatePreset(task.dueDate, filters.datePreset)) return false
  if (
    filters.labelIds?.length
    && !filters.labelIds.every(id => task.labels.some(label => label.id === id))
  ) return false
  const query = filters.query?.trim().toLocaleLowerCase('zh-CN')
  return !query || `${task.title}\n${task.description}`.toLocaleLowerCase('zh-CN').includes(query)
}

function matchesDatePreset(
  dueDate: string | null,
  preset: TaskboardWorkflowDatePreset,
): boolean {
  if (preset === 'no_due_date') return dueDate === null
  if (dueDate === null) return false
  const today = localDateKey(new Date())
  if (preset === 'overdue') return dueDate < today
  if (preset === 'due_today') return dueDate === today
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  return dueDate >= today && dueDate <= localDateKey(weekEnd)
}

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nullableDateValue(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : Date.parse(`${value}T12:00:00`)
}

export function optimisticallyMoveTask(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  task: TaskboardWorkflowTaskSummary,
  status: TaskboardWorkflowStatus,
  placement?: TaskMovePlacement,
): TaskboardWorkflowTaskSummary[] {
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
  tasks: readonly TaskboardWorkflowTaskSummary[],
  detailTask: TaskboardWorkflowTask | undefined,
  taskId: string,
): Pick<TaskboardWorkflowTask, 'id' | 'version'> | undefined {
  return tasks.find(task => task.id === taskId)
    ?? (detailTask?.id === taskId ? detailTask : undefined)
}

function taskThreads(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  detail: TaskboardWorkflowTaskDetails | null,
  taskId: string,
): readonly { threadId: string; role: 'primary' | 'supporting' }[] {
  return tasks.find(task => task.id === taskId)?.threads
    ?? (detail?.task.id === taskId ? detail.threads : [])
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
