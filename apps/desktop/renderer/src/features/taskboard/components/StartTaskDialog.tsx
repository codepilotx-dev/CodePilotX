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
import { Input } from '../../../components/ui/Input.js'
import { RadioGroup, RadioItem } from '../../../components/ui/RadioGroup.js'
import { Select } from '../../../components/ui/Select.js'
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
  const createsPrimary = taskboardStartCreatesPrimary(Boolean(primaryThread), startMode)
  const actionLabel = taskboardStartActionLabel(Boolean(primaryThread), startMode)

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
      setError(next.errorCode ?? '创建主会话失败，请重试。')
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
    if (!createsPrimary || mode === 'local') execution = { kind: 'local' }
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
              <RadioGroup ariaLabel="主会话启动方式" onValueChange={value => setStartMode(value as TaskboardWorkflowStartMode)} value={startMode}>
                <RadioItem label="继续当前主会话" value="continue_primary" />
                {!primaryActive ? (
                  <RadioItem label="新建主会话（原主会话保留为辅助会话）" value="new_primary" />
                ) : null}
              </RadioGroup>
              {primaryActive ? <small>主会话正在运行或等待处理，将直接打开现有会话。</small> : null}
            </fieldset>
          ) : null}
          {createsPrimary ? (
            <RadioGroup ariaLabel="执行位置" className="taskboard-execution-options" onValueChange={value => setMode(value as Mode)} value={mode}>
              <RadioItem detail="直接使用项目的本地工作目录" icon={<HardDrive />} label="当前项目" value="local" variant="card" />
              <RadioItem detail="在已就绪的托管工作树中继续" icon={<Trees />} label="已有工作树" value="existing_worktree" variant="card" />
              <RadioItem detail="隔离创建分支或复制当前改动" icon={<GitBranch />} label="新工作树" value="new_worktree" variant="card" />
            </RadioGroup>
          ) : null}
          {createsPrimary && mode === 'existing_worktree' ? (
            <label className="taskboard-dialog__field">
              <span>托管工作树</span>
              <Select
                ariaLabel="托管工作树"
                emptyText="当前项目没有已就绪的托管工作树"
                onValueChange={setWorktreeId}
                options={readyWorktrees.map(worktree => ({ value: worktree.id, label: worktree.branchName ?? worktree.id }))}
                placeholder="选择已就绪的工作树"
                searchable
                searchPlaceholder="搜索工作树"
                value={worktreeId}
              />
              {readyWorktrees.length === 0 ? <small>当前项目没有已就绪的托管工作树。</small> : null}
            </label>
          ) : null}
          {createsPrimary && mode === 'new_worktree' ? (
            <div className="taskboard-dialog__nested">
              <RadioGroup ariaLabel="新工作树起始状态" onValueChange={value => setStartingState(value as 'working_tree' | 'branch')} value={startingState}>
                <RadioItem label="复制当前工作目录改动" value="working_tree" />
                <RadioItem label="从分支创建" value="branch" />
              </RadioGroup>
              {startingState === 'branch' ? <Input aria-label="起始分支" placeholder="例如 main" value={branchName} onChange={event => setBranchName(event.currentTarget.value)} /> : null}
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
                disabled={!projectAvailable || createsPrimary && mode === 'existing_worktree' && !worktreeId || createsPrimary && mode === 'new_worktree' && startingState === 'branch' && !branchName.trim()}
                loading={submitting}
                onClick={submit}
              >
                {operation?.status === 'rollback_failed' ? '重试' : actionLabel}
              </Button>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function taskboardStartCreatesPrimary(
  hasPrimaryThread: boolean,
  startMode: TaskboardWorkflowStartMode,
): boolean {
  return !hasPrimaryThread || startMode === 'new_primary'
}

export function taskboardStartActionLabel(
  hasPrimaryThread: boolean,
  startMode: TaskboardWorkflowStartMode,
): '继续主会话' | '创建主会话' {
  return hasPrimaryThread && startMode === 'continue_primary'
    ? '继续主会话'
    : '创建主会话'
}
