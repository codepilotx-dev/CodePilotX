import type React from 'react'
import { ChevronDown, ChevronRight, MessageSquare, Play, TriangleAlert } from 'lucide-react'
import type { TaskboardPlanAggregate, TaskboardWorkflowTaskSummary, TaskboardWorktreeStatus } from '@codepilotx/shared/taskboard'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { canStartTask } from '../taskboardConstants.js'

type Props = {
  task: TaskboardWorkflowTaskSummary
  projectName: string
  pending: boolean
  menu?: React.ReactNode
  dataDragging?: boolean
  dataDragDisplaced?: boolean
  sessionDropActive?: boolean
  onOpen: () => void
  onStart: () => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  hierarchy?: {
    depth: number
    aggregate: TaskboardPlanAggregate
    expandable: boolean
    expanded: boolean
    onToggle: () => void
  }
}

export function TaskCard({
  task,
  projectName,
  pending,
  menu,
  dataDragging,
  dataDragDisplaced,
  sessionDropActive,
  onOpen,
  onStart,
  onDragStart,
  hierarchy,
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

  const formattedId = task.id.startsWith('visual-')
    ? `ID: ${task.id.toUpperCase()}`
    : task.number
      ? `ID: ${projectName ? `${projectName.toUpperCase().replace(/\s+/g, '-')}` : 'LOCAL'}-${task.number}`
      : `ID: ${task.id.toUpperCase().slice(0, 16)}`

  return (
    <article
      aria-busy={pending || undefined}
      className="taskboard-card"
      data-drag-displaced={dataDragDisplaced ? '' : undefined}
      data-dragging={dataDragging ? '' : undefined}
      data-session-drop={sessionDropActive ? '' : undefined}
      data-pending={pending || undefined}
      data-priority={task.priority}
      data-status={task.status}
      data-taskboard-task-id={task.id}
      data-unread={task.attention.unread || undefined}
      data-task-depth={hierarchy?.depth || undefined}
      draggable={!pending}
      onDragStart={onDragStart}
    >
      {sessionDropActive ? (
        <span className="taskboard-card__drop-hint">松开以关联会话</span>
      ) : null}
      {hierarchy?.expandable ? (
        <IconButton
          aria-expanded={hierarchy.expanded}
          className="taskboard-card__tree-toggle"
          color="ghostSecondary"
          size="toolbar"
          title={`${hierarchy.expanded ? '收起' : '展开'} ${task.title} 的子任务`}
          onClick={hierarchy.onToggle}
        >
          {hierarchy.expanded ? <ChevronDown aria-hidden="true" size={APP_ICON_SIZE} /> : <ChevronRight aria-hidden="true" size={APP_ICON_SIZE} />}
        </IconButton>
      ) : null}
      <button
        aria-label={`打开任务：${task.title}`}
        className="taskboard-card__open"
        type="button"
        onClick={onOpen}
      >
        <span className="taskboard-card__heading">
          <span className="taskboard-card__context">
          <span className="taskboard-card__project" title={formattedId}>
            {formattedId}
          </span>
          {task.status === 'blocked' ? (
            <span className="taskboard-card__blocked" aria-label="任务状态：遇到阻碍">
              <TriangleAlert aria-hidden="true" size={12} strokeWidth={APP_ICON_STROKE_WIDTH} />
              <span>阻碍</span>
            </span>
          ) : null}
          {needsInput ? (
            <span className="taskboard-card__attention" title="关联对话需要处理">
              <TriangleAlert
                aria-hidden="true"
                size={12}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </span>
          ) : null}
          {task.attention.unread ? <span className="taskboard-unread-dot" aria-label="待整理任务" /> : null}
          <span className="taskboard-card__status-dot" data-status={task.status} aria-hidden="true" />
          </span>
          <strong className="taskboard-card__title" title={task.title}>{task.title}</strong>
        </span>
        <span className="taskboard-card__body">
          {task.description ? (
            <span className="taskboard-card__description" title={task.description}>
              {task.description}
            </span>
          ) : null}
          <span className="taskboard-card__facts">
          {task.status === 'in_progress' || runningThreads > 0 ? (
          <span className="taskboard-card__processing-row">
            <span className="taskboard-card__processing-badge">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="taskboard-processing-grid">
                <circle cx="3" cy="3" r="1.2" fill="currentColor" />
                <circle cx="6" cy="3" r="1.2" fill="currentColor" />
                <circle cx="9" cy="3" r="1.2" fill="currentColor" />
                <circle cx="3" cy="6" r="1.2" fill="currentColor" />
                <circle cx="6" cy="6" r="1.2" fill="currentColor" />
                <circle cx="9" cy="6" r="1.2" fill="currentColor" />
                <circle cx="3" cy="9" r="1.2" fill="currentColor" />
                <circle cx="6" cy="9" r="1.2" fill="currentColor" />
                <circle cx="9" cy="9" r="1.2" fill="currentColor" />
              </svg>
              <span className="taskboard-card__processing-text">正在处理...</span>
            </span>
            <span className="taskboard-card__processing-bars" aria-hidden="true">
              <span /><span /><span /><span />
            </span>
          </span>
        ) : null}
        {hierarchy && (
          hierarchy.aggregate.directTotal > 0
          || hierarchy.aggregate.descendantTaskCount > 0
          || hierarchy.aggregate.openBlockerCount > 0
          || hierarchy.aggregate.readyUnreadCount > 0
        ) ? (
          <span className="taskboard-card__plan-summary">
            {hierarchy.aggregate.directTotal > 0 ? <span>{hierarchy.aggregate.directDone}/{hierarchy.aggregate.directTotal} 步</span> : null}
            {hierarchy.aggregate.directSkipped > 0 ? <span>{hierarchy.aggregate.directSkipped} 跳过</span> : null}
            {hierarchy.aggregate.descendantTaskCount > 0 ? <span>{hierarchy.aggregate.descendantTaskCount} 子任务</span> : null}
            {hierarchy.aggregate.openBlockerCount > 0 ? <span>{hierarchy.aggregate.openBlockerCount} 阻碍</span> : null}
            {hierarchy.aggregate.readyUnreadCount > 0 ? <span>{hierarchy.aggregate.readyUnreadCount} 已解锁</span> : null}
          </span>
        ) : null}
          </span>
        </span>
      </button>
      <footer className="taskboard-card__footer">
        <span className="taskboard-card__execution-summary">
          <span className="taskboard-card__threads">
            <MessageSquare aria-hidden="true" size={APP_ICON_SIZE - 2} strokeWidth={APP_ICON_STROKE_WIDTH} />
            {task.threads.length}
            {runningThreads > 0 ? <span className="taskboard-card__running">· {runningThreads} 执行中</span> : null}
            {needsInput ? <span className="taskboard-card__needs-input">· 等待输入</span> : null}
          </span>
          {execution?.branchName ? (
            <span className="taskboard-card__branch" title={execution.branchName}>{execution.branchName}</span>
          ) : null}
          {execution?.kind === 'worktree' ? (
            <span className="taskboard-card__worktree">工作树 · {worktreeStatusLabel(execution.status)}</span>
          ) : null}
        </span>
        <span className="taskboard-card__actions">
          {menu}
          {canStartTask(task) ? (
            <IconButton color="ghostSecondary" disabled={pending} size="toolbar" title="开始执行" onClick={onStart}>
              <Play aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </IconButton>
          ) : null}
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
