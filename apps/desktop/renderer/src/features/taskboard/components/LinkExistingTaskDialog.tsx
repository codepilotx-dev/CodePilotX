import type React from 'react'
import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type {
  TaskboardThreadRole,
  TaskboardWorkflowTaskSummary,
  TaskboardWorkflowThreadCandidate,
} from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Select } from '../../../components/ui/Select.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { taskboardStatusLabel } from '../taskboardConstants.js'

type Props = {
  open: boolean
  thread?: TaskboardWorkflowThreadCandidate
  onClose: () => void
  onLinked?: (taskId: string) => void
}

export function LinkExistingTaskDialog({ open, thread, onClose, onLinked }: Props): React.ReactNode {
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<readonly TaskboardWorkflowTaskSummary[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedTaskId('')
    setTasks([])
    setError(null)
    setSubmitting(false)
  }, [open, thread?.threadId])

  useEffect(() => {
    if (!open || !thread?.projectId) return
    let active = true
    const timeout = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      const list = desktopClient.listTaskboardWorkflowTasks
      if (!list) {
        setLoading(false)
        setError('当前 Agent 不支持任务看板。')
        return
      }
      void list({
        projectId: thread.projectId,
        archived: false,
        limit: 200,
        ...(query.trim() ? { query: query.trim() } : {}),
      }).then(result => {
        if (!active) return
        setTasks(result.tasks)
        setSelectedTaskId(current => result.tasks.some(({ id }) => id === current) ? current : '')
      }).catch(cause => {
        if (active) setError(errorMessage(cause))
      }).finally(() => {
        if (active) setLoading(false)
      })
    }, 150)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [open, query, thread?.projectId])

  const selectedTask = useMemo(
    () => tasks.find(({ id }) => id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  )

  const submit = async (): Promise<void> => {
    if (!thread || !selectedTask || submitting) return
    const read = desktopClient.readTaskboardWorkflowTask
    const link = desktopClient.linkTaskboardWorkflowThreads
    if (!read || !link) {
      setError('当前 Agent 不支持关联任务。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const detail = await read({ taskId: selectedTask.id })
      await link({
        taskId: selectedTask.id,
        expectedVersion: detail.task.task.version,
        links: taskboardLinksWithCurrentThread(detail.task, thread.threadId),
      })
      onLinked?.(selectedTask.id)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && !submitting && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="taskboard-link-existing-description"
          className="ui-dialog-surface ui-dialog-surface--centered taskboard-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="taskboard-dialog__header">
            <div>
              <Dialog.Title asChild><h2>关联已有任务</h2></Dialog.Title>
              <Dialog.Description id="taskboard-link-existing-description">
                从当前项目选择任务。正在运行或等待计划确认的会话也可以安全关联。
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" disabled={submitting} size="toolbar" title="关闭关联任务">
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </IconButton>
            </Dialog.Close>
          </header>
          <form className="taskboard-dialog__form" onSubmit={event => { event.preventDefault(); void submit() }}>
            <label>
              <span>任务</span>
              <Select
                ariaLabel="任务"
                emptyText="没有匹配的任务"
                loading={loading}
                onSearchChange={setQuery}
                onValueChange={setSelectedTaskId}
                options={tasks.map(task => ({
                  value: task.id,
                  label: `#${task.number} · ${task.title}`,
                  detail: `${taskboardStatusLabel(task.status)} · ${task.threads.length} 个会话`,
                }))}
                placeholder="选择任务"
                searchable
                searchPlaceholder="按标题或描述搜索"
                searchValue={query}
                value={selectedTaskId}
              />
            </label>
            {loading ? <p className="taskboard-drawer__empty" role="status">正在查找任务…</p> : null}
            {!loading && tasks.length === 0 && !error ? <p className="taskboard-drawer__empty">没有匹配的任务。</p> : null}
            {error ? <p className="taskboard-dialog__error" role="alert">{error}</p> : null}
            <footer className="taskboard-dialog__actions">
              <Dialog.Close asChild><Button color="secondary" disabled={submitting}>取消</Button></Dialog.Close>
              <Button color="secondary" disabled={!selectedTask} loading={submitting} type="submit">关联会话</Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function taskboardLinksWithCurrentThread(
  detail: { threads: readonly { threadId: string; role: TaskboardThreadRole }[] },
  threadId: string,
): readonly { threadId: string; role: TaskboardThreadRole }[] {
  if (detail.threads.some(link => link.threadId === threadId)) {
    return detail.threads.map(({ threadId: id, role }) => ({ threadId: id, role }))
  }
  const role: TaskboardThreadRole = detail.threads.some(link => link.role === 'primary') ? 'supporting' : 'primary'
  return [
    ...detail.threads.map(({ threadId: id, role: existingRole }) => ({ threadId: id, role: existingRole })),
    { threadId, role },
  ]
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
