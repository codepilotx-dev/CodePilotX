// Adapted from dashi-taskboard commit 9b2aeb5; modified for CodePilotX.
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, MoreHorizontal, Plus } from 'lucide-react'
import type {
  TaskboardWorkflowStatus,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { PopoverItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { TASKBOARD_ALL_COLUMNS, taskboardStatusLabel } from '../taskboardConstants.js'
import { TaskCard } from './TaskCard.js'

type ProjectNames = ReadonlyMap<string, string>
const TASK_DRAG_TYPE = 'application/x-codepilotx-task'

type TaskDragPayload = { taskId: string; projectId: string }
export type TaskDropPlacement = {
  beforeTaskId: string | null
  afterTaskId: string | null
  position: number
}

type DragInsertState = {
  payload: TaskDragPayload
  taskId: string
  placeAfter: boolean
} | null

type Props = {
  status: TaskboardWorkflowStatus
  label: string
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ProjectNames
  pendingTaskIds: ReadonlySet<string>
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onNewTask: () => void
  onMove: (
    taskId: string,
    status: TaskboardWorkflowStatus,
    placement?: { beforeTaskId: string | null; afterTaskId: string | null },
  ) => Promise<void>
}

export function BoardColumn({
  status,
  label,
  tasks,
  projectNames,
  pendingTaskIds,
  onOpen,
  onStart,
  onNewTask,
  onMove,
}: Props): React.ReactNode {
  const [announcement, setAnnouncement] = useState('')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [dragInsert, setDragInsert] = useState<DragInsertState>(null)
  const dragDepth = useRef(0)

  useEffect(() => {
    if (!draggingTaskId) return
    const clear = (): void => {
      setDraggingTaskId(null)
      setDragInsert(null)
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [draggingTaskId])

  const announceMove = (message: string): void => setAnnouncement(message)

  const moveAndAnnounce = (
    task: TaskboardWorkflowTaskSummary,
    nextStatus: TaskboardWorkflowStatus,
    placement?: { beforeTaskId: string | null; afterTaskId: string | null },
  ): void => {
    void onMove(task.id, nextStatus, placement).then(() => {
      announceMove(`已将 ${task.title} 移到${moveLabel(nextStatus).slice(2)}`)
    }).catch(() => announceMove('移动失败，已恢复'))
  }

  const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    dragDepth.current = 0
    const payload = readTaskDragPayload(event.dataTransfer)
    setDragInsert(null)
    if (!payload) return
    const placement = resolveTaskDropPlacement(tasks, payload)
    void onMove(payload.taskId, status, {
      beforeTaskId: placement.beforeTaskId,
      afterTaskId: placement.afterTaskId,
    }).then(() => {
      announceMove(`已移到${label}第 ${placement.position} 位`)
    }).catch(() => announceMove('移动失败，已恢复'))
  }

  const handleCardDrop = (
    event: React.DragEvent<HTMLElement>,
    targetTaskId: string,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    const payload = readTaskDragPayload(event.dataTransfer)
    setDragInsert(null)
    if (!payload || payload.taskId === targetTaskId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2
    const placement = resolveTaskDropPlacement(tasks, payload, targetTaskId, placeAfter)
    void onMove(payload.taskId, status, {
      beforeTaskId: placement.beforeTaskId,
      afterTaskId: placement.afterTaskId,
    }).then(() => {
      announceMove(`已移到${label}第 ${placement.position} 位`)
    }).catch(() => announceMove('移动失败，已恢复'))
  }

  const handleCardDragEnter = (
    event: React.DragEvent<HTMLElement>,
    targetTaskId: string,
  ): void => {
    event.preventDefault()
    const payload = readTaskDragPayload(event.dataTransfer)
    if (!payload || payload.taskId === targetTaskId) return
    dragDepth.current += 1
    const bounds = event.currentTarget.getBoundingClientRect()
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2
    setDragInsert({ payload, taskId: targetTaskId, placeAfter })
  }

  const handleCardDragLeave = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragInsert(null)
  }

  const projectPeersOf = (taskId: string): TaskboardWorkflowTaskSummary[] => {
    const task = tasks.find(candidate => candidate.id === taskId)
    return task
      ? tasks.filter(candidate => candidate.projectId === task.projectId)
      : []
  }

  return (
    <section
      aria-label={`${label}，${tasks.length} 个任务`}
      className="taskboard-column"
      data-status={status}
      onDragOver={event => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="taskboard-column__header">
        <span className="taskboard-column__dot" aria-hidden="true" />
        <h2>{label}</h2>
        <span className="taskboard-column__count">{tasks.length}</span>
        <IconButton
          aria-label={`新建任务到${label}`}
          className="taskboard-column__add"
          color="ghostSecondary"
          size="iconMd"
          title={`新建任务到${label}`}
          type="button"
          onClick={onNewTask}
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </IconButton>
      </header>
      <div className="taskboard-column__cards">
        {(() => {
          const hoveredIndex = dragInsert
            ? tasks.findIndex(candidate => candidate.id === dragInsert.taskId)
            : -1
          const displacedTaskId = dragInsert
            ? dragInsert.placeAfter
              ? tasks[hoveredIndex + 1]?.id ?? null
              : dragInsert.taskId
            : null
          return tasks.map(task => {
            const insertBefore = dragInsert?.taskId === task.id && !dragInsert.placeAfter
            const insertAfter = dragInsert?.taskId === task.id && dragInsert.placeAfter
            return (
            <div
              className="taskboard-column__card-slot"
              data-drag-insert={insertBefore ? 'before' : insertAfter ? 'after' : undefined}
              key={task.id}
              onDragEnter={event => handleCardDragEnter(event, task.id)}
              onDragLeave={handleCardDragLeave}
              onDragOver={event => event.preventDefault()}
              onDrop={event => handleCardDrop(event, task.id)}
            >
              <TaskCard
                dataDragDisplaced={displacedTaskId === task.id}
                dataDragging={draggingTaskId === task.id}
                menu={(
                  <TaskMoveMenu
                    pending={pendingTaskIds.has(task.id)}
                    projectPeers={projectPeersOf(task.id)}
                    status={status}
                    task={task}
                    onMove={moveAndAnnounce}
                  />
                )}
                pending={pendingTaskIds.has(task.id)}
                projectName={projectNames.get(task.projectId) ?? '项目已移除'}
                task={task}
                onDragStart={event => {
                  setDraggingTaskId(task.id)
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(
                    TASK_DRAG_TYPE,
                    JSON.stringify({ taskId: task.id, projectId: task.projectId } satisfies TaskDragPayload),
                  )
                }}
                onOpen={() => onOpen(task.id)}
                onStart={() => onStart(task.id)}
              />
            </div>
            )
          })
        })()}
        {tasks.length === 0 ? (
          <div className="taskboard-column__empty">
            <p>暂无任务</p>
            <span>拖拽卡片到这里，或点击上方 + 新建。</span>
            <IconButton
              aria-label={`新建任务到${label}`}
              color="ghostSecondary"
              size="toolbar"
              title={`新建任务到${label}`}
              type="button"
              onClick={onNewTask}
            >
              <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </IconButton>
          </div>
        ) : null}
        <p aria-live="polite" className="taskboard-live-region">{announcement}</p>
      </div>
    </section>
  )
}

function TaskMoveMenu({
  pending,
  projectPeers,
  status,
  task,
  onMove,
}: {
  pending: boolean
  projectPeers: readonly TaskboardWorkflowTaskSummary[]
  status: TaskboardWorkflowStatus
  task: TaskboardWorkflowTaskSummary
  onMove: (
    task: TaskboardWorkflowTaskSummary,
    status: TaskboardWorkflowStatus,
    placement?: { beforeTaskId: string | null; afterTaskId: string | null },
  ) => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const projectIndex = projectPeers.findIndex(candidate => candidate.id === task.id)
  const moveWithinColumn = (offset: -1 | 1): void => {
    const remaining = projectPeers.filter(candidate => candidate.id !== task.id)
    const insertionIndex = projectIndex + offset
    onMove(task, status, {
      beforeTaskId: remaining[insertionIndex - 1]?.id ?? null,
      afterTaskId: remaining[insertionIndex]?.id ?? null,
    })
    setOpen(false)
  }
  return (
    <PopoverMenu
      align="end"
      open={open}
      side="top"
      width={148}
      trigger={
        <IconButton
          aria-label={`移动任务：${task.title}`}
          color="ghostSecondary"
          disabled={pending}
          size="toolbar"
          title="移动任务"
        >
          <MoreHorizontal aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        </IconButton>
      }
      onOpenChange={setOpen}
    >
      <PopoverItem
        disabled={pending || projectIndex <= 0}
        icon={<ChevronUp aria-hidden="true" size={APP_ICON_SIZE - 2} />}
        onClick={() => moveWithinColumn(-1)}
      >
        上移
      </PopoverItem>
      <PopoverItem
        disabled={pending || projectIndex === -1 || projectIndex >= projectPeers.length - 1}
        icon={<ChevronDown aria-hidden="true" size={APP_ICON_SIZE - 2} />}
        onClick={() => moveWithinColumn(1)}
      >
        下移
      </PopoverItem>
      <PopoverSeparator />
      {TASKBOARD_ALL_COLUMNS.map(column => column.status)
        .filter(nextStatus => nextStatus !== task.status)
        .map(nextStatus => (
          <PopoverItem
            disabled={pending}
            icon={<ChevronRight aria-hidden="true" size={APP_ICON_SIZE - 2} />}
            key={nextStatus}
            onClick={() => {
              onMove(task, nextStatus)
              setOpen(false)
            }}
          >
            {moveLabel(nextStatus)}
          </PopoverItem>
        ))}
    </PopoverMenu>
  )
}

export function resolveTaskDropPlacement(
  tasks: readonly Pick<TaskboardWorkflowTaskSummary, 'id' | 'projectId'>[],
  payload: TaskDragPayload,
  targetTaskId?: string,
  placeAfter = false,
): TaskDropPlacement {
  const peers = tasks.filter(task =>
    task.projectId === payload.projectId && task.id !== payload.taskId,
  )
  const targetIndex = targetTaskId
    ? peers.findIndex(task => task.id === targetTaskId)
    : -1
  const insertionIndex = targetIndex >= 0
    ? targetIndex + (placeAfter ? 1 : 0)
    : peers.length
  return {
    beforeTaskId: peers[insertionIndex - 1]?.id ?? null,
    afterTaskId: peers[insertionIndex]?.id ?? null,
    position: insertionIndex + 1,
  }
}

function readTaskDragPayload(dataTransfer: DataTransfer): TaskDragPayload | null {
  try {
    const value = JSON.parse(dataTransfer.getData(TASK_DRAG_TYPE)) as Partial<TaskDragPayload>
    return typeof value.taskId === 'string' && typeof value.projectId === 'string'
      ? { taskId: value.taskId, projectId: value.projectId }
      : null
  } catch {
    return null
  }
}

function moveLabel(status: TaskboardWorkflowStatus): string {
  return `移到${taskboardStatusLabel(status)}`
}
