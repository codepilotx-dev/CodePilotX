import type React from 'react'
import { useEffect, useState } from 'react'
import { Archive, ArrowLeft, MessageSquare, Play, RotateCcw, Star, Unlink } from 'lucide-react'
import type {
  TaskboardPriority,
  TaskboardLabel,
  TaskboardWorkflowStatus,
  TaskboardWorkflowTaskDetails,
} from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { ConfirmationDialog, InputDialog } from '../../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { MarkdownMessage } from '../../markdown/index.js'
import { canStartTask, TASKBOARD_ALL_COLUMNS, TASKBOARD_PRIORITY_LABELS, taskboardStatusLabel } from '../taskboardConstants.js'
import { useTaskboardThreadCandidates } from '../state/useTaskboardThreadCandidates.js'

type Props = {
  open: boolean
  detail: TaskboardWorkflowTaskDetails | null
  loading: boolean
  error: string | null
  pending: boolean
  projectName: string
  projectAvailable: boolean
  readOnly: boolean
  labels: readonly TaskboardLabel[]
  onClose: () => void
  onStart: (taskId: string) => void
  onArchive: (taskId: string) => Promise<void>
  onRestore: (taskId: string) => Promise<void>
  onUpdate: (taskId: string, patch: {
    title?: string
    description?: string
    priority?: TaskboardPriority
    labelIds?: readonly string[]
    startDate?: string | null
    dueDate?: string | null
  }) => Promise<void>
  onMove: (taskId: string, status: TaskboardWorkflowStatus) => Promise<void>
  onTransition: (taskId: string, action: 'accept' | 'return_work' | 'report_blocked', note?: string) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onCreateLabel: (projectId: string, name: string) => Promise<void>
  onUpdateLabel: (labelId: string, name: string) => Promise<void>
  onDeleteLabel: (labelId: string) => Promise<void>
  onAddComment: (taskId: string, body: string) => Promise<void>
  onUpdateComment: (commentId: string, body: string) => Promise<void>
  onDeleteComment: (commentId: string) => Promise<void>
  onOpenThread: (threadId: string) => void
  onLinkThread: (taskId: string, threadId: string) => Promise<void>
  onUnlinkThread: (taskId: string, threadId: string) => Promise<void>
  onSetPrimaryThread: (taskId: string, threadId: string) => Promise<void>
}

type TaskboardTaskPropertiesProps = {
  statusField: React.ReactNode
  assigneeSlot?: React.ReactNode
  priorityField: React.ReactNode
}

function TaskboardTaskProperties({
  statusField,
  assigneeSlot,
  priorityField,
}: TaskboardTaskPropertiesProps): React.ReactNode {
  return (
    <div className="taskboard-edit-form__primary-properties" data-has-assignee={assigneeSlot ? 'true' : undefined}>
      {statusField}
      {assigneeSlot ? <div className="taskboard-edit-form__assignee-slot">{assigneeSlot}</div> : null}
      {priorityField}
    </div>
  )
}

export function TaskDetailsDrawer({
  open,
  detail,
  loading,
  error,
  pending,
  projectName,
  projectAvailable,
  readOnly,
  labels,
  onClose,
  onStart,
  onArchive,
  onRestore,
  onUpdate,
  onMove,
  onTransition,
  onDelete,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel,
  onAddComment,
  onUpdateComment,
  onDeleteComment,
  onOpenThread,
  onLinkThread,
  onUnlinkThread,
  onSetPrimaryThread,
}: Props): React.ReactNode {
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskboardWorkflowStatus>('backlog')
  const [priority, setPriority] = useState<TaskboardPriority>('none')
  const [labelIds, setLabelIds] = useState<readonly string[]>([])
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [transitionAction, setTransitionAction] = useState<'accept' | 'return_work' | 'report_blocked' | null>(null)
  const [transitionNote, setTransitionNote] = useState('')
  const [linkThreadId, setLinkThreadId] = useState('')
  const [linkThreadQuery, setLinkThreadQuery] = useState('')
  const [newLabelName, setNewLabelName] = useState('')
  const [labelNames, setLabelNames] = useState<Record<string, string>>({})
  const task = detail?.task ?? null
  const taskArchived = task?.archivedAt !== null && task?.archivedAt !== undefined
  const taskMutationReadOnly = readOnly || taskArchived
  const threadCandidates = useTaskboardThreadCandidates({
    open: open && Boolean(task),
    projectId: task?.projectId ?? '',
    query: linkThreadQuery,
  })

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description)
    setStatus(task.status)
    setPriority(task.priority)
    setLabelIds(task.labels.map(label => label.id))
    setStartDate(task.startDate ?? '')
    setDueDate(task.dueDate ?? '')
    setEditing(false)
    setEditingCommentId(null)
    setDeleteOpen(false)
    setLinkThreadId('')
    setLinkThreadQuery('')
  }, [task?.id, task?.version])

  useEffect(() => {
    setLabelNames(Object.fromEntries(labels.map(label => [label.id, label.name])))
  }, [labels])

  const addComment = async (): Promise<void> => {
    if (!task || taskMutationReadOnly || !comment.trim()) return
    setCommenting(true)
    try {
      await onAddComment(task.id, comment.trim())
      setComment('')
    } finally {
      setCommenting(false)
    }
  }

  const saveTask = async (): Promise<void> => {
    if (!task || taskMutationReadOnly || !title.trim()) return
    setSaving(true)
    try {
      await onUpdate(task.id, {
        title: title.trim(),
        description,
        priority,
        labelIds: [...labelIds],
        startDate: startDate || null,
        dueDate: dueDate || null,
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
      <section
        aria-describedby="taskboard-details-description"
        aria-label={task ? `任务详情：${task.title}` : '任务详情'}
        className="taskboard-drawer"
      >
        <header className="taskboard-drawer__header">
          <IconButton color="ghostSecondary" size="toolbar" title="返回任务看板" onClick={onClose}>
            <ArrowLeft aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </IconButton>
          <div>
            <span>{task ? `${projectName} · #${task.number}` : '任务详情'}</span>
            <h2>{task?.title ?? '加载任务'}</h2>
            <p id="taskboard-details-description">
              {task ? `${taskboardStatusLabel(task.status)} · ${TASKBOARD_PRIORITY_LABELS[task.priority]}` : '正在读取任务详情。'}
            </p>
          </div>
        </header>
        {loading ? <div className="taskboard-drawer__state" role="status">正在加载任务详情…</div> : null}
        {error ? (
          <div className="taskboard-drawer__state" role="alert">
            <strong>无法打开任务</strong><p>{error}</p>
          </div>
        ) : null}
        {task && detail ? (
          <div className="taskboard-drawer__content">
            <main className="taskboard-detail__main">
            {readOnly ? <p className="taskboard-drawer__project-removed" role="status">项目已移除，仅可查看任务内容和历史记录。</p> : null}
            <section className="taskboard-drawer__section">
              <div className="taskboard-drawer__section-heading">
                <h3>任务内容</h3>
                <Button color="ghostSecondary" disabled={taskMutationReadOnly} size="compact" onClick={() => setEditing(value => !value)}>{editing ? '取消编辑' : '编辑'}</Button>
              </div>
              {editing ? (
                <form className="taskboard-edit-form" onSubmit={event => { event.preventDefault(); void saveTask() }}>
                  <label><span>标题</span><input maxLength={200} required value={title} onChange={event => setTitle(event.currentTarget.value)} /></label>
                  <label><span>说明</span><textarea rows={10} value={description} onChange={event => setDescription(event.currentTarget.value)} /></label>
                  {labels.length > 0 ? (
                    <fieldset className="taskboard-edit-form__labels">
                      <legend>标签</legend>
                      {labels.map(label => <label key={label.id}><input checked={labelIds.includes(label.id)} type="checkbox" onChange={() => setLabelIds(current => current.includes(label.id) ? current.filter(id => id !== label.id) : [...current, label.id])} />{label.name}</label>)}
                    </fieldset>
                  ) : null}
                  <Button color="secondary" disabled={!title.trim()} loading={saving} type="submit">保存内容</Button>
                </form>
              ) : (
                <>
                  {task.description ? (
                    <div className="taskboard-drawer__description">
                      <MarkdownMessage text={task.description} />
                    </div>
                  ) : <p className="taskboard-drawer__empty">暂未添加说明。</p>}
                  {task.labels.length > 0 ? <div className="taskboard-drawer__labels">{task.labels.map(label => <span key={label.id}>{label.name}</span>)}</div> : null}
                </>
              )}
            </section>
            <section className="taskboard-drawer__section">
              <h3>关联对话 <span>{detail.threads.length}</span></h3>
              {detail.threads.length === 0 ? <p className="taskboard-drawer__empty">开始执行后，对话会出现在这里。</p> : (
                <ul className="taskboard-drawer__threads">
                  {detail.threads.map(thread => (
                    <li key={thread.threadId}>
                      <button type="button" onClick={() => onOpenThread(thread.threadId)}>
                        <span><strong>{thread.title || '新对话'}</strong><small>{thread.attention === 'running' ? '执行中' : thread.attention === 'needs_input' ? '需要处理' : '空闲'}</small></span>
                      </button>
                      {thread.role !== 'primary' ? <IconButton color="ghostSecondary" disabled={taskMutationReadOnly} size="toolbar" title="设为主要对话" onClick={() => void onSetPrimaryThread(task.id, thread.threadId)}><Star aria-hidden="true" size={APP_ICON_SIZE} /></IconButton> : <span className="taskboard-drawer__primary">主要</span>}
                      <IconButton color="ghostSecondary" disabled={taskMutationReadOnly} size="toolbar" title="取消关联" onClick={() => void onUnlinkThread(task.id, thread.threadId)}><Unlink aria-hidden="true" size={APP_ICON_SIZE} /></IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <div className="taskboard-thread-linker">
                <input aria-label="搜索要关联的对话" placeholder="搜索历史会话" value={linkThreadQuery} onChange={event => setLinkThreadQuery(event.currentTarget.value)} />
                <select aria-label="选择要关联的对话" disabled={taskMutationReadOnly} value={linkThreadId} onChange={event => setLinkThreadId(event.currentTarget.value)}>
                  <option value="">选择项目中的对话</option>
                  {threadCandidates.threads.map(thread => <option key={thread.threadId} value={thread.threadId}>{thread.title || '未命名会话'}</option>)}
                </select>
                <Button color="secondary" disabled={taskMutationReadOnly || !linkThreadId} onClick={() => {
                  if (!linkThreadId) return
                  void onLinkThread(task.id, linkThreadId).then(() => setLinkThreadId(''))
                }}>{detail.threads.length === 0 ? '关联为主要对话' : '关联为辅助对话'}</Button>
                {threadCandidates.hasMore ? <Button color="secondary" loading={threadCandidates.loadingMore} size="compact" onClick={() => void threadCandidates.loadMore()}>加载更多</Button> : null}
                {threadCandidates.error ? <p className="taskboard-dialog__error" role="alert">会话加载失败：{threadCandidates.error}</p> : null}
              </div>
            </section>
            <section className="taskboard-drawer__section">
              <h3>动态与评论 <span>{mergeTaskTimeline(detail).length}</span></h3>
              <div className="taskboard-comments">
                {mergeTaskTimeline(detail).map(item => item.kind === 'activity' ? (
                  <article className="taskboard-comments__activity" key={`activity:${item.value.id}`}>
                    <span>{formatTime(item.value.createdAt)}</span>
                    <p><strong>{activityLabel(item.value.kind)}</strong></p>
                  </article>
                ) : (
                  <article key={`comment:${item.value.id}`}>
                    <span>{item.value.author === 'agent' ? 'Agent' : '你'} · {formatTime(item.value.createdAt)}</span>
                    {editingCommentId === item.value.id ? (
                      <form onSubmit={event => {
                        event.preventDefault()
                        if (!editingCommentBody.trim()) return
                        void onUpdateComment(item.value.id, editingCommentBody.trim()).then(() => setEditingCommentId(null))
                      }}>
                        <textarea aria-label="编辑评论" rows={3} value={editingCommentBody} onChange={event => setEditingCommentBody(event.currentTarget.value)} />
                        <Button color="ghostSecondary" size="compact" type="button" onClick={() => setEditingCommentId(null)}>取消</Button>
                        <Button color="secondary" disabled={!editingCommentBody.trim()} size="compact" type="submit">保存</Button>
                      </form>
                    ) : (
                      <><p>{item.value.body}</p><footer><Button color="ghostSecondary" disabled={taskMutationReadOnly} size="compact" onClick={() => { setEditingCommentId(item.value.id); setEditingCommentBody(item.value.body) }}>编辑</Button><Button color="danger" disabled={taskMutationReadOnly} size="compact" onClick={() => void onDeleteComment(item.value.id)}>删除</Button></footer></>
                    )}
                  </article>
                ))}
                {mergeTaskTimeline(detail).length === 0 ? <p className="taskboard-drawer__empty">用评论记录决策、检查结果或下一步。</p> : null}
              </div>
              <form className="taskboard-comment-form" onSubmit={event => { event.preventDefault(); void addComment() }}>
                <textarea aria-label="添加评论" disabled={taskMutationReadOnly} placeholder="记录一个执行备注…" rows={3} value={comment} onChange={event => setComment(event.currentTarget.value)} />
                <Button color="secondary" disabled={taskMutationReadOnly || !comment.trim()} loading={commenting} type="submit">
                  <MessageSquare aria-hidden="true" size={APP_ICON_SIZE} />添加评论
                </Button>
              </form>
            </section>
            </main>
            <aside className="taskboard-detail__aside" aria-label="任务属性和活动">
            <div className="taskboard-drawer__actions">
              {canStartTask(task) ? (
                <Button color="secondary" disabled={pending || taskMutationReadOnly} onClick={() => onStart(task.id)}>
                  <Play aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  开始执行
                </Button>
              ) : null}
              {task.status === 'in_review' ? (
                <>
                  <Button color="secondary" disabled={pending || taskMutationReadOnly} onClick={() => { setTransitionNote(''); setTransitionAction('accept') }}>通过审核</Button>
                  <Button color="secondary" disabled={pending || taskMutationReadOnly} onClick={() => { setTransitionNote(''); setTransitionAction('return_work') }}>退回修改</Button>
                </>
              ) : null}
              {task.status === 'todo' || task.status === 'in_progress' ? (
                <Button color="secondary" disabled={pending || taskMutationReadOnly} onClick={() => { setTransitionNote(''); setTransitionAction('report_blocked') }}>报告阻碍</Button>
              ) : null}
              {task.archivedAt === null ? (
                <Button color="secondary" disabled={pending || readOnly} onClick={() => void onArchive(task.id)}>
                  <Archive aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />归档
                </Button>
              ) : (
                <Button color="secondary" disabled={pending || readOnly} onClick={() => void onRestore(task.id)}>
                  <RotateCcw aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />恢复
                </Button>
              )}
            </div>
            <section className="taskboard-drawer__section">
              <div className="taskboard-drawer__section-heading">
                <h3>属性</h3>
              </div>
                <form className="taskboard-edit-form taskboard-edit-form--properties" onSubmit={event => { event.preventDefault(); void saveTask() }}>
                  <TaskboardTaskProperties
                    statusField={<label><span>阶段</span><select disabled={taskMutationReadOnly || pending} value={status} onChange={event => {
                      const nextStatus = event.currentTarget.value as TaskboardWorkflowStatus
                      setStatus(nextStatus)
                      void onMove(task.id, nextStatus)
                    }}>{TASKBOARD_ALL_COLUMNS.map(column => <option key={column.status} value={column.status}>{column.label}</option>)}</select></label>}
                    priorityField={<label><span>优先级</span><select value={priority} onChange={event => setPriority(event.currentTarget.value as TaskboardPriority)}>{(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).map(value => <option key={value} value={value}>{TASKBOARD_PRIORITY_LABELS[value]}</option>)}</select></label>}
                  />
                  <div>
                    <label><span>开始日期</span><input type="date" value={startDate} onChange={event => setStartDate(event.currentTarget.value)} /></label>
                    <label><span>截止日期</span><input type="date" value={dueDate} onChange={event => setDueDate(event.currentTarget.value)} /></label>
                  </div>
                  <fieldset className="taskboard-label-manager">
                    <legend>标签管理</legend>
                    {labels.map(label => (
                      <div key={label.id}>
                        <input aria-label={`标签名称：${label.name}`} maxLength={40} value={labelNames[label.id] ?? label.name} onChange={event => setLabelNames(current => ({ ...current, [label.id]: event.currentTarget.value }))} />
                        <Button color="ghostSecondary" disabled={taskMutationReadOnly || !(labelNames[label.id] ?? '').trim() || (labelNames[label.id] ?? '').trim() === label.name} size="compact" onClick={() => void onUpdateLabel(label.id, (labelNames[label.id] ?? '').trim())}>重命名</Button>
                        <Button color="danger" disabled={taskMutationReadOnly} size="compact" onClick={() => void onDeleteLabel(label.id)}>删除</Button>
                      </div>
                    ))}
                    <div>
                      <input aria-label="新标签名称" maxLength={40} placeholder="新标签名称" value={newLabelName} onChange={event => setNewLabelName(event.currentTarget.value)} />
                      <Button color="secondary" disabled={taskMutationReadOnly || !newLabelName.trim()} size="compact" onClick={() => void onCreateLabel(task.projectId, newLabelName.trim()).then(() => setNewLabelName(''))}>新建标签</Button>
                    </div>
                  </fieldset>
                  <Button color="secondary" disabled={taskMutationReadOnly || !title.trim()} loading={saving} type="submit">保存属性</Button>
                </form>
            </section>
            <section className="taskboard-drawer__danger-zone">
              <div>
                <h3>永久删除</h3>
                <p>{task.archivedAt === null ? '请先归档任务，再执行永久删除。' : '删除任务、评论和活动记录。关联对话本身会保留。'}</p>
              </div>
              <Button color="danger" disabled={readOnly || task.archivedAt === null} onClick={() => setDeleteOpen(true)}>永久删除任务</Button>
            </section>
            </aside>
          </div>
        ) : null}
        <ConfirmationDialog
          actionLabel="永久删除"
          description="此操作无法撤销；关联对话不会被删除。"
          open={deleteOpen}
          title="永久删除这个任务？"
          tone="danger"
          onAction={() => {
            if (!task) return
            void onDelete(task.id).then(onClose)
          }}
          onCancel={() => setDeleteOpen(false)}
        />
        <InputDialog
          allowEmpty={transitionAction === 'accept'}
          actionDisabled={transitionAction !== 'accept' && !transitionNote.trim()}
          actionLabel={transitionAction === 'accept' ? '通过审核' : transitionAction === 'return_work' ? '退回修改' : '报告阻碍'}
          description={transitionAction === 'accept' ? '可以选填审核说明。' : transitionAction === 'return_work' ? '填写需要继续修改的反馈。' : '填写阻碍任务继续进行的原因。'}
          input={{
            value: transitionNote,
            onChange: setTransitionNote,
            maxLength: 2_000,
            placeholder: transitionAction === 'accept' ? '审核说明（可选）' : '填写原因或反馈',
          }}
          open={transitionAction !== null}
          title={transitionAction === 'accept' ? '通过任务审核？' : transitionAction === 'return_work' ? '退回任务继续修改？' : '将任务标记为遇到阻碍？'}
          onAction={() => {
            if (!task || !transitionAction) return
            const note = transitionNote.trim()
            void onTransition(task.id, transitionAction, note || undefined).then(() => setTransitionAction(null))
          }}
          onCancel={() => setTransitionAction(null)}
        />
      </section>
  )
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

export function mergeTaskTimeline(detail: TaskboardWorkflowTaskDetails): Array<
  | { kind: 'comment'; value: TaskboardWorkflowTaskDetails['comments'][number] }
  | { kind: 'activity'; value: TaskboardWorkflowTaskDetails['activities'][number] }
> {
  const comments = detail.comments.filter(comment => comment.deletedAt === null)
  const commentActivityKinds = new Set(['comment_created', 'comment_updated', 'comment_deleted'])
  const activities = detail.activities.filter(activity => !(
    commentActivityKinds.has(activity.kind)
    && comments.some(comment => Math.abs(comment.createdAt - activity.createdAt) <= 1_000)
  ))
  return [
    ...comments.map(value => ({ kind: 'comment' as const, value })),
    ...activities.map(value => ({ kind: 'activity' as const, value })),
  ].sort((left, right) => right.value.createdAt - left.value.createdAt)
}

function activityLabel(kind: TaskboardWorkflowTaskDetails['activities'][number]['kind']): string {
  const labels: Record<typeof kind, string> = {
    task_created: '创建任务', task_updated: '更新任务', task_moved: '移动阶段', task_archived: '归档任务', task_restored: '恢复任务',
    comment_created: '添加评论', comment_updated: '更新评论', comment_deleted: '删除评论', thread_linked: '关联对话', thread_unlinked: '取消关联对话',
    primary_changed: '更换主要对话', label_created: '创建标签', label_updated: '更新标签', label_deleted: '删除标签', execution_started: '开始执行',
  }
  return labels[kind]
}
