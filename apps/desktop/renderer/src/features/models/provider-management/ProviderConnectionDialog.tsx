import { APP_ICON_SIZE } from '../../../components/ui/iconTokens.js'
import * as Dialog from '@radix-ui/react-dialog'
import type { UsageSourceDescriptor } from '@codepilotx/agent-protocol'
import {
  ChevronLeft,
  KeyRound,
  Link2,
  ShieldCheck,
  X,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import type {
  DesktopModelProviderSummary,
} from '../../../../shared/types.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import {
  providerManagementStore,
} from '../../provider-management/index.js'
import {
  ApiKeyEditorDialog,
  type ApiKeyEditorValue,
} from '../ApiKeyEditorDialog.js'
import { BillingCredentialConnection } from './BillingCredentialConnection.js'
import { OAuthConnection } from './OAuthConnection.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { useLastNonNull } from '../../../hooks/usePresenceRetention.js'
import { useLocale } from '../../i18n/LocaleProvider.js'

export type ConnectionChoice =
  | { id: 'inference-key'; kind: 'inference-key' }
  | { id: 'inference-oauth'; kind: 'inference-oauth' }
  | { id: string; kind: 'billing' | 'usage-oauth'; source: UsageSourceDescriptor }

export type ProviderConnectionDialogProps = {
  busy: boolean
  open: boolean
  provider: DesktopModelProviderSummary | null
  sources: readonly UsageSourceDescriptor[]
  onKeySubmit: (value: ApiKeyEditorValue) => Promise<boolean>
  onOpenChange: (open: boolean) => void
  onConnected: () => void | Promise<void>
}

export function ProviderConnectionDialog({
  busy,
  open,
  provider: currentProvider,
  sources,
  onKeySubmit,
  onOpenChange,
  onConnected,
}: ProviderConnectionDialogProps): React.ReactNode {
  const { t } = useLocale()
  const retainedProvider = useLastNonNull(currentProvider)
  const provider = open ? currentProvider : retainedProvider
  const titleId = useId()
  const descriptionId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const focusRestore = useDialogFocusRestore(open)
  const choices = useMemo(
    () => provider ? getProviderConnectionChoices(provider, sources) : [],
    [provider, sources],
  )
  const selected = choices.find(choice => choice.id === selectedId) ?? null

  useEffect(() => {
    if (!open) setSelectedId(null)
  }, [open])

  if (!provider) return null
  if (selected?.kind === 'inference-key') {
    return (
      <ApiKeyEditorDialog
        busy={busy}
        initialProviderId={provider.providerID}
        open={open}
        providers={[provider]}
        restoreFocusElement={focusRestore.restoreFocusElement}
        onOpenChange={nextOpen => {
          if (!nextOpen) setSelectedId(null)
          onOpenChange(nextOpen)
        }}
        onSubmit={onKeySubmit}
      />
    )
  }

  const selectedSource = selected?.kind === 'billing'
    || selected?.kind === 'usage-oauth'
    ? selected.source
    : null

  async function connected(): Promise<void> {
    await providerManagementStore.refreshConnections()
    await onConnected()
    setSelectedId(null)
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog model-center-key-dialog model-center-connection-dialog"
          data-dialog-size="detail"
          onCloseAutoFocus={focusRestore.onCloseAutoFocus}
        >
          <header className="settings-management-dialog-header model-center-key-dialog-header">
            <div className="settings-management-dialog-heading model-center-key-dialog-heading">
              {selected ? (
                <IconButton
                  color="ghostSecondary"
                  onClick={() => setSelectedId(null)}
                  size="toolbar"
                  title="返回连接方式"
                >
                  <ChevronLeft size={APP_ICON_SIZE} aria-hidden />
                </IconButton>
              ) : (
                <span className="model-center-key-dialog-icon">
                  <Link2 size={APP_ICON_SIZE} aria-hidden />
                </span>
              )}
              <div>
                <Dialog.Title id={titleId}>
                  {selected ? t(choiceLabel(selected, provider)) : `连接 ${provider.displayName}`}
                </Dialog.Title>
                <Dialog.Description id={descriptionId}>
                  {selected?.kind === 'inference-oauth'
                    ? t(provider.providerID === 'openai'
                      ? '在浏览器完成登录，连接你的 ChatGPT 账号。'
                      : '在浏览器完成授权，连接此供应商。')
                    : selected?.kind === 'usage-oauth'
                      ? t(selectedSource?.scope === 'subscription'
                        ? '授权读取订阅额度，不会改变模型推理账号。'
                        : '授权读取账户用量。')
                      : selected
                        ? '完成连接后，此供应商即可直接用于模型推理。'
                        : '选择模型推理、管理账务或订阅额度的连接方式。'}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭">
                <X size={APP_ICON_SIZE} aria-hidden />
              </IconButton>
            </Dialog.Close>
          </header>

          {!selected ? (
            <div className="settings-management-dialog-card model-center-connection-choices">
              {choices.map(choice => (
                <button
                  className="settings-management-dialog-row model-center-connection-choice"
                  key={choice.id}
                  type="button"
                  onClick={() => setSelectedId(choice.id)}
                >
                  <span className="model-center-connection-choice-icon">
                    {choice.kind === 'inference-key'
                      ? <KeyRound aria-hidden size={APP_ICON_SIZE} />
                      : <ShieldCheck aria-hidden size={APP_ICON_SIZE} />}
                  </span>
                  <span className="model-center-connection-choice-text">
                    <strong>{t(choiceLabel(choice, provider))}</strong>
                    <small>{choiceDescription(choice)}</small>
                  </span>
                </button>
              ))}
              {choices.length === 0 ? (
                <p className="model-center-account-section-empty">
                  当前供应商没有可在应用内建立的连接，请查看官方文档。
                </p>
              ) : null}
            </div>
          ) : null}

          {selected?.kind === 'inference-oauth' ? (
            <OAuthConnection
              connected={false}
              description="在浏览器完成授权，连接此供应商。"
              hideHeader
              target={{
                kind: 'provider',
                providerId: provider.providerID,
              } as never}
              title={choiceLabel(selected, provider)}
              onChanged={connected}
            />
          ) : null}

          {selected?.kind === 'usage-oauth' && selectedSource ? (
            <OAuthConnection
              connected={false}
              hideHeader
              description={
                selectedSource.scope === 'subscription'
                  ? '独立订阅授权仅用于读取套餐额度，不会成为模型推理凭据。'
                  : '此授权仅用于读取账户用量。'
              }
              target={{ kind: 'usage', sourceId: selectedSource.sourceId }}
              title={selectedSource.displayName}
              onChanged={connected}
            />
          ) : null}

          {selected?.kind === 'billing'
            && selectedSource?.connectionMethod.kind === 'billing-key' ? (
              <BillingCredentialConnection
                source={{
                  ...selectedSource,
                  connectionMethod: selectedSource.connectionMethod,
                }}
                onChanged={connected}
                onConnect={input =>
                  providerManagementStore.connectUsageCredential(input)
                }
                onDisconnect={sourceId =>
                  providerManagementStore.disconnectUsageCredential({ sourceId })
                }
              />
            ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function getProviderConnectionChoices(
  provider: DesktopModelProviderSummary,
  sources: readonly UsageSourceDescriptor[],
): ConnectionChoice[] {
  const methods = provider.authMethods ?? ['api-key']
  const result: ConnectionChoice[] = []
  if (methods.includes('oauth')) {
    result.push({ id: 'inference-oauth', kind: 'inference-oauth' })
  }
  if (methods.includes('api-key')) {
    result.push({ id: 'inference-key', kind: 'inference-key' })
  }
  for (const source of sources) {
    if (source.connection.kind !== 'none') continue
    if (source.connectionMethod.kind === 'billing-key') {
      result.push({ id: source.sourceId, kind: 'billing', source })
    } else if (source.connectionMethod.kind === 'oauth') {
      result.push({ id: source.sourceId, kind: 'usage-oauth', source })
    }
  }
  return result
}

function choiceLabel(choice: ConnectionChoice, provider: DesktopModelProviderSummary): string {
  if (choice.kind === 'inference-key') return '模型推理 API Key'
  if (choice.kind === 'inference-oauth') {
    return provider.providerID === 'openai' ? '使用 ChatGPT 登录' : '模型推理 OAuth'
  }
  return choice.source.displayName
}

function choiceDescription(choice: ConnectionChoice): string {
  if (choice.kind === 'inference-key') return '保存用于模型请求的 API Key；活动凭据由你手动选择'
  if (choice.kind === 'inference-oauth') return '通过供应商官方 OAuth 授权模型推理'
  if (choice.kind === 'billing') return '独立管理凭据，仅用于余额和组织账务'
  return choice.source.scope === 'subscription'
    ? '连接订阅套餐，读取额度窗口与重置时间'
    : '通过 OAuth 读取账户用量'
}
