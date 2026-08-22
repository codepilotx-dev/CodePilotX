import type React from 'react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  TaskboardPriority,
  TaskboardWorkflowStatus,
  TaskboardWorkflowTaskDetails,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { Button } from '../../components/ui/Button.js'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { InputDialog } from '../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { composerDraftStore } from '../session/composer/composerDraftStore.js'
import { AgentRpcError } from '../../services/agentRpcClient.js'
import { TaskboardBoard } from './components/TaskboardBoard.js'
import { TaskboardList } from './components/TaskboardList.js'
import { OtherTasksPanel } from './components/OtherTasksPanel.js'
import { TaskboardToolbar } from './components/TaskboardToolbar.js'
import { CreateTaskDialog } from './components/CreateTaskDialog.js'
import { StartTaskDialog } from './components/StartTaskDialog.js'
import { TaskDetailsDrawer } from './components/TaskDetailsDrawer.js'
import { activeTaskboardPrimaryThreadId, canStartTask, TASKBOARD_PRIORITY_LABELS } from './taskboardConstants.js'
import { useTaskboardController, type TaskboardFilters } from './state/useTaskboardController.js'
import {
  readTaskboardGanttHideCompleted,
  readTaskboardGanttZoom,
  readTaskboardLayout,
  rememberTaskboardLayout,
  type TaskboardGanttZoom,
  type TaskboardLayout,
} from './state/taskboardViewPreferences.js'
import { executeBlockedTransition } from './state/taskboardBlockedTransition.js'
import {
  applyTaskboardReturnScroll,
  markTaskboardReturnPending,
  readPendingTaskboardReturnSnapshot,
  taskboardReturnSnapshot,
  taskboardReturnToken,
  type TaskboardReturnSnapshot,
} from './state/taskboardNavigationRestore.js'
import '../../styles/lazy/taskboard.scss'

const TaskboardGantt = lazy(() => import('./components/TaskboardGantt.js'))

export function TaskboardView(): React.ReactNode {
  const { taskId } = useParams<{ taskId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseTaskboardFilters(searchParams), [searchParams])
  const controller = useTaskboardController(filters, taskId)
  const [createStatus, setCreateStatus] = useState<TaskboardWorkflowStatus | null>(null)
  const [startTaskId, setStartTaskId] = useState<string | null>(null)
  const [otherTasksOpen, setOtherTasksOpen] = useState(false)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const [ganttTodayRequest, setGanttTodayRequest] = useState(0)
  const [returnSnapshot, setReturnSnapshot] = useState<TaskboardReturnSnapshot | null>(null)
  const boardAreaRef = useRef<HTMLDivElement>(null)
  const otherTasksTriggerRef = useRef<HTMLButtonElement>(null)
  const [blockedRequest, setBlockedRequest] = useState<{
    taskId: string
    resolve: () => void
    reject: (error: Error) => void
  } | null>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const view = readTaskboardLayout(searchParams, filters.projectId)
  const ganttZoom = readTaskboardGanttZoom(searchParams)
  const ganttHideCompleted = readTaskboardGanttHideCompleted(searchParams)

  useEffect(() => {
    const snapshot = taskboardReturnSnapshot(location.state)
    if (taskId && snapshot) {
      markTaskboardReturnPending(snapshot)
      return
    }
    if (!taskId) setReturnSnapshot(readPendingTaskboardReturnSnapshot())
  }, [location.key, location.state, taskId])

  useEffect(() => {
    if (taskId || !returnSnapshot || returnSnapshot.view !== view || returnSnapshot.search !== searchParams.toString()) return
    const frame = requestAnimationFrame(() => {
      const area = boardAreaRef.current
      const anchor = area?.querySelector<HTMLElement>(`[data-taskboard-task-id="${CSS.escape(returnSnapshot.taskId)}"]`)
      if (!area || !anchor) return
      const container = view === 'board'
        ? area.querySelector<HTMLElement>('.taskboard-board-scroll')
        : view === 'list'
          ? area.querySelector<HTMLElement>('.taskboard-list')
          : area.querySelector<HTMLElement>('.taskboard-gantt__unscheduled')
      if (!container) return
      const verticalContainer = view === 'board'
        ? anchor.closest<HTMLElement>('.taskboard-column__cards')
        : container
      applyTaskboardReturnScroll(returnSnapshot, container, verticalContainer ?? container)
      anchor.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
      setReturnSnapshot(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [controller.tasks, returnSnapshot, searchParams, taskId, view])
  const projectNames = useMemo(() => new Map(
    controller.projects.map(project => [project.projectId ?? '', project.name]),
  ), [controller.projects])
  const availableLabels = useMemo(() => {
    const labels = new Map<string, { id: string; name: string }>()
    for (const task of controller.tasks) {
      for (const label of task.labels) labels.set(label.id, label)
    }
    return [...labels.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }, [controller.tasks])
  const startTask = findTask(controller.tasks, controller.detail, startTaskId)
  const hasActiveFilters = Boolean(
    filters.query
    || filters.projectId
    || filters.labelIds?.length
    || filters.priorities?.length
    || filters.unread
    || filters.datePreset,
  )

  const updateFilter = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next, { replace: true })
  }

  const openTask = (nextTaskId: string, viewport?: { scrollLeft: number; scrollTop: number }): void => {
    const area = boardAreaRef.current
    const anchor = area?.querySelector<HTMLElement>(`[data-taskboard-task-id="${CSS.escape(nextTaskId)}"]`)
    const container = view === 'board'
      ? area?.querySelector<HTMLElement>('.taskboard-board-scroll')
      : view === 'list'
        ? area?.querySelector<HTMLElement>('.taskboard-list')
        : area?.querySelector<HTMLElement>('.taskboard-gantt__unscheduled')
    const verticalContainer = view === 'board'
      ? anchor?.closest<HTMLElement>('.taskboard-column__cards')
      : container
    const token = crypto.randomUUID()
    const snapshot: TaskboardReturnSnapshot = {
      view,
      search: searchParams.toString(),
      taskId: nextTaskId,
      scrollLeft: viewport?.scrollLeft ?? container?.scrollLeft ?? 0,
      scrollTop: viewport?.scrollTop ?? verticalContainer?.scrollTop ?? 0,
    }
    markTaskboardReturnPending(snapshot)
    navigate(`/taskboard/${encodeURIComponent(nextTaskId)}?${searchParams.toString()}`, {
      state: { taskboardReturnToken: token, taskboardReturnSnapshot: snapshot },
    })
  }
  const closeTask = (): void => {
    if (taskboardReturnToken(location.state)) {
      navigate(-1)
      return
    }
    navigate(`/taskboard${searchParams.size ? `?${searchParams.toString()}` : ''}`)
  }
  const changeView = (nextView: TaskboardLayout): void => {
    rememberTaskboardLayout(nextView, filters.projectId)
    updateFilter({ view: nextView })
  }
  const moveTask = (
    nextTaskId: string,
    status: TaskboardWorkflowStatus,
    placement?: { beforeTaskId: string | null; afterTaskId: string | null },
  ): Promise<void> => {
    const task = controller.tasks.find(candidate => candidate.id === nextTaskId)
    if (status !== 'blocked' || task?.status === 'blocked') {
      return controller.moveTask(nextTaskId, status, placement)
    }
    setBlockedReason('')
    return new Promise((resolve, reject) => setBlockedRequest({ taskId: nextTaskId, resolve, reject }))
  }
  const linkDroppedThread = async (nextTaskId: string, threadId: string): Promise<void> => {
    setDropNotice(null)
    setDropError(null)
    try {
      const role = await controller.linkThreadByDrop(nextTaskId, threadId)
      setDropNotice(role === 'already_linked'
        ? '该会话已关联此任务。'
        : role === 'primary'
          ? '已关联为主会话。'
          : '已关联为辅助会话。')
    } catch (cause) {
      setDropError(
        cause instanceof AgentRpcError && cause.errorCode === 'CONFLICT'
          ? '任务已在其他窗口更新，请重新拖入会话。'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
      throw cause
    }
  }
  const requestStart = (nextTaskId: string): void => {
    const task = findTask(controller.tasks, controller.detail, nextTaskId)
    if (!task || !canStartTask(task)) return
    const activePrimaryThreadId = activeTaskboardPrimaryThreadId(task)
    if (activePrimaryThreadId) {
      navigate(`/threads/${encodeURIComponent(activePrimaryThreadId)}`)
      return
    }
    setStartTaskId(nextTaskId)
  }

  return (
    <section className="taskboard-view" data-detail={taskId ? '' : undefined}>
      <WorkspaceHeaderItem align="end" id="taskboard.actions" order={100} slot="right">
        {!taskId ? (
          <Button color="secondary" onClick={() => setCreateStatus('backlog')}>
            <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            新建任务
          </Button>
        ) : null}
      </WorkspaceHeaderItem>
      {!taskId ? <TaskboardToolbar
        archived={filters.archived}
        count={controller.tasks.length}
        hasActiveFilters={hasActiveFilters}
        labelIds={filters.labelIds ?? []}
        labels={availableLabels}
        loading={controller.loading}
        view={view}
        unread={Boolean(filters.unread)}
        unreadCount={controller.unreadCount}
        datePreset={filters.datePreset}
        sort={filters.sort}
        otherTasksOpen={otherTasksOpen}
        ganttZoom={ganttZoom}
        ganttHideCompleted={ganttHideCompleted}
        otherTasksTriggerRef={otherTasksTriggerRef}
        priority={filters.priorities?.[0]}
        projectId={filters.projectId}
        projects={controller.projects}
        query={filters.query}
        onChange={updateFilter}
        onViewChange={changeView}
        onOtherTasksToggle={() => setOtherTasksOpen(value => !value)}
        onGanttToday={() => setGanttTodayRequest(value => value + 1)}
        onGanttZoomChange={(zoom: TaskboardGanttZoom) => updateFilter({ zoom })}
        onGanttHideCompletedChange={hidden => updateFilter({ hideCompleted: hidden ? '1' : null })}
      /> : null}
      <div className="taskboard-board-area" ref={boardAreaRef}>
        {controller.error ? (
          <div className="taskboard-notice" role="alert">
            <strong>无法读取任务看板</strong>
            <span>{controller.error}</span>
            <Button color="secondary" onClick={() => void controller.refresh()}>重试</Button>
          </div>
        ) : null}
        {controller.loading && controller.tasks.length === 0 ? (
          <div className="taskboard-loading" role="status">正在排列任务跑道…</div>
        ) : null}
        {!taskId && view === 'board' ? (
          <div className="taskboard-board-layout" data-other-open={otherTasksOpen || undefined}>
            <div className="taskboard-board-scroll">
              <TaskboardBoard
                archived={filters.archived}
                pendingTaskIds={controller.pendingTaskIds}
                projectNames={projectNames}
                tasks={controller.tasks}
                onMove={moveTask}
                onLinkThread={linkDroppedThread}
                onNewTask={setCreateStatus}
                onOpen={openTask}
                onStart={requestStart}
              />
            </div>
            {otherTasksOpen ? (
              <OtherTasksPanel
                archived={filters.archived}
                pendingTaskIds={controller.pendingTaskIds}
                projectNames={projectNames}
                tasks={controller.tasks}
                onClose={() => {
                  setOtherTasksOpen(false)
                  requestAnimationFrame(() => otherTasksTriggerRef.current?.focus())
                }}
                onMove={moveTask}
                onLinkThread={linkDroppedThread}
                onArchivedChange={archived => updateFilter({ archived: archived ? '1' : null })}
                onNewTask={setCreateStatus}
                onOpen={openTask}
                onStart={requestStart}
              />
            ) : null}
          </div>
        ) : null}
        {!taskId && view === 'list' ? (
          <TaskboardList
            pendingTaskIds={controller.pendingTaskIds}
            projectId={filters.projectId}
            projectNames={projectNames}
            tasks={controller.tasks}
            onMove={moveTask}
            onOpen={openTask}
            onStart={requestStart}
            onUpdate={controller.updateTask}
          />
        ) : null}
        {!taskId && view === 'gantt' ? (
          <Suspense fallback={<div className="taskboard-loading" role="status">正在展开任务时间轴…</div>}>
            <TaskboardGantt
              hasActiveFilters={hasActiveFilters}
              hideCompleted={ganttHideCompleted}
              pendingTaskIds={controller.pendingTaskIds}
              projectNames={projectNames}
              tasks={controller.tasks}
              todayRequest={ganttTodayRequest}
              restoreViewport={returnSnapshot?.view === 'gantt' && returnSnapshot.search === searchParams.toString()
                ? returnSnapshot
                : null}
              zoom={ganttZoom}
              onOpen={openTask}
              onViewportRestored={() => setReturnSnapshot(null)}
              onUpdateDates={(id, startDate, dueDate) => controller.updateTask(id, { startDate, dueDate })}
            />
          </Suspense>
        ) : null}
        <TaskDetailsDrawer
          detail={controller.detail}
          error={controller.detailError}
          loading={controller.detailLoading}
          open={Boolean(taskId)}
          pending={taskId ? controller.pendingTaskIds.has(taskId) : false}
          projectAvailable={Boolean(controller.detail && projectNames.has(controller.detail.task.projectId))}
          readOnly={controller.detailReadOnly || Boolean(controller.detail && !projectNames.has(controller.detail.task.projectId))}
          projectName={controller.detail ? projectNames.get(controller.detail.task.projectId) ?? '项目已移除' : ''}
          labels={controller.labels}
          onAddComment={controller.addComment}
          onDeleteComment={controller.deleteComment}
          onArchive={async id => { await controller.archiveTask(id); closeTask() }}
          onClose={closeTask}
          onDelete={controller.deleteTask}
          onCreateLabel={controller.createLabel}
          onDeleteLabel={controller.deleteLabel}
          onLinkThread={controller.linkThread}
          onMove={moveTask}
          onOpenThread={id => navigate(`/threads/${encodeURIComponent(id)}`)}
          onRestore={controller.restoreTask}
          onSetPrimaryThread={controller.setPrimaryThread}
          onStart={requestStart}
          onUnlinkThread={controller.unlinkThread}
          onTransition={controller.transitionTask}
          onUpdateComment={controller.updateComment}
          onUpdate={controller.updateTask}
          onUpdateLabel={controller.updateLabel}
        />
      </div>
      <CreateTaskDialog
        initialProjectId={filters.projectId}
        initialStatus={createStatus ?? 'backlog'}
        open={createStatus !== null}
        projects={controller.projects}
        onClose={() => setCreateStatus(null)}
        onCreate={async input => { openTask(await controller.createTask(input)) }}
      />
      <StartTaskDialog
        open={Boolean(startTaskId && startTask && canStartTask(startTask))}
        projectName={startTask ? projectNames.get(startTask.projectId) ?? '项目已移除' : ''}
        projectAvailable={Boolean(startTask && projectNames.has(startTask.projectId))}
        task={startTask}
        onClose={() => setStartTaskId(null)}
        onContinueWithoutSetup={controller.continueStartWithoutSetup}
        onReady={operation => {
          if (!operation.threadId) return
          if (operation.startupInstruction) {
            composerDraftStore.prefillTextIfEmpty(
              `session:${operation.threadId}`,
              operation.startupInstruction,
            )
          }
          setStartTaskId(null)
          navigate(`/threads/${encodeURIComponent(operation.threadId)}`)
        }}
        onRetrySetup={controller.retryStartSetup}
        onStart={controller.startTask}
      />
      <InputDialog
        actionDisabled={!blockedReason.trim()}
        actionLabel="报告阻碍"
        description="填写任务无法继续推进的原因；取消不会改变任务状态。"
        input={{ value: blockedReason, onChange: setBlockedReason, maxLength: 2_000, placeholder: '填写阻碍原因' }}
        open={blockedRequest !== null}
        title="将任务标记为遇到阻碍？"
        onAction={() => {
          if (!blockedRequest || !blockedReason.trim()) return
          const request = blockedRequest
          void executeBlockedTransition(blockedReason, note => (
            controller.transitionTask(request.taskId, 'report_blocked', note)
          )).then(changed => {
            if (!changed) return
            setBlockedRequest(null)
            request.resolve()
          }).catch(error => request.reject(error instanceof Error ? error : new Error(String(error))))
        }}
        onCancel={() => {
          blockedRequest?.reject(new Error('已取消移动'))
          setBlockedRequest(null)
        }}
      />
      <GlobalErrorModal
        message={dropNotice}
        tone="status"
        onDismiss={() => setDropNotice(null)}
      />
      <GlobalErrorModal
        message={dropError}
        onDismiss={() => setDropError(null)}
      />
    </section>
  )
}

export function parseTaskboardFilters(params: URLSearchParams): TaskboardFilters {
  const priority = params.get('priority') as TaskboardPriority | null
  const datePreset = params.get('date')
  const sort = params.get('sort')
  return {
    ...(params.get('projectId') ? { projectId: params.get('projectId')! } : {}),
    ...(params.get('query') ? { query: params.get('query')! } : {}),
    ...(params.get('label') ? { labelIds: params.get('label')!.split(',').filter(Boolean) } : {}),
    ...(priority && priority in TASKBOARD_PRIORITY_LABELS ? { priorities: [priority] } : {}),
    archived: params.get('archived') === '1',
    ...(params.get('unread') === '1' ? { unread: true } : {}),
    ...(isDatePreset(datePreset) ? { datePreset } : {}),
    ...(isSort(sort) ? { sort } : {}),
  }
}

function isDatePreset(value: string | null): value is 'overdue' | 'due_today' | 'due_7_days' | 'no_due_date' {
  return value === 'overdue' || value === 'due_today' || value === 'due_7_days' || value === 'no_due_date'
}

function isSort(value: string | null): value is 'position' | 'due_date' | 'updated_at' {
  return value === 'position' || value === 'due_date' || value === 'updated_at'
}

function findTask(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  detail: TaskboardWorkflowTaskDetails | null,
  taskId: string | null,
): TaskboardWorkflowTaskSummary | null {
  if (!taskId) return null
  return tasks.find(task => task.id === taskId)
    ?? (detail?.task.id === taskId ? { ...detail.task, threads: detail.threads } : null)
}
