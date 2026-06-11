import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderBalanceResult,
  ModelProviderID,
} from '../../shared/types.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import {
  getModelDescription,
  getModelDisplayLabel,
} from '../modelPresets.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

export function ModelProviderSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [baseURL, setBaseURL] = useState(settings.providerBaseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [modelError, setModelError] = useState<string | null>(null)
  const [balanceStatus, setBalanceStatus] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    void Promise.all([
      window.desktopApi.listModelProviders(),
      window.desktopApi.getModelProviderState(),
    ])
      .then(([nextProviders, nextState]) => {
        if (!mounted) return
        setProviders(nextProviders)
        applyProviderState(nextState)
      })
      .catch(error => {
        if (!mounted) return
        setModelError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      mounted = false
    }
  }, [])

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.providerID === providerID),
    [providerID, providers],
  )
  const isDeepSeek = providerID === 'deepseek'
  const isCustom = providerID === 'custom'
  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    setBaseURL(selectedProvider?.baseURL ?? '')
    setModel('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  const modelOptions = useMemo(
    () => [
      {
        value: '',
        label: selectedProvider
          ? `默认模型 (${selectedProvider.displayName})`
          : '默认模型',
      },
      ...(selectedProviderState?.models ?? selectedProvider?.defaultModels ?? [])
        .filter(Boolean)
        .map(item => ({
          value: item,
          label: isDeepSeek
            ? `${getModelDisplayLabel(item)} (${item})`
            : item,
        })),
    ],
    [isDeepSeek, selectedProvider, selectedProviderState],
  )

  const selectedModelDescription =
    isDeepSeek && model ? getModelDescription(model) : null

  function applyProviderState(nextState: DesktopModelProviderState): void {
    setProviderState(nextState)
    setProviderID(nextState.selectedProviderID)
    setBaseURL(nextState.baseURL ?? '')
    setModel(nextState.model)
    settings.setProviderID(nextState.selectedProviderID)
    settings.setProviderBaseURL(nextState.baseURL ?? '')
    settings.setModel(nextState.model)
  }

  function applyFetchedModels(models: string[], error?: string): void {
    setProviderState(current => {
      if (current && current.selectedProviderID === providerID) {
        return { ...current, models, error }
      }
      if (!selectedProvider) {
        return current
      }
      return {
        selectedProviderID: providerID,
        provider: selectedProvider,
        model,
        baseURL,
        apiKeyConfigured: false,
        apiKeySource: null,
        models,
        error,
      }
    })
  }

  async function fetchModels(): Promise<void> {
    setBusy(true)
    setModelError(null)
    setStatus('正在拉取模型列表...')
    try {
      const result = await window.desktopApi.fetchProviderModels({
        providerID,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      applyFetchedModels(result.models, result.error)
      setModelError(result.error ?? null)
      setStatus(
        result.error
          ? null
          : `已拉取 ${result.models.length} 个可用模型。`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function fetchBalance(): Promise<DesktopProviderBalanceResult> {
    const result = await window.desktopApi.fetchProviderBalance({
      providerID,
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
    })
    setBalanceStatus(formatBalanceStatus(result))
    return result
  }

  async function testConnection(): Promise<void> {
    setBusy(true)
    setModelError(null)
    setStatus('正在测试连接...')
    try {
      const modelsRequest = window.desktopApi.fetchProviderModels({
        providerID,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      const [modelsResult, balanceResult] = isDeepSeek
        ? await Promise.all([modelsRequest, fetchBalance()])
        : [await modelsRequest, null]
      applyFetchedModels(modelsResult.models, modelsResult.error)
      const errors = [modelsResult.error, balanceResult?.error].filter(
        (item): item is string => Boolean(item),
      )
      setModelError(errors.length > 0 ? errors.join('；') : null)
      setStatus(
        errors.length > 0
          ? null
          : `连接正常，已发现 ${modelsResult.models.length} 个模型。`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveProvider(): Promise<void> {
    setBusy(true)
    setModelError(null)
    try {
      const nextState = await window.desktopApi.saveModelProvider({
        providerID,
        modelID: model.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      applyProviderState(nextState)
      setStatus('模型连接已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } finally {
      setBusy(false)
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) {
      setModelError('请输入 API key。')
      return
    }
    setBusy(true)
    setModelError(null)
    try {
      const nextState = await window.desktopApi.saveProviderApiKey(
        providerID,
        apiKey.trim(),
      )
      setApiKey('')
      applyProviderState(nextState)
      setStatus('API key 已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      if (providerID === 'deepseek') {
        const result = await window.desktopApi.fetchProviderBalance({
          providerID,
          baseURL: nextState.baseURL,
        })
        setBalanceStatus(formatBalanceStatus(result))
        if (result.error) {
          setModelError(result.error)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection
      title="模型连接"
      description="配置桌面端新会话使用的模型提供商、模型和 API key。"
    >
      <SettingsRow
        title="提供商"
        description="新会话会使用这里选择的 provider。"
        control={
          <SettingsDropdown
            ariaLabel="模型提供商"
            value={providerID}
            options={providers.map(provider => ({
              value: provider.providerID,
              label: provider.displayName,
            }))}
            onChange={value => setProviderID(value as ModelProviderID)}
          />
        }
      />
      <SettingsRow
        title="Base URL"
        description={
          isDeepSeek
            ? 'DeepSeek 使用内置 OpenAI-compatible 地址。'
            : isCustom
              ? 'Custom provider 需要填写 OpenAI-compatible Base URL。'
              : '内置 provider 的 Base URL 由应用管理。'
        }
        control={
          <input
            className="settings-input"
            readOnly={!isCustom}
            value={baseURL}
            placeholder={selectedProvider?.baseURL ?? 'https://.../v1'}
            onChange={event => setBaseURL(event.target.value)}
          />
        }
      />
      <SettingsRow
        title="API key"
        description={
          selectedProviderState?.apiKeyConfigured
            ? `已配置：${selectedProviderState.apiKeySource ?? 'secureStorage'}`
            : 'API key 会保存到安全存储，不会明文写入桌面设置 JSON。'
        }
        control={
          <div className="settings-inline-actions">
            <input
              className="settings-input"
              value={apiKey}
              placeholder="输入后保存"
              type="password"
              onChange={event => setApiKey(event.target.value)}
            />
            <button
              className="settings-button"
              disabled={busy}
              type="button"
              onClick={() => void saveApiKey()}
            >
              保存
            </button>
          </div>
        }
      />
      <SettingsRow
        title="模型"
        description={
          selectedModelDescription ??
          '留空表示使用该 provider 的默认模型。'
        }
        control={
          <SettingsDropdown
            ariaLabel="模型"
            value={model}
            options={modelOptions}
            onChange={setModel}
          />
        }
      />
      {isDeepSeek ? (
        <SettingsRow
          title="DeepSeek 状态"
          description={
            balanceStatus ??
            '测试连接会同时拉取模型列表并查询 /user/balance。'
          }
          control={
            <div className="settings-provider-links">
              <a
                className="settings-row-link"
                href="https://platform.deepseek.com/api_keys"
                onClick={openExternalLink}
                rel="noreferrer"
                target="_blank"
              >
                API key
              </a>
              <a
                className="settings-row-link"
                href="https://api-docs.deepseek.com/"
                onClick={openExternalLink}
                rel="noreferrer"
                target="_blank"
              >
                文档
              </a>
            </div>
          }
        />
      ) : null}
      <SettingsRow
        title="操作"
        description={modelError ?? status ?? '拉取模型列表、测试连接或保存当前连接。'}
        control={
          <div className="settings-inline-actions">
            <button
              className="settings-button"
              disabled={busy}
              type="button"
              onClick={() => void fetchModels()}
            >
              拉取模型
            </button>
            <button
              className="settings-button"
              disabled={busy}
              type="button"
              onClick={() => void testConnection()}
            >
              测试连接
            </button>
            <button
              className="settings-button"
              disabled={busy}
              type="button"
              onClick={() => void saveProvider()}
            >
              保存连接
            </button>
          </div>
        }
      />
    </SettingsSection>
  )
}

function formatBalanceStatus(result: DesktopProviderBalanceResult): string {
  if (result.error) {
    return result.error
  }
  if (result.balances.length === 0) {
    return result.isAvailable
      ? 'DeepSeek 账户可用，但未返回余额明细。'
      : 'DeepSeek 账户当前不可用。'
  }
  const balanceText = result.balances
    .map(balance => `${balance.currency} ${balance.totalBalance}`)
    .join('，')
  return result.isAvailable
    ? `DeepSeek 账户可用，余额：${balanceText}`
    : `DeepSeek 余额不足或账户不可用：${balanceText}`
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void window.desktopApi.openExternalURL(event.currentTarget.href)
}
