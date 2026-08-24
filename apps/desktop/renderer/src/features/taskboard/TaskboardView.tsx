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
import type { TaskboardPlanningNode } from './state/taskboardStore.js'
import { Button } from '../../components/ui/Button.js'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { InputDialog } from '../../components/ui/ConfirmationDialog.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { composerDraftStore } from '../session/composer/composerDraftStore.js'
import { AgentRpcError } from '../../services/agentRpcClient.js'
import { TaskboardBoard } from './components/TaskboardBoard.js'
import { TaskboardList } from './components/TaskboardList.js'
import { TaskboardArchive } from './components/TaskboardArchive.js'
import { TaskboardToolbar } from './components/TaskboardToolbar.js'
import { CreateTaskDialog } from './components/CreateTaskDialog.js'
import { StartTaskDialog } from './components/StartTaskDialog.js'
import { TaskDetailsDrawer } from './components/TaskDetailsDrawer.js'
import { activeTaskboardPrimaryThreadId, canStartTask, taskboardStatusLabel, TASKBOARD_PRIORITY_LABELS } from './taskboardConstants.js'
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
export type TaskboardHierarchyMode = 'roots' | 'expanded' | 'ready'

export function TaskboardView(): React.ReactNode {
  const { taskId } = useParams<{ taskId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseTaskboardFilters(searchParams), [searchParams])
  const controller = useTaskboardController(filters, taskId)
  const [createStatus, setCreateStatus] = useState<TaskboardWorkflowStatus | null>(null)
  const [startTaskId, setStartTaskId] = useState<string | null>(null)
  const [dropNotice, setDropNotice] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const [ganttTodayRequest, setGanttTodayRequest] = useState(0)
  const [returnSnapshot, setReturnSnapshot] = useState<TaskboardReturnSnapshot | null>(null)
  const boardAreaRef = useRef<HTMLDivElement>(null)
  const [blockedRequest, setBlockedRequest] = useState<{
    taskId: string
    resolve: () => void
    reject: (error: Error) => void
  } | null>(null)
  const [blockedReason, setBlockedReason] = useState('')
  const view = readTaskboardLayout(searchParams, filters.projectId)
  const ganttZoom = readTaskboardGanttZoom(searchParams)
  const ganttHideCompleted = readTaskboardGanttHideCompleted(searchParams)
  const hierarchyMode = taskboardHierarchyMode(searchParams)
  const expandedTaskIds = useMemo(() => new Set(
    (searchParams.get('expanded') ?? '').split(',').filter(Boolean),
  ), [searchParams])
  const projectedTasks = useMemo(() => projectTaskboardHierarchy(
    controller.tasks,
    controller.planningNodes,
    expandedTaskIds,
    hierarchyMode,
  ), [controller.planningNodes, controller.tasks, expandedTaskIds, hierarchyMode])

  useEffect(() => {
    if (taskId) return
    let cancelled = false
    const load = async (id: string, recursive: boolean): Promise<void> => {
      if (cancelled) return
      const node = controller.planningNodes[id]
      const children = node?.loaded
        ? controller.tasks.filter(task => controller.planningNodes[task.id]?.parentTaskId === id)
        : await controller.loadPlanningChildren(id)
      if (recursive) for (const child of children) await load(child.id, true)
    }
    if (hierarchyMode === 'ready' || view === 'archive') {
      const roots = controller.tasks.filter(task => controller.planningNodes[task.id]?.parentTaskId === null)
      void (async () => { for (const root of roots) await load(root.id, true) })()
    } else {
      const requested = new Set(expandedTaskIds)
      if (view === 'gantt') {
        for (const task of controller.tasks) {
          if (controller.planningNodes[task.id]?.parentTaskId === null) requested.add(task.id)
        }
      }
      for (const id of requested) void load(id, false)
    }
    return () => { cancelled = true }
  }, [controller.loadPlanningChildren, controller.planningNodes, controller.tasks, expandedTaskIds, hierarchyMode, taskId, view])

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
          : view === 'archive'
            ? area.querySelector<HTMLElement>('.taskboard-archive')
            : area.querySelector<HTMLElement>('.taskboard-gantt__unscheduled')
      if (!container) return
      const verticalContainer = view === 'board'
        ? anchor.closest<HTMLElement>('.taskboard-column__cards')
        : container
      applyTaskboardReturnScroll(returnSnapshot, container, verticalContainer ?? container)
      const focusTarget = anchor.matches('button')
        ? anchor
        : anchor.querySelector<HTMLElement>('button')
      focusTarget?.focus({ preventScroll: true })
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
  const compatibilitySummary = useMemo(() => {
    const visible = controller.compatibilityWarnings.slice(0, 3).map((warning) => {
      const task = controller.tasks.find(item => item.id === warning.taskId)
      if (!task) return null
      const projectName = projectNames.get(task.projectId) ?? '项目已移除'
      return `${projectName} · #${task.number} → ${taskboardStatusLabel(warning.fallbackStatus)}`
    }).filter((item): item is string => item !== null)
    if (visible.length === 0) return null
    const remaining = controller.compatibilityWarnings.length - visible.length
    return `${visible.join('；')}${remaining > 0 ? `；另有 ${remaining} 项` : ''}`
  }, [controller.compatibilityWarnings, controller.tasks, projectNames])
  const startTask = findTask(controller.tasks, controller.detail, startTaskId)
  const hasActiveFilters = Boolean(
    filters.query
    || filters.projectId
    || filters.labelIds?.length
    || filters.priorities?.length
    || filters.unread
    || filters.datePreset
    || (view !== 'archive' && hierarchyMode === 'ready'),
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
        : view === 'archive'
          ? area?.querySelector<HTMLElement>('.taskboard-archive')
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
    updateFilter({
      view: nextView,
      archived: null,
      ...(nextView === 'archive' ? { sort: null } : {}),
    })
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
      <WorkspaceHeaderItem align="start" id="taskboard.views" order={0} slot="left">
        {!taskId ? (
          <SegmentedControl
            ariaLabel="任务视图"
            className="taskboard-header__views"
            onChange={changeView}
            options={[
              { value: 'board', label: '议题看板' },
              { value: 'list', label: '列表视图' },
              { value: 'gantt', label: '甘特图' },
              { value: 'archive', label: '已归档' },
            ]}
            value={view}
          />
        ) : null}
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem align="end" id="taskboard.actions" order={100} slot="right">
        {!taskId && view !== 'archive' ? (
          <Button color="secondary" onClick={() => setCreateStatus('backlog')}>
            <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            新建任务
          </Button>
        ) : null}
      </WorkspaceHeaderItem>
      {!taskId ? <TaskboardToolbar
        count={view === 'archive' ? controller.tasks.length : projectedTasks.length}
        hasActiveFilters={hasActiveFilters}
        labelIds={filters.labelIds ?? []}
        labels={availableLabels}
        loading={controller.loading}
        view={view}
        unread={Boolean(filters.unread)}
        unreadCount={controller.unreadCount}
        datePreset={filters.datePreset}
        sort={filters.sort}
        hierarchyMode={hierarchyMode}
        ganttZoom={ganttZoom}
        ganttHideCompleted={ganttHideCompleted}
        priority={filters.priorities?.[0]}
        projectId={filters.projectId}
        projects={controller.projects}
        query={filters.query}
        onChange={updateFilter}
        onHierarchyModeChange={mode => updateFilter({ hierarchy: mode === 'roots' ? null : mode, expanded: mode === 'roots' ? null : searchParams.get('expanded') })}
        onGanttToday={() => setGanttTodayRequest(value => value + 1)}
        onGanttZoomChange={(zoom: TaskboardGanttZoom) => updateFilter({ zoom })}
        onGanttHideCompletedChange={hidden => updateFilter({ hideCompleted: hidden ? '1' : null })}
      /> : null}
      <div className="taskboard-board-area" ref={boardAreaRef}>
        {controller.loadError ? (
          <div className="taskboard-notice" role="alert">
            <strong>无法读取任务看板</strong>
            <span>{controller.loadError}</span>
            <Button color="secondary" onClick={() => void controller.refresh()}>重试</Button>
          </div>
        ) : null}
        {controller.operationError ? (
          <div className="taskboard-notice" role="alert">
            <strong>任务操作失败</strong>
            <span>{controller.operationError}</span>
            <Button color="secondary" onClick={controller.dismissOperationError}>关闭</Button>
          </div>
        ) : null}
        {compatibilitySummary ? (
          <div className="taskboard-notice" data-tone="warning" role="status">
            <strong>部分任务已兼容读取</strong>
            <span>{compatibilitySummary}。移动或重新设置任务阶段后会写回合法状态。</span>
          </div>
        ) : null}
        {controller.loading && controller.tasks.length === 0 ? (
          <div className="taskboard-loading" role="status">正在排列任务跑道…</div>
        ) : null}
        {!taskId && view === 'board' ? (
          <div className="taskboard-board-layout">
            <div className="taskboard-board-scroll">
              <TaskboardBoard
                pendingTaskIds={controller.pendingTaskIds}
                projectNames={projectNames}
                tasks={projectedTasks}
                planningNodes={controller.planningNodes}
                expandedTaskIds={expandedTaskIds}
                hierarchyMode={hierarchyMode}
                onMove={moveTask}
                onLinkThread={linkDroppedThread}
                onNewTask={setCreateStatus}
                onOpen={openTask}
                onStart={requestStart}
                onToggleTask={id => toggleExpandedTask(id, expandedTaskIds, updateFilter)}
              />
            </div>
          </div>
        ) : null}
        {!taskId && view === 'list' ? (
          <TaskboardList
            pendingTaskIds={controller.pendingTaskIds}
            projectId={filters.projectId}
            projectNames={projectNames}
            tasks={projectedTasks}
            planningNodes={controller.planningNodes}
            expandedTaskIds={expandedTaskIds}
            hierarchyMode={hierarchyMode}
            onMove={moveTask}
            onOpen={openTask}
            onStart={requestStart}
            onUpdate={controller.updateTask}
            onToggleTask={id => toggleExpandedTask(id, expandedTaskIds, updateFilter)}
          />
        ) : null}
        {!taskId && view === 'gantt' ? (
          <Suspense fallback={<div className="taskboard-loading" role="status">正在展开任务时间轴…</div>}>
            <TaskboardGantt
              hasActiveFilters={hasActiveFilters}
              hideCompleted={ganttHideCompleted}
              pendingTaskIds={controller.pendingTaskIds}
              projectNames={projectNames}
              tasks={projectedTasks}
              planningSteps={controller.planningSteps}
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
        {!taskId && view === 'archive' ? (
          <TaskboardArchive
            projectNames={projectNames}
            tasks={controller.tasks}
            onOpen={openTask}
          />
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
          onArchive={controller.archiveTask}
          onClose={closeTask}
          onDelete={controller.deleteTask}
          onCreateLabel={controller.createLabel}
          onDeleteLabel={controller.deleteLabel}
          onLinkThread={controller.linkThread}
          onMove={moveTask}
          onOpenTask={openTask}
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

export function projectTaskboardHierarchy(
  tasks: readonly TaskboardWorkflowTaskSummary[],
  nodes: Readonly<Record<string, TaskboardPlanningNode>>,
  expandedTaskIds: ReadonlySet<string>,
  mode: TaskboardHierarchyMode,
): TaskboardWorkflowTaskSummary[] {
  const roots = tasks.filter(task => nodes[task.id]?.parentTaskId === null || !nodes[task.id])
  if (mode === 'roots') return roots
  if (mode === 'ready') {
    return tasks.filter(task => {
      const node = nodes[task.id]
      return !node || node.readiness.status === 'ready'
    })
  }
  return tasks.filter(task => {
    let parentId = nodes[task.id]?.parentTaskId ?? null
    const visited = new Set<string>()
    while (parentId) {
      if (visited.has(parentId) || !expandedTaskIds.has(parentId)) return false
      visited.add(parentId)
      parentId = nodes[parentId]?.parentTaskId ?? null
    }
    return true
  })
}

function taskboardHierarchyMode(params: URLSearchParams): TaskboardHierarchyMode {
  const value = params.get('hierarchy')
  return value === 'expanded' || value === 'ready' ? value : 'roots'
}

function toggleExpandedTask(
  taskId: string,
  expandedTaskIds: ReadonlySet<string>,
  updateFilter: (patch: Record<string, string | null>) => void,
): void {
  const next = new Set(expandedTaskIds)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  updateFilter({ expanded: next.size ? [...next].join(',') : null })
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
    archived: params.get('view') === 'archive' || params.get('archived') === '1',
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
