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
import { Button } from '../../../components/ui/Button.js'
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

export type ConnectionChoice =
  | { id: 'inference'; kind: 'inference-key' }
  | { id: 'inference'; kind: 'inference-oauth' }
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
  provider,
  sources,
  onKeySubmit,
  onOpenChange,
  onConnected,
}: ProviderConnectionDialogProps): React.ReactNode {
  const titleId = useId()
  const descriptionId = useId()
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="model-center-key-dialog model-center-connection-dialog"
          >
            <header className="model-center-key-dialog-header">
              <div className="model-center-key-dialog-heading">
                {selected ? (
                  <IconButton
                    onClick={() => setSelectedId(null)}
                    title="返回连接方式"
                    variant="plain"
                  >
                    <ChevronLeft aria-hidden />
                  </IconButton>
                ) : (
                  <span className="model-center-key-dialog-icon">
                    <Link2 aria-hidden />
                  </span>
                )}
                <div>
                  <Dialog.Title id={titleId}>
                    {selected ? choiceLabel(selected) : `连接 ${provider.displayName}`}
                  </Dialog.Title>
                  <Dialog.Description id={descriptionId}>
                    {selected
                      ? '完成连接后，此供应商会自动出现在“账户连接”中。'
                      : '选择模型推理、管理账务或订阅额度的连接方式。'}
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild>
                <IconButton title="关闭"><X aria-hidden /></IconButton>
              </Dialog.Close>
            </header>

            {!selected ? (
              <div className="model-center-connection-choices">
                {choices.map(choice => (
                  <Button
                    className="model-center-connection-choice"
                    key={choice.id}
                    onClick={() => setSelectedId(choice.id)}
                  >
                    <span>
                      {choice.kind === 'inference-key'
                        ? <KeyRound aria-hidden />
                        : <ShieldCheck aria-hidden />}
                    </span>
                    <span>
                      <strong>{choiceLabel(choice)}</strong>
                      <small>{choiceDescription(choice)}</small>
                    </span>
                  </Button>
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
                description="此授权用于模型推理；令牌由 Agent 加密保存。"
                target={{
                  kind: 'provider',
                  providerId: provider.providerID,
                } as never}
                title={choiceLabel(selected)}
                onChanged={connected}
              />
            ) : null}

            {selected?.kind === 'usage-oauth' && selectedSource ? (
              <OAuthConnection
                connected={false}
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
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function getProviderConnectionChoices(
  provider: DesktopModelProviderSummary,
  sources: readonly UsageSourceDescriptor[],
): ConnectionChoice[] {
  const inferenceKind = provider.authMethods?.includes('oauth')
    ? 'inference-oauth' as const
    : 'inference-key' as const
  const result: ConnectionChoice[] = [{
    id: 'inference',
    kind: inferenceKind,
  }]
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

function choiceLabel(choice: ConnectionChoice): string {
  if (choice.kind === 'inference-key') return '模型推理 API Key'
  if (choice.kind === 'inference-oauth') return '模型推理 OAuth'
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
