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
            <AlertDialog.Content className="permission-modal confirmation-dialog">
              <header className="confirmation-dialog-header">
                <AlertDialog.Title asChild>
                  <h2>{title}</h2>
                </AlertDialog.Title>
                <AlertDialog.Cancel asChild>
                  <button
                    aria-label="关闭对话框"
                    className="confirmation-dialog-close"
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
                  <p className="confirmation-dialog-description">{description}</p>
                </AlertDialog.Description>
              ) : null}
              {input ? (
                <input
                  aria-label={title}
                  className="confirmation-dialog-input"
                  maxLength={input.maxLength}
                  onChange={event => input.onChange(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={input.placeholder}
                  ref={inputRef}
                  type="text"
                  value={input.value}
                />
              ) : null}
              <div className="permission-modal-actions confirmation-dialog-actions">
                <AlertDialog.Cancel asChild>
                  <button className="confirmation-cancel" type="button">
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
