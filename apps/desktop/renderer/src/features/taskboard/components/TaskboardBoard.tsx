import type React from 'react'
import type {
  TaskboardWorkflowStatus,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { TASKBOARD_COLUMNS } from '../taskboardConstants.js'
import type { TaskMovePlacement } from '../state/useTaskboardController.js'
import { BoardColumn } from './BoardColumn.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  pendingTaskIds: ReadonlySet<string>
  archived: boolean
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onNewTask: (status: TaskboardWorkflowStatus) => void
  onMove: (
    taskId: string,
    status: TaskboardWorkflowStatus,
    placement?: TaskMovePlacement,
  ) => Promise<void>
}

export function TaskboardBoard({
  tasks,
  projectNames,
  pendingTaskIds,
  archived,
  onOpen,
  onStart,
  onNewTask,
  onMove,
}: Props): React.ReactNode {
  const visibleColumns = TASKBOARD_COLUMNS.filter(column => (
    column.status !== 'blocked'
    || tasks.some(task => task.status === 'blocked')
  ))
  return (
    <div
      className="taskboard-board"
      data-archived={archived || undefined}
      data-column-count={visibleColumns.length}
      style={{
        '--taskboard-main-column-count': visibleColumns.length,
        '--taskboard-main-min-width': `${visibleColumns.length * 300 + Math.max(0, visibleColumns.length - 1) * 24}px`,
      } as React.CSSProperties}
    >
      {visibleColumns.map(column => (
        <BoardColumn
          key={column.status}
          {...column}
          pendingTaskIds={pendingTaskIds}
          projectNames={projectNames}
          tasks={tasks.filter(task => task.status === column.status)}
          onMove={onMove}
          onNewTask={() => onNewTask(column.status)}
          onOpen={onOpen}
          onStart={onStart}
        />
      ))}
    </div>
  )
}
