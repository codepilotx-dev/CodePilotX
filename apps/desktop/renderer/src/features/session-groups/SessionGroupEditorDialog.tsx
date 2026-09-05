import { useRef } from 'react'
import { X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../components/ui/useDialogFocusRestore.js'

type SessionGroupEditorDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  name: string
  description: string
  saving: boolean
  error?: string | null
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onCancel: () => void
  onSubmit: () => void
}

export function SessionGroupEditorDialog({
  open,
  mode,
  name,
  description,
  saving,
  error,
  onNameChange,
  onDescriptionChange,
  onCancel,
  onSubmit,
}: SessionGroupEditorDialogProps): React.ReactNode {
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const submitDisabled = saving || name.trim().length === 0
  const creating = mode === 'create'

  return (
    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen && !saving) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered permission-modal confirmation-dialog tw:grid tw:w-[min(30rem,100%)] tw:gap-3 tw:rounded-3xl tw:p-5"
          onCloseAutoFocus={onCloseAutoFocus}
          onOpenAutoFocus={event => {
            event.preventDefault()
            nameInputRef.current?.focus()
            nameInputRef.current?.select()
          }}
        >
          <form
            className="tw:grid tw:gap-4"
            onSubmit={event => {
              event.preventDefault()
              if (!submitDisabled) onSubmit()
            }}
          >
            <header className="confirmation-dialog-header tw:flex tw:items-start tw:justify-between tw:gap-3">
              <div className="tw:min-w-0 tw:flex-1">
                <Dialog.Title className="u-type-title-sm tw:text-app-text">
                  {creating ? '新建会话组' : '编辑会话组'}
                </Dialog.Title>
                <Dialog.Description className="u-type-body-sm tw:mt-1 tw:text-app-text-soft">
                  {creating ? '为相关会话建立一个共享上下文。' : '修改会话组的名称和说明。'}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild disabled={saving}>
                <IconButton color="ghostSecondary" size="toolbar" title="关闭对话框">
                  <X aria-hidden="true" size={APP_ICON_SIZE + 2} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </IconButton>
              </Dialog.Close>
            </header>

            <label className="u-type-control tw:grid tw:gap-1.5 tw:text-app-text">
              名称
              <input
                className="u-type-control tw:w-full tw:rounded-xs tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                maxLength={120}
                onChange={event => onNameChange(event.currentTarget.value)}
                placeholder="例如：登录流程修复"
                ref={nameInputRef}
                value={name}
              />
            </label>
            <label className="u-type-control tw:grid tw:gap-1.5 tw:text-app-text">
              说明
              <textarea
                className="u-type-control tw:min-h-24 tw:w-full tw:resize-y tw:rounded-xs tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent tw:focus:ring-2 tw:focus:ring-app-accent"
                maxLength={4000}
                onChange={event => onDescriptionChange(event.currentTarget.value)}
                placeholder="说明这个会话组要共同解决的问题（可选）"
                value={description}
              />
            </label>

            {error ? (
              <p className="u-type-body-sm tw:m-0 tw:text-app-danger" role="alert">
                {error}
              </p>
            ) : null}

            <div className="permission-modal-actions confirmation-dialog-actions tw:mt-1 tw:flex tw:items-center tw:justify-between tw:gap-3">
              <Dialog.Close asChild disabled={saving}>
                <Button className="tw:min-w-19" color="secondary">取消</Button>
              </Dialog.Close>
              <Button className="tw:min-w-19" color="primary" disabled={submitDisabled} type="submit">
                {saving ? '保存中…' : creating ? '新建' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
