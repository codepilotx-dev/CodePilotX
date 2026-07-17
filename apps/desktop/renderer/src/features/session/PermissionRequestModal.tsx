import type React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type {
  DesktopPermissionDecision,
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
    decisionExtras?: Pick<DesktopPermissionDecision, 'rememberOptionId'>,
  ) => void
  onAcceptExitPlanMode?: (
    request: DesktopPermissionRequest,
    options?: {
      note?: string
      planExecutionModel?: string
      savePlanExecutionModel?: boolean
    },
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
              className="permission-modal tw:grid tw:w-[min(38.75rem,100%)] tw:gap-3 tw:rounded-xl tw:p-5 tw:text-app-text"
              onEscapeKeyDown={event => event.preventDefault()}
              onInteractOutside={event => event.preventDefault()}
            >
              <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
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
                  onAccept={options => {
                    if (onAcceptExitPlanMode) {
                      onAcceptExitPlanMode(request, options)
                    } else {
                      onDecide(request, 'allow')
                    }
                  }}
                  onRevise={() => onDecide(request, 'deny')}
                />
              ) : (
                <>
                  <div className="permission-code-scroll-area tw:overflow-hidden tw:overflow-y-auto">
                    <div className="permission-code-scroll-content tw:overflow-hidden tw:overflow-x-auto">
                      <code>{JSON.stringify(request.input)}</code>
                    </div>
                  </div>
                  <div className="permission-modal-actions tw:flex tw:items-center tw:justify-between tw:gap-3">
                    <button
                      className="primary-button"
                      onClick={() => onDecide(request, 'allow')}
                      type="button"
                    >
                      允许
                    </button>
                    {(request.rememberOptions ?? []).map(option => (
                      <button
                        key={option.id}
                        onClick={() =>
                          onDecide(request, 'allow', false, undefined, {
                            rememberOptionId: option.id,
                          })
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
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
