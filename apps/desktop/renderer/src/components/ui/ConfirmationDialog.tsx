import type React from 'react'
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'

type ConfirmationInput = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  maxLength?: number
}

type Props = {
  open: boolean
  title: string
  description?: React.ReactNode
  cancelLabel?: string
  actionLabel: string
  tone?: 'primary' | 'danger'
  input?: ConfirmationInput
  actionDisabled?: boolean
  onCancel: () => void
  onAction: () => void
}

export function ConfirmationDialog({
  open,
  title,
  description,
  cancelLabel = '取消',
  actionLabel,
  tone = 'primary',
  input,
  actionDisabled = false,
  onCancel,
  onAction,
}: Props): React.ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open || !input) return
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open, input])

  const trimmedActionDisabled =
    actionDisabled || (input ? input.value.trim().length === 0 : false)

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (!trimmedActionDisabled) onAction()
    }
  }

  function handleActionClick(
    event: React.MouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    onAction()
  }

  const actionClassName = [
    'confirmation-dialog-action',
    'tw:inline-flex tw:min-w-19 tw:items-center tw:justify-center tw:rounded-md tw:px-4 tw:py-2 tw:text-sm tw:font-[var(--font-weight-label)] tw:transition-[background-color,opacity] tw:duration-[120ms] tw:hover:opacity-90 tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
    tone === 'danger' ? 'danger' : 'primary',
  ].join(' ')

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onCancel()
      }}
    >
      <AlertDialog.Portal>
        {open ? (
          <AlertDialog.Overlay className="permission-modal-backdrop">
            <AlertDialog.Content className="permission-modal confirmation-dialog tw:grid tw:w-[min(27.5rem,100%)] tw:gap-3 tw:rounded-xl tw:p-5">
              <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
                <AlertDialog.Title asChild>
                  <h2 className="tw:min-w-0 tw:flex-1 tw:text-lg tw:leading-6 tw:font-[var(--font-weight-heading)] tw:text-app-text">
                    {title}
                  </h2>
                </AlertDialog.Title>
                <AlertDialog.Cancel asChild>
                  <button
                    aria-label="关闭对话框"
                    className="confirmation-dialog-close tw:inline-flex tw:size-8 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full tw:text-app-text-soft tw:transition-colors tw:duration-[120ms] tw:hover:bg-app-panel tw:hover:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-app-accent"
                    type="button"
                  >
                    <X
                      size={APP_ICON_SIZE + 2}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </button>
                </AlertDialog.Cancel>
              </header>
              {description ? (
                <AlertDialog.Description asChild>
                  <p className="confirmation-dialog-description tw:m-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">
                    {description}
                  </p>
                </AlertDialog.Description>
              ) : null}
              {input ? (
                <input
                  aria-label={title}
                  className="confirmation-dialog-input tw:w-full tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-base tw:text-app-text tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-[160ms] tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                  maxLength={input.maxLength}
                  onChange={event => input.onChange(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={input.placeholder}
                  ref={inputRef}
                  type="text"
                  value={input.value}
                />
              ) : null}
              <div className="permission-modal-actions confirmation-dialog-actions tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
                <AlertDialog.Cancel asChild>
                  <button
                    className="confirmation-cancel tw:inline-flex tw:min-w-19 tw:items-center tw:justify-center tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-4 tw:py-2 tw:text-sm tw:font-[var(--font-weight-label)] tw:text-app-text tw:transition-colors tw:duration-[120ms] tw:hover:bg-app-panel"
                    type="button"
                  >
                    {cancelLabel}
                  </button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <button
                    className={actionClassName}
                    disabled={trimmedActionDisabled}
                    onClick={handleActionClick}
                    type="button"
                  >
                    {actionLabel}
                  </button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Overlay>
        ) : null}
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
