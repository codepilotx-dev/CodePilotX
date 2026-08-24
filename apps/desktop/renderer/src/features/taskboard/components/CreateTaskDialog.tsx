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
import { DatePicker } from '../../../components/ui/DatePicker.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Input } from '../../../components/ui/Input.js'
import { Select } from '../../../components/ui/Select.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { TASKBOARD_ALL_COLUMNS, TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type CreateTaskDialogInput = {
  projectId: string
  title: string
  description?: string
  status: TaskboardWorkflowStatus
  priority: TaskboardPriority
  startDate?: string | null
  dueDate?: string | null
  threadLinks?: readonly { threadId: string; role: 'primary' | 'supporting' }[]
  parentTaskId?: string
}

type Props = {
  open: boolean
  projects: readonly DesktopWorkspace[]
  initialProjectId?: string
  initialStatus?: TaskboardWorkflowStatus
  initialThread?: TaskboardWorkflowThreadCandidate
  initialTitle?: string
  onClose: () => void
  onCreate: (input: CreateTaskDialogInput) => Promise<void>
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
  const [parentTaskId, setParentTaskId] = useState('')
  const [parentTasks, setParentTasks] = useState<readonly { id: string; number: number; title: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  useEffect(() => {
    if (!open) return
    setProjectId(initialThread
      ? initialThread.projectId
      : initialProjectId || projects[0]?.projectId || '')
    setTitle(initialTitle ?? '')
    setDescription('')
    setStatus(initialStatus)
    setPriority('none')
    setStartDate('')
    setDueDate('')
    setParentTaskId('')
    setError(null)
    setSubmitting(false)
  }, [initialProjectId, initialStatus, initialThread, initialTitle, open, projects])

  useEffect(() => {
    if (!open || !projectId || !desktopClient.listTaskboardWorkflowTasks) {
      setParentTasks([])
      return
    }
    let active = true
    void desktopClient.listTaskboardWorkflowTasks({ projectId, archived: false, limit: 200 }).then(result => {
      if (active) setParentTasks(result.tasks.map(({ id, number, title }) => ({ id, number, title })))
    }).catch(() => {
      if (active) setParentTasks([])
    })
    return () => { active = false }
  }, [open, projectId])

  const submit = async (): Promise<void> => {
    if (!projectId || !title.trim()) return
    const initialThreadLinks = taskboardInitialThreadLinks(initialThread)
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
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(initialThreadLinks
          ? { threadLinks: initialThreadLinks }
          : {}),
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
              <Select
                ariaLabel="项目"
                disabled={Boolean(initialThread)}
                onValueChange={setProjectId}
                options={projects.filter(project => project.projectId).map(project => ({ value: project.projectId!, label: project.name }))}
                placeholder="选择项目"
                searchable
                searchPlaceholder="搜索项目"
                value={projectId}
              />
            </label>
            <label>
              <span>状态</span>
              <Select<TaskboardWorkflowStatus> ariaLabel="状态" onValueChange={setStatus} options={TASKBOARD_ALL_COLUMNS.map(column => ({ value: column.status, label: column.label }))} value={status} />
            </label>
            <label>
              <span>任务层级</span>
              <Select
                ariaLabel="任务层级"
                onValueChange={setParentTaskId}
                options={[
                  { value: '', label: '创建顶级任务' },
                  ...parentTasks.map(parent => ({ value: parent.id, label: `作为 #${parent.number} ${parent.title} 的子任务` })),
                ]}
                searchable
                searchPlaceholder="搜索父任务"
                value={parentTaskId}
              />
            </label>
            <label>
              <span>标题</span>
              <Input aria-label="标题" autoFocus maxLength={200} required value={title} onChange={event => setTitle(event.currentTarget.value)} />
            </label>
            <label>
              <span>描述</span>
              <Textarea aria-label="描述" rows={5} value={description} onChange={event => setDescription(event.currentTarget.value)} />
            </label>
            <label>
              <span>优先级</span>
              <Select<TaskboardPriority>
                ariaLabel="优先级"
                onValueChange={setPriority}
                options={(Object.keys(TASKBOARD_PRIORITY_LABELS) as TaskboardPriority[]).map(value => ({ value, label: TASKBOARD_PRIORITY_LABELS[value] }))}
                value={priority}
              />
            </label>
            <div className="taskboard-dialog__date-row">
              <label><span>开始日期</span><DatePicker ariaLabel="开始日期" max={dueDate || undefined} value={startDate} onValueChange={setStartDate} /></label>
              <label><span>截止日期</span><DatePicker ariaLabel="截止日期" min={startDate || undefined} value={dueDate} onValueChange={setDueDate} /></label>
            </div>
            {initialThread ? (
              <fieldset className="taskboard-dialog__threads">
                <legend>关联会话</legend>
                <div className="taskboard-dialog__thread-summary">
                  <span>
                    <strong>{initialThread.title || '未命名会话'}</strong>
                    <small>更新于 {formatCandidateUpdatedAt(initialThread.updatedAt)}</small>
                  </span>
                  <span className="taskboard-dialog__thread-role">主会话</span>
                </div>
              </fieldset>
            ) : null}
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

export async function createTaskboardTaskFromDialog(input: CreateTaskDialogInput) {
  const { parentTaskId, ...createInput } = input
  if (parentTaskId && (!desktopClient.reparentTaskboardPlanningChild || !desktopClient.readTaskboardWorkflowTask
    || !(await desktopClient.getRuntimeCapabilities()).includes('taskboard.planning.v1'))) {
    throw new Error('当前 Agent 不支持创建子任务。')
  }
  const created = await desktopClient.createTaskboardWorkflowTask!(createInput)
  if (!parentTaskId) return created
  await desktopClient.reparentTaskboardPlanningChild({
    childTaskId: created.task.task.id,
    expectedVersion: created.task.task.version,
    parentTaskId,
  })
  return desktopClient.readTaskboardWorkflowTask({ taskId: created.task.task.id })
}

export function taskboardInitialThreadLinks(
  initialThread: TaskboardWorkflowThreadCandidate | undefined,
): readonly { threadId: string; role: 'primary' }[] | undefined {
  return initialThread
    ? [{ threadId: initialThread.threadId, role: 'primary' }]
    : undefined
}

function formatCandidateUpdatedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(updatedAt)
}
