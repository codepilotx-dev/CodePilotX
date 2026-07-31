import type React from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type {
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRequest,
} from '../../../../shared/types.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'
import { Button } from '../../../components/ui/Button.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'

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
}

export function PermissionRequestModal({
  request,
  currentPermissionMode,
  onDecide,
}: PermissionRequestModalProps): React.ReactNode {
  const open = Boolean(request)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  return (
    <AlertDialog.Root open={open}>
      <AlertDialog.Portal>
        {request ? (
          <AlertDialog.Overlay className="permission-modal-backdrop">
            <AlertDialog.Content
              className="permission-modal tw:grid tw:w-[min(38.75rem,100%)] tw:gap-3 tw:rounded-xl tw:p-5 tw:text-app-text"
              onCloseAutoFocus={onCloseAutoFocus}
              onEscapeKeyDown={event => event.preventDefault()}
            >
              <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
                <AlertDialog.Title asChild>
                  <h2>权限请求</h2>
                </AlertDialog.Title>
                <span>{request.toolName}</span>
              </header>
              <AlertDialog.Description asChild>
                <p>{request.description}</p>
              </AlertDialog.Description>
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
              ) : (
                <>
                  <div className="permission-code-scroll-area tw:overflow-hidden tw:overflow-y-auto">
                    <div className="permission-code-scroll-content tw:overflow-hidden tw:overflow-x-auto">
                      <code>{JSON.stringify(request.input)}</code>
                    </div>
                  </div>
                  <div className="permission-modal-actions tw:flex tw:items-center tw:justify-between tw:gap-3">
                    <AlertDialog.Action asChild>
                      <Button
                        onClick={event => {
                          event.preventDefault()
                          onDecide(request, 'allow')
                        }}
                        type="button"
                      >
                        允许
                      </Button>
                    </AlertDialog.Action>
                    {(request.rememberOptions ?? []).map(option => (
                      <AlertDialog.Action asChild key={option.id}>
                        <Button
                          onClick={event => {
                            event.preventDefault()
                            onDecide(request, 'allow', false, undefined, {
                              rememberOptionId: option.id,
                            })
                          }}
                          type="button"
                        >
                          {option.label}
                        </Button>
                      </AlertDialog.Action>
                    ))}
                    <AlertDialog.Cancel asChild>
                      <Button
                        tone="danger"
                        onClick={() =>
                          onDecide(request, 'deny')
                        }
                        type="button"
                      >
                        拒绝
                      </Button>
                    </AlertDialog.Cancel>
                  </div>
                </>
              )}
            </AlertDialog.Content>
          </AlertDialog.Overlay>
        ) : null}
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
