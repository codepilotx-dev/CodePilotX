import React from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ManagedWorktree, RpcResult } from '@codepilotx/agent-protocol'
import { Button } from '../../components/ui/Button.js'
import { environmentDomainClient } from '../../services/desktop-client/environment-domain-client.js'
import { SettingsContentArea } from '../settings/SettingsContentArea.js'
import { SettingsSection } from '../settings/SettingsSection.js'

type Props = { onError: (message: string) => void; onNotice?: (message: string) => void }
type Mutation = { operation: RpcResult<'worktree/create'>['operation']; worktree: ManagedWorktree }
type MutationOutcome =
  | { kind: 'mutation'; value: Mutation }
  | { kind: 'mutation-error'; error: unknown }

export function WorktreeSettings({ onError, onNotice }: Props): React.ReactNode {
  const [params] = useSearchParams()
  const projectId = params.get('projectId') ?? ''
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [worktrees, setWorktrees] = React.useState<readonly ManagedWorktree[]>([])
  const [branchName, setBranchName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [operation, setOperation] = React.useState<Mutation['operation'] | null>(null)
  const [output, setOutput] = React.useState('')

  const refresh = React.useCallback(async () => {
    if (!projectId) return
    setWorktrees((await client.listWorktrees(projectId)).worktrees)
  }, [client, projectId])
  React.useEffect(() => { void refresh().catch(cause => onError(message(cause))) }, [onError, refresh])

  const track = async (operationId: string, mutationPromise: Promise<Mutation>) => {
    setOutput('')
    let cursor = 0
    let current: Mutation['operation'] | null = null
    const mutationOutcome: Promise<MutationOutcome> = mutationPromise.then(
      value => ({ kind: 'mutation', value }),
      error => ({ kind: 'mutation-error', error }),
    )
    let mutationPending = true
    while (!current || current.status === 'pending' || current.status === 'running') {
      const statusOutcome = client.worktreeOperationStatus(operationId, cursor).then(
        value => ({ kind: 'status' as const, value }),
        error => ({ kind: 'status-error' as const, error }),
      )
      const outcome = mutationPending ? await Promise.race([mutationOutcome, statusOutcome]) : await statusOutcome
      if (outcome.kind === 'mutation-error') throw outcome.error
      if (outcome.kind === 'mutation') {
        mutationPending = false
        current = outcome.value.operation
        setOperation(current)
        if (current.status !== 'pending' && current.status !== 'running') break
        continue
      }
      if (outcome.kind === 'status') {
        current = outcome.value.operation
        cursor = outcome.value.output.cursor
        setOperation(current)
        if (outcome.value.output.data) setOutput(previous => `${previous}${outcome.value.output.data}`.slice(-65_536))
      } else if (current) throw outcome.error
      const settled = mutationPending
        ? await Promise.race([
            mutationOutcome,
            new Promise<{ kind: 'retry' }>(resolve => setTimeout(() => resolve({ kind: 'retry' }), 100)),
          ])
        : { kind: 'retry' as const }
      if (settled.kind === 'mutation-error') throw settled.error
      if (settled.kind === 'mutation') {
        mutationPending = false
        current = settled.value.operation
        setOperation(current)
        if (current.status !== 'pending' && current.status !== 'running') break
      }
    }
    if (mutationPending) {
      const settled = await mutationOutcome
      if (settled.kind === 'mutation-error') throw settled.error
      current = settled.value.operation
      setOperation(current)
    }
    try {
      const finalStatus = await client.worktreeOperationStatus(operationId, cursor)
      current = finalStatus.operation
      setOperation(current)
      if (finalStatus.output.data) setOutput(previous => `${previous}${finalStatus.output.data}`.slice(-65_536))
    } catch {
      // Mutation result remains authoritative when the volatile output tail is unavailable.
    }
    await refresh()
    if (current.status === 'failed') throw new Error(current.errorCode ?? 'Worktree 操作失败')
    onNotice?.(current.warnings.length
      ? `Worktree 操作已完成；${current.warnings.join('；')}`
      : 'Worktree 操作已完成。')
  }

  const mutate = async (action: (operationId: string) => Promise<Mutation>) => {
    setBusy(true)
    const operationId = crypto.randomUUID()
    try { await track(operationId, action(operationId)) } catch (cause) { onError(message(cause)) } finally { setBusy(false) }
  }

  if (!projectId) return <SettingsContentArea><SettingsSection title="托管 Worktrees" description="请从项目或任务入口打开此页。"><p className="settings-empty-copy">缺少 projectId。</p></SettingsSection></SettingsContentArea>
  return (
    <SettingsContentArea>
      <SettingsSection title="创建 Worktree" description="Working-tree 模式会安全捕获 staged、unstaged 与 untracked 修改。">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:p-3">
          <input aria-label="起始分支" className="confirmation-dialog-input tw:min-w-56" placeholder="已有分支名称" value={branchName} onChange={event => setBranchName(event.target.value)} />
          <Button disabled={busy || !branchName.trim()} onClick={() => void mutate(operationId => client.createWorktree({ projectId, startingState: { type: 'branch', branchName: branchName.trim() }, operationId }))}>从分支创建</Button>
          <Button disabled={busy} onClick={() => void mutate(operationId => client.createWorktree({ projectId, startingState: { type: 'working-tree' }, operationId }))}>从当前 Working Tree 创建</Button>
          <Button disabled={busy} onClick={() => void refresh()}>刷新</Button>
        </div>
      </SettingsSection>
      <SettingsSection title="托管 Worktrees" description="永久、活跃或仍有关联任务的 Worktree 不会被自动清理。">
        <div className="tw:grid tw:gap-2 tw:p-3">
          {worktrees.length ? worktrees.map(worktree => (
            <article className="settings-card tw:grid tw:gap-2 tw:p-3" key={worktree.id}>
              <div className="tw:flex tw:items-center tw:justify-between tw:gap-3">
                <div><strong>{worktree.branchName ?? 'Detached worktree'}</strong><div className="tw:text-xs tw:text-app-text-soft">{worktree.status} · setup {worktree.setupStatus}</div></div>
                <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                  {worktree.status === 'ready-with-setup-error' ? <>
                    <Button disabled={busy} onClick={() => void mutate(operationId => client.retryWorktreeSetup(worktree.id, operationId))}>重试 Setup</Button>
                    <Button disabled={busy} onClick={() => void mutate(operationId => client.continueWorktreeWithoutSetup(worktree.id, operationId))}>跳过并继续</Button>
                  </> : null}
                  <Button disabled={busy} onClick={() => void mutate(operationId => client.setWorktreePermanent(worktree.id, !worktree.permanent, operationId))}>{worktree.permanent ? '取消永久保留' : '永久保留'}</Button>
                  {worktree.status === 'cleaned'
                    ? <Button disabled={busy} onClick={() => void mutate(operationId => client.restoreWorktree(worktree.id, operationId))}>恢复</Button>
                    : worktree.status === 'restore-conflict'
                      ? <span className="tw:text-xs tw:text-app-danger">恢复冲突，已保留工作树和快照，请手动处理</span>
                      : <Button disabled={busy} tone="danger" onClick={() => void mutate(operationId => client.deleteWorktree(worktree.id, operationId))}>删除</Button>}
                </div>
              </div>
            </article>
          )) : <p className="settings-empty-copy">暂无托管 Worktree。</p>}
        </div>
      </SettingsSection>
      {operation ? <SettingsSection title="操作进度" description={`${operation.kind} · ${operation.step} · ${operation.status}`}>
        {operation.warnings.length ? (
          <ul className="tw:grid tw:gap-1 tw:px-3 tw:pt-3 tw:text-xs tw:text-app-text-soft" role="status">
            {operation.warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
        <pre className="tw:max-h-64 tw:overflow-auto tw:whitespace-pre-wrap tw:p-3 tw:text-xs">{output || '等待输出…'}</pre>
      </SettingsSection> : null}
    </SettingsContentArea>
  )
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Worktree 操作失败。' }
