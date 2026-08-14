import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Archive, MessageSquare, Play, RotateCcw, Star, Unlink, X } from 'lucide-react'
import type {
  TaskboardPriority,
  TaskboardLabel,
  TaskboardStatus,
  TaskboardTaskDetails,
} from '@codepilotx/shared/taskboard'
import type { SessionListItem } from '../../../uiTypes.js'
import { sessionDisplayTitle } from '../../../uiTypes.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { MarkdownMessage } from '../../markdown/index.js'
import { TASKBOARD_COLUMNS, TASKBOARD_PRIORITY_LABELS, taskboardStatusLabel } from '../taskboardConstants.js'

type Props = {
  open: boolean
  detail: TaskboardTaskDetails | null
  loading: boolean
  error: string | null
  pending: boolean
  projectName: string
  projectAvailable: boolean
  readOnly: boolean
  sessions: readonly SessionListItem[]
  labels: readonly TaskboardLabel[]
  onClose: () => void
  onStart: (taskId: string) => void
  onArchive: (taskId: string) => Promise<void>
  onRestore: (taskId: string) => Promise<void>
  onUpdate: (taskId: string, patch: {
    title?: string
    description?: string
    status?: TaskboardStatus
    priority?: TaskboardPriority
    labelIds?: readonly string[]
  }) => Promise<void>
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

export function TaskDetailsDrawer({
  open,
  detail,
  loading,
  error,
  pending,
  projectName,
  projectAvailable,
  readOnly,
  sessions,
  labels,
  onClose,
  onStart,
  onArchive,
  onRestore,
  onUpdate,
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
  const [status, setStatus] = useState<TaskboardStatus>('backlog')
  const [priority, setPriority] = useState<TaskboardPriority>('none')
  const [labelIds, setLabelIds] = useState<readonly string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [linkThreadId, setLinkThreadId] = useState('')
  const [newLabelName, setNewLabelName] = useState('')
  const [labelNames, setLabelNames] = useState<Record<string, string>>({})
  const task = detail?.task ?? null
  const taskArchived = task?.archivedAt !== null && task?.archivedAt !== undefined
  const taskMutationReadOnly = readOnly || taskArchived
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const availableSessions = useMemo(() => {
    const linked = new Set(detail?.threads.map(thread => thread.threadId) ?? [])
    return sessions.filter(session =>
      session.projectId === task?.projectId
      && !linked.has(session.id),
    )
  }, [detail?.threads, sessions, task?.projectId])

  useEffect(() => {
    if (!task) return
    setTitle(task.title)
    setDescription(task.description)
    setStatus(task.status)
    setPriority(task.priority)
    setLabelIds(task.labels.map(label => label.id))
    setEditing(false)
    setEditingCommentId(null)
    setDeleteOpen(false)
    setLinkThreadId('')
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
        status,
        priority,
        labelIds: [...labelIds],
      })
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root modal={false} open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby="taskboard-details-description"
          className="taskboard-drawer"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <header className="taskboard-drawer__header">
            <div>
              <span>{task ? `${projectName} · #${task.number}` : '任务详情'}</span>
              <Dialog.Title asChild><h2>{task?.title ?? '加载任务'}</h2></Dialog.Title>
              <Dialog.Description id="taskboard-details-description">
                {task ? `${taskboardStatusLabel(task.status)} · ${TASKBOARD_PRIORITY_LABELS[task.priority]}` : '正在读取任务详情。'}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭任务详情">
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </IconButton>
            </Dialog.Close>
          </header>
          {loading ? <div className="taskboard-drawer__state" role="status">正在加载任务详情…</div> : null}
          {error ? (
            <div className="taskboard-drawer__state" role="alert">
              <strong>无法打开任务</strong><p>{error}</p>
            </div>
          ) : null}
          {task && detail ? (
            <div className="taskboard-drawer__content">
              <div className="taskboard-drawer__actions">
                <Button color="secondary" disabled={pending || taskMutationReadOnly} onClick={() => onStart(task.id)}>
                  <Play aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                  开始执行
                </Button>
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
              {readOnly ? <p className="taskboard-drawer__project-removed" role="status">项目已移除，仅可查看任务内容和历史记录。</p> : null}
              <section className="taskboard-drawer__section">
                <div className="taskboard-drawer__section-heading">
                  <h3>任务字段</h3>
                  <Button color="ghostSecondary" disabled={taskMutationReadOnly} size="compact" onClick={() => setEditing(value => !value)}>{editing ? '取消编辑' : '编辑'}</Button>
                </div>
                {editing ? (
                  <form className="taskboard-edit-form" onSubmit={event => { event.preventDefault(); void saveTask() }}>
                    <label><span>标题</span><input maxLength={200} required value={title} onChange={event => setTitle(event.currentTarget.value)} /></label>
                    <label><span>说明</span><textarea rows={6} value={description} onChange={event => setDescription(event.currentTarget.value)} /></label>
                    <div>
                      <label><span>阶段</span><select value={status} onChange={event => setStatus(event.currentTarget.value as TaskboardStatus)}>{TASKBOARD_COLUMNS.map(column => <option key={column.status} value={column.status}>{column.label}</option>)}</select></label>
                      <label><span>优先级</span><select value={priority} onChange={event => setPriority(event.currentTarget.value as TaskboardPriority)}>{(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).map(value => <option key={value} value={value}>{TASKBOARD_PRIORITY_LABELS[value]}</option>)}</select></label>
                    </div>
                    {labels.length > 0 ? (
                      <fieldset className="taskboard-edit-form__labels">
                        <legend>标签</legend>
                        {labels.map(label => <label key={label.id}><input checked={labelIds.includes(label.id)} type="checkbox" onChange={() => setLabelIds(current => current.includes(label.id) ? current.filter(id => id !== label.id) : [...current, label.id])} />{label.name}</label>)}
                      </fieldset>
                    ) : null}
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
                    <Button color="secondary" disabled={!title.trim()} loading={saving} type="submit">保存更改</Button>
                  </form>
                ) : task.description ? (
                  <div className="taskboard-drawer__description">
                    <MarkdownMessage text={task.description} />
                  </div>
                ) : <p className="taskboard-drawer__empty">暂未添加说明。</p>}
                {task.labels.length > 0 ? <div className="taskboard-drawer__labels">{task.labels.map(label => <span key={label.id}>{label.name}</span>)}</div> : null}
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
                  <select aria-label="选择要关联的对话" disabled={taskMutationReadOnly} value={linkThreadId} onChange={event => setLinkThreadId(event.currentTarget.value)}>
                    <option value="">选择项目中的对话</option>
                    {availableSessions.map(session => <option key={session.id} value={session.id}>{sessionDisplayTitle(session)}</option>)}
                  </select>
                  <Button color="secondary" disabled={taskMutationReadOnly || !linkThreadId} onClick={() => {
                    if (!linkThreadId) return
                    void onLinkThread(task.id, linkThreadId).then(() => setLinkThreadId(''))
                  }}>{detail.threads.length === 0 ? '关联为主要对话' : '关联为辅助对话'}</Button>
                </div>
              </section>
              <section className="taskboard-drawer__section">
                <h3>评论 <span>{detail.comments.filter(item => item.deletedAt === null).length}</span></h3>
                <div className="taskboard-comments">
                  {detail.comments.filter(item => item.deletedAt === null).map(item => (
                    <article key={item.id}>
                      <span>{item.author === 'agent' ? 'Agent' : '你'} · {formatTime(item.createdAt)}</span>
                      {editingCommentId === item.id ? (
                        <form onSubmit={event => {
                          event.preventDefault()
                          if (!editingCommentBody.trim()) return
                          void onUpdateComment(item.id, editingCommentBody.trim()).then(() => setEditingCommentId(null))
                        }}>
                          <textarea aria-label="编辑评论" rows={3} value={editingCommentBody} onChange={event => setEditingCommentBody(event.currentTarget.value)} />
                          <Button color="ghostSecondary" size="compact" type="button" onClick={() => setEditingCommentId(null)}>取消</Button>
                          <Button color="secondary" disabled={!editingCommentBody.trim()} size="compact" type="submit">保存</Button>
                        </form>
                      ) : (
                        <><p>{item.body}</p><footer><Button color="ghostSecondary" disabled={taskMutationReadOnly} size="compact" onClick={() => { setEditingCommentId(item.id); setEditingCommentBody(item.body) }}>编辑</Button><Button color="danger" disabled={taskMutationReadOnly} size="compact" onClick={() => void onDeleteComment(item.id)}>删除</Button></footer></>
                      )}
                    </article>
                  ))}
                  {detail.comments.length === 0 ? <p className="taskboard-drawer__empty">用评论记录决策、检查结果或下一步。</p> : null}
                </div>
                <form className="taskboard-comment-form" onSubmit={event => { event.preventDefault(); void addComment() }}>
                  <textarea aria-label="添加评论" disabled={taskMutationReadOnly} placeholder="记录一个执行备注…" rows={3} value={comment} onChange={event => setComment(event.currentTarget.value)} />
                  <Button color="secondary" disabled={taskMutationReadOnly || !comment.trim()} loading={commenting} type="submit">
                    <MessageSquare aria-hidden="true" size={APP_ICON_SIZE} />添加评论
                  </Button>
                </form>
              </section>
              <section className="taskboard-drawer__section">
                <h3>活动</h3>
                <ol className="taskboard-activity">
                  {detail.activities.map(activity => (
                    <li key={activity.id}><span aria-hidden="true" /><p><strong>{activityLabel(activity.kind)}</strong><small>{formatTime(activity.createdAt)}</small></p></li>
                  ))}
                </ol>
              </section>
              <section className="taskboard-drawer__danger-zone">
                <div>
                  <h3>永久删除</h3>
                  <p>{task.archivedAt === null ? '请先归档任务，再执行永久删除。' : '删除任务、评论和活动记录。关联对话本身会保留。'}</p>
                </div>
                <Button color="danger" disabled={readOnly || task.archivedAt === null} onClick={() => setDeleteOpen(true)}>永久删除任务</Button>
              </section>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

function activityLabel(kind: TaskboardTaskDetails['activities'][number]['kind']): string {
  const labels: Record<typeof kind, string> = {
    task_created: '创建任务', task_updated: '更新任务', task_moved: '移动阶段', task_archived: '归档任务', task_restored: '恢复任务',
    comment_created: '添加评论', comment_updated: '更新评论', comment_deleted: '删除评论', thread_linked: '关联对话', thread_unlinked: '取消关联对话',
    primary_changed: '更换主要对话', label_created: '创建标签', label_updated: '更新标签', label_deleted: '删除标签', execution_started: '开始执行',
  }
  return labels[kind]
}
