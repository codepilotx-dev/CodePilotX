import type React from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { TaskboardWorkflowStatus, TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { BoardColumn } from './BoardColumn.js'
import { TASKBOARD_OTHER_STATUSES, taskboardStatusLabel } from '../taskboardConstants.js'
import type { TaskMovePlacement } from '../state/useTaskboardController.js'

type Props = {
  archived: boolean
  tasks: readonly TaskboardWorkflowTaskSummary[]
  projectNames: ReadonlyMap<string, string>
  pendingTaskIds: ReadonlySet<string>
  onOpen: (taskId: string) => void
  onStart: (taskId: string) => void
  onNewTask: (status: TaskboardWorkflowStatus) => void
  onMove: (taskId: string, status: TaskboardWorkflowStatus, placement?: TaskMovePlacement) => Promise<void>
  onArchivedChange: (archived: boolean) => void
  onClose: () => void
}

export function OtherTasksPanel(props: Props): React.ReactNode {
  const [status, setStatus] = useState<(typeof TASKBOARD_OTHER_STATUSES)[number]>('backlog')
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [props.onClose])

  return (
    <aside className="taskboard-other" aria-label="其他任务" id="taskboard-other-tasks">
      <header className="taskboard-other__header">
        <strong>其他任务</strong>
        <IconButton aria-label="关闭其他任务" color="ghostSecondary" size="toolbar" title="关闭其他任务" onClick={props.onClose}>
          <X aria-hidden="true" size={APP_ICON_SIZE} />
        </IconButton>
      </header>
      <div className="taskboard-other__tabs" role="tablist" aria-label="其他任务状态">
        {TASKBOARD_OTHER_STATUSES.map(value => (
          <Button
            aria-selected={!props.archived && status === value}
            color={!props.archived && status === value ? 'ghostActive' : 'ghostSecondary'}
            key={value}
            role="tab"
            size="compact"
            onClick={() => {
              setStatus(value)
              if (props.archived) props.onArchivedChange(false)
            }}
          >
            {taskboardStatusLabel(value)}
            <span>{props.tasks.filter(task => task.status === value).length}</span>
          </Button>
        ))}
        <Button
          aria-selected={props.archived}
          color={props.archived ? 'ghostActive' : 'ghostSecondary'}
          role="tab"
          size="compact"
          onClick={() => props.onArchivedChange(true)}
        >
          已归档
        </Button>
      </div>
      <BoardColumn
        label={props.archived ? '已归档' : taskboardStatusLabel(status)}
        pendingTaskIds={props.pendingTaskIds}
        projectNames={props.projectNames}
        status={props.archived ? 'done' : status}
        tasks={props.archived ? props.tasks : props.tasks.filter(task => task.status === status)}
        onMove={props.onMove}
        onNewTask={() => props.onNewTask(status)}
        onOpen={props.onOpen}
        onStart={props.onStart}
      />
    </aside>
  )
}
