import type React from 'react'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type {
  TaskboardPriority,
  TaskboardWorkflowStatus,
  TaskboardWorkflowThreadCandidate,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { TASKBOARD_ALL_COLUMNS, TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'
import { useTaskboardThreadCandidates } from '../state/useTaskboardThreadCandidates.js'

type Props = {
  open: boolean
  projects: readonly DesktopWorkspace[]
  initialProjectId?: string
  initialStatus?: TaskboardWorkflowStatus
  initialThread?: TaskboardWorkflowThreadCandidate
  initialTitle?: string
  onClose: () => void
  onCreate: (input: {
    projectId: string
    title: string
    description?: string
    status: TaskboardWorkflowStatus
    priority: TaskboardPriority
    startDate?: string | null
    dueDate?: string | null
    threadLinks?: readonly { threadId: string; role: 'primary' | 'supporting' }[]
  }) => Promise<void>
}

export function CreateTaskDialog({
  open,
  projects,
  initialProjectId,
  initialStatus = 'backlog',
  initialThread,
  initialTitle,
  onClose,
  onCreate,
}: Props): React.ReactNode {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskboardWorkflowStatus>(initialStatus)
  const [priority, setPriority] = useState<TaskboardPriority>('none')
  const [startDate, setStartDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [threadQuery, setThreadQuery] = useState('')
  const [primaryThreadId, setPrimaryThreadId] = useState<string | null>(null)
  const [supportingThreadIds, setSupportingThreadIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const candidates = useTaskboardThreadCandidates({
    open,
    projectId,
    query: threadQuery,
    initialThread,
  })

  useEffect(() => {
    if (!open) return
    setProjectId(initialProjectId ?? projects[0]?.projectId ?? '')
    setTitle(initialTitle ?? '')
    setDescription('')
    setStatus(initialStatus)
    setPriority('none')
    setStartDate('')
    setDueDate('')
    setThreadQuery('')
    setPrimaryThreadId(initialThread?.projectId === (initialProjectId ?? projects[0]?.projectId)
      ? initialThread.threadId
      : null)
    setSupportingThreadIds(new Set())
    setError(null)
    setSubmitting(false)
  }, [initialProjectId, initialStatus, initialThread, initialTitle, open, projects])

  const submit = async (): Promise<void> => {
    if (!projectId || !title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onCreate({
        projectId,
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        status,
        priority,
        startDate: startDate || null,
        dueDate: dueDate || null,
        ...(primaryThreadId ? {
          threadLinks: [
            { threadId: primaryThreadId, role: 'primary' as const },
            ...[...supportingThreadIds].map(threadId => ({ threadId, role: 'supporting' as const })),
          ],
        } : {}),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="taskboard-create-description"
          className="ui-dialog-surface ui-dialog-surface--centered taskboard-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="taskboard-dialog__header">
            <div>
              <Dialog.Title asChild><h2>新建任务</h2></Dialog.Title>
              <Dialog.Description id="taskboard-create-description">
                把要完成的工作放进项目执行跑道。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭新建任务">
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </IconButton>
            </Dialog.Close>
          </header>
          <form className="taskboard-dialog__form" onSubmit={event => {
            event.preventDefault()
            void submit()
          }}>
            <label>
              <span>项目</span>
              <select required aria-label="项目" value={projectId} onChange={event => {
                setProjectId(event.currentTarget.value)
                setPrimaryThreadId(null)
                setSupportingThreadIds(new Set())
              }}>
                <option disabled value="">选择项目</option>
                {projects.filter(project => project.projectId).map(project => (
                  <option key={project.projectId} value={project.projectId}>{project.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>状态</span>
              <select aria-label="状态" value={status} onChange={event => setStatus(event.currentTarget.value as TaskboardWorkflowStatus)}>
                {TASKBOARD_ALL_COLUMNS.map(column => (
                  <option key={column.status} value={column.status}>{column.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>标题</span>
              <input aria-label="标题" autoFocus maxLength={200} required value={title} onChange={event => setTitle(event.currentTarget.value)} />
            </label>
            <label>
              <span>描述</span>
              <textarea aria-label="描述" rows={5} value={description} onChange={event => setDescription(event.currentTarget.value)} />
            </label>
            <label>
              <span>优先级</span>
              <select aria-label="优先级" value={priority} onChange={event => setPriority(event.currentTarget.value as TaskboardPriority)}>
                {(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).map(value => (
                  <option key={value} value={value}>{TASKBOARD_PRIORITY_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <div className="taskboard-dialog__date-row">
              <label><span>开始日期</span><input aria-label="开始日期" type="date" value={startDate} onChange={event => setStartDate(event.currentTarget.value)} /></label>
              <label><span>截止日期</span><input aria-label="截止日期" type="date" value={dueDate} onChange={event => setDueDate(event.currentTarget.value)} /></label>
            </div>
            <fieldset className="taskboard-dialog__threads">
              <legend>关联会话</legend>
              <input
                aria-label="搜索可关联会话"
                placeholder="搜索会话"
                value={threadQuery}
                onChange={event => setThreadQuery(event.currentTarget.value)}
              />
              <div className="taskboard-dialog__thread-list" aria-busy={candidates.loading}>
                {candidates.threads.map(thread => {
                  const primary = primaryThreadId === thread.threadId
                  const supporting = supportingThreadIds.has(thread.threadId)
                  return (
                    <div className="taskboard-dialog__thread-row" key={thread.threadId}>
                      <span><strong>{thread.title || '未命名会话'}</strong><small>{formatCandidateStatus(thread)}</small></span>
                      <label>
                        <input
                          checked={primary}
                          name="task-primary-thread"
                          type="radio"
                          onChange={() => {
                            setPrimaryThreadId(thread.threadId)
                            setSupportingThreadIds(current => {
                              const next = new Set(current)
                              next.delete(thread.threadId)
                              return next
                            })
                          }}
                        />
                        主会话
                      </label>
                      <label>
                        <input
                          checked={supporting}
                          disabled={primary}
                          type="checkbox"
                          onChange={event => setSupportingThreadIds(current => {
                            const next = new Set(current)
                            if (event.currentTarget.checked) next.add(thread.threadId)
                            else next.delete(thread.threadId)
                            return next
                          })}
                        />
                        辅助
                      </label>
                    </div>
                  )
                })}
                {!candidates.loading && candidates.threads.length === 0 ? <p>没有可关联的会话</p> : null}
              </div>
              {candidates.hasMore ? (
                <Button color="secondary" loading={candidates.loadingMore} size="compact" type="button" onClick={() => void candidates.loadMore()}>
                  加载更多会话
                </Button>
              ) : null}
            </fieldset>
            {error ? <p className="taskboard-dialog__error" role="alert">{error}</p> : null}
            <footer className="taskboard-dialog__actions">
              <Dialog.Close asChild><Button color="secondary">取消</Button></Dialog.Close>
              <Button color="secondary" disabled={!projectId || !title.trim()} loading={submitting} type="submit">
                创建任务
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatCandidateStatus(thread: TaskboardWorkflowThreadCandidate): string {
  if (thread.pendingPlanApproval) return '等待计划确认'
  if (thread.latestTurnStatus === 'running' || thread.latestTurnStatus === 'queued') return '进行中'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(thread.updatedAt)
}
