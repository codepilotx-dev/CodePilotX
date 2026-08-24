import type React from 'react'
import type {
  TaskboardWorkflowStatus,
  TaskboardWorkflowTaskSummary,
} from '@codepilotx/shared/taskboard'
import { TASKBOARD_COLUMNS } from '../taskboardConstants.js'
import type { TaskMovePlacement } from '../state/useTaskboardController.js'
import { BoardColumn } from './BoardColumn.js'
import type { TaskboardPlanningNode } from '../state/taskboardStore.js'
import type { TaskboardHierarchyMode } from '../TaskboardView.js'

type Props = {
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  pendingTaskIds: ReadonlySet<string>
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onNewTask: (status: TaskboardWorkflowStatus) => void
  onMove: (
    taskId: string,
    status: TaskboardWorkflowStatus,
    placement?: TaskMovePlacement,
  ) => Promise<void>
  onLinkThread: (taskId: string, threadId: string) => Promise<void>
  planningNodes?: Readonly<Record<string, TaskboardPlanningNode>>
  expandedTaskIds?: ReadonlySet<string>
  hierarchyMode?: TaskboardHierarchyMode
  onToggleTask?: (taskId: string) => void
}

export function TaskboardBoard({
  tasks,
  projectNames,
  pendingTaskIds,
  onOpen,
  onStart,
  onNewTask,
  onMove,
  onLinkThread,
  planningNodes = {},
  expandedTaskIds = new Set(),
  hierarchyMode = 'roots',
  onToggleTask,
}: Props): React.ReactNode {
  const visibleColumns = taskboardBoardColumns()
  return (
    <div
      className="taskboard-board"
      data-column-count={visibleColumns.length}
    >
      {visibleColumns.map(column => (
        <BoardColumn
          key={column.status}
          {...column}
          pendingTaskIds={pendingTaskIds}
          projectNames={projectNames}
          tasks={taskboardTasksForColumn(tasks, column)}
          planningNodes={planningNodes}
          expandedTaskIds={expandedTaskIds}
          hierarchyMode={hierarchyMode}
          onMove={onMove}
          onLinkThread={onLinkThread}
          onNewTask={() => onNewTask(column.status)}
          onOpen={onOpen}
          onStart={onStart}
          onToggleTask={onToggleTask}
        />
      ))}
    </div>
  )
}

export function taskboardBoardColumns(
): typeof TASKBOARD_COLUMNS {
  return TASKBOARD_COLUMNS
}

export function taskboardTasksForColumn<T extends Pick<TaskboardWorkflowTaskSummary, 'status'>>(
  tasks: readonly T[],
  column: (typeof TASKBOARD_COLUMNS)[number],
): T[] {
  return tasks.filter(task => column.taskStatuses.some(status => status === task.status))
}
