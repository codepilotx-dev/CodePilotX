import type React from 'react'
import { useState } from 'react'
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
  archived: boolean
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
  archived,
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
  const [taskDragActive, setTaskDragActive] = useState(false)
  const visibleColumns = taskboardBoardColumns(tasks, taskDragActive)
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
          planningNodes={planningNodes}
          expandedTaskIds={expandedTaskIds}
          hierarchyMode={hierarchyMode}
          onMove={onMove}
          onLinkThread={onLinkThread}
          onNewTask={() => onNewTask(column.status)}
          onOpen={onOpen}
          onStart={onStart}
          onTaskDragActiveChange={setTaskDragActive}
          onToggleTask={onToggleTask}
        />
      ))}
    </div>
  )
}

export function taskboardBoardColumns(
  tasks: readonly Pick<TaskboardWorkflowTaskSummary, 'status'>[],
  taskDragActive: boolean,
): typeof TASKBOARD_COLUMNS {
  return TASKBOARD_COLUMNS.filter(column => (
    column.status !== 'blocked'
    || taskDragActive
    || tasks.some(task => task.status === 'blocked')
  ))
}
