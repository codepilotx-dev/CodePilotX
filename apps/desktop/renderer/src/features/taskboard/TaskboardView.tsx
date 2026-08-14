import type React from 'react'
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type {
  TaskboardPriority,
  TaskboardStatus,
  TaskboardTask,
  TaskboardTaskSummary,
} from '@codepilotx/shared/taskboard'
import { Button } from '../../components/ui/Button.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { composerDraftStore } from '../session/composer/composerDraftStore.js'
import { TaskboardBoard } from './components/TaskboardBoard.js'
import { TaskboardToolbar } from './components/TaskboardToolbar.js'
import { CreateTaskDialog } from './components/CreateTaskDialog.js'
import { StartTaskDialog } from './components/StartTaskDialog.js'
import { TaskDetailsDrawer } from './components/TaskDetailsDrawer.js'
import { TASKBOARD_PRIORITY_LABELS } from './taskboardConstants.js'
import { useTaskboardController } from './state/useTaskboardController.js'
import '../../styles/lazy/taskboard.scss'

export function TaskboardView(): React.ReactNode {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseTaskboardFilters(searchParams), [searchParams])
  const controller = useTaskboardController(filters, taskId)
  const [createStatus, setCreateStatus] = useState<TaskboardStatus | null>(null)
  const [startTaskId, setStartTaskId] = useState<string | null>(null)
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
  const startTask = findTask(controller.tasks, controller.detail?.task ?? null, startTaskId)
  const hasActiveFilters = Boolean(
    filters.query
    || filters.projectId
    || filters.labelIds?.length
    || filters.priorities?.length,
  )

  const updateFilter = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next, { replace: true })
  }

  const openTask = (nextTaskId: string): void => {
    navigate(`/taskboard/${encodeURIComponent(nextTaskId)}?${searchParams.toString()}`)
  }
  const closeTask = (): void => {
    navigate(`/taskboard${searchParams.size ? `?${searchParams.toString()}` : ''}`)
  }

  return (
    <section className="taskboard-view">
      <WorkspaceHeaderItem align="end" id="taskboard.actions" order={100} slot="right">
        <Button color="secondary" onClick={() => setCreateStatus('backlog')}>
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          新建任务
        </Button>
      </WorkspaceHeaderItem>
      <TaskboardToolbar
        archived={filters.archived}
        count={controller.tasks.length}
        hasActiveFilters={hasActiveFilters}
        labelIds={filters.labelIds ?? []}
        labels={availableLabels}
        loading={controller.loading}
        priority={filters.priorities?.[0]}
        projectId={filters.projectId}
        projects={controller.projects}
        query={filters.query}
        onChange={updateFilter}
      />
      <div className="taskboard-board-area">
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
        <TaskboardBoard
          archived={filters.archived}
          pendingTaskIds={controller.pendingTaskIds}
          projectNames={projectNames}
          tasks={controller.tasks}
          onMove={controller.moveTask}
          onNewTask={setCreateStatus}
          onOpen={openTask}
          onStart={id => {
            if (controller.tasks.find(task => task.id === id)?.archivedAt == null) {
              setStartTaskId(id)
            }
          }}
        />
        <TaskDetailsDrawer
          detail={controller.detail}
          error={controller.detailError}
          loading={controller.detailLoading}
          open={Boolean(taskId)}
          pending={taskId ? controller.pendingTaskIds.has(taskId) : false}
          projectAvailable={Boolean(controller.detail && projectNames.has(controller.detail.task.projectId))}
          readOnly={controller.detailReadOnly || Boolean(controller.detail && !projectNames.has(controller.detail.task.projectId))}
          projectName={controller.detail ? projectNames.get(controller.detail.task.projectId) ?? '项目已移除' : ''}
          sessions={controller.sessions}
          labels={controller.labels}
          onAddComment={controller.addComment}
          onDeleteComment={controller.deleteComment}
          onArchive={async id => { await controller.archiveTask(id); closeTask() }}
          onClose={closeTask}
          onDelete={controller.deleteTask}
          onCreateLabel={controller.createLabel}
          onDeleteLabel={controller.deleteLabel}
          onLinkThread={controller.linkThread}
          onOpenThread={id => navigate(`/threads/${encodeURIComponent(id)}`)}
          onRestore={controller.restoreTask}
          onSetPrimaryThread={controller.setPrimaryThread}
          onStart={id => {
            if (controller.detail?.task.id === id && controller.detail.task.archivedAt === null) {
              setStartTaskId(id)
            }
          }}
          onUnlinkThread={controller.unlinkThread}
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
        open={Boolean(startTaskId && startTask?.archivedAt === null)}
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
    </section>
  )
}

export function parseTaskboardFilters(params: URLSearchParams) {
  const priority = params.get('priority') as TaskboardPriority | null
  return {
    ...(params.get('projectId') ? { projectId: params.get('projectId')! } : {}),
    ...(params.get('query') ? { query: params.get('query')! } : {}),
    ...(params.get('label') ? { labelIds: params.get('label')!.split(',').filter(Boolean) } : {}),
    ...(priority && priority in TASKBOARD_PRIORITY_LABELS ? { priorities: [priority] } : {}),
    archived: params.get('archived') === '1',
  }
}

function findTask(
  tasks: readonly TaskboardTaskSummary[],
  detail: TaskboardTask | null,
  taskId: string | null,
): TaskboardTask | null {
  if (!taskId) return null
  return tasks.find(task => task.id === taskId) ?? (detail?.id === taskId ? detail : null)
}
