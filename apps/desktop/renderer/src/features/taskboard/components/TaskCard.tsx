import type React from 'react'
import { MessageSquare, Play, TriangleAlert } from 'lucide-react'
import type { TaskboardTaskSummary, TaskboardWorktreeStatus } from '@codepilotx/shared/taskboard'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'

type Props = {
  task: TaskboardTaskSummary
  projectName: string
  pending: boolean
  menu?: React.ReactNode
  dataDragging?: boolean
  dataDragDisplaced?: boolean
  onOpen: () => void
  onStart: () => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
}

export function TaskCard({
  task,
  projectName,
  pending,
  menu,
  dataDragging,
  dataDragDisplaced,
  onOpen,
  onStart,
  onDragStart,
}: Props): React.ReactNode {
  const runningThreads = task.threads.filter(
    thread => thread.attention === 'running',
  ).length
  const needsInput = task.threads.some(
    thread => thread.attention === 'needs_input',
  )
  const executionThread = task.threads.find(thread => thread.role === 'primary')
    ?? task.threads[0]
  const execution = executionThread?.execution

  return (
    <article
      aria-busy={pending || undefined}
      className="taskboard-card"
      data-drag-displaced={dataDragDisplaced ? '' : undefined}
      data-dragging={dataDragging ? '' : undefined}
      data-pending={pending || undefined}
      data-priority={task.priority}
      draggable={!pending}
      onDragStart={onDragStart}
    >
      <button
        aria-label={`打开任务：${task.title}`}
        className="taskboard-card__open"
        type="button"
        onClick={onOpen}
      >
        <span className="taskboard-card__context">
          <span className="taskboard-card__project" title={projectName}>
            {projectName} · <span className="taskboard-card__number">#{task.number}</span>
          </span>
          {needsInput ? (
            <span className="taskboard-card__attention" title="关联对话需要处理">
              <TriangleAlert
                aria-hidden="true"
                size={APP_ICON_SIZE - 2}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          ) : null}
          {task.priority !== 'none' ? (
            <span className="taskboard-card__priority">
              {TASKBOARD_PRIORITY_LABELS[task.priority]}
            </span>
          ) : null}
        </span>
        <strong>{task.title}</strong>
        {task.description ? <p>{task.description}</p> : null}
        {task.labels.length > 0 ? (
          <span className="taskboard-card__labels">
            {task.labels.slice(0, 2).map(label => (
              <span key={label.id}>{label.name}</span>
            ))}
            {task.labels.length > 2 ? <span>+{task.labels.length - 2}</span> : null}
          </span>
        ) : null}
      </button>
      <footer className="taskboard-card__footer">
        <span className="taskboard-card__execution-summary">
          <span className="taskboard-card__threads">
            <MessageSquare
              aria-hidden="true"
              size={APP_ICON_SIZE - 2}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            {task.threads.length}
            {runningThreads > 0 ? <span className="taskboard-card__running">· {runningThreads} 执行中</span> : null}
            {needsInput ? <span className="taskboard-card__needs-input">· 等待输入</span> : null}
          </span>
          {execution?.branchName ? (
            <span className="taskboard-card__branch" title={execution.branchName}>
              {execution.branchName}
            </span>
          ) : null}
          {execution?.kind === 'worktree' ? (
            <span className="taskboard-card__worktree">
              工作树 · {worktreeStatusLabel(execution.status)}
            </span>
          ) : null}
        </span>
        <span className="taskboard-card__actions">
          {menu}
          <IconButton
            color="ghostSecondary"
            disabled={pending}
            size="toolbar"
            title="开始执行"
            onClick={onStart}
          >
            <Play
              aria-hidden="true"
              size={APP_ICON_SIZE}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
          </IconButton>
        </span>
      </footer>
    </article>
  )
}

function worktreeStatusLabel(status: TaskboardWorktreeStatus): string {
  switch (status) {
    case 'creating': return '创建中'
    case 'ready': return '就绪'
    case 'ready-with-setup-error': return '初始化警告'
    case 'deleting': return '清理中'
    case 'cleaned': return '已清理'
    case 'restoring': return '恢复中'
    case 'restore-conflict': return '恢复冲突'
    default: return status
  }
}
