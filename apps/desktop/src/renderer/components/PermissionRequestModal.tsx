import type React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { DesktopPermissionRequest } from '../../shared/types.js'
import { AskUserQuestionApproval } from './AskUserQuestionApproval.js'

export type PermissionRequestModalProps = {
  request: DesktopPermissionRequest | null
  onDecide: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
  ) => void
}

export function PermissionRequestModal({
  request,
  onDecide,
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
