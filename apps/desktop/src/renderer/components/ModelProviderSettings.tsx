import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopModelMetadata,
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

const BUILT_IN_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
  'minimax',
  'groq',
  'custom',
])

export function ModelProviderSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [providerQuery, setProviderQuery] = useState('')
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
  const isMiniMax = providerID === 'minimax'
  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null
  const providerModels =
    selectedProviderState?.models ?? selectedProvider?.defaultModels ?? []
  const modelMetadata =
    selectedProviderState?.modelMetadata ??
    selectedProvider?.modelMetadata ??
    {}
  const selectedModelMetadata = model ? modelMetadata[model] : undefined
  const requiresBaseURL = Boolean(selectedProvider?.requiresBaseURL)
  const baseURLEditable = requiresBaseURL || providerID === 'custom'
  const apiKeySource = selectedProviderState?.apiKeySource ?? null
  const apiKeyConfigured = Boolean(selectedProviderState?.apiKeyConfigured)

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    setBaseURL(selectedProvider?.baseURL ?? '')
    setModel('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  const filteredProviderOptions = useMemo(() => {
    const query = providerQuery.trim().toLowerCase()
    return providers
      .filter(provider => {
        if (!query) return true
        return (
          provider.displayName.toLowerCase().includes(query) ||
          provider.providerID.toLowerCase().includes(query) ||
          provider.npmPackage?.toLowerCase().includes(query)
        )
      })
      .slice(0, 80)
      .map(provider => ({
        value: provider.providerID,
        label: provider.displayName,
        detail: provider.modelsDevSource
          ? provider.requiresBaseURL
            ? 'Models.dev · needs Base URL'
            : 'Models.dev'
          : 'Built-in',
        icon: provider.logoURL ? (
          <img className="settings-provider-logo" src={provider.logoURL} alt="" />
        ) : undefined,
      }))
  }, [providerQuery, providers])

  const modelOptions = useMemo(
    () => [
      {
        value: '',
        label: selectedProvider
          ? `默认模型 (${selectedProvider.displayName})`
          : '默认模型',
        detail: 'Use provider default',
      },
      ...providerModels.filter(Boolean).map(item => ({
        value: item,
        label: modelOptionLabel(item, modelMetadata[item], isDeepSeek),
        detail: modelOptionDetail(modelMetadata[item]),
      })),
    ],
    [isDeepSeek, modelMetadata, providerModels, selectedProvider],
  )

  const selectedModelDescription =
    selectedModelMetadata
      ? formatModelMetadata(selectedModelMetadata)
      : isDeepSeek && model
        ? getModelDescription(model)
        : null

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
      if (!selectedProvider) return current
      return {
        selectedProviderID: providerID,
        provider: selectedProvider,
        model,
        baseURL,
        apiKeyConfigured: false,
        apiKeySource: null,
        models,
        modelMetadata,
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
      setStatus(result.error ? null : `已拉取 ${result.models.length} 个可用模型。`)
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
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('该供应商需要填写 OpenAI-compatible Base URL 后才能测试连接。')
      return
    }
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
          : `连接正常，发现 ${modelsResult.models.length} 个模型。`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveProvider(): Promise<void> {
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('已选择 Models.dev 供应商；请填写 Base URL 后再保存为可调用连接。')
      return
    }
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
      setProviderState(current => {
        if (current && current.selectedProviderID === providerID) {
          return {
            ...current,
            apiKeyConfigured: true,
            apiKeySource: nextState.apiKeySource ?? 'secureStorage',
            provider: {
              ...current.provider,
              apiKeyConfigured: true,
            },
          }
        }
        if (!selectedProvider) return current
        return {
          selectedProviderID: providerID,
          provider: {
            ...selectedProvider,
            apiKeyConfigured: true,
          },
          model,
          baseURL,
          apiKeyConfigured: true,
          apiKeySource: nextState.apiKeySource ?? 'secureStorage',
          models: providerModels,
          modelMetadata,
        }
      })
      setStatus('API key 已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      if (providerID === 'deepseek') {
        const result = await window.desktopApi.fetchProviderBalance({
          providerID,
          baseURL: baseURL.trim() || nextState.baseURL,
        })
        setBalanceStatus(formatBalanceStatus(result))
        if (result.error) setModelError(result.error)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="model-provider-settings">
      <section className="settings-hero-card">
        <div className="settings-hero-copy">
          <span className="settings-eyebrow">当前连接</span>
          <h3>{selectedProvider?.displayName ?? providerID}</h3>
          <p>
            {model ? model : '使用供应商默认模型'} · {baseURL || '未配置 Base URL'}
          </p>
        </div>
        <div className="settings-status-grid">
          <StatusPill label="API key" value={formatApiKeyState(apiKeySource, apiKeyConfigured)} tone={apiKeyConfigured ? 'ok' : 'warn'} />
          <StatusPill label="类型" value={selectedProvider?.kind ?? 'openai-compatible'} />
          <StatusPill label="来源" value={selectedProvider?.modelsDevSource ? 'Models.dev' : '内置'} />
        </div>
      </section>

      <SettingsSection
        title="供应商"
        description="从内置适配器和 Models.dev 目录中选择模型供应商。非内置供应商需要填写 OpenAI-compatible Base URL。"
      >
        <SettingsRow
          title="搜索"
          description="按供应商名称、ID 或 npm 包名过滤列表。"
          control={
            <input
              className="settings-input settings-input-wide"
              value={providerQuery}
              placeholder="搜索 provider..."
              onChange={event => setProviderQuery(event.target.value)}
            />
          }
        />
        <SettingsRow
          title="提供商"
          description={providerDescription(selectedProvider)}
          control={
            <SettingsDropdown
              ariaLabel="模型提供商"
              value={providerID}
              options={filteredProviderOptions.length ? filteredProviderOptions : [{ value: providerID, label: providerID }]}
              onChange={value => setProviderID(value as ModelProviderID)}
            />
          }
        />
        <SettingsRow
          title="Base URL"
          description={baseURLDescription(selectedProvider, isMiniMax)}
          control={
            <input
              className="settings-input settings-input-wide"
              readOnly={!baseURLEditable}
              value={baseURL}
              placeholder={selectedProvider?.baseURL ?? 'https://.../v1'}
              onChange={event => setBaseURL(event.target.value)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="凭据"
        description="API key 会保存到安全存储，不会明文写入桌面设置 JSON。"
      >
        <SettingsRow
          title="API key"
          description={apiKeySource ? `当前来源：${apiKeySource}` : providerEnvDescription(selectedProvider)}
          control={
            <div className="settings-inline-actions settings-secret-actions">
              <span className={`settings-chip ${apiKeyConfigured ? 'ok' : 'warn'}`}>
                {formatApiKeyState(apiKeySource, apiKeyConfigured)}
              </span>
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
      </SettingsSection>

      <SettingsSection
        title="模型"
        description="模型列表优先来自 Models.dev 元数据；连接测试会尝试读取供应商实时 /models。"
      >
        <SettingsRow
          title="模型"
          description={selectedModelDescription ?? '留空表示使用该 provider 的默认模型。'}
          control={
            <SettingsDropdown
              ariaLabel="模型"
              value={model}
              options={modelOptions}
              onChange={setModel}
            />
          }
        />
        <SettingsRow
          title="模型列表"
          description={modelError ?? status ?? `当前目录包含 ${providerModels.length} 个模型。`}
          control={
            <button
              className="settings-button"
              disabled={busy}
              type="button"
              onClick={() => void fetchModels()}
            >
              拉取模型
            </button>
          }
        />
      </SettingsSection>

      {isDeepSeek ? (
        <SettingsSection title="DeepSeek 状态" description="测试连接会同时拉取模型列表并查询 /user/balance。">
          <SettingsRow
            title="账户状态"
            description={balanceStatus ?? '尚未查询余额。'}
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
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="连接测试"
        description="测试当前凭据和 Base URL；保存连接后新会话会使用该 provider/model。"
      >
        <SettingsRow
          title="操作"
          description={modelError ?? status ?? connectionHint(selectedProvider, baseURL)}
          control={
            <div className="settings-inline-actions">
              {selectedProvider?.docURL ? (
                <a
                  className="settings-row-link"
                  href={selectedProvider.docURL}
                  onClick={openExternalLink}
                  rel="noreferrer"
                  target="_blank"
                >
                  文档
                </a>
              ) : null}
              <button
                className="settings-button"
                disabled={busy}
                type="button"
                onClick={() => void testConnection()}
              >
                测试连接
              </button>
              <button
                className="settings-button primary"
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
    </div>
  )
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}): React.ReactNode {
  return (
    <div className={`settings-status-pill ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function providerDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider) return '选择新会话使用的 provider。'
  const parts = [provider.providerID]
  if (provider.npmPackage) parts.push(provider.npmPackage)
  if (provider.requiresBaseURL && !BUILT_IN_PROVIDER_IDS.has(provider.providerID)) {
    parts.push('需要 Base URL')
  }
  return parts.join(' · ')
}

function baseURLDescription(
  provider: DesktopModelProviderSummary | undefined,
  isMiniMax: boolean,
): string {
  if (!provider) return '选择 provider 后显示默认地址。'
  if (provider.requiresBaseURL) return '该 Models.dev provider 需要填写 OpenAI-compatible Base URL。'
  if (provider.providerID === 'deepseek') return 'DeepSeek 使用内置 OpenAI-compatible 地址。'
  if (isMiniMax) return 'MiniMax 使用内置 Anthropic-compatible 地址。'
  return '内置 provider 的 Base URL 由应用管理。'
}

function providerEnvDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider?.envVars?.length) return '未发现环境变量配置。'
  return `可使用环境变量：${provider.envVars.join(', ')}`
}

function connectionHint(provider: DesktopModelProviderSummary | undefined, baseURL: string): string {
  if (provider?.requiresBaseURL && !baseURL.trim()) {
    return '填写 Base URL 后可以测试并保存为可调用连接。'
  }
  return '拉取模型列表、测试连接或保存当前连接。'
}

function modelOptionLabel(
  model: string,
  metadata: DesktopModelMetadata | undefined,
  isDeepSeek: boolean,
): string {
  if (metadata?.name && metadata.name !== model) return `${metadata.name} (${model})`
  return isDeepSeek ? `${getModelDisplayLabel(model)} (${model})` : model
}

function modelOptionDetail(metadata: DesktopModelMetadata | undefined): string | undefined {
  if (!metadata) return undefined
  const parts = []
  if (metadata.contextWindow) parts.push(`${formatCompactNumber(metadata.contextWindow)} ctx`)
  if (metadata.inputCost !== undefined && metadata.outputCost !== undefined) {
    parts.push(`$${metadata.inputCost}/$${metadata.outputCost}`)
  }
  const caps = formatCapabilities(metadata)
  if (caps) parts.push(caps)
  return parts.join(' · ')
}

function formatModelMetadata(metadata: DesktopModelMetadata): string {
  const parts = []
  if (metadata.contextWindow) parts.push(`上下文 ${formatCompactNumber(metadata.contextWindow)}`)
  if (metadata.outputTokens) parts.push(`输出 ${formatCompactNumber(metadata.outputTokens)}`)
  if (metadata.inputCost !== undefined && metadata.outputCost !== undefined) {
    parts.push(`价格 $${metadata.inputCost}/$${metadata.outputCost} 每百万 tokens`)
  }
  const caps = formatCapabilities(metadata)
  if (caps) parts.push(caps)
  return parts.join(' · ')
}

function formatCapabilities(metadata: DesktopModelMetadata): string {
  return [
    metadata.reasoning ? 'reasoning' : null,
    metadata.toolCall ? 'tools' : null,
    metadata.structuredOutput ? 'structured' : null,
    metadata.vision ? 'vision' : null,
  ].filter(Boolean).join(', ')
}

function formatCompactNumber(value: number): string {
  if (value >= 1000000) return `${Math.round(value / 100000) / 10}M`
  if (value >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

function formatApiKeyState(source: string | null, configured: boolean): string {
  if (!configured) return '未配置'
  if (source && source !== 'secureStorage') return '来自环境变量'
  return '已配置'
}

function formatBalanceStatus(result: DesktopProviderBalanceResult): string {
  if (result.error) return result.error
  if (result.balances.length === 0) {
    return result.isAvailable
      ? 'DeepSeek 账户可用，但未返回余额明细。'
      : 'DeepSeek 账户当前不可用。'
  }
  const balanceText = result.balances
    .map(balance => `${balance.currency} ${balance.totalBalance}`)
    .join('；')
  return result.isAvailable
    ? `DeepSeek 账户可用，余额：${balanceText}`
    : `DeepSeek 余额不足或账户不可用：${balanceText}`
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void window.desktopApi.openExternalURL(event.currentTarget.href)
}
