import { desktopClient } from '../services/desktopClient.js'
﻿import React, { useEffect, useMemo, useState } from 'react'
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
import { THINKING_MODE_OPTIONS } from '../features/settings/settingsStorage.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

const BUILT_IN_PROVIDER_IDS = new Set([
  'ai-gateway',
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
  'minimax',
  'groq',
  'custom',
])

const NO_MODEL_OPTION = '__no_models_available__'

type Props = {
  onError: (message: string) => void
}

export function ModelProviderSettings({ onError }: Props): React.ReactNode {
  const settings = useDesktopSettings()
  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
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
      desktopClient.listModelProviders(),
      desktopClient.getModelProviderState(),
    ])
      .then(([nextProviders, nextState]) => {
        if (!mounted) return
        setProviders(nextProviders)
        applyProviderState(nextState)
      })
      .catch(error => {
        if (!mounted) return
        const message = error instanceof Error ? error.message : String(error)
        setModelError(message)
        onError(message)
      })
    return () => {
      mounted = false
    }
  }, [onError])

  const selectedProvider = useMemo(
    () => providers.find(provider => provider.providerID === providerID),
    [providerID, providers],
  )
  const isAIGateway = providerID === 'ai-gateway'
  const isDeepSeek = providerID === 'deepseek'
  const isMiniMax = providerID === 'minimax'
  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null
  const providerModels = (
    selectedProviderState?.models ?? selectedProvider?.defaultModels ?? []
  ).filter(item => item && item !== NO_MODEL_OPTION)
  const modelMetadata =
    selectedProviderState?.modelMetadata ?? selectedProvider?.modelMetadata ?? {}
  const selectedModelMetadata = model ? modelMetadata[model] : undefined
  const requiresBaseURL = Boolean(selectedProvider?.requiresBaseURL)
  const baseURLEditable = requiresBaseURL || providerID === 'custom'
  const apiKeySource = selectedProviderState?.apiKeySource ?? null
  const apiKeyConfigured = Boolean(selectedProviderState?.apiKeyConfigured)

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const firstModel = selectedProvider?.defaultModels[0] ?? ''
    setBaseURL(selectedProvider?.baseURL ?? '')
    setModel(firstModel)
    setModelQuery('')
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
        detail: providerDetail(provider),
        icon: provider.logoURL ? (
          <img className="settings-provider-logo" src={provider.logoURL} alt="" />
        ) : undefined,
      }))
  }, [providerQuery, providers])

  const modelOptions = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    const filteredModels = providerModels.filter(item => {
      if (!query) return true
      const metadata = modelMetadata[item]
      return modelSearchText(item, metadata).includes(query)
    })
    return filteredModels.slice(0, 200).map(item => ({
      value: item,
      label: modelOptionLabel(item, modelMetadata[item], isDeepSeek),
      detail: modelOptionDetail(modelMetadata[item]),
    }))
  }, [isDeepSeek, modelMetadata, modelQuery, providerModels])

  const selectedModelDescription = selectedModelMetadata
    ? formatModelMetadata(selectedModelMetadata)
    : isDeepSeek && model
      ? getModelDescription(model)
      : null

  function applyProviderState(nextState: DesktopModelProviderState): void {
    const nextModel =
      nextState.model ||
      nextState.models[0] ||
      nextState.provider.defaultModels[0] ||
      ''
    setProviderState(nextState)
    setProviderID(nextState.selectedProviderID)
    setBaseURL(nextState.baseURL ?? '')
    setModel(nextModel)
    settings.setProviderID(nextState.selectedProviderID)
    settings.setProviderBaseURL(nextState.baseURL ?? '')
    settings.setModel(nextModel)
  }

  function applyFetchedModels(models: string[], error?: string): void {
    const cleanModels = models.filter(Boolean)
    setProviderState(current => {
      if (current && current.selectedProviderID === providerID) {
        return { ...current, models: cleanModels, error }
      }
      if (!selectedProvider) return current
      return {
        selectedProviderID: providerID,
        provider: selectedProvider,
        model,
        baseURL,
        apiKeyConfigured: false,
        apiKeySource: null,
        models: cleanModels,
        modelMetadata,
        error,
      }
    })
    if (!model && cleanModels[0]) setModel(cleanModels[0])
  }

  async function fetchModels(): Promise<void> {
    setBusy(true)
    setModelError(null)
    setStatus('正在刷新模型目录...')
    try {
      const result = await desktopClient.fetchProviderModels({
        providerID,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      applyFetchedModels(result.models, result.error)
      setModelError(result.error ?? null)
      setStatus(result.error ? null : `已加载 ${result.models.length} 个模型。`)
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function fetchBalance(): Promise<DesktopProviderBalanceResult> {
    const result = await desktopClient.fetchProviderBalance({
      providerID,
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
    })
    setBalanceStatus(formatBalanceStatus(result))
    return result
  }

  async function testConnection(): Promise<void> {
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('测试前请为该供应商配置兼容 OpenAI 的 Base URL。')
      return
    }
    if (isAIGateway && !apiKeyConfigured && !apiKey.trim()) {
      setModelError('请先保存 AI Gateway API 密钥，或设置 AI_GATEWAY_API_KEY 环境变量。')
      return
    }
    setBusy(true)
    setModelError(null)
    setStatus('正在测试连接...')
    try {
      const modelsRequest = desktopClient.fetchProviderModels({
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
          : isAIGateway
            ? `AI Gateway 密钥已配置。目录共有 ${modelsResult.models.length} 个语言模型。`
            : `连接正常。共找到 ${modelsResult.models.length} 个模型。`,
      )
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveProvider(): Promise<void> {
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('保存为可调用连接前，该 Models.dev 供应商需要 Base URL。')
      return
    }
    if (!model.trim()) {
      setModelError('保存前请选择一个具体模型。')
      return
    }
    setBusy(true)
    setModelError(null)
    try {
      const nextState = await desktopClient.saveModelProvider({
        providerID,
        modelID: model.trim(),
        baseURL: baseURL.trim() || undefined,
      })
      applyProviderState(nextState)
      setStatus('模型连接已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) {
      setModelError('请输入 API 密钥。')
      return
    }
    setBusy(true)
    setModelError(null)
    try {
      const nextState = await desktopClient.saveProviderApiKey(
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
      setStatus('API 密钥已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      if (providerID === 'deepseek') {
        const result = await desktopClient.fetchProviderBalance({
          providerID,
          baseURL: baseURL.trim() || nextState.baseURL,
        })
        setBalanceStatus(formatBalanceStatus(result))
        if (result.error) setModelError(result.error)
      }
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  function showOperationError(error: unknown): void {
    const message = errorMessageOf(error)
    setModelError(message)
    setStatus(null)
    onError(message)
  }

  const providerOptions = filteredProviderOptions.length
    ? filteredProviderOptions
    : [{ value: providerID, label: providerID }]
  const dropdownModelOptions = modelOptions.length
    ? modelOptions
    : [{ value: NO_MODEL_OPTION, label: '未加载模型', detail: '请先刷新目录' }]
  const dropdownModelValue = modelOptions.some(option => option.value === model)
    ? model
    : dropdownModelOptions[0]?.value ?? NO_MODEL_OPTION

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">Agent 配置</h2>
        <p className="settings-page-desc">
          配置桌面端新会话使用的模型供应商、模型、API key 和连接状态。已有会话会继续使用创建时保存的配置快照。
        </p>

        <section className="settings-hero-card">
          <div className="settings-hero-copy">
            <span className="settings-eyebrow">当前连接</span>
            <h3>{selectedProvider?.displayName ?? providerID}</h3>
            <p>
              {model || '未选择模型'} / {baseURL || '无需 Base URL'}
            </p>
          </div>
          <div className="settings-status-grid">
            <StatusPill label="API 密钥" value={formatApiKeyState(apiKeySource, apiKeyConfigured)} tone={apiKeyConfigured ? 'ok' : 'warn'} />
            <StatusPill label="类型" value={selectedProvider?.kind ?? 'openai-compatible'} />
            <StatusPill label="来源" value={selectedProvider?.gatewaySource ? 'AI Gateway' : selectedProvider?.modelsDevSource ? 'Models.dev' : '内置'} />
          </div>
        </section>

        <SettingsSection
          title="新会话默认值"
          description="这些值会写入桌面端设置，并在创建新会话时进入 session snapshot。"
        >
          <SettingsRow
            title="会话名称"
            description="可选。留空时由对话内容生成标题。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={settings.sessionName}
                placeholder="自动生成"
                onChange={event => settings.setSessionName(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Thinking 模式"
            description="选择支持推理模型的新会话默认推理强度。"
            control={
              <SettingsDropdown
                ariaLabel="Thinking 模式"
                value={settings.thinkingMode}
                options={THINKING_MODE_OPTIONS}
                onChange={value =>
                  settings.setThinkingMode(
                    value as typeof settings.thinkingMode,
                  )
                }
              />
            }
          />
          <SettingsRow
            title="备用模型"
            description="可选。主模型不可用时使用的模型 ID。"
            control={
              <input
                className="settings-input settings-input-narrow"
                value={settings.fallbackModel}
                placeholder="留空"
                onChange={event => settings.setFallbackModel(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="系统提示词"
            description="可选。设置后替换默认系统提示词。"
            control={
              <textarea
                className="settings-textarea"
                value={settings.systemPrompt}
                placeholder="使用内置默认"
                onChange={event => settings.setSystemPrompt(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="追加系统提示词"
            description="可选。追加到默认系统提示词之后。"
            control={
              <textarea
                className="settings-textarea"
                value={settings.appendSystemPrompt}
                placeholder="无追加内容"
                onChange={event =>
                  settings.setAppendSystemPrompt(event.target.value)
                }
              />
            }
          />
          <SettingsRow
            title="额外目录"
            description="每行一个目录，新会话会额外读取这些工作目录。"
            control={
              <textarea
                className="settings-textarea settings-code-textarea"
                value={settings.additionalDirectories}
                placeholder="D:\\path\\to\\repo"
                onChange={event =>
                  settings.setAdditionalDirectories(event.target.value)
                }
              />
            }
          />
        </SettingsSection>

        <SettingsSection
          title="供应商"
          description="AI Gateway 提供 AI SDK 支持的语言模型；DeepSeek 直连模式保留其优化路径。"
        >
          <SettingsRow
            title="搜索"
            description="按供应商名称、ID 或 npm 包名筛选。"
            control={
              <input
                className="settings-input settings-input-wide"
                value={providerQuery}
                placeholder="搜索供应商..."
                onChange={event => setProviderQuery(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="供应商"
            description={providerDescription(selectedProvider)}
            control={
              <SettingsDropdown
                ariaLabel="模型供应商"
                value={providerID}
                options={providerOptions}
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
          description="API 密钥保存在安全存储中，环境变量优先级更高。"
        >
          <SettingsRow
            title="API 密钥"
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
          description={isAIGateway ? 'AI Gateway 模型使用 provider/model 格式的 ID，例如 openai/gpt-4.1。' : '模型元数据来自 Models.dev 以及供应商实时目录（如可用）。'}
        >
          <SettingsRow
            title="搜索模型"
            description="按供应商、模型、能力、上下文、价格、来源或标签筛选。"
            control={
              <input
                className="settings-input settings-input-wide"
                value={modelQuery}
                placeholder="搜索模型 / 供应商 / 能力..."
                onChange={event => setModelQuery(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="模型"
            description={selectedModelDescription ?? '请选择一个具体模型。'}
            control={
              <SettingsDropdown
                ariaLabel="模型"
                value={dropdownModelValue}
                options={dropdownModelOptions}
                onChange={value => {
                  if (value !== NO_MODEL_OPTION) setModel(value)
                }}
              />
            }
          />
          <SettingsRow
            title="目录"
            description={modelError ?? status ?? `当前目录共有 ${providerModels.length} 个模型。`}
            control={
              <button
                className="settings-button"
                disabled={busy}
                type="button"
                onClick={() => void fetchModels()}
              >
                刷新目录
              </button>
            }
          />
        </SettingsSection>

        {isDeepSeek ? (
          <SettingsSection title="DeepSeek 状态" description="DeepSeek 直连模式会保留余额查询、思考参数和输出 token 优化。">
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
                    API 密钥
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
          description="测试当前凭据与 Base URL。保存后的连接会应用到新会话。"
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

function providerDetail(provider: DesktopModelProviderSummary): string {
  if (provider.providerID === 'ai-gateway') return 'AI SDK Gateway / 完整目录'
  if (provider.gatewaySource && provider.modelsDevSource) return 'Gateway + Models.dev'
  if (provider.gatewaySource) return 'Gateway'
  if (provider.modelsDevSource) {
    return provider.requiresBaseURL ? 'Models.dev / 需要 Base URL' : 'Models.dev'
  }
  return '内置'
}

function providerDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider) return '选择新会话使用的供应商。'
  if (provider.providerID === 'ai-gateway') {
    return '使用 AI SDK / Vercel AI Gateway 作为受支持语言模型的统一运行时。'
  }
  const parts = [provider.providerID]
  if (provider.npmPackage) parts.push(provider.npmPackage)
  if (provider.requiresBaseURL && !BUILT_IN_PROVIDER_IDS.has(provider.providerID)) {
    parts.push('需要 Base URL')
  }
  return parts.join(' / ')
}

function baseURLDescription(
  provider: DesktopModelProviderSummary | undefined,
  isMiniMax: boolean,
): string {
  if (!provider) return '选择供应商后会显示其默认 endpoint。'
  if (provider.providerID === 'ai-gateway') return 'AI Gateway 使用内置的统一 endpoint。'
  if (provider.requiresBaseURL) return '该 Models.dev 供应商需要兼容 OpenAI 的 Base URL。'
  if (provider.providerID === 'deepseek') return 'DeepSeek 使用内置的 OpenAI 兼容 endpoint。'
  if (isMiniMax) return 'MiniMax 使用内置的 Anthropic 兼容 endpoint。'
  return '内置供应商的 Base URL 由应用管理。'
}

function providerEnvDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider?.envVars?.length) return '未检测到环境变量。'
  return `环境变量：${provider.envVars.join('、')}`
}

function connectionHint(provider: DesktopModelProviderSummary | undefined, baseURL: string): string {
  if (provider?.requiresBaseURL && !baseURL.trim()) {
    return '测试或保存此可调用连接前请先填写 Base URL。'
  }
  return '可以刷新模型目录、测试连接或保存当前连接。'
}

function modelSearchText(model: string, metadata: DesktopModelMetadata | undefined): string {
  return [
    model,
    metadata?.name,
    metadata?.description,
    metadata?.modelsDevProviderId,
    metadata?.gatewayModelId,
    metadata?.modelType,
    ...(metadata?.tags ?? []),
    ...(metadata?.catalogSources ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
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
  if (metadata.modelsDevProviderId) parts.push(metadata.modelsDevProviderId)
  if (metadata.contextWindow) parts.push(`${formatCompactNumber(metadata.contextWindow)} ctx`)
  if (metadata.inputCost !== undefined && metadata.outputCost !== undefined) {
    parts.push(`$${metadata.inputCost}/$${metadata.outputCost}`)
  }
  const caps = formatCapabilities(metadata)
  if (caps) parts.push(caps)
  const sources = metadata.catalogSources?.join('+')
  if (sources) parts.push(sources)
  return parts.join(' / ')
}

function formatModelMetadata(metadata: DesktopModelMetadata): string {
  const parts = []
  if (metadata.contextWindow) parts.push(`上下文 ${formatCompactNumber(metadata.contextWindow)}`)
  if (metadata.outputTokens) parts.push(`输出 ${formatCompactNumber(metadata.outputTokens)}`)
  if (metadata.inputCost !== undefined && metadata.outputCost !== undefined) {
    parts.push(`价格 $${metadata.inputCost}/$${metadata.outputCost} 每 1M tokens`)
  }
  const caps = formatCapabilities(metadata)
  if (caps) parts.push(caps)
  if (metadata.catalogSources?.length) parts.push(`来源 ${metadata.catalogSources.join('+')}`)
  return parts.join(' / ')
}

function formatCapabilities(metadata: DesktopModelMetadata): string {
  return [
    metadata.reasoning ? '推理' : null,
    metadata.toolCall ? '工具调用' : null,
    metadata.structuredOutput ? '结构化输出' : null,
    metadata.vision ? '视觉' : null,
  ].filter(Boolean).join('、')
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
      ? 'DeepSeek 账户可用，但未返回余额详情。'
      : 'DeepSeek 账户当前不可用。'
  }
  const balanceText = result.balances
    .map(balance => `${balance.currency} ${balance.totalBalance}`)
    .join('；')
  return result.isAvailable
    ? `DeepSeek 账户可用。余额：${balanceText}`
    : `DeepSeek 余额不足或账户不可用：${balanceText}`
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void desktopClient.openExternalURL(event.currentTarget.href)
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return String(error ?? '发生未知错误。')
}
