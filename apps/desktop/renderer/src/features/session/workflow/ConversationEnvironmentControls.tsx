import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { GitFork, Play, RefreshCw, X } from 'lucide-react'
import type { LocalEnvironmentActionMetadata, ManagedWorktree } from '@codepilotx/agent-protocol'

import { GlobalErrorModal } from '../../../components/GlobalErrorModal.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import {
  commandMenuActionStore,
  registerCommandMenuActions,
  type CommandMenuActionRegistration,
} from '../../search/commandMenuActionStore.js'
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
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [handoff, setHandoff] = React.useState<HandoffOperation | null>(null)
  const [handoffOpen, setHandoffOpen] = React.useState(false)
  const resumedThreadRef = React.useRef<string | null>(null)
  const callbacksRef = React.useRef({ onNavigateTarget, onTransferAuxiliaryState })
  callbacksRef.current = { onNavigateTarget, onTransferAuxiliaryState }
  const { onCloseAutoFocus } = useDialogFocusRestore(handoffOpen)

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
    let cancelled = false
    setLoading(true)
    setError(null)
    void refresh()
      .catch(cause => {
        if (!cancelled) setError(message(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
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
      onProgress: operation => {
        if (cancelled) return
        setHandoff(operation)
        setHandoffOpen(true)
      },
      transferUiState: transferInput => transferUiState(
        transferInput,
        callbacksRef.current.onTransferAuxiliaryState,
      ),
    })).then(result => {
      if (!result || cancelled) return
      setNotice(handoffWarningMessage(result))
      callbacksRef.current.onNavigateTarget(result.targetThreadId)
    }).catch(cause => {
      if (!cancelled) setError(message(cause))
    }).finally(() => {
      if (!cancelled) setBusy(false)
    })
    return () => { cancelled = true }
  }, [client, threadId, workspacePath])

  const executeAction = React.useCallback(async (action: LocalEnvironmentActionMetadata) => {
    setBusy(true)
    setError(null)
    try {
      await runTerminalAction({
        terminal: await loadDesktopTerminalClient(),
        threadId,
        action,
        profileId: terminalProfileId,
      })
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }, [terminalProfileId, threadId])

  const start = React.useCallback(async (
    destination: { kind: 'local' } | { kind: 'worktree'; worktreeId: string },
  ) => {
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
      setNotice(handoffWarningMessage(result))
      onNavigateTarget(result.targetThreadId)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }, [client, onNavigateTarget, onTransferAuxiliaryState, threadId, workspacePath])

  const createWorktree = React.useCallback(async () => {
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
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }, [client, projectId, refresh])

  const commandActions = React.useMemo<CommandMenuActionRegistration[]>(() => {
    const registrations: CommandMenuActionRegistration[] = actions.map((action, index) => ({
      id: `environment.action.${threadId}.${index}.${action.name}`,
      group: 'workspace-actions',
      label: action.name,
      description: '在当前任务的集成终端中运行',
      keywords: ['action', '环境', '终端', action.name],
      icon: action.icon || <Play aria-hidden="true" size={APP_ICON_SIZE} />,
      order: 100 + index,
      availability: busy || action.availability !== 'available' ? 'disabled' : 'available',
      disabledReason: busy
        ? '另一项工作区操作正在进行中'
        : action.availability === 'unsupported-platform'
          ? '当前平台不支持此操作'
          : undefined,
      execute: () => executeAction(action),
    }))

    if (loading && actions.length === 0) {
      registrations.push({
        id: `environment.action.${threadId}.loading`,
        group: 'workspace-actions',
        label: '正在加载工作区操作…',
        keywords: ['action', '环境'],
        order: 90,
        availability: 'loading',
        execute: () => undefined,
      })
    }

    registrations.push({
      id: `environment.handoff.${threadId}`,
      group: 'task-transfer',
      label: '移交当前任务…',
      description: '将任务、工作区修改和界面状态迁移到其他环境',
      keywords: ['handoff', '移交', '迁移', 'local', 'worktree'],
      icon: <GitFork aria-hidden="true" size={APP_ICON_SIZE} />,
      order: 500,
      availability: busy ? 'disabled' : 'available',
      disabledReason: busy ? '另一项工作区操作正在进行中' : undefined,
      execute: () => setHandoffOpen(true),
    })

    return registrations
  }, [actions, busy, executeAction, loading, threadId])

  React.useEffect(() => {
    return registerCommandMenuActions(commandMenuActionStore, commandActions)
  }, [commandActions])

  const readyWorktrees = worktrees.filter(worktree => worktree.status === 'ready'
    || (worktree.status === 'ready-with-setup-error' && worktree.continuedWithoutSetup))

  return (
    <>
      <Dialog.Root open={handoffOpen} onOpenChange={setHandoffOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
          <Dialog.Content
            className="ui-dialog-surface ui-dialog-surface--centered permission-modal tw:grid tw:w-[min(38rem,100%)] tw:gap-4 tw:rounded-2xl tw:p-6"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header className="tw:flex tw:items-start tw:justify-between tw:gap-4">
              <div className="tw:grid tw:gap-1">
                <Dialog.Title asChild>
                  <h2 className="tw:m-0 tw:text-xl tw:font-[var(--font-weight-heading)] tw:text-app-text">
                    移交当前任务
                  </h2>
                </Dialog.Title>
                <Dialog.Description className="tw:m-0 tw:text-sm tw:text-app-text-soft">
                  移交会停止并归档当前任务，再把修改和界面状态迁移到目标环境。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton color="ghostSecondary" disabled={busy} size="toolbar" title="关闭移交对话框">
                  <X
                    aria-hidden="true"
                    size={APP_ICON_SIZE + 2}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                </IconButton>
              </Dialog.Close>
            </header>

            {handoff && busy ? (
              <div className="tw:grid tw:min-h-24 tw:place-content-center tw:gap-2 tw:text-center" role="status">
                <span className="ui-button-spinner tw:mx-auto" aria-hidden="true" />
                <strong className="tw:text-sm tw:text-app-text">{stepLabel[handoff.step]}</strong>
                <span className="tw:text-xs tw:text-app-text-soft">
                  {completedHandoffStepCount(handoff)}/{HANDOFF_PROGRESS_STEPS.length}
                </span>
              </div>
            ) : (
              <div className="tw:grid tw:gap-2">
                <Button color="secondary" disabled={busy} onClick={() => void start({ kind: 'local' })}>
                  移交到 Local
                </Button>
                {readyWorktrees.map(worktree => (
                  <Button
                    color="secondary"
                    disabled={busy}
                    key={worktree.id}
                    onClick={() => void start({ kind: 'worktree', worktreeId: worktree.id })}
                  >
                    移交到 {worktree.branchName ?? worktree.id.slice(0, 8)}
                  </Button>
                ))}
                <Button color="secondary" disabled={!projectId || busy} onClick={() => void createWorktree()}>
                  新建托管工作树…
                </Button>
              </div>
            )}

            <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
              <Button color="ghostSecondary" onClick={() => {
                setHandoffOpen(false)
                onOpenEnvironmentSettings()
              }}>
                配置 Local environment…
              </Button>
              <Button color="ghostSecondary" disabled={!projectId} onClick={() => {
                if (!projectId) return
                setHandoffOpen(false)
                onOpenWorktreeSettings(projectId)
              }}>
                管理 Worktrees…
              </Button>
              <Button color="ghostSecondary" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" size={APP_ICON_SIZE} />
                刷新
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <GlobalErrorModal message={error} onDismiss={() => setError(null)} />
      <GlobalErrorModal message={notice} tone="status" onDismiss={() => setNotice(null)} />
    </>
  )
}

function handoffWarningMessage(result: {
  warning: 'LOCAL_STORAGE_UNAVAILABLE' | null
  warnings: readonly string[]
}): string | null {
  const warnings = [
    ...(result.warning ? ['部分本地界面状态未能复制。'] : []),
    ...result.warnings,
  ]
  return warnings.length ? `任务已移交；${warnings.join('；')}` : null
}

function transferUiState(
  transferInput: Parameters<typeof transferConversationUiStateForHandoff>[0],
  onTransferAuxiliaryState: (targetThreadId: string) => void,
) {
  const result = transferConversationUiStateForHandoff(transferInput)
  try {
    onTransferAuxiliaryState(transferInput.targetThreadId)
  } catch {
    return { transferred: result.transferred, warning: 'LOCAL_STORAGE_UNAVAILABLE' as const }
  }
  return result
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : '操作失败，请重试。'
}
