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
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import { fullErrorMessage } from '../utils/errors.js'

const BUILT_IN_PROVIDER_IDS = new Set([
  'openai',
  'openrouter',
  'deepseek',
  'minimax',
  'groq',
])

const NO_MODEL_OPTION = '__no_models_available__'

type Props = {
  onError: (message: string) => void
}

export function getProviderSelectionState(
  provider: DesktopModelProviderSummary | undefined,
): { baseURL: string; model: string } {
  return {
    baseURL: provider?.baseURL ?? '',
    model: provider?.defaultModels[0] ?? '',
  }
}

export function getProviderConnectionState({
  provider,
  model,
  providerModels,
  baseURL,
  baseURLEditable,
}: {
  provider: DesktopModelProviderSummary | undefined
  model: string
  providerModels: string[]
  baseURL: string
  baseURLEditable: boolean
}): { baseURL: string; model: string } {
  const defaultSelection = getProviderSelectionState(provider)
  return {
    baseURL: baseURLEditable ? baseURL : defaultSelection.baseURL,
    model: providerModels.includes(model) ? model : defaultSelection.model,
  }
}

export function ModelConnectionSettings({ onError }: Props): React.ReactNode {
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
        const message = fullErrorMessage(error)
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
  const baseURLEditable = requiresBaseURL
  const apiKeySource = selectedProviderState?.apiKeySource ?? null
  const apiKeyConfigured = Boolean(selectedProviderState?.apiKeyConfigured)

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setModelQuery('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider)
    setProviderID(nextProviderID)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setModelQuery('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }

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
      icon: modelMetadata[item]?.iconURL ? (
        <img className="settings-provider-logo" src={modelMetadata[item]?.iconURL} alt="" />
      ) : undefined,
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
        modelConfigured: false,
        configurationMessage: '未配置模型，请先在设置中配置模型。',
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
      const nextConnection = getProviderConnectionState({
        provider: selectedProvider,
        model,
        providerModels,
        baseURL,
        baseURLEditable,
      })
      setProviderState(current => {
        if (current && current.selectedProviderID === providerID) {
          return {
            ...current,
            model: nextConnection.model,
            baseURL: nextConnection.baseURL,
            apiKeyConfigured: true,
            apiKeySource: nextState.apiKeySource ?? 'secureStorage',
            modelConfigured: Boolean(nextConnection.model),
            configurationMessage: nextConnection.model
              ? undefined
              : '未配置模型，请先在设置中选择模型。',
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
          model: nextConnection.model,
          baseURL: nextConnection.baseURL,
          apiKeyConfigured: true,
          apiKeySource: nextState.apiKeySource ?? 'secureStorage',
          modelConfigured: Boolean(nextConnection.model),
          configurationMessage: nextConnection.model
            ? undefined
            : '未配置模型，请先在设置中选择模型。',
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

  async function clearApiKey(): Promise<void> {
    if (!apiKeyConfigured) return
    setBusy(true)
    setModelError(null)
    try {
const nextState = await desktopClient.deleteProviderApiKey(providerID)
      setApiKey('')
      setProviderState(current => {
        if (current && current.selectedProviderID === providerID) {
          return {
            ...current,
            apiKeyConfigured: false,
            apiKeySource: nextState.apiKeySource,
            modelConfigured: false,
            configurationMessage: '未配置模型，请先在设置中配置模型。',
            provider: {
              ...current.provider,
              apiKeyConfigured: false,
            },
          }
        }
        if (!selectedProvider) return current
        return {
          selectedProviderID: providerID,
          provider: {
            ...selectedProvider,
            apiKeyConfigured: false,
          },
          model,
          baseURL,
          apiKeyConfigured: false,
          apiKeySource: nextState.apiKeySource,
          modelConfigured: false,
          configurationMessage: '未配置模型，请先在设置中配置模型。',
          models: providerModels,
          modelMetadata,
        }
      })
      setStatus('API 密钥已删除。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  function showOperationError(error: unknown): void {
    const message = fullErrorMessage(error)
    setModelError(message)
    setStatus(null)
    onError(message)
  }

  const providerOptions = filteredProviderOptions.length
    ? filteredProviderOptions
    : [
        {
          value: NO_MODEL_OPTION,
          label: providers.length ? '无匹配供应商' : '未加载供应商',
          detail: providers.length ? '请调整搜索条件' : '请检查 catalog 网络连接',
        },
      ]
  const dropdownModelOptions = modelOptions.length
    ? modelOptions
    : [{ value: NO_MODEL_OPTION, label: '未加载模型', detail: '请先刷新目录' }]
  const dropdownModelValue = modelOptions.some(option => option.value === model)
    ? model
    : dropdownModelOptions[0]?.value ?? NO_MODEL_OPTION
  const taskModelOptions = useMemo(
    () => buildTaskModelOptions(modelOptions, model),
    [model, modelOptions],
  )

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">模型链接</h2>
        <p className="settings-page-desc">
          管理模型供应商、模型、API key、Base URL 和连接状态。已有会话会继续使用创建时保存的配置快照。
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
            <StatusPill label="来源" value={selectedProvider?.modelsDevSource ? 'Models.dev' : '内置'} />
          </div>
        </section>

        <SettingsSection
          title="供应商"
          description="选择新会话使用的模型供应商；DeepSeek 直连模式保留其优化路径。"
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
                onChange={value => {
                  if (value === NO_MODEL_OPTION) return
                  const nextProviderID = value as ModelProviderID
                  const nextProvider = providers.find(
                    provider => provider.providerID === nextProviderID,
                  )
                  applyProviderSelection(nextProviderID, nextProvider)
                }}
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
                <button
                  className="settings-button settings-button-danger"
                  disabled={busy || !apiKeyConfigured}
                  type="button"
                  onClick={() => void clearApiKey()}
                >
                  删除
                </button>
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="模型"
          description="模型元数据来自 Models.dev、供应商实时目录以及模型图标目录（如可用）。"
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

        <SettingsSection
          title="任务模型"
          description="这些模型对应 Claude 原版的快速、Haiku、Sonnet、Opus 四个任务入口；留空时会使用上面的会话主模型。"
        >
          <SettingsRow
            title="快速模型"
            description="用于标题、摘要、Hook、检索等轻量辅助任务；未配置时使用主模型。"
            control={
              <SettingsDropdown
                ariaLabel="快速任务模型"
                value={taskModelValue(settings.smallFastModel, taskModelOptions)}
                options={taskModelOptions}
                onChange={settings.setSmallFastModel}
              />
            }
          />
          <SettingsRow
            title="Haiku 角色模型"
            description="用于原 Haiku 角色入口；未配置时使用主模型。"
            control={
              <SettingsDropdown
                ariaLabel="Haiku 角色模型"
                value={taskModelValue(settings.haikuModel, taskModelOptions)}
                options={taskModelOptions}
                onChange={settings.setHaikuModel}
              />
            }
          />
          <SettingsRow
            title="Sonnet 角色模型"
            description="用于原 Sonnet 角色入口；未配置时使用主模型。"
            control={
              <SettingsDropdown
                ariaLabel="Sonnet 角色模型"
                value={taskModelValue(settings.sonnetModel, taskModelOptions)}
                options={taskModelOptions}
                onChange={settings.setSonnetModel}
              />
            }
          />
          <SettingsRow
            title="Opus 角色模型"
            description="用于原 Opus 角色入口；未配置时使用主模型。"
            control={
              <SettingsDropdown
                ariaLabel="Opus 角色模型"
                value={taskModelValue(settings.opusModel, taskModelOptions)}
                options={taskModelOptions}
                onChange={settings.setOpusModel}
              />
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
  if (provider.gatewaySource && provider.modelsDevSource) return 'Gateway + Models.dev'
  if (provider.gatewaySource) return 'Gateway'
  if (provider.modelsDevSource) {
    return provider.requiresBaseURL ? 'Models.dev / 需要 Base URL' : 'Models.dev'
  }
  return '内置'
}

function providerDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider) return '选择新会话使用的供应商。'
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
  if (provider.requiresBaseURL) return '该供应商需要兼容 OpenAI 的 Base URL。'
  if (provider.providerID === 'deepseek') return 'DeepSeek 使用内置的 OpenAI 兼容 endpoint。'
  if (isMiniMax) return 'MiniMax 使用内置的 Anthropic 兼容 endpoint。'
  return 'Base URL 来自 Models.dev catalog。'
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

function buildTaskModelOptions(
  modelOptions: Array<{ value: string; label: string; detail?: string }>,
  mainModel: string,
): Array<{ value: string; label: string; detail?: string }> {
  const inheritedLabel = mainModel ? `使用主模型 (${mainModel})` : '使用主模型'
  return [
    {
      value: '',
      label: inheritedLabel,
      detail: '不单独配置时，运行时会继承会话主模型。',
    },
    ...modelOptions,
  ]
}

function taskModelValue(
  value: string,
  options: Array<{ value: string; label: string; detail?: string }>,
): string {
  if (!value) return ''
  return options.some(option => option.value === value) ? value : ''
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
