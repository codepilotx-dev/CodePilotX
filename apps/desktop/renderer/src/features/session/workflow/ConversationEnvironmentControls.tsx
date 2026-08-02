import React from 'react'
import { GitFork, Play, RefreshCw } from 'lucide-react'
import type { LocalEnvironmentActionMetadata, ManagedWorktree } from '@codepilotx/agent-protocol'
import { Button } from '../../../components/ui/Button.js'
import { PopoverItem, PopoverSeparator } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import { environmentDomainClient } from '../../../services/desktop-client/environment-domain-client.js'
import { loadDesktopTerminalClient } from '../../../services/desktop-client/index.js'
import { transferConversationUiStateForHandoff } from '../../layout/tabs/conversationUiState.js'
import { listTerminalActions, runTerminalAction } from './actions/terminalActionController.js'
import {
  HANDOFF_PROGRESS_STEPS,
  completedHandoffStepCount,
  resumePendingHandoff,
  runHandoff,
  type HandoffOperation,
} from './handoff/handoffController.js'

type Props = {
  threadId: string
  workspacePath: string
  terminalProfileId: string | null
  onNavigateTarget: (threadId: string) => void
  onOpenEnvironmentSettings: () => void
  onOpenWorktreeSettings: (projectId: string) => void
  onTransferAuxiliaryState: (targetThreadId: string) => void
}

const stepLabel: Record<(typeof HANDOFF_PROGRESS_STEPS)[number], string> = {
  preflight: '预检查',
  'stop-source': '停止源任务',
  'prepare-destination': '准备目标',
  'capture-source': '捕获源修改',
  'release-branch': '释放分支',
  'checkout-destination': '签出目标',
  'apply-source-changes': '应用源修改',
  'fork-conversation': '派生对话',
  'transfer-core-state': '迁移核心状态',
  'await-client-transfer': '迁移界面状态',
  'archive-source': '归档源任务',
  complete: '完成',
}

export function ConversationEnvironmentControls({
  threadId,
  workspacePath,
  terminalProfileId,
  onNavigateTarget,
  onOpenEnvironmentSettings,
  onOpenWorktreeSettings,
  onTransferAuxiliaryState,
}: Props): React.ReactNode {
  const client = React.useMemo(() => environmentDomainClient(), [])
  const [actions, setActions] = React.useState<readonly LocalEnvironmentActionMetadata[]>([])
  const [worktrees, setWorktrees] = React.useState<readonly ManagedWorktree[]>([])
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [handoff, setHandoff] = React.useState<HandoffOperation | null>(null)
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const [handoffOpen, setHandoffOpen] = React.useState(false)
  const resumedThreadRef = React.useRef<string | null>(null)
  const callbacksRef = React.useRef({ onNavigateTarget, onTransferAuxiliaryState })
  callbacksRef.current = { onNavigateTarget, onTransferAuxiliaryState }

  const refresh = React.useCallback(async () => {
    const [nextActions, nextProjectId] = await Promise.all([
      listTerminalActions(client, threadId),
      client.projectForThread(threadId),
    ])
    setActions(nextActions)
    setProjectId(nextProjectId)
    setWorktrees(nextProjectId ? (await client.listWorktrees(nextProjectId)).worktrees : [])
  }, [client, threadId])

  React.useEffect(() => {
    setError(null)
    void refresh().catch(cause => setError(message(cause)))
  }, [refresh])

  React.useEffect(() => {
    if (!threadId || !workspacePath || resumedThreadRef.current === threadId) return
    resumedThreadRef.current = threadId
    let cancelled = false
    setBusy(true)
    void loadDesktopTerminalClient().then(terminal => resumePendingHandoff({
      sourceThreadId: threadId,
      sourceWorkspacePath: workspacePath,
      destination: { kind: 'local' },
      client,
      terminal,
      onProgress: operation => { if (!cancelled) setHandoff(operation) },
      transferUiState: transferInput => transferUiState(
        transferInput,
        callbacksRef.current.onTransferAuxiliaryState,
      ),
    })).then(result => {
      if (!result || cancelled) return
      setHandoffWarnings(result)
      callbacksRef.current.onNavigateTarget(result.targetThreadId)
    }).catch(cause => {
      if (!cancelled) setError(message(cause))
    }).finally(() => {
      if (!cancelled) setBusy(false)
    })
    return () => { cancelled = true }
  }, [client, threadId, workspacePath])

  const executeAction = async (action: LocalEnvironmentActionMetadata) => {
    setBusy(true)
    setError(null)
    try {
      await runTerminalAction({
        terminal: await loadDesktopTerminalClient(),
        threadId,
        action,
        profileId: terminalProfileId,
      })
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  const start = async (destination: { kind: 'local' } | { kind: 'worktree'; worktreeId: string }) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await runHandoff({
        sourceThreadId: threadId,
        sourceWorkspacePath: workspacePath,
        destination,
        client,
        terminal: await loadDesktopTerminalClient(),
        onProgress: setHandoff,
        transferUiState: transferInput => transferUiState(transferInput, onTransferAuxiliaryState),
      })
      setHandoffWarnings(result)
      onNavigateTarget(result.targetThreadId)
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  const createWorktree = async () => {
    if (!projectId) return
    setBusy(true)
    setError(null)
    try {
      await client.createWorktree({
        projectId,
        startingState: { type: 'working-tree' },
        operationId: crypto.randomUUID(),
      })
      await refresh()
    } catch (cause) { setError(message(cause)) } finally { setBusy(false) }
  }

  return (
    <div className="conversation-environment-controls tw:flex tw:items-center tw:gap-2">
      <PopoverMenu
        align="end"
        open={actionsOpen}
        width={260}
        trigger={<Button disabled={busy}><Play size={APP_ICON_SIZE} />Actions</Button>}
        onOpenChange={setActionsOpen}
      >
        {actions.length ? actions.map(action => (
          <PopoverItem
            disabled={busy || action.availability !== 'available'}
            key={action.name}
            onClick={() => void executeAction(action)}
          >
            {action.icon ? `${action.icon} ` : ''}{action.name}
          </PopoverItem>
        )) : <PopoverItem disabled>当前环境没有 Actions</PopoverItem>}
      </PopoverMenu>
      <PopoverMenu
        align="end"
        open={handoffOpen}
        width={310}
        trigger={<Button disabled={busy || !workspacePath}><GitFork size={APP_ICON_SIZE} />Handoff</Button>}
        onOpenChange={setHandoffOpen}
      >
        <PopoverItem disabled={busy} onClick={() => void start({ kind: 'local' })}>
          移交到 Local
        </PopoverItem>
        <PopoverSeparator />
        {worktrees.filter(worktree => worktree.status === 'ready'
          || (worktree.status === 'ready-with-setup-error' && worktree.continuedWithoutSetup)).map(worktree => (
          <PopoverItem
            disabled={busy}
            key={worktree.id}
            onClick={() => void start({ kind: 'worktree', worktreeId: worktree.id })}
          >
            移交到 {worktree.branchName ?? worktree.id.slice(0, 8)}
          </PopoverItem>
        ))}
        <PopoverItem disabled={!projectId || busy} onClick={() => void createWorktree()}>
          新建托管工作树…
        </PopoverItem>
        <PopoverItem onClick={onOpenEnvironmentSettings}>配置 Local environment…</PopoverItem>
        <PopoverItem disabled={!projectId} onClick={() => projectId && onOpenWorktreeSettings(projectId)}>管理 Worktrees…</PopoverItem>
        <PopoverItem disabled={busy} icon={<RefreshCw size={APP_ICON_SIZE} />} onClick={() => void refresh()}>
          刷新
        </PopoverItem>
      </PopoverMenu>
      {handoff && busy ? (
        <span className="tw:max-w-64 tw:text-xs tw:text-app-text-soft" role="status">
          {stepLabel[handoff.step]} · {completedHandoffStepCount(handoff)}/{HANDOFF_PROGRESS_STEPS.length}
        </span>
      ) : null}
      {error ? <span className="tw:max-w-60 tw:text-xs tw:text-app-danger" role="alert">{error}</span> : null}
      {notice ? <span className="tw:max-w-60 tw:text-xs tw:text-app-text-soft" role="status">{notice}</span> : null}
    </div>
  )

  function setHandoffWarnings(result: {
    warning: 'LOCAL_STORAGE_UNAVAILABLE' | null
    warnings: readonly string[]
  }): void {
    const warnings = [
      ...(result.warning ? ['部分本地界面状态未能复制。'] : []),
      ...result.warnings,
    ]
    if (warnings.length) setNotice(`任务已移交；${warnings.join('；')}`)
  }
}

function transferUiState(
  transferInput: Parameters<typeof transferConversationUiStateForHandoff>[0],
  onTransferAuxiliaryState: (targetThreadId: string) => void,
) {
  const result = transferConversationUiStateForHandoff(transferInput)
  try { onTransferAuxiliaryState(transferInput.targetThreadId) } catch {
    return { transferred: result.transferred, warning: 'LOCAL_STORAGE_UNAVAILABLE' as const }
  }
  return result
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。'
}
