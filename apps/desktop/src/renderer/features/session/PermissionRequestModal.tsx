import type React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { ExitPlanModeApproval } from './ExitPlanModeApproval.js'

export type PermissionRequestModalProps = {
  request: DesktopPermissionRequest | null
  currentPermissionMode?: DesktopPermissionMode
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
  ) => void
  onAcceptExitPlanMode?: (
    request: DesktopPermissionRequest,
  ) => void
}

export function PermissionRequestModal({
  request,
  currentPermissionMode,
  onDecide,
  onAcceptExitPlanMode,
}: PermissionRequestModalProps): React.ReactNode {
  return (
    <Dialog.Root open={Boolean(request)}>
      <Dialog.Portal>
        {request ? (
          <Dialog.Overlay className="permission-modal-backdrop">
            <Dialog.Content
              className="permission-modal"
              onEscapeKeyDown={event => event.preventDefault()}
              onInteractOutside={event => event.preventDefault()}
            >
              <header>
                <Dialog.Title asChild>
                  <h2>权限请求</h2>
                </Dialog.Title>
                <span>{request.toolName}</span>
              </header>
              <Dialog.Description asChild>
                <p>{request.description}</p>
              </Dialog.Description>
              {request.autoReviewFallbackReason ? (
                <p>
                  自动审查无法完成，已转为人工审批：
                  {request.autoReviewFallbackReason}
                </p>
              ) : null}
              {request.toolName === 'AskUserQuestion' ? (
                <AskUserQuestionApproval
                  request={request}
                  onReject={() => onDecide(request, 'deny')}
                  onSubmit={updatedInput =>
                    onDecide(request, 'allow', false, updatedInput)
                  }
                />
              ) : request.toolName === 'ExitPlanMode' ? (
                <ExitPlanModeApproval
                  request={request}
                  onAccept={() => {
                    if (onAcceptExitPlanMode) {
                      onAcceptExitPlanMode(request)
                    } else {
                      onDecide(request, 'allow')
                    }
                  }}
                  onRevise={() => onDecide(request, 'deny')}
                />
              ) : (
                <>
                  <code>{JSON.stringify(request.input)}</code>
                  <div className="permission-modal-actions">
                    <button
                      className="primary-button"
                      onClick={() => onDecide(request, 'allow')}
                      type="button"
                    >
                      允许
                    </button>
                    <button
                      onClick={() => onDecide(request, 'allow', true)}
                      type="button"
                    >
                      始终允许
                    </button>
                    <button
                      onClick={() => onDecide(request, 'deny')}
                      type="button"
                    >
                      拒绝
                    </button>
                  </div>
                </>
              )}
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
