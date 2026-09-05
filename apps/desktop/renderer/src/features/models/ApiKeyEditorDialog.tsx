import * as Dialog from '@radix-ui/react-dialog'
import { KeyRound, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useState } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { useDialogFocusRestore } from '../../components/ui/useDialogFocusRestore.js'
import { useLastNonNull } from '../../hooks/usePresenceRetention.js'

export type ApiKeyEditorValue = {
  providerId: ModelProviderID
  label: string
  key?: string
}

export type ApiKeyEditorFormProps = {
  apiKey?: DesktopApiKeySummary | null
  busy?: boolean
  className?: string
  /** 固定 Provider 场景隐藏 Provider 下拉（首次配置内联使用）。 */
  hideProvider?: boolean
  initialProviderId: ModelProviderID
  providers: DesktopModelProviderSummary[]
  submitLabel?: string
  /** 每次变更时重置名称与密钥输入（例如 Dialog 重新打开）。 */
  resetSignal?: unknown
  /** 未编辑时名称输入框的默认值。 */
  defaultLabel?: string
  autoFocusLabel?: boolean
  onCancel?: () => void
  onSubmit: (value: ApiKeyEditorValue) => Promise<boolean>
}

export function ApiKeyEditorForm({
  apiKey: currentApiKey = null,
  busy = false,
  className,
  hideProvider = false,
  initialProviderId,
  providers,
  submitLabel,
  resetSignal,
  defaultLabel = '',
  autoFocusLabel = false,
  onCancel,
  onSubmit,
}: ApiKeyEditorFormProps): React.ReactNode {
  const [providerId, setProviderId] = useState<ModelProviderID>(initialProviderId)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const editing = Boolean(currentApiKey)

  useEffect(() => {
    const fallbackProviderId = providers.some(
      provider => provider.providerID === initialProviderId,
    )
      ? initialProviderId
      : providers[0]?.providerID
    if (fallbackProviderId) {
      setProviderId(currentApiKey?.providerId ?? fallbackProviderId)
    }
    setLabel(currentApiKey?.label ?? defaultLabel)
    setSecret('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentApiKey, defaultLabel, initialProviderId, providers, resetSignal])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedLabel = label.trim()
    const normalizedSecret = secret.trim()
    if (!normalizedLabel || (!editing && !normalizedSecret)) return
    const saved = await onSubmit({
      providerId: currentApiKey?.providerId ?? providerId,
      label: normalizedLabel,
      ...(normalizedSecret ? { key: normalizedSecret } : {}),
    })
    if (!saved) return
    setSecret('')
  }

  const canSubmit = label.trim().length > 0 && (editing || secret.trim().length > 0)
  const providerName = providers.find(
    provider => provider.providerID === currentApiKey?.providerId,
  )?.displayName

  return (
    <form
      className={['model-center-key-dialog-form', className].filter(Boolean).join(' ')}
      onSubmit={event => void handleSubmit(event)}
    >
      <div className="settings-management-dialog-card model-center-key-dialog-fields">
        {!hideProvider ? (
          <label className="settings-management-dialog-row model-center-field">
            <span>Provider</span>
            {editing ? (
              <div className="model-center-key-dialog-provider">{providerName ?? currentApiKey?.providerId}</div>
            ) : (
              <SettingsDropdown
                ariaLabel="Provider"
                searchable
                searchPlaceholder="搜索 Provider"
                width="var(--radix-select-trigger-width)"
                value={providerId}
                options={providers.map(provider => ({
                  value: provider.providerID,
                  label: provider.displayName,
                  detail: provider.providerID,
                }))}
                onChange={value => setProviderId(value as ModelProviderID)}
              />
            )}
          </label>
        ) : null}
        <label className="settings-management-dialog-row model-center-field">
          <span>名称</span>
          <Input
            autoFocus={autoFocusLabel}
            maxLength={80}
            placeholder="例如：个人主账号"
            value={label}
            onChange={event => setLabel(event.target.value)}
          />
        </label>
        <label className="settings-management-dialog-row model-center-field">
          <span>{editing ? '更换 Key（可选）' : 'API Key'}</span>
          <Input
            autoComplete="off"
            placeholder={editing ? '留空则保留现有 Key' : '粘贴 API Key'}
            type="password"
            value={secret}
            onChange={event => setSecret(event.target.value)}
          />
          {editing ? <small>输入新 Key 后，健康状态会重置为“未测试”。</small> : null}
        </label>
      </div>

      <footer className="settings-management-dialog-footer model-center-key-dialog-actions">
        {onCancel ? <Button color="secondary" onClick={onCancel}>取消</Button> : null}
        <Button color="primary" disabled={!canSubmit} loading={busy} type="submit">
          {submitLabel ?? (editing ? '保存更改' : '安全保存')}
        </Button>
      </footer>
    </form>
  )
}

export type ApiKeyEditorDialogProps = {
  open: boolean
  providers: DesktopModelProviderSummary[]
  initialProviderId: ModelProviderID
  apiKey?: DesktopApiKeySummary | null
  busy?: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onSubmit: (value: ApiKeyEditorValue) => Promise<boolean>
}

export function ApiKeyEditorDialog({
  open,
  providers,
  initialProviderId,
  apiKey: currentApiKey = null,
  busy = false,
  restoreFocusElement,
  onOpenChange,
  onSubmit,
}: ApiKeyEditorDialogProps): React.ReactNode {
  const retainedApiKey = useLastNonNull(currentApiKey)
  const apiKey = open ? currentApiKey : retainedApiKey
  const titleId = useId()
  const descriptionId = useId()
  const editing = Boolean(apiKey)
  const { onCloseAutoFocus } = useDialogFocusRestore(
    open,
    restoreFocusElement,
  )

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog model-center-key-dialog"
            data-dialog-size="credential"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header className="settings-management-dialog-header model-center-key-dialog-header">
              <div className="settings-management-dialog-heading model-center-key-dialog-heading">
                <span className="model-center-key-dialog-icon"><KeyRound aria-hidden /></span>
                <div>
                  <Dialog.Title id={titleId}>{editing ? '编辑 API Key' : '新增 API Key'}</Dialog.Title>
                  <Dialog.Description id={descriptionId}>
                    {editing
                      ? '修改名称，或输入新 Key 完成安全更换。旧密钥不会回填。'
                      : '密钥保存后只显示名称和尾号，页面不会再次展示明文。'}
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <IconButton color="ghostSecondary" size="toolbar" title="关闭"><X aria-hidden /></IconButton>
              </Dialog.Close>
            </header>
            <ApiKeyEditorForm
              apiKey={apiKey}
              busy={busy}
              autoFocusLabel
              initialProviderId={initialProviderId}
              providers={providers}
              resetSignal={open}
              submitLabel={editing ? '保存更改' : '安全保存'}
              onCancel={() => onOpenChange(false)}
              onSubmit={onSubmit}
            />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
