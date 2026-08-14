// Adapted from dashi-taskboard commit 9b2aeb5; modified for CodePilotX.
import type React from 'react'
import { useState } from 'react'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react'
import type {
  TaskboardStatus,
  TaskboardTaskSummary,
} from '@codepilotx/shared/taskboard'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { TaskCard } from './TaskCard.js'

type ProjectNames = ReadonlyMap<string, string>
const TASK_DRAG_TYPE = 'application/x-codepilotx-task'

type TaskDragPayload = { taskId: string; projectId: string }
export type TaskDropPlacement = {
  beforeTaskId: string | null
  afterTaskId: string | null
  position: number
}

type Props = {
  status: TaskboardStatus
  label: string
  shortLabel: string
  tasks: readonly TaskboardTaskSummary[]
  projectNames: ProjectNames
  pendingTaskIds: ReadonlySet<string>
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onMove: (
    taskId: string,
    status: TaskboardStatus,
    placement?: { beforeTaskId: string | null; afterTaskId: string | null },
  ) => Promise<void>
}

export function BoardColumn({
  status,
  label,
  shortLabel,
  tasks,
  projectNames,
  pendingTaskIds,
  onOpen,
  onStart,
  onMove,
}: Props): React.ReactNode {
  const [announcement, setAnnouncement] = useState('')
  const handleDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    const payload = readTaskDragPayload(event.dataTransfer)
    if (!payload) return
    const placement = resolveTaskDropPlacement(tasks, payload)
    void onMove(payload.taskId, status, {
      beforeTaskId: placement.beforeTaskId,
      afterTaskId: placement.afterTaskId,
    }).then(() => {
      setAnnouncement(`已移到${label}第 ${placement.position} 位`)
    }).catch(() => setAnnouncement('移动失败，已恢复'))
  }

  const handleCardDrop = (
    event: React.DragEvent<HTMLElement>,
    targetTaskId: string,
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const payload = readTaskDragPayload(event.dataTransfer)
    if (!payload || payload.taskId === targetTaskId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const placeAfter = event.clientY >= bounds.top + bounds.height / 2
    const placement = resolveTaskDropPlacement(tasks, payload, targetTaskId, placeAfter)
    void onMove(payload.taskId, status, {
      beforeTaskId: placement.beforeTaskId,
      afterTaskId: placement.afterTaskId,
    }).then(() => {
      setAnnouncement(`已移到${label}第 ${placement.position} 位`)
    }).catch(() => setAnnouncement('移动失败，已恢复'))
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
        <span className="taskboard-column__rail" aria-hidden="true" />
        <div>
          <span>{shortLabel}</span>
          <h2>{label}</h2>
        </div>
        <span className="taskboard-column__count">{tasks.length}</span>
      </header>
      <div className="taskboard-column__cards">
        {tasks.map(task => {
          const projectPeers = tasks.filter(candidate => candidate.projectId === task.projectId)
          const projectIndex = projectPeers.findIndex(candidate => candidate.id === task.id)
          return (
          <div
            className="taskboard-column__card-slot"
            key={task.id}
            onDragOver={event => event.preventDefault()}
            onDrop={event => handleCardDrop(event, task.id)}
          >
            <TaskCard
              pending={pendingTaskIds.has(task.id)}
              projectName={projectNames.get(task.projectId) ?? '项目已移除'}
              task={task}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(
                  TASK_DRAG_TYPE,
                  JSON.stringify({ taskId: task.id, projectId: task.projectId } satisfies TaskDragPayload),
                )
              }}
              onOpen={() => onOpen(task.id)}
              onStart={() => onStart(task.id)}
            />
            <details className="taskboard-card__move-menu">
              <summary aria-label={`移动任务：${task.title}`}>移动</summary>
              <div>
                <Button
                  color="ghostSecondary"
                  disabled={pendingTaskIds.has(task.id) || projectIndex === 0}
                  size="compact"
                  onClick={() => {
                    const remaining = projectPeers.filter(candidate => candidate.id !== task.id)
                    const insertionIndex = projectIndex - 1
                    void onMove(task.id, status, {
                      beforeTaskId: remaining[insertionIndex - 1]?.id ?? null,
                      afterTaskId: remaining[insertionIndex]?.id ?? null,
                    }).then(() => {
                      setAnnouncement(`已将 ${task.title} 移到${label}第 ${projectIndex} 位`)
                    }).catch(() => setAnnouncement('移动失败，已恢复'))
                  }}
                >
                  <ChevronUp aria-hidden="true" size={APP_ICON_SIZE - 2} />上移
                </Button>
                <Button
                  color="ghostSecondary"
                  disabled={pendingTaskIds.has(task.id) || projectIndex === projectPeers.length - 1}
                  size="compact"
                  onClick={() => {
                    const remaining = projectPeers.filter(candidate => candidate.id !== task.id)
                    const insertionIndex = projectIndex + 1
                    void onMove(task.id, status, {
                      beforeTaskId: remaining[insertionIndex - 1]?.id ?? null,
                      afterTaskId: remaining[insertionIndex]?.id ?? null,
                    }).then(() => {
                      setAnnouncement(`已将 ${task.title} 移到${label}第 ${projectIndex + 2} 位`)
                    }).catch(() => setAnnouncement('移动失败，已恢复'))
                  }}
                >
                  <ChevronDown aria-hidden="true" size={APP_ICON_SIZE - 2} />下移
                </Button>
                {(['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const)
                  .filter(nextStatus => nextStatus !== task.status)
                  .map(nextStatus => (
                    <Button
                      color="ghostSecondary"
                      disabled={pendingTaskIds.has(task.id)}
                      key={nextStatus}
                      size="compact"
                      onClick={() => {
                        void onMove(task.id, nextStatus).then(() => {
                          setAnnouncement(`已将 ${task.title} 移到${moveLabel(nextStatus).slice(2)}`)
                        }).catch(() => setAnnouncement('移动失败，已恢复'))
                      }}
                    >
                      <ChevronRight
                        aria-hidden="true"
                        size={APP_ICON_SIZE - 2}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                      {moveLabel(nextStatus)}
                    </Button>
                  ))}
              </div>
            </details>
          </div>
          )
        })}
        {tasks.length === 0 ? (
          <p className="taskboard-column__empty">把任务拖到这里，或用移动菜单调整阶段。</p>
        ) : null}
        <p aria-live="polite" className="taskboard-live-region">{announcement}</p>
      </div>
    </section>
  )
}

export function resolveTaskDropPlacement(
  tasks: readonly Pick<TaskboardTaskSummary, 'id' | 'projectId'>[],
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

function moveLabel(status: TaskboardStatus): string {
  switch (status) {
    case 'backlog': return '移到待整理'
    case 'todo': return '移到待办'
    case 'in_progress': return '移到进行中'
    case 'in_review': return '移到待审核'
    case 'done': return '移到已完成'
  }
}
