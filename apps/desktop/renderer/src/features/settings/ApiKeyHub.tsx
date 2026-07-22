import React, { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type {
  DesktopApiKeySummary,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'
import { desktopClient } from '../../services/desktopClient.js'
import { fullErrorMessage } from '../../utils/errors.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsSection } from './SettingsSection.js'

type Props = {
  providers: DesktopModelProviderSummary[]
  selectedProviderId: ModelProviderID
  onError: (message: string) => void
  onChanged: (keys: DesktopApiKeySummary[]) => void
}

const HEALTH_LABELS: Record<DesktopApiKeySummary['health']['status'], string> = {
  untested: '未测试',
  healthy: '健康',
  'auth-failed': '鉴权失败',
  'rate-limited': '限流冷却',
  error: '异常',
}

export function ApiKeyHub({ providers, selectedProviderId, onError, onChanged }: Props): React.ReactNode {
  const apiKeyProviders = useMemo(
    () => providers.filter(provider => provider.kind !== 'github-copilot'),
    [providers],
  )
  const [keys, setKeys] = useState<DesktopApiKeySummary[]>([])
  const [filterProviderId, setFilterProviderId] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [newProviderId, setNewProviderId] = useState<ModelProviderID>(selectedProviderId)
  const [newLabel, setNewLabel] = useState('')
  const [newKey, setNewKey] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [replacementKey, setReplacementKey] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [, setClockTick] = useState(0)

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(value => value + 1), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const providerID = apiKeyProviders.some(provider => provider.providerID === selectedProviderId)
      ? selectedProviderId
      : apiKeyProviders[0]?.providerID
    if (providerID) setNewProviderId(providerID)
  }, [apiKeyProviders, selectedProviderId])

  const refresh = React.useCallback(async () => {
    const next = await desktopClient.listApiKeys()
    setKeys(next)
    onChanged(next)
    return next
  }, [onChanged])

  useEffect(() => {
    void refresh().catch(error => onError(fullErrorMessage(error)))
  }, [onError, refresh])

  const providerOptions = apiKeyProviders.map(provider => ({
    value: provider.providerID,
    label: provider.displayName,
    icon: provider.logoURL ? <img className="settings-provider-logo" src={provider.logoURL} alt="" /> : undefined,
  }))
  const visibleKeys = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return keys.filter(key => {
      if (filterProviderId !== 'all' && key.providerId !== filterProviderId) return false
      if (!normalized) return true
      return `${key.label} ${key.maskedValue} ${key.providerId} ${HEALTH_LABELS[key.health.status]}`
        .toLowerCase()
        .includes(normalized)
    })
  }, [filterProviderId, keys, query])
  const groups = apiKeyProviders
    .map(provider => ({
      provider,
      keys: visibleKeys
        .filter(key => key.providerId === provider.providerID)
        .sort((left, right) => left.priority - right.priority || left.createdAt - right.createdAt),
    }))
    .filter(group => group.keys.length > 0)

  async function mutate(id: string, action: () => Promise<void>, success: string): Promise<void> {
    setBusyId(id)
    setNotice(null)
    try {
      await action()
      await refresh()
      setNotice(success)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      await refresh().catch(() => undefined)
      onError(fullErrorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  async function createKey(): Promise<void> {
    if (!newLabel.trim() || !newKey.trim()) {
      onError('请填写 API Key 名称和密钥。')
      return
    }
    await mutate('create', async () => {
      await desktopClient.createApiKey({
        providerId: newProviderId,
        label: newLabel.trim(),
        key: newKey.trim(),
      })
      setNewLabel('')
      setNewKey('')
    }, 'API Key 已安全保存。')
  }

  async function saveEdit(key: DesktopApiKeySummary): Promise<void> {
    const label = editLabel.trim()
    const replacement = replacementKey.trim()
    if (!label && !replacement) return
    await mutate(key.id, () => desktopClient.updateApiKey({
      credentialId: key.id,
      ...(label && label !== key.label ? { label } : {}),
      ...(replacement ? { key: replacement } : {}),
    }), replacement ? 'API Key 已更换，健康状态已重置。' : '名称已更新。')
    setEditingId(null)
    setReplacementKey('')
  }

  async function moveKey(groupKeys: DesktopApiKeySummary[], index: number, offset: -1 | 1): Promise<void> {
    const target = index + offset
    if (target < 0 || target >= groupKeys.length) return
    const ordered = [...groupKeys]
    const [item] = ordered.splice(index, 1)
    if (!item) return
    ordered.splice(target, 0, item)
    await mutate(item.id, () => desktopClient.reorderApiKeys(item.providerId, ordered.map(key => key.id)), '接管优先级已更新。')
  }

  async function copyKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyId(key.id)
    try {
      const result = await desktopClient.copyProviderApiKey(key.id)
      setNotice(`已复制，剪贴板将在 ${Math.round(result.clearAfterMs / 1000)} 秒后清理。`)
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  function confirmDelete(key: DesktopApiKeySummary, groupKeys: DesktopApiKeySummary[]): void {
    const next = groupKeys.find(item => item.id !== key.id && item.enabled)
    const detail = key.active
      ? next
        ? `删除当前 Key 后将自动切换到「${next.label}」。`
        : '删除后该 Provider 将变为未配置。'
      : '此操作无法撤销。'
    if (!window.confirm(`确定删除「${key.label}」吗？\n${detail}`)) return
    void mutate(key.id, () => desktopClient.deleteApiKey(key.id), 'API Key 已删除。')
  }

  return (
    <SettingsSection
      title="API Key Hub"
      description="集中保存多条命名 API Key，并控制当前项、备用顺序和健康状态。完整密钥不会显示在页面中。"
    >
      <div className="api-key-hub">
        <div className="api-key-hub-toolbar">
          <SettingsDropdown
            width={240}
            ariaLabel="筛选 Provider"
            value={filterProviderId}
            options={[{ value: 'all', label: '全部 Provider' }, ...providerOptions]}
            onChange={setFilterProviderId}
          />
          <Input value={query} placeholder="搜索名称、尾号或状态" onChange={event => setQuery(event.target.value)} />
          <Button type="button" disabled={busyId !== null} onClick={() => void refresh()}>
            <RefreshCw aria-hidden /> 刷新
          </Button>
        </div>

        <div className="api-key-hub-create">
          <div className="api-key-hub-create-title"><Plus aria-hidden /> 新增 API Key</div>
          <SettingsDropdown
            width={240}
            ariaLabel="新增 Key 的 Provider"
            value={newProviderId}
            options={providerOptions}
            onChange={value => setNewProviderId(value as ModelProviderID)}
          />
          <Input value={newLabel} placeholder="名称，例如：个人主账号" onChange={event => setNewLabel(event.target.value)} />
          <Input type="password" value={newKey} placeholder="粘贴 API Key" autoComplete="off" onChange={event => setNewKey(event.target.value)} />
          <Button variant="primary" type="button" disabled={busyId !== null} onClick={() => void createKey()}>安全保存</Button>
        </div>

        {notice ? <p className="api-key-hub-notice">{notice}</p> : null}
        {groups.length === 0 ? (
          <p className="settings-empty-state">暂无匹配的 API Key。可在上方添加第一条密钥。</p>
        ) : groups.map(({ provider, keys: groupKeys }) => (
          <div className="api-key-group" key={provider.providerID}>
            <div className="api-key-group-header">
              {provider.logoURL ? <img className="settings-provider-logo" src={provider.logoURL} alt="" /> : <KeyRound aria-hidden />}
              <strong>{provider.displayName}</strong>
              <span>{groupKeys.length} 条</span>
            </div>
            {groupKeys.map((key, index) => {
              const onlyAvailableActive = key.active && key.enabled && groupKeys.filter(item => item.enabled).length === 1
              const isEditing = editingId === key.id
              return (
                <div className={`api-key-row${key.enabled ? '' : ' disabled'}`} key={key.id}>
                  <div className="api-key-row-main">
                    <div className="api-key-row-title">
                      <strong>{key.label}</strong>
                      <code>{key.maskedValue}</code>
                      {key.active ? <span className="settings-chip ok">当前</span> : <span className="settings-chip">备用 #{index + 1}</span>}
                      {!key.enabled ? <span className="settings-chip warn">停用</span> : null}
                      <span className={`settings-chip ${healthTone(key.health.status)}`}>{healthText(key)}</span>
                    </div>
                    <div className="api-key-row-meta">
                      优先级 {key.priority + 1} · 最近测试 {formatTime(key.health.lastTestedAt)} · 最近使用 {formatTime(key.health.lastUsedAt)}
                    </div>
                    {isEditing ? (
                      <div className="api-key-row-edit">
                        <Input value={editLabel} placeholder="名称" onChange={event => setEditLabel(event.target.value)} />
                        <Input type="password" value={replacementKey} placeholder="可选：输入新 Key（不会回填旧值）" autoComplete="off" onChange={event => setReplacementKey(event.target.value)} />
                        <Button type="button" onClick={() => void saveEdit(key)}>保存</Button>
                        <Button variant="ghost" type="button" onClick={() => { setEditingId(null); setReplacementKey('') }}>取消</Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="api-key-row-actions">
                    <Button aria-label="复制 API Key" title="安全复制" type="button" disabled={busyId !== null} onClick={() => void copyKey(key)}><Copy aria-hidden /></Button>
                    <Button type="button" disabled={busyId !== null} title="测试会产生极少量费用" onClick={() => void mutate(key.id, () => desktopClient.testApiKey(key.id), '测试完成。')}>测试</Button>
                    {!key.active ? <Button type="button" disabled={!key.enabled || key.health.status === 'auth-failed' || busyId !== null} title={key.health.status === 'auth-failed' ? '请先更换 Key 或测试成功' : undefined} onClick={() => void mutate(key.id, () => desktopClient.setActiveApiKey(key.providerId, key.id), '当前 API Key 已切换。')}>设为当前</Button> : null}
                    <Button type="button" disabled={onlyAvailableActive || busyId !== null} title={onlyAvailableActive ? '请先新增或启用备用 Key' : undefined} onClick={() => void mutate(key.id, () => desktopClient.setApiKeyEnabled(key.id, !key.enabled), key.enabled ? 'API Key 已停用。' : 'API Key 已启用。')}>{key.enabled ? '停用' : '启用'}</Button>
                    <Button aria-label="上移" type="button" disabled={index === 0 || busyId !== null} onClick={() => void moveKey(groupKeys, index, -1)}><ArrowUp aria-hidden /></Button>
                    <Button aria-label="下移" type="button" disabled={index === groupKeys.length - 1 || busyId !== null} onClick={() => void moveKey(groupKeys, index, 1)}><ArrowDown aria-hidden /></Button>
                    <Button aria-label="编辑" type="button" disabled={busyId !== null} onClick={() => { setEditingId(key.id); setEditLabel(key.label); setReplacementKey('') }}><Pencil aria-hidden /></Button>
                    <Button aria-label="删除" tone="danger" type="button" disabled={busyId !== null} onClick={() => confirmDelete(key, groupKeys)}><Trash2 aria-hidden /></Button>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

function healthTone(status: DesktopApiKeySummary['health']['status']): string {
  if (status === 'healthy') return 'ok'
  if (status === 'untested') return 'pending'
  return 'warn'
}

function healthText(key: DesktopApiKeySummary): string {
  const label = HEALTH_LABELS[key.health.status]
  if (key.health.status !== 'rate-limited' || !key.health.cooldownUntil) return label
  const seconds = Math.max(0, Math.ceil((key.health.cooldownUntil - Date.now()) / 1000))
  return seconds > 0 ? `${label} ${seconds}s` : '冷却结束'
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}
