import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { GitBranch, HardDrive, Trees, X } from 'lucide-react'
import type {
  ManagedWorktree,
  TaskboardStartExecution,
  TaskboardStartOperation,
} from '@codepilotx/agent-protocol'
import type { TaskboardWorkflowStartMode, TaskboardWorkflowTaskSummary } from '@codepilotx/shared/taskboard'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { environmentDomainClient } from '../../../services/desktop-client/environment-domain-client.js'

type Mode = 'local' | 'existing_worktree' | 'new_worktree'

type Props = {
  open: boolean
  task: TaskboardWorkflowTaskSummary | null
  projectName: string
  projectAvailable: boolean
  onClose: () => void
  onStart: (
    taskId: string,
    execution: TaskboardStartExecution,
    startMode?: TaskboardWorkflowStartMode,
  ) => Promise<TaskboardStartOperation>
  onRetrySetup: (operation: TaskboardStartOperation) => Promise<TaskboardStartOperation>
  onContinueWithoutSetup: (operation: TaskboardStartOperation) => Promise<TaskboardStartOperation>
  onReady: (operation: TaskboardStartOperation) => void
}

export function StartTaskDialog({
  open,
  task,
  projectName,
  projectAvailable,
  onClose,
  onStart,
  onRetrySetup,
  onContinueWithoutSetup,
  onReady,
}: Props): React.ReactNode {
  const [mode, setMode] = useState<Mode>('local')
  const [startMode, setStartMode] = useState<TaskboardWorkflowStartMode>('new_primary')
  const [worktrees, setWorktrees] = useState<readonly ManagedWorktree[]>([])
  const [worktreeId, setWorktreeId] = useState('')
  const [startingState, setStartingState] = useState<'working_tree' | 'branch'>('working_tree')
  const [branchName, setBranchName] = useState('')
  const [operation, setOperation] = useState<TaskboardStartOperation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const openRef = useRef(open)
  openRef.current = open
  const readyWorktrees = useMemo(() => worktrees.filter(worktree =>
    worktree.status === 'ready'
    || worktree.status === 'ready-with-setup-error' && worktree.continuedWithoutSetup,
  ), [worktrees])
  const primaryThread = task?.threads.find(thread => thread.role === 'primary')
  const primaryActive = primaryThread?.attention === 'running' || primaryThread?.attention === 'needs_input'

  useEffect(() => {
    if (!open || !task) return
    setMode('local')
    setStartMode(task.threads.some(thread => thread.role === 'primary') ? 'continue_primary' : 'new_primary')
    setOperation(null)
    setError(null)
    setSubmitting(false)
    setStartingState('working_tree')
    setBranchName('')
    void environmentDomainClient().listWorktrees(task.projectId)
      .then(result => {
        setWorktrees(result.worktrees)
        setWorktreeId(result.worktrees.find(item => item.status === 'ready')?.id ?? '')
      })
      .catch(() => setWorktrees([]))
  }, [open, task])

  const complete = (next: TaskboardStartOperation): void => {
    setOperation(next)
    if (next.status === 'completed' && next.threadId && openRef.current) onReady(next)
    else if (next.status === 'failed' || next.status === 'rollback_failed') {
      setError(next.errorCode ?? '创建对话失败，请重试。')
    }
  }

  const run = async (action: () => Promise<TaskboardStartOperation>): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      complete(await action())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const submit = (): void => {
    if (!task) return
    let execution: TaskboardStartExecution
    if (mode === 'local') execution = { kind: 'local' }
    else if (mode === 'existing_worktree') {
      if (!worktreeId) return
      execution = { kind: 'existing_worktree', worktreeId }
    } else {
      if (startingState === 'branch' && !branchName.trim()) return
      execution = {
        kind: 'new_worktree',
        startingState: startingState === 'branch'
          ? { type: 'branch', branchName: branchName.trim() }
          : { type: 'working_tree' },
      }
    }
    void run(() => onStart(task.id, execution, primaryActive ? 'continue_primary' : startMode))
  }

  return (
    <Dialog.Root open={open} onOpenChange={next => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby="taskboard-start-description"
          className="ui-dialog-surface ui-dialog-surface--centered taskboard-dialog taskboard-start-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="taskboard-dialog__header">
            <div>
              <Dialog.Title asChild><h2>开始执行</h2></Dialog.Title>
              <Dialog.Description id="taskboard-start-description">
                {task?.title ?? '任务'} · {projectName}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭开始执行">
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </IconButton>
            </Dialog.Close>
          </header>
          {primaryThread ? (
            <fieldset className="taskboard-dialog__threads">
              <legend>主会话</legend>
              <label>
                <input checked={startMode === 'continue_primary'} name="task-start-mode" type="radio" onChange={() => setStartMode('continue_primary')} />
                继续当前主会话
              </label>
              {!primaryActive ? (
                <label>
                  <input checked={startMode === 'new_primary'} name="task-start-mode" type="radio" onChange={() => setStartMode('new_primary')} />
                  新建主会话（原主会话保留为辅助会话）
                </label>
              ) : <small>主会话正在运行或等待处理，将直接打开现有会话。</small>}
            </fieldset>
          ) : null}
          <div className="taskboard-execution-options" role="radiogroup" aria-label="执行位置">
            <ExecutionOption checked={mode === 'local'} icon={<HardDrive />} label="当前项目" detail="直接使用项目的本地工作目录" onChange={() => setMode('local')} />
            <ExecutionOption checked={mode === 'existing_worktree'} icon={<Trees />} label="已有工作树" detail="在已就绪的托管工作树中继续" onChange={() => setMode('existing_worktree')} />
            <ExecutionOption checked={mode === 'new_worktree'} icon={<GitBranch />} label="新工作树" detail="隔离创建分支或复制当前改动" onChange={() => setMode('new_worktree')} />
          </div>
          {mode === 'existing_worktree' ? (
            <label className="taskboard-dialog__field">
              <span>托管工作树</span>
              <select value={worktreeId} onChange={event => setWorktreeId(event.currentTarget.value)}>
                <option disabled value="">选择已就绪的工作树</option>
                {readyWorktrees.map(worktree => (
                  <option key={worktree.id} value={worktree.id}>{worktree.branchName ?? worktree.id}</option>
                ))}
              </select>
              {readyWorktrees.length === 0 ? <small>当前项目没有已就绪的托管工作树。</small> : null}
            </label>
          ) : null}
          {mode === 'new_worktree' ? (
            <div className="taskboard-dialog__nested">
              <label><input checked={startingState === 'working_tree'} name="starting-state" type="radio" onChange={() => setStartingState('working_tree')} />复制当前工作目录改动</label>
              <label><input checked={startingState === 'branch'} name="starting-state" type="radio" onChange={() => setStartingState('branch')} />从分支创建</label>
              {startingState === 'branch' ? <input aria-label="起始分支" placeholder="例如 main" value={branchName} onChange={event => setBranchName(event.currentTarget.value)} /> : null}
            </div>
          ) : null}
          {operation?.status === 'awaiting_setup_decision' ? (
            <div className="taskboard-start-dialog__decision" role="status">
              <div>
                <strong>初始化脚本失败</strong>
                <p>工作树已创建，但项目初始化脚本没有成功执行。可以重试初始化，或保留当前工作树继续。</p>
              </div>
              <div className="taskboard-start-dialog__decision-actions">
                <Button color="secondary" loading={submitting} onClick={() => void run(() => onRetrySetup(operation))}>重试初始化</Button>
                <Button color="secondary" loading={submitting} onClick={() => void run(() => onContinueWithoutSetup(operation))}>仍然继续</Button>
              </div>
            </div>
          ) : null}
          {operation?.warnings.length ? (
            <div className="taskboard-start-dialog__warnings" role="status">
              <strong>执行环境需要检查</strong>
              <ul>
                {operation.warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}
          {error ? <p className="taskboard-dialog__error" role="alert">{error}</p> : null}
          {!projectAvailable ? <p className="taskboard-dialog__error" role="alert">此任务所属项目已移除，无法创建执行对话。</p> : null}
          <footer className="taskboard-dialog__actions">
            <Dialog.Close asChild><Button color="secondary">{operation?.status === 'rollback_failed' ? '关闭' : '取消'}</Button></Dialog.Close>
            {operation?.status !== 'awaiting_setup_decision' ? (
              <Button
                color="secondary"
                disabled={!projectAvailable || mode === 'existing_worktree' && !worktreeId || mode === 'new_worktree' && startingState === 'branch' && !branchName.trim()}
                loading={submitting}
                onClick={submit}
              >
                {operation?.status === 'rollback_failed' ? '重试' : '创建对话'}
              </Button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ExecutionOption({
  checked,
  icon,
  label,
  detail,
  onChange,
}: {
  checked: boolean
  icon: React.ReactNode
  label: string
  detail: string
  onChange: () => void
}): React.ReactNode {
  return (
    <label className="taskboard-execution-option" data-checked={checked || undefined}>
      <input checked={checked} name="execution" type="radio" onChange={onChange} />
      <span className="taskboard-execution-option__icon" aria-hidden="true">{icon}</span>
      <span><strong>{label}</strong><small>{detail}</small></span>
    </label>
  )
}
