import {
  ArrowDown,
  ArrowUp,
  Cable,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Zap,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Input } from '../../../components/ui/Input.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../../utils/errors.js'
import {
  providerManagementStore,
  type ConfiguredProviderGroup,
} from '../../provider-management/index.js'
import { BillingCredentialConnection } from './BillingCredentialConnection.js'
import { OAuthConnection } from './OAuthConnection.js'

export type ProviderConnectionSectionProps = {
  provider: DesktopModelProviderSummary
  providerState: DesktopModelProviderState | null
  group: ConfiguredProviderGroup | undefined
  apiKeys: readonly DesktopApiKeySummary[]
  busy: boolean
  onTestConnection: () => Promise<void>
  onOpenNewKey: () => void
  onEditKey: (key: DesktopApiKeySummary) => void
  onDeleteKey: (key: DesktopApiKeySummary) => void
  onCopyKey: (key: DesktopApiKeySummary) => Promise<void>
  onMoveKey: (key: DesktopApiKeySummary, offset: -1 | 1) => Promise<void>
  onTestKey: (key: DesktopApiKeySummary) => Promise<void>
  onSetActiveKey: (key: DesktopApiKeySummary) => Promise<void>
  onToggleKeyEnabled: (key: DesktopApiKeySummary) => Promise<void>
  onRefresh: () => Promise<void>
  onNotice: (message: string) => void
  onError: (message: string) => void
}

const HEALTH_LABELS: Record<DesktopApiKeyHealthStatus, string> = {
  untested: '未测试',
  healthy: '健康',
  'auth-failed': '鉴权失败',
  'rate-limited': '限流冷却',
  error: '异常',
}

export function ProviderConnectionSection({
  provider,
  providerState,
  group,
  apiKeys,
  busy,
  onTestConnection,
  onOpenNewKey,
  onEditKey,
  onDeleteKey,
  onCopyKey,
  onMoveKey,
  onTestKey,
  onSetActiveKey,
  onToggleKeyEnabled,
  onRefresh,
  onNotice,
  onError,
}: ProviderConnectionSectionProps): React.ReactNode {
  const supportsInferenceKeys =
    provider.authMethods?.includes('api-key')
    ?? provider.kind !== 'github-copilot'

  const isCustom = provider.providerKind === 'custom'
  const customConfig = isCustom && provider.config?.kind === 'custom' ? provider.config : null
  const [customBaseUrl, setCustomBaseUrl] = useState(customConfig?.baseUrl ?? '')
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)

  const oauthCredentials = (group?.connections ?? []).filter(
    connection => connection.kind === 'oauth' && connection.origin === 'credential',
  )
  const envConnections = (group?.connections ?? []).filter(
    connection => connection.kind === 'env',
  )

  async function handleSaveCustomBaseUrl(): Promise<void> {
    if (!customConfig) return
    setSavingBaseUrl(true)
    try {
      await desktopClient.updateProvider(provider.providerID, {
        ...customConfig,
        baseUrl: customBaseUrl.trim(),
      })
      onNotice('Endpoint Base URL 已更新。')
      await onRefresh()
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSavingBaseUrl(false)
    }
  }

  return (
    <div className="model-center-connection-section">
      {/* 1. Base URL / Custom Endpoint (if custom) */}
      {isCustom && customConfig ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>Endpoint 连接配置</h3>
              <p>自定义或本地服务的 API 地址。</p>
            </div>
          </header>
          <div className="model-center-detail-card-body">
            <div className="model-center-detail-field-row">
              <label className="model-center-detail-field" style={{ flex: 1 }}>
                <span>Base URL</span>
                <Input
                  placeholder="https://api.example.com/v1"
                  value={customBaseUrl}
                  onChange={e => setCustomBaseUrl(e.target.value)}
                />
              </label>
              <Button
                color="secondary"
                disabled={savingBaseUrl || customBaseUrl === customConfig.baseUrl}
                onClick={() => void handleSaveCustomBaseUrl()}
              >
                保存地址
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 2. API Keys Management */}
      {supportsInferenceKeys ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>API 密钥凭据</h3>
              <p>每个供应商支持保存多个 API Key；按优先级优先使用排在首位的活动凭据。</p>
            </div>
            <Button color="primary" onClick={onOpenNewKey}>
              <Plus aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              新增 API Key
            </Button>
          </header>

          <div className="model-center-detail-card-body">
            {apiKeys.length > 0 ? (
              <div className="model-center-key-list">
                {apiKeys.map((key, index) => (
                  <ApiKeyRowItem
                    busy={busy}
                    index={index}
                    key={key.id}
                    keyItem={key}
                    last={index === apiKeys.length - 1}
                    onCopy={() => void onCopyKey(key)}
                    onDelete={() => onDeleteKey(key)}
                    onEdit={() => onEditKey(key)}
                    onMove={offset => void onMoveKey(key, offset)}
                    onSetActive={() => void onSetActiveKey(key)}
                    onTest={() => void onTestKey(key)}
                    onToggleEnabled={() => void onToggleKeyEnabled(key)}
                  />
                ))}
              </div>
            ) : (
              <div className="model-center-section-empty-hint">
                <KeyRound aria-hidden size={20} />
                <span>尚未保存此供应商的 API Key，点击右上角「新增 API Key」进行配置。</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* 3. OAuth Connections */}
      {group?.oauthAvailable ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>OAuth 授权连接</h3>
              <p>通过官方账号授权快速连接，令牌将加密保存在本地凭据库。</p>
            </div>
          </header>
          <div className="model-center-detail-card-body">
            <OAuthConnection
              connected={oauthCredentials.length > 0}
              description="此授权用于模型推理；令牌保存在当前 Provider 凭据仓库。"
              target={{
                kind: 'provider',
                providerId: provider.providerID,
              } as never}
              title={`${provider.displayName} OAuth`}
              onChanged={onRefresh}
            />

            {oauthCredentials.length > 0 ? (
              <div className="model-center-key-list" style={{ marginTop: 'var(--space-3)' }}>
                {oauthCredentials.map(connection => (
                  <div className="model-center-key-row" key={connection.id}>
                    <div>
                      <strong>{connection.label}</strong>
                      <span>{connection.active ? '当前活动' : '未选择'}</span>
                    </div>
                    <div className="model-center-account-actions">
                      {!connection.active && connection.credentialId ? (
                        <Button
                          color="primary"
                          onClick={() => {
                            void providerManagementStore
                              .setActiveCredential(provider.providerID, connection.credentialId!)
                              .then(() => onNotice('活动凭据已切换为 OAuth。'))
                              .catch(err => onError(fullErrorMessage(err)))
                          }}
                        >
                          设为当前活动
                        </Button>
                      ) : null}
                      {connection.credentialId ? (
                        <Button
                          color="danger"
                          onClick={() => {
                            void providerManagementStore
                              .deleteCredential(connection.credentialId!)
                              .then(() => onNotice('OAuth 凭据已删除。'))
                              .catch(err => onError(fullErrorMessage(err)))
                          }}
                        >
                          断开并删除
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 4. Billing / Usage Sources */}
      {(group?.usageSources ?? []).length > 0 ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>用量与账单凭据</h3>
              <p>绑定独立用量凭据以查看实时额度与消耗。</p>
            </div>
          </header>
          <div className="model-center-detail-card-body">
            {group!.usageSources.map(source => {
              if (source.connectionMethod.kind === 'billing-key') {
                return (
                  <BillingCredentialConnection
                    key={source.sourceId}
                    source={{
                      ...source,
                      connectionMethod: source.connectionMethod,
                    }}
                    onChanged={onRefresh}
                    onConnect={input =>
                      providerManagementStore.connectUsageCredential(input)
                    }
                    onDisconnect={sourceId =>
                      providerManagementStore.disconnectUsageCredential({ sourceId })
                    }
                  />
                )
              }
              if (source.connectionMethod.kind === 'oauth') {
                return (
                  <OAuthConnection
                    connected={source.connection.kind !== 'none'}
                    description={
                      source.scope === 'subscription'
                        ? '独立订阅授权仅用于读取套餐额度，不会成为推理凭据。'
                        : '此授权仅用于读取账户用量。'
                    }
                    target={{ kind: 'usage', sourceId: source.sourceId }}
                    key={source.sourceId}
                    title={source.displayName}
                    onChanged={onRefresh}
                  />
                )
              }
              return null
            })}
          </div>
        </section>
      ) : null}

      {/* 5. Environment Connections */}
      {envConnections.length > 0 ? (
        <section className="model-center-detail-card">
          <header className="model-center-detail-card-header">
            <div>
              <h3>环境变量</h3>
              <p>系统在运行环境中检测到以下可用凭据：</p>
            </div>
          </header>
          <div className="model-center-detail-card-body">
            <div className="model-center-account-readonly-list">
              {envConnections.map(connection => (
                <div key={connection.id}>
                  <Cable aria-hidden />
                  <span>{connection.label}</span>
                  <strong>已生效</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* 6. Quick Connectivity Test Footer */}
      <section className="model-center-detail-card model-center-test-banner-card">
        <div className="model-center-test-banner-info">
          <Zap aria-hidden size={20} />
          <div>
            <strong>快速连通性诊断</strong>
            <span>发送一个最小测试请求验证当前配置与凭据是否可用。</span>
          </div>
        </div>
        <Button
          color="secondary"
          disabled={busy}
          onClick={() => void onTestConnection()}
        >
          <Cable aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          测试连接
        </Button>
      </section>
    </div>
  )
}

type ApiKeyRowItemProps = {
  busy: boolean
  index: number
  keyItem: DesktopApiKeySummary
  last: boolean
  onCopy: () => void
  onDelete: () => void
  onEdit: () => void
  onMove: (offset: -1 | 1) => void
  onSetActive: () => void
  onTest: () => void
  onToggleEnabled: () => void
}

function ApiKeyRowItem({
  busy,
  index,
  keyItem,
  last,
  onCopy,
  onDelete,
  onEdit,
  onMove,
  onSetActive,
  onTest,
  onToggleEnabled,
}: ApiKeyRowItemProps): React.ReactNode {
  return (
    <article
      className="model-center-key-row"
      data-disabled={!keyItem.enabled || undefined}
    >
      <div className="model-center-key-order">
        <IconButton
          color="ghostSecondary"
          disabled={busy || index <= 0}
          onClick={() => onMove(-1)}
          size="iconMd"
          title={`上移 ${keyItem.label}`}
        >
          <ArrowUp aria-hidden />
        </IconButton>
        <IconButton
          color="ghostSecondary"
          disabled={busy || last}
          onClick={() => onMove(1)}
          size="iconMd"
          title={`下移 ${keyItem.label}`}
        >
          <ArrowDown aria-hidden />
        </IconButton>
      </div>

      <div className="model-center-key-main">
        <div className="model-center-key-title">
          <strong>{keyItem.label}</strong>
          <code>{keyItem.maskedValue}</code>
          <span
            className="model-center-key-badge"
            data-tone={keyItem.active ? 'active' : 'neutral'}
          >
            {keyItem.active ? '当前活动' : `优先级 #${index + 1}`}
          </span>
          {!keyItem.enabled ? (
            <span className="model-center-key-badge" data-tone="warning">
              已停用
            </span>
          ) : null}
          <span
            className="model-center-key-badge"
            data-tone={healthTone(keyItem.health.status)}
          >
            {HEALTH_LABELS[keyItem.health.status]}
          </span>
        </div>
        <div className="model-center-key-meta">
          <span>最近测试：{formatTime(keyItem.health.lastTestedAt)}</span>
        </div>
      </div>

      <div className="model-center-key-actions">
        <Button color="secondary" disabled={busy} onClick={onCopy}>
          <Copy aria-hidden />
          复制
        </Button>
        <Button color="secondary" disabled={busy} onClick={onTest} title="测试当前 Key 有效性">
          测试
        </Button>
        <Dropdown
          align="end"
          className="popover-menu--flex"
          trigger={(
            <IconButton
              color="ghostSecondary"
              disabled={busy}
              size="iconMd"
              title={`操作 ${keyItem.label}`}
            >
              <MoreHorizontal aria-hidden />
            </IconButton>
          )}
          width={180}
        >
          <PopoverItem
            disabled={keyItem.active || !keyItem.enabled}
            onClick={onSetActive}
          >
            设为当前活动
          </PopoverItem>
          <PopoverItem onClick={onToggleEnabled}>
            {keyItem.enabled ? '停用 Key' : '启用 Key'}
          </PopoverItem>
          <PopoverItem onClick={onEdit}>编辑 / 更换 Key</PopoverItem>
          <PopoverItem onClick={onDelete}>删除 Key</PopoverItem>
        </Dropdown>
      </div>
    </article>
  )
}

function healthTone(
  status: DesktopApiKeyHealthStatus,
): 'healthy' | 'neutral' | 'warning' {
  if (status === 'healthy') return 'healthy'
  if (status === 'untested') return 'neutral'
  return 'warning'
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}
