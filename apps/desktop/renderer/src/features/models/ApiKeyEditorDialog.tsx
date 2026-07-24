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
import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'

export type ApiKeyEditorValue = {
  providerId: ModelProviderID
  label: string
  key?: string
}

export type ApiKeyEditorDialogProps = {
  open: boolean
  providers: DesktopModelProviderSummary[]
  initialProviderId: ModelProviderID
  apiKey?: DesktopApiKeySummary | null
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (value: ApiKeyEditorValue) => Promise<boolean>
}

export function ApiKeyEditorDialog({
  open,
  providers,
  initialProviderId,
  apiKey = null,
  busy = false,
  onOpenChange,
  onSubmit,
}: ApiKeyEditorDialogProps): React.ReactNode {
  const titleId = useId()
  const descriptionId = useId()
  const [providerId, setProviderId] = useState<ModelProviderID>(initialProviderId)
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const editing = Boolean(apiKey)

  useEffect(() => {
    if (!open) return
    const fallbackProviderId = providers.some(provider => provider.providerID === initialProviderId)
      ? initialProviderId
      : providers[0]?.providerID
    if (fallbackProviderId) setProviderId(apiKey?.providerId ?? fallbackProviderId)
    setLabel(apiKey?.label ?? '')
    setSecret('')
  }, [apiKey, initialProviderId, open, providers])

  function clearSecret(): void {
    setSecret('')
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) clearSecret()
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const normalizedLabel = label.trim()
    const normalizedSecret = secret.trim()
    if (!normalizedLabel || (!editing && !normalizedSecret)) return
    const saved = await onSubmit({
      providerId: apiKey?.providerId ?? providerId,
      label: normalizedLabel,
      ...(normalizedSecret ? { key: normalizedSecret } : {}),
    })
    if (!saved) return
    clearSecret()
    onOpenChange(false)
  }

  const canSubmit = label.trim().length > 0 && (editing || secret.trim().length > 0)
  const providerName = providers.find(provider => provider.providerID === apiKey?.providerId)?.displayName

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="model-center-key-dialog"
          >
            <form className="model-center-key-dialog-form" onSubmit={event => void handleSubmit(event)}>
              <header className="model-center-key-dialog-header">
                <div className="model-center-key-dialog-heading">
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
                  <Button aria-label="关闭" size="icon" variant="ghost"><X aria-hidden /></Button>
                </Dialog.Close>
              </header>

              <div className="model-center-key-dialog-fields">
                <label className="model-center-field">
                  <span>Provider</span>
                  {editing ? (
                    <div className="model-center-key-dialog-provider">{providerName ?? apiKey?.providerId}</div>
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
                <label className="model-center-field">
                  <span>名称</span>
                  <Input
                    autoFocus
                    maxLength={80}
                    placeholder="例如：个人主账号"
                    value={label}
                    onChange={event => setLabel(event.target.value)}
                  />
                </label>
                <label className="model-center-field">
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

              <footer className="model-center-key-dialog-actions">
                <Dialog.Close asChild><Button variant="secondary">取消</Button></Dialog.Close>
                <Button disabled={!canSubmit} loading={busy} type="submit" variant="primary">
                  {editing ? '保存更改' : '安全保存'}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
