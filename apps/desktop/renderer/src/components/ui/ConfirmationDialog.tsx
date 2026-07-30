import type React from 'react'
import { useRef } from 'react'
import { X } from 'lucide-react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from './iconTokens.js'
import { Button } from './Button.js'
import { IconButton } from './IconButton.js'
import { useDialogFocusRestore } from './useDialogFocusRestore.js'

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
  actionDisabled = false,
  onCancel,
  onAction,
}: Props): React.ReactNode {
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  function handleActionClick(
    event: React.MouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault()
    onAction()
  }

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
            <AlertDialog.Content
              className="permission-modal confirmation-dialog tw:grid tw:w-[min(27.5rem,100%)] tw:gap-3 tw:rounded-xl tw:p-5"
              onCloseAutoFocus={onCloseAutoFocus}
            >
              <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
                <AlertDialog.Title asChild>
                  <h2 className="tw:min-w-0 tw:flex-1 tw:text-lg tw:leading-6 tw:font-[var(--font-weight-heading)] tw:text-app-text">
                    {title}
                  </h2>
                </AlertDialog.Title>
                <AlertDialog.Cancel asChild>
                  <IconButton
                    className="tw:shrink-0"
                    title="关闭对话框"
                  >
                    <X
                      size={APP_ICON_SIZE + 2}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </IconButton>
                </AlertDialog.Cancel>
              </header>
              <AlertDialog.Description asChild>
                <p className="confirmation-dialog-description tw:m-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">
                  {description ?? '请确认是否继续。'}
                </p>
              </AlertDialog.Description>
              <div className="permission-modal-actions confirmation-dialog-actions tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
                <AlertDialog.Cancel asChild>
                  <Button className="tw:min-w-19">
                    {cancelLabel}
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button
                    className="tw:min-w-19"
                    disabled={actionDisabled}
                    onClick={handleActionClick}
                    tone={tone === 'danger' ? 'danger' : 'default'}
                  >
                    {actionLabel}
                  </Button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Overlay>
        ) : null}
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

type InputDialogProps = Omit<Props, 'description' | 'tone'> & {
  description: React.ReactNode
  input: ConfirmationInput
}

export function InputDialog({
  open,
  title,
  description,
  cancelLabel = '取消',
  actionLabel,
  input,
  actionDisabled = false,
  onCancel,
  onAction,
}: InputDialogProps): React.ReactNode {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const submitDisabled = actionDisabled || input.value.trim().length === 0

  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onCancel()
      }}
    >
      <Dialog.Portal>
        {open ? (
          <Dialog.Overlay className="permission-modal-backdrop">
            <Dialog.Content
              className="permission-modal confirmation-dialog tw:grid tw:w-[min(27.5rem,100%)] tw:gap-3 tw:rounded-xl tw:p-5"
              onCloseAutoFocus={onCloseAutoFocus}
              onOpenAutoFocus={event => {
                event.preventDefault()
                inputRef.current?.focus()
                inputRef.current?.select()
              }}
            >
              <form
                className="tw:contents"
                onSubmit={event => {
                  event.preventDefault()
                  if (!submitDisabled) onAction()
                }}
              >
                <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
                  <Dialog.Title asChild>
                    <h2 className="tw:min-w-0 tw:flex-1 tw:text-lg tw:leading-6 tw:font-[var(--font-weight-heading)] tw:text-app-text">
                      {title}
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
                <Dialog.Description asChild>
                  <p className="confirmation-dialog-description tw:m-0 tw:text-sm tw:leading-5 tw:text-app-text-soft">
                    {description}
                  </p>
                </Dialog.Description>
                <input
                  aria-label={title}
                  className="confirmation-dialog-input tw:w-full tw:rounded-md tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-base tw:text-app-text tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-[160ms] tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                  maxLength={input.maxLength}
                  onChange={event => input.onChange(event.currentTarget.value)}
                  placeholder={input.placeholder}
                  ref={inputRef}
                  type="text"
                  value={input.value}
                />
                <div className="permission-modal-actions confirmation-dialog-actions tw:mt-2 tw:flex tw:items-center tw:justify-between tw:gap-3">
                  <Dialog.Close asChild>
                    <Button className="tw:min-w-19">{cancelLabel}</Button>
                  </Dialog.Close>
                  <Button
                    className="tw:min-w-19"
                    disabled={submitDisabled}
                    type="submit"
                  >
                    {actionLabel}
                  </Button>
                </div>
              </form>
            </Dialog.Content>
          </Dialog.Overlay>
        ) : null}
      </Dialog.Portal>
    </Dialog.Root>
  )
}
