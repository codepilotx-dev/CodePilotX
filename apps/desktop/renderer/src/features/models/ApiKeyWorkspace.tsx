import {
  ArrowDown,
  ArrowUp,
  Cable,
  Copy,
  KeyRound,
  MoreHorizontal,
  Plus,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { Dropdown } from '../../components/ui/Dropdown.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../utils/errors.js'
import {
  providerManagementStore,
  selectConfiguredProviderGroups,
  useProviderManagementSnapshot,
  type ConfiguredProviderGroup,
} from '../provider-management/index.js'
import {
  ApiKeyEditorDialog,
  type ApiKeyEditorValue,
} from './ApiKeyEditorDialog.js'
import { getApiKeyDeleteConfirmation } from './modelCenterState.js'
import {
  AccountProviderGroup,
  buildAccountGroupSummary,
} from './provider-management/AccountProviderGroup.js'
import {
  BillingCredentialConnection,
} from './provider-management/BillingCredentialConnection.js'
import { OAuthConnection } from './provider-management/OAuthConnection.js'
import {
  ProviderCredentialStoreSection,
} from './ProviderCredentialStoreSection.js'

export type ApiKeyWorkspaceProps = {
  expandedProviderId: ModelProviderID | null
  onOpenCatalog: () => void
  onOpenProvider: (providerId: ModelProviderID) => void
  onOpenUsage: (providerId: ModelProviderID) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

const HEALTH_LABELS: Record<DesktopApiKeyHealthStatus, string> = {
  untested: '未测试',
  healthy: '健康',
  'auth-failed': '鉴权失败',
  'rate-limited': '限流冷却',
  error: '异常',
}

export function ApiKeyWorkspace({
  expandedProviderId,
  onOpenCatalog,
  onOpenProvider,
  onOpenUsage,
  onError,
  onNotice,
}: ApiKeyWorkspaceProps): React.ReactNode {
  const snapshot = useProviderManagementSnapshot()
  const groups = useMemo(
    () => selectConfiguredProviderGroups(snapshot),
    [snapshot],
  )
  const [expandedIds, setExpandedIds] = useState<Set<ModelProviderID>>(
    () => new Set(),
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editorProviderId, setEditorProviderId] =
    useState<ModelProviderID | null>(null)
  const [editingKey, setEditingKey] = useState<DesktopApiKeySummary | null>(null)
  const [deleteKey, setDeleteKey] = useState<DesktopApiKeySummary | null>(null)
  const [, setClockTick] = useState(0)
  const queriedSources = useRef('')
  const cachedSources = useRef('')
  const groupElements = useRef(new Map<ModelProviderID, HTMLElement>())

  useEffect(() => {
    if (!expandedProviderId) return
    if (!groups.some(group => group.provider.providerID === expandedProviderId)) return
    setExpandedIds(current => {
      if (current.has(expandedProviderId)) return current
      const next = new Set(current)
      next.add(expandedProviderId)
      return next
    })
  }, [expandedProviderId, groups])

  useEffect(() => {
    if (!expandedProviderId || !expandedIds.has(expandedProviderId)) return
    const element = groupElements.current.get(expandedProviderId)
    if (!element) return
    element.focus({ preventScroll: true })
    element.scrollIntoView({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'nearest',
    })
  }, [expandedIds, expandedProviderId])

  useEffect(() => {
    const eligibleSources = groups
      .flatMap(group => group.usageSources)
      .filter(source =>
        source.availability === 'queryable'
        && source.queryPolicy !== 'metered'
        && source.connection.kind !== 'none'
        && (
          source.capabilities.includes('balance')
          || source.capabilities.includes('quota')
        )
      )
    const sources = [...new Map(
      eligibleSources.map(source => [source.sourceId, source]),
    ).values()].sort((left, right) => left.sourceId.localeCompare(right.sourceId))
    const sourceIds = sources.map(source => source.sourceId)
    const signature = sources.map(source => [
      source.sourceId,
      source.connection.kind,
      source.connection.credentialId ?? '',
      source.connection.maskedValue ?? '',
    ].join(':')).join('|')
    const allCached = sourceIds.every(sourceId =>
      snapshot.usageResults.some(result => result.sourceId === sourceId)
    )
    if (!signature) return
    if (allCached) {
      cachedSources.current = signature
      queriedSources.current = signature
      return
    }
    const cacheWasInvalidated = cachedSources.current === signature
    if (queriedSources.current === signature && !cacheWasInvalidated) return
    if (cacheWasInvalidated) cachedSources.current = ''
    queriedSources.current = signature
    void providerManagementStore.querySources({
      range: '7d',
      timeZone: resolvedTimeZone(),
      sourceIds,
    }).catch(error => onError(fullErrorMessage(error)))
  }, [groups, onError, snapshot.usageResults])

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(value => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const orderedKeysByProvider = useMemo(() => {
    const result = new Map<ModelProviderID, DesktopApiKeySummary[]>()
    for (const group of groups) {
      result.set(
        group.provider.providerID,
        [...group.apiKeys].sort(
          (left, right) =>
            left.priority - right.priority || left.createdAt - right.createdAt,
        ),
      )
    }
    return result
  }, [groups])

  async function mutate(
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    setBusyId(id)
    try {
      await action()
      queriedSources.current = ''
      cachedSources.current = ''
      onNotice(success)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      onError(fullErrorMessage(error))
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function testKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyId(key.id)
    try {
      const result = await providerManagementStore.testApiKey(key.id)
      onNotice(result.message ?? (result.ok ? 'API Key 可用。' : 'API Key 测试失败。'))
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'API Key 测试失败，请稍后重试。')
    } finally {
      setBusyId(null)
    }
  }

  async function saveEditor(value: ApiKeyEditorValue): Promise<boolean> {
    if (editingKey) {
      const replacement = value.key?.trim()
      return mutate(editingKey.id, () => providerManagementStore.updateApiKey({
        credentialId: editingKey.id,
        ...(value.label !== editingKey.label ? { label: value.label } : {}),
        ...(replacement ? { key: replacement } : {}),
      }), replacement ? 'API Key 已更换，健康状态已重置。' : '名称已更新。')
    }
    if (!value.key) return false
    return mutate('create', () => providerManagementStore.createApiKey({
      providerId: value.providerId,
      label: value.label,
      key: value.key,
    }), 'API Key 已保存。')
  }

  async function moveKey(
    key: DesktopApiKeySummary,
    offset: -1 | 1,
  ): Promise<void> {
    const providerKeys = orderedKeysByProvider.get(key.providerId) ?? []
    const index = providerKeys.findIndex(item => item.id === key.id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= providerKeys.length) return
    const ordered = [...providerKeys]
    const [item] = ordered.splice(index, 1)
    if (!item) return
    ordered.splice(target, 0, item)
    await mutate(
      key.id,
      () => providerManagementStore.reorderApiKeys(
        key.providerId,
        ordered.map(candidate => candidate.id),
      ),
      '显示顺序已更新。',
    )
  }

  async function copyKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyId(key.id)
    try {
      const result = await desktopClient.copyProviderApiKey(key.id)
      onNotice(`已复制，剪贴板将在 ${Math.round(result.clearAfterMs / 1000)} 秒后清理。`)
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  function openCreate(providerId: ModelProviderID): void {
    setEditingKey(null)
    setEditorProviderId(providerId)
  }

  function openEdit(key: DesktopApiKeySummary): void {
    setEditingKey(key)
    setEditorProviderId(key.providerId)
  }

  const editorProvider = editorProviderId
    ? snapshot.providers.find(provider => provider.providerID === editorProviderId)
    : undefined
  const deleteConfirmation = deleteKey
    ? getApiKeyDeleteConfirmation(
        deleteKey,
        [...snapshot.apiKeys],
        snapshot.providers.find(
          provider => provider.providerID === deleteKey.providerId,
        )?.displayName,
      )
    : null

  return (
    <section className="model-center-key-workspace" aria-label="账户连接">
      <ProviderCredentialStoreSection
        onChanged={() =>
          providerManagementStore.refreshConnections().then(() => undefined)
        }
        onError={onError}
        onNotice={onNotice}
      />
      <div className="model-center-key-groups">
        {groups.length === 0 ? (
          <AccountWorkspaceEmptyState onOpenCatalog={onOpenCatalog} />
        ) : groups.map(group => {
          const providerId = group.provider.providerID
          const providerKeys = orderedKeysByProvider.get(providerId) ?? []
          const expanded = expandedIds.has(providerId)
          return (
            <AccountProviderGroup
              expanded={expanded}
              group={group}
              key={providerId}
              summary={buildAccountGroupSummary(group, snapshot.usageResults)}
              containerRef={element => {
                if (element) groupElements.current.set(providerId, element)
                else groupElements.current.delete(providerId)
              }}
              onOpenProvider={() => onOpenProvider(providerId)}
              onOpenUsage={() => onOpenUsage(providerId)}
              onToggle={() => {
                setExpandedIds(current => {
                  const next = new Set(current)
                  if (next.has(providerId)) next.delete(providerId)
                  else next.add(providerId)
                  return next
                })
              }}
            >
              <ProviderConnectionContents
                busyId={busyId}
                group={group}
                keys={providerKeys}
                onCopyKey={copyKey}
                onDeleteKey={setDeleteKey}
                onEditKey={openEdit}
                onMoveKey={moveKey}
                onMutate={mutate}
                onNewKey={() => openCreate(providerId)}
                onRefresh={async () => {
                  queriedSources.current = ''
                  cachedSources.current = ''
                  await providerManagementStore.refreshConnections()
                }}
                onTestKey={testKey}
              />
            </AccountProviderGroup>
          )
        })}
      </div>

      <ApiKeyEditorDialog
        apiKey={editingKey}
        busy={busyId !== null}
        initialProviderId={editorProviderId ?? snapshot.providers[0]?.providerID ?? 'openai'}
        open={editorProviderId !== null}
        providers={editorProvider ? [editorProvider] : []}
        onOpenChange={open => {
          if (open) return
          setEditorProviderId(null)
          setEditingKey(null)
        }}
        onSubmit={saveEditor}
      />

      <ConfirmationDialog
        actionDisabled={busyId !== null}
        actionLabel="删除"
        description={deleteConfirmation?.description ?? ''}
        open={deleteKey !== null}
        title={deleteConfirmation?.title ?? '删除 API Key？'}
        tone="danger"
        onAction={() => {
          if (!deleteKey) return
          const target = deleteKey
          void mutate(
            target.id,
            () => providerManagementStore.deleteCredential(target.id),
            'API Key 已删除。',
          ).then(success => {
            if (success) setDeleteKey(null)
          })
        }}
        onCancel={() => setDeleteKey(null)}
      />
    </section>
  )
}

export function AccountWorkspaceEmptyState({
  onOpenCatalog,
}: {
  onOpenCatalog: () => void
}): React.ReactNode {
  return (
    <div className="model-center-empty-state">
      <Cable aria-hidden />
      <strong>尚未连接任何供应商</strong>
      <span>先从供应商目录选择服务，再添加推理 Key 或完成 OAuth 授权。</span>
      <Button onClick={onOpenCatalog}>前往供应商</Button>
    </div>
  )
}

type ProviderConnectionContentsProps = {
  busyId: string | null
  group: ConfiguredProviderGroup
  keys: readonly DesktopApiKeySummary[]
  onCopyKey: (key: DesktopApiKeySummary) => Promise<void>
  onDeleteKey: (key: DesktopApiKeySummary) => void
  onEditKey: (key: DesktopApiKeySummary) => void
  onMoveKey: (key: DesktopApiKeySummary, offset: -1 | 1) => Promise<void>
  onMutate: (
    id: string,
    action: () => Promise<unknown>,
    success: string,
  ) => Promise<boolean>
  onNewKey: () => void
  onRefresh: () => Promise<void>
  onTestKey: (key: DesktopApiKeySummary) => Promise<void>
}

function ProviderConnectionContents({
  busyId,
  group,
  keys,
  onCopyKey,
  onDeleteKey,
  onEditKey,
  onMoveKey,
  onMutate,
  onNewKey,
  onRefresh,
  onTestKey,
}: ProviderConnectionContentsProps): React.ReactNode {
  const supportsInferenceKeys =
    group.provider.authMethods?.includes('api-key')
    ?? group.provider.kind !== 'github-copilot'
  const oauthCredentials = group.connections.filter(
    connection => connection.kind === 'oauth' && connection.origin === 'credential',
  )

  return (
    <>
      {supportsInferenceKeys ? (
        <section className="model-center-account-section">
          <header>
            <div>
              <h3>推理 API Keys</h3>
              <p>每个 Provider 只有一个活动凭据；其他 Key 仅保留供手动切换。</p>
            </div>
            <Button onClick={onNewKey}>
              <Plus aria-hidden />
              新增 Key
            </Button>
          </header>
          {keys.length > 0 ? (
            <div className="model-center-key-list">
              {keys.map((key, index) => {
                return (
                  <ApiKeyRow
                    busy={busyId !== null}
                    index={index}
                    key={key.id}
                    keyItem={key}
                    last={index === keys.length - 1}
                    onlyAvailableActive={false}
                    onCopy={() => void onCopyKey(key)}
                    onDelete={() => onDeleteKey(key)}
                    onEdit={() => onEditKey(key)}
                    onMove={offset => void onMoveKey(key, offset)}
                    onSetActive={() => void onMutate(
                      key.id,
                      () => providerManagementStore.setActiveCredential(
                        key.providerId,
                        key.id,
                      ),
                      '当前 API Key 已切换。',
                    )}
                    onTest={() => void onTestKey(key)}
                    onToggleEnabled={() => void onMutate(
                      key.id,
                      () => providerManagementStore.setCredentialEnabled(
                        key.id,
                        !key.enabled,
                      ),
                      key.enabled ? 'API Key 已停用。' : 'API Key 已启用。',
                    )}
                  />
                )
              })}
            </div>
          ) : (
            <p className="model-center-account-section-empty">
              当前连接来自环境变量或账务凭据，尚未保存推理 Key。
            </p>
          )}
        </section>
      ) : null}

      {group.oauthAvailable ? (
        <OAuthConnection
          connected={oauthCredentials.length > 0}
          description="此授权用于模型推理；令牌保存在当前 Provider 凭据仓库。"
          target={{
            kind: 'provider',
            providerId: group.provider.providerID,
          } as never}
          title={`${group.provider.displayName} OAuth`}
          onChanged={onRefresh}
        />
      ) : null}

      {oauthCredentials.length > 0 ? (
        <section className="model-center-account-section">
          <header><div><h3>OAuth 凭据</h3><p>OAuth 与 API Key 共用活动凭据选择。</p></div></header>
          <div className="model-center-key-list">
            {oauthCredentials.map(connection => (
              <div className="model-center-key-row" key={connection.id}>
                <div><strong>{connection.label}</strong><span>{connection.active ? '当前活动' : '未选择'}</span></div>
                <div className="model-center-account-actions">
                  {!connection.active && connection.credentialId ? (
                    <Button onClick={() => void onMutate(
                      connection.id,
                      () => providerManagementStore.setActiveCredential(
                        group.provider.providerID,
                        connection.credentialId!,
                      ).then(() => undefined),
                      '活动凭据已切换为 OAuth。',
                    )}>设为活动</Button>
                  ) : null}
                  {connection.credentialId ? (
                    <Button
                      tone="danger"
                      onClick={() => void onMutate(
                        connection.id,
                        () => providerManagementStore.deleteCredential(
                          connection.credentialId!,
                        ).then(() => undefined),
                        'OAuth 凭据已删除。',
                      )}
                    >删除</Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {group.usageSources.map(source => {
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
                  ? '独立订阅授权仅用于读取套餐额度，不会成为 Anthropic 推理凭据。'
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

      <ReadOnlyConnections group={group} />
    </>
  )
}

function ReadOnlyConnections({
  group,
}: {
  group: ConfiguredProviderGroup
}): React.ReactNode {
  const connections = group.connections.filter(
    connection => connection.kind === 'env',
  )
  if (connections.length === 0) return null
  return (
    <section className="model-center-account-section">
      <header>
        <div>
          <h3>环境连接</h3>
          <p>这些凭据由运行环境提供，不会在页面中回显或修改。</p>
        </div>
      </header>
      <div className="model-center-account-readonly-list">
        {connections.map(connection => (
          <div key={connection.id}>
            <Cable aria-hidden />
            <span>{connection.label}</span>
            <strong>已连接</strong>
          </div>
        ))}
      </div>
    </section>
  )
}

type ApiKeyRowProps = {
  busy: boolean
  index: number
  keyItem: DesktopApiKeySummary
  last: boolean
  onlyAvailableActive: boolean
  onCopy: () => void
  onDelete: () => void
  onEdit: () => void
  onMove: (offset: -1 | 1) => void
  onSetActive: () => void
  onTest: () => void
  onToggleEnabled: () => void
}

function ApiKeyRow({
  busy,
  index,
  keyItem,
  last,
  onlyAvailableActive,
  onCopy,
  onDelete,
  onEdit,
  onMove,
  onSetActive,
  onTest,
  onToggleEnabled,
}: ApiKeyRowProps): React.ReactNode {
  return (
    <article
      className="model-center-key-row"
      data-disabled={!keyItem.enabled || undefined}
    >
      <div className="model-center-key-order">
        <IconButton
          disabled={busy || index <= 0}
          onClick={() => onMove(-1)}
          title={`上移 ${keyItem.label}`}
        >
          <ArrowUp aria-hidden />
        </IconButton>
        <IconButton
          disabled={busy || last}
          onClick={() => onMove(1)}
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
            {keyItem.active ? '当前' : `未选择 #${index + 1}`}
          </span>
          {!keyItem.enabled ? (
            <span className="model-center-key-badge" data-tone="warning">
              停用
            </span>
          ) : null}
          <span
            className="model-center-key-badge"
            data-tone={healthTone(keyItem.health.status)}
          >
            {healthText(keyItem)}
          </span>
        </div>
        <div className="model-center-key-meta">
          <span>最近测试 {formatTime(keyItem.health.lastTestedAt)}</span>
        </div>
      </div>
      <div className="model-center-key-actions">
        <Button disabled={busy} onClick={onCopy}>
          <Copy aria-hidden />
          复制
        </Button>
        <Button disabled={busy} onClick={onTest} title="测试会产生极少量费用">
          测试
        </Button>
        <Dropdown
          align="end"
          className="popover-menu--flex"
          trigger={(
            <IconButton disabled={busy} title={`更多 ${keyItem.label}`}>
              <MoreHorizontal aria-hidden />
            </IconButton>
          )}
          width={180}
        >
          <PopoverItem
            disabled={
              keyItem.active || !keyItem.enabled
            }
            onClick={onSetActive}
          >
            设为当前
          </PopoverItem>
          <PopoverItem
            disabled={onlyAvailableActive}
            onClick={onToggleEnabled}
          >
            {keyItem.enabled ? '停用' : '启用'}
          </PopoverItem>
          <PopoverItem onClick={onEdit}>编辑 / 更换 Key</PopoverItem>
          <PopoverItem onClick={onDelete}>删除</PopoverItem>
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

function healthText(key: DesktopApiKeySummary): string {
  return HEALTH_LABELS[key.health.status]
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
}
