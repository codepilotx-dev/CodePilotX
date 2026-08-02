import type React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { GitFork, LoaderCircle, X } from 'lucide-react'

import { Button } from '../../../../components/ui/Button.js'
import { IconButton } from '../../../../components/ui/IconButton.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../../components/ui/useDialogFocusRestore.js'
import type {
  ConversationForkOperation,
  ConversationForkProgress,
} from './conversationForkController.js'
import type { ConversationForkDestination } from './forkClient.js'

type Props = {
  busy: boolean
  canUseNewWorktree: boolean
  open: boolean
  operation: ConversationForkOperation | null
  progress: ConversationForkProgress | null
  sourceRunning: boolean
  onAbandon: () => void
  onContinueWithoutSetup: () => void
  onOpenChange: (open: boolean) => void
  onRetrySetup: () => void
  onSelectDestination: (destination: ConversationForkDestination) => void
}

export function ConversationForkDialog({
  busy,
  canUseNewWorktree,
  open,
  operation,
  progress,
  sourceRunning,
  onAbandon,
  onContinueWithoutSetup,
  onOpenChange,
  onRetrySetup,
  onSelectDestination,
}: Props): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const awaitingSetup = operation?.status === 'awaiting-setup-decision'
  const choosing = operation === null

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {open ? (
          <Dialog.Overlay className="permission-modal-backdrop">
            <Dialog.Content
              className="permission-modal conversation-fork-dialog tw:grid tw:w-[min(38rem,100%)] tw:gap-4 tw:rounded-2xl tw:p-6"
              onCloseAutoFocus={onCloseAutoFocus}
            >
              <header className="tw:flex tw:items-start tw:justify-between tw:gap-4">
                <Dialog.Title asChild>
                  <h2 className="tw:m-0 tw:text-xl tw:leading-7 tw:font-[var(--font-weight-heading)] tw:text-app-text">
                    在新聊天中继续
                  </h2>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <IconButton className="tw:shrink-0" title="关闭对话框">
                    <X
                      aria-hidden="true"
                      size={APP_ICON_SIZE + 2}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </IconButton>
                </Dialog.Close>
              </header>

              <Dialog.Description className="tw:sr-only">
                选择在当前工作树或新的托管工作树中从此消息继续。
              </Dialog.Description>

              {choosing ? (
                <div className="tw:grid tw:gap-2">
                  <DestinationButton
                    disabled={busy}
                    description="从此消息在同一工作树中继续"
                    title="使用此工作树"
                    onClick={() => onSelectDestination({ kind: 'same-worktree' })}
                  />
                  <p className="tw:m-0 tw:px-3 tw:text-xs tw:leading-5 tw:text-app-text-soft">
                    两个聊天共享同一工作目录，后续文件修改互相可见。
                  </p>
                  <DestinationButton
                    disabled={busy || !canUseNewWorktree}
                    description="在新工作树中从此消息继续"
                    title="使用新工作树"
                    onClick={() => onSelectDestination({ kind: 'new-worktree' })}
                  />
                  {!canUseNewWorktree ? (
                    <p className="tw:m-0 tw:px-3 tw:text-xs tw:leading-5 tw:text-app-text-soft">
                      当前任务不在 Git 工作区中，无法创建托管工作树。
                    </p>
                  ) : sourceRunning ? (
                    <p className="tw:m-0 tw:px-3 tw:text-xs tw:leading-5 tw:text-app-text-soft">
                      当前任务正在运行，将从当前 Git HEAD 创建，不复制未提交修改。
                    </p>
                  ) : null}
                </div>
              ) : (
                <ForkProgress progress={progress} />
              )}

              {awaitingSetup ? (
                <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-2">
                  <Button disabled={busy} onClick={onAbandon} tone="danger">
                    放弃并删除
                  </Button>
                  <Button disabled={busy} onClick={onContinueWithoutSetup}>
                    跳过并继续
                  </Button>
                  <Button disabled={busy} onClick={onRetrySetup}>
                    重新尝试
                  </Button>
                </div>
              ) : null}
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DestinationButton({
  description,
  disabled,
  title,
  onClick,
}: {
  description: string
  disabled: boolean
  title: string
  onClick: () => void
}): React.ReactNode {
  return (
    <Button
      className="conversation-fork-dialog__destination tw:h-auto tw:w-full tw:justify-start tw:gap-4 tw:px-4 tw:py-3 tw:text-left"
      disabled={disabled}
      onClick={onClick}
    >
      <GitFork
        aria-hidden="true"
        className="tw:shrink-0"
        size={APP_ICON_SIZE + 2}
        strokeWidth={APP_ICON_STROKE_WIDTH}
      />
      <span className="tw:grid tw:min-w-0 tw:gap-1">
        <strong className="tw:text-sm tw:font-[var(--font-weight-heading)] tw:text-app-text">
          {title}
        </strong>
        <span className="tw:text-xs tw:font-normal tw:text-app-text-soft">
          {description}
        </span>
      </span>
    </Button>
  )
}

function ForkProgress({
  progress,
}: {
  progress: ConversationForkProgress | null
}): React.ReactNode {
  const operation = progress?.operation
  return (
    <div className="tw:grid tw:min-h-28 tw:gap-3" aria-live="polite">
      <div className="tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-app-text">
        {operation?.status === 'running' ? (
          <LoaderCircle
            aria-hidden="true"
            className="canonical-spin"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        ) : (
          <GitFork
            aria-hidden="true"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        )}
        <span>{forkProgressLabel(operation)}</span>
      </div>
      {progress?.output ? (
        <pre className="tw:m-0 tw:max-h-52 tw:overflow-auto tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:p-3 tw:font-mono tw:text-xs tw:leading-5 tw:whitespace-pre-wrap tw:text-app-text">
          {progress.outputTruncated ? '…较早的输出已截断\n' : null}
          {progress.output}
        </pre>
      ) : null}
      {operation?.warnings.length ? (
        <ul className="tw:m-0 tw:grid tw:gap-1 tw:pl-5 tw:text-xs tw:text-app-text-soft">
          {operation.warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
      {operation?.status === 'failed' ? (
        <p className="tw:m-0 tw:text-sm tw:text-app-text-soft" role="alert">
          {operation.errorCode ?? '分叉操作失败。'}
        </p>
      ) : null}
    </div>
  )
}

export function forkProgressLabel(
  operation: ConversationForkOperation | null | undefined,
): string {
  if (!operation) return '正在准备…'
  if (operation.status === 'awaiting-setup-decision') return '工作树设置脚本未成功完成'
  if (operation.status === 'completed') return '新聊天已创建'
  if (operation.status === 'abandoned') return '已放弃创建新聊天'
  if (operation.status === 'failed') return '无法创建新聊天'
  return forkStepLabel[operation.step]
}

const forkStepLabel: Record<ConversationForkOperation['step'], string> = {
  preflight: '正在检查分叉点…',
  'prepare-worktree': '正在准备新工作树…',
  setup: '正在运行工作树设置脚本…',
  'fork-history': '正在复制聊天历史…',
  'bind-target': '正在绑定目标工作区…',
  complete: '正在完成…',
}
