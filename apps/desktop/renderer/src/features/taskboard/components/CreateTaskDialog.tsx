import type React from 'react'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type {
  TaskboardPriority,
  TaskboardStatus,
} from '@codepilotx/shared/taskboard'
import type { DesktopWorkspace } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { TASKBOARD_COLUMNS, TASKBOARD_PRIORITY_LABELS } from '../taskboardConstants.js'

type Props = {
  open: boolean
  projects: readonly DesktopWorkspace[]
  initialProjectId?: string
  initialStatus?: TaskboardStatus
  onClose: () => void
  onCreate: (input: {
    projectId: string
    title: string
    description?: string
    status: TaskboardStatus
    priority: TaskboardPriority
  }) => Promise<void>
}

export function CreateTaskDialog({
  open,
  projects,
  initialProjectId,
  initialStatus = 'backlog',
  onClose,
  onCreate,
}: Props): React.ReactNode {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskboardStatus>(initialStatus)
  const [priority, setPriority] = useState<TaskboardPriority>('none')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  useEffect(() => {
    if (!open) return
    setProjectId(initialProjectId ?? projects[0]?.projectId ?? '')
    setTitle('')
    setDescription('')
    setStatus(initialStatus)
    setPriority('none')
    setError(null)
    setSubmitting(false)
  }, [initialProjectId, initialStatus, open, projects])

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
              <select required aria-label="项目" value={projectId} onChange={event => setProjectId(event.currentTarget.value)}>
                <option disabled value="">选择项目</option>
                {projects.filter(project => project.projectId).map(project => (
                  <option key={project.projectId} value={project.projectId}>{project.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>状态</span>
              <select aria-label="状态" value={status} onChange={event => setStatus(event.currentTarget.value as TaskboardStatus)}>
                {TASKBOARD_COLUMNS.map(column => (
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
