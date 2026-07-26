import {
  ArrowDown,
  ArrowUp,
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
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { Button } from '../../components/ui/Button.js'
import { IconButton } from '../../components/ui/IconButton.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { Dropdown } from '../../components/ui/Dropdown.js'
import { Input } from '../../components/ui/Input.js'
import { PopoverItem } from '../../components/ui/PopoverItem.js'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../utils/errors.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import {
  ApiKeyEditorDialog,
  type ApiKeyEditorValue,
} from './ApiKeyEditorDialog.js'
import { getApiKeyDeleteConfirmation } from './modelCenterState.js'

export type ApiKeyWorkspaceProps = {
  providers: DesktopModelProviderSummary[]
  keys: DesktopApiKeySummary[]
  selectedProviderId: ModelProviderID
  createRequestToken: number
  onSelectedProviderIdChange: (providerId: ModelProviderID) => void
  onChanged: (keys: DesktopApiKeySummary[]) => void | Promise<void>
  onError: (message: string) => void
  onNotice: (message: string) => void
}

type HealthFilter = 'all' | DesktopApiKeyHealthStatus

const HEALTH_LABELS: Record<DesktopApiKeyHealthStatus, string> = {
  untested: '未测试',
  healthy: '健康',
  'auth-failed': '鉴权失败',
  'rate-limited': '限流冷却',
  error: '异常',
}

export function ApiKeyWorkspace({
  providers,
  keys,
  selectedProviderId,
  createRequestToken,
  onSelectedProviderIdChange,
  onChanged,
  onError,
  onNotice,
}: ApiKeyWorkspaceProps): React.ReactNode {
  const apiKeyProviders = useMemo(
    () => providers.filter(provider => provider.kind !== 'github-copilot'),
    [providers],
  )
  const defaultProviderId = apiKeyProviders.some(provider => provider.providerID === selectedProviderId)
    ? selectedProviderId
    : apiKeyProviders[0]?.providerID
  const [providerFilter, setProviderFilter] = useState<string>(selectedProviderId)
  const [query, setQuery] = useState('')
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<DesktopApiKeySummary | null>(null)
  const [deleteKey, setDeleteKey] = useState<DesktopApiKeySummary | null>(null)
  const [, setClockTick] = useState(0)
  const lastCreateRequestToken = useRef(createRequestToken)

  useEffect(() => {
    if (apiKeyProviders.some(provider => provider.providerID === selectedProviderId)) {
      setProviderFilter(selectedProviderId)
    } else {
      setProviderFilter(apiKeyProviders[0]?.providerID ?? 'all')
    }
  }, [apiKeyProviders, selectedProviderId])

  useEffect(() => {
    if (createRequestToken === lastCreateRequestToken.current) return
    lastCreateRequestToken.current = createRequestToken
    setEditingKey(null)
    setEditorOpen(true)
  }, [createRequestToken])

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(value => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const orderedKeysByProvider = useMemo(() => {
    const result = new Map<ModelProviderID, DesktopApiKeySummary[]>()
    for (const provider of apiKeyProviders) {
      result.set(
        provider.providerID,
        keys
          .filter(key => key.providerId === provider.providerID)
          .sort((left, right) => left.priority - right.priority || left.createdAt - right.createdAt),
      )
    }
    return result
  }, [apiKeyProviders, keys])

  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return apiKeyProviders
      .filter(provider => providerFilter === 'all' || provider.providerID === providerFilter)
      .map(provider => ({
        provider,
        keys: (orderedKeysByProvider.get(provider.providerID) ?? []).filter(key => {
          if (healthFilter !== 'all' && key.health.status !== healthFilter) return false
          if (!normalized) return true
          return `${key.label} ${key.maskedValue} ${HEALTH_LABELS[key.health.status]}`
            .toLowerCase()
            .includes(normalized)
        }),
      }))
      .filter(group => group.keys.length > 0)
  }, [apiKeyProviders, healthFilter, orderedKeysByProvider, providerFilter, query])

  async function refresh(): Promise<DesktopApiKeySummary[]> {
    const next = await desktopClient.listApiKeys()
    await onChanged(next)
    return next
  }

  async function mutate(id: string, action: () => Promise<void>, success: string): Promise<boolean> {
    setBusyId(id)
    try {
      await action()
      await refresh()
      onNotice(success)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      await refresh().catch(() => undefined)
      onError(fullErrorMessage(error))
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function testKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyId(key.id)
    try {
      const result = await desktopClient.testApiKey(key.id)
      await refresh()
      onNotice(result.message ?? (result.ok ? 'API Key 可用。' : 'API Key 测试失败。'))
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      await refresh().catch(() => undefined)
      onError(error instanceof Error ? error.message : 'API Key 测试失败，请稍后重试。')
    } finally {
      setBusyId(null)
    }
  }

  async function saveEditor(value: ApiKeyEditorValue): Promise<boolean> {
    if (editingKey) {
      const replacement = value.key?.trim()
      return mutate(editingKey.id, () => desktopClient.updateApiKey({
        credentialId: editingKey.id,
        ...(value.label !== editingKey.label ? { label: value.label } : {}),
        ...(replacement ? { key: replacement } : {}),
      }), replacement ? 'API Key 已更换，健康状态已重置。' : '名称已更新。')
    }
    if (!value.key) return false
    const saved = await mutate('create', () => desktopClient.createApiKey({
      providerId: value.providerId,
      label: value.label,
      key: value.key as string,
    }), 'API Key 已安全保存。')
    if (saved) onSelectedProviderIdChange(value.providerId)
    return saved
  }

  async function moveKey(key: DesktopApiKeySummary, offset: -1 | 1): Promise<void> {
    const providerKeys = orderedKeysByProvider.get(key.providerId) ?? []
    const index = providerKeys.findIndex(item => item.id === key.id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= providerKeys.length) return
    const ordered = [...providerKeys]
    const [item] = ordered.splice(index, 1)
    if (!item) return
    ordered.splice(target, 0, item)
    await mutate(key.id, () => desktopClient.reorderApiKeys(
      key.providerId,
      ordered.map(candidate => candidate.id),
    ), '接管优先级已更新。')
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

  function openCreate(): void {
    setEditingKey(null)
    setEditorOpen(true)
  }

  function openEdit(key: DesktopApiKeySummary): void {
    setEditingKey(key)
    setEditorOpen(true)
  }

  const deleteConfirmation = deleteKey
    ? getApiKeyDeleteConfirmation(
        deleteKey,
        keys,
        providers.find(provider => provider.providerID === deleteKey.providerId)?.displayName,
      )
    : null

  return (
    <section className="model-center-key-workspace" aria-label="API Keys">
      <div className="model-center-key-toolbar">
        <SettingsDropdown
          ariaLabel="筛选 Provider"
          searchable
          searchPlaceholder="搜索 Provider"
          width="var(--radix-select-trigger-width)"
          value={providerFilter}
          options={[
            { value: 'all', label: '全部 Provider' },
            ...apiKeyProviders.map(provider => ({
              value: provider.providerID,
              label: provider.displayName,
              detail: provider.providerID,
            })),
          ]}
          onChange={value => {
            setProviderFilter(value)
            if (value !== 'all') onSelectedProviderIdChange(value as ModelProviderID)
          }}
        />
        <Input
          aria-label="搜索 API Key"
          placeholder="搜索名称或尾号"
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <SettingsDropdown
          ariaLabel="筛选健康状态"
          width="var(--radix-select-trigger-width)"
          value={healthFilter}
          options={[
            { value: 'all', label: '全部状态' },
            ...Object.entries(HEALTH_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          onChange={value => setHealthFilter(value as HealthFilter)}
        />
        <Button disabled={!defaultProviderId} onClick={openCreate}>
          <Plus aria-hidden /> 新增 Key
        </Button>
      </div>

      <div className="model-center-key-groups">
        {groups.length === 0 ? (
          <div className="model-center-empty-state">
            <KeyRound aria-hidden />
            <strong>暂无匹配的 API Key</strong>
            <span>调整筛选条件，或添加第一条密钥。</span>
          </div>
        ) : groups.map(({ provider, keys: visibleKeys }) => {
          const providerKeys = orderedKeysByProvider.get(provider.providerID) ?? []
          const enabledCount = providerKeys.filter(key => key.enabled).length
          return (
            <section className="model-center-key-group" key={provider.providerID}>
              <header className="model-center-key-group-header">
                <div>
                  {provider.logoURL ? (
                    <RemoteImage
                      alt=""
                      className="model-center-provider-logo"
                      fallback={<KeyRound aria-hidden />}
                      src={provider.logoURL}
                    />
                  ) : <KeyRound aria-hidden />}
                  <strong>{provider.displayName}</strong>
                </div>
                <span>{providerKeys.length} 条</span>
              </header>
              <div className="model-center-key-list">
                {visibleKeys.map(key => {
                  const index = providerKeys.findIndex(item => item.id === key.id)
                  const onlyAvailableActive = key.active && key.enabled && enabledCount === 1
                  return (
                    <article className="model-center-key-row" data-disabled={!key.enabled || undefined} key={key.id}>
                      <div className="model-center-key-order">
                        <IconButton
                          title={`上移 ${key.label}`}
                          disabled={busyId !== null || index <= 0}
                          onClick={() => void moveKey(key, -1)}
                        ><ArrowUp aria-hidden /></IconButton>
                        <IconButton
                          title={`下移 ${key.label}`}
                          disabled={busyId !== null || index === providerKeys.length - 1}
                          onClick={() => void moveKey(key, 1)}
                        ><ArrowDown aria-hidden /></IconButton>
                      </div>
                      <div className="model-center-key-main">
                        <div className="model-center-key-title">
                          <strong>{key.label}</strong>
                          <code>{key.maskedValue}</code>
                          <span className="model-center-key-badge" data-tone={key.active ? 'active' : 'neutral'}>
                            {key.active ? '当前' : `备用 #${index + 1}`}
                          </span>
                          {!key.enabled ? <span className="model-center-key-badge" data-tone="warning">停用</span> : null}
                          <span className="model-center-key-badge" data-tone={healthTone(key.health.status)}>
                            {healthText(key)}
                          </span>
                        </div>
                        <div className="model-center-key-meta">
                          <span>优先级 {key.priority + 1}</span>
                          <span>最近测试 {formatTime(key.health.lastTestedAt)}</span>
                          <span>最近使用 {formatTime(key.health.lastUsedAt)}</span>
                        </div>
                      </div>
                      <div className="model-center-key-actions">
                        <Button disabled={busyId !== null} onClick={() => void copyKey(key)}>
                          <Copy aria-hidden /> 复制
                        </Button>
                        <Button
                          disabled={busyId !== null}
                          title="测试会产生极少量费用"
                          onClick={() => void testKey(key)}
                        >测试</Button>
                        <Dropdown
                          align="end"
                          trigger={(
                            <IconButton title={`更多 ${key.label}`} disabled={busyId !== null}>
                              <MoreHorizontal aria-hidden />
                            </IconButton>
                          )}
                          width={190}
                        >
                          <PopoverItem
                            disabled={key.active || !key.enabled || key.health.status === 'auth-failed'}
                            onClick={() => void mutate(key.id, () => desktopClient.setActiveApiKey(key.providerId, key.id), '当前 API Key 已切换。')}
                          >设为当前</PopoverItem>
                          <PopoverItem
                            disabled={onlyAvailableActive}
                            onClick={() => void mutate(key.id, () => desktopClient.setApiKeyEnabled(key.id, !key.enabled), key.enabled ? 'API Key 已停用。' : 'API Key 已启用。')}
                          >{key.enabled ? '停用' : '启用'}</PopoverItem>
                          <PopoverItem onClick={() => openEdit(key)}>编辑 / 更换 Key</PopoverItem>
                          <PopoverItem onClick={() => setDeleteKey(key)}>删除</PopoverItem>
                        </Dropdown>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <ApiKeyEditorDialog
        apiKey={editingKey}
        busy={busyId !== null}
        initialProviderId={defaultProviderId ?? selectedProviderId}
        open={editorOpen}
        providers={apiKeyProviders}
        onOpenChange={open => {
          setEditorOpen(open)
          if (!open) setEditingKey(null)
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
          void mutate(target.id, () => desktopClient.deleteApiKey(target.id), 'API Key 已删除。')
            .then(success => { if (success) setDeleteKey(null) })
        }}
        onCancel={() => setDeleteKey(null)}
      />
    </section>
  )
}

function healthTone(status: DesktopApiKeyHealthStatus): 'healthy' | 'neutral' | 'warning' {
  if (status === 'healthy') return 'healthy'
  if (status === 'untested') return 'neutral'
  return 'warning'
}

function healthText(key: DesktopApiKeySummary): string {
  const label = HEALTH_LABELS[key.health.status]
  if (key.health.status !== 'rate-limited' || !key.health.cooldownUntil) return label
  const seconds = Math.max(0, Math.ceil((key.health.cooldownUntil - Date.now()) / 1_000))
  return seconds > 0 ? `${label} ${seconds}s` : '冷却结束'
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}
