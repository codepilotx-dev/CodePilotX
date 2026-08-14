import type React from 'react'
import type {
  TaskboardStatus,
  TaskboardTaskSummary,
} from '@codepilotx/shared/taskboard'
import { TASKBOARD_COLUMNS } from '../taskboardConstants.js'
import type { TaskMovePlacement } from '../state/useTaskboardController.js'
import { BoardColumn } from './BoardColumn.js'

type Props = {
  tasks: readonly TaskboardTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  pendingTaskIds: ReadonlySet<string>
  archived: boolean
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onMove: (
    taskId: string,
    status: TaskboardStatus,
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
  onMove,
}: Props): React.ReactNode {
  return (
    <div className="taskboard-board" data-archived={archived || undefined}>
      {TASKBOARD_COLUMNS.map(column => (
        <BoardColumn
          key={column.status}
          {...column}
          pendingTaskIds={pendingTaskIds}
          projectNames={projectNames}
          tasks={tasks.filter(task => task.status === column.status)}
          onMove={onMove}
          onOpen={onOpen}
          onStart={onStart}
        />
      ))}
    </div>
  )
}
