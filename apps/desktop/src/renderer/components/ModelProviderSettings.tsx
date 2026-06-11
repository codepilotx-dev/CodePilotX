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

export function ModelProviderSettings(): React.ReactNode {
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
    setStatus('Refreshing model catalog...')
    try {
      const result = await window.desktopApi.fetchProviderModels({
        providerID,
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      applyFetchedModels(result.models, result.error)
      setModelError(result.error ?? null)
      setStatus(result.error ? null : `Loaded ${result.models.length} models.`)
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
      setModelError('This provider needs an OpenAI-compatible Base URL before testing.')
      return
    }
    if (isAIGateway && !apiKeyConfigured && !apiKey.trim()) {
      setModelError('Save the AI Gateway API key first, or set AI_GATEWAY_API_KEY.')
      return
    }
    setBusy(true)
    setModelError(null)
    setStatus('Testing connection...')
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
      setModelError(errors.length > 0 ? errors.join('; ') : null)
      setStatus(
        errors.length > 0
          ? null
          : isAIGateway
            ? `AI Gateway key configured. Catalog has ${modelsResult.models.length} language models.`
            : `Connection OK. Found ${modelsResult.models.length} models.`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function saveProvider(): Promise<void> {
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('This Models.dev provider needs a Base URL before saving as callable.')
      return
    }
    if (!model.trim()) {
      setModelError('Select a concrete model before saving.')
      return
    }
    setBusy(true)
    setModelError(null)
    try {
      const nextState = await window.desktopApi.saveModelProvider({
        providerID,
        modelID: model.trim(),
        baseURL: baseURL.trim() || undefined,
      })
      applyProviderState(nextState)
      setStatus('Model connection saved.')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } finally {
      setBusy(false)
    }
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) {
      setModelError('Enter an API key.')
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
      setStatus('API key saved.')
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

  const providerOptions = filteredProviderOptions.length
    ? filteredProviderOptions
    : [{ value: providerID, label: providerID }]
  const dropdownModelOptions = modelOptions.length
    ? modelOptions
    : [{ value: NO_MODEL_OPTION, label: 'No models loaded', detail: 'Refresh catalog first' }]
  const dropdownModelValue = modelOptions.some(option => option.value === model)
    ? model
    : dropdownModelOptions[0]?.value ?? NO_MODEL_OPTION

  return (
    <div className="settings-content-area">
      <div className="settings-content-inner">
        <h2 className="settings-page-title">高级配置</h2>
        <p className="settings-page-desc">
          配置桌面端新会话使用的模型供应商、模型、API key 和连接状态。
        </p>

        <section className="settings-hero-card">
          <div className="settings-hero-copy">
            <span className="settings-eyebrow">Current connection</span>
            <h3>{selectedProvider?.displayName ?? providerID}</h3>
            <p>
              {model || 'No model selected'} / {baseURL || 'No Base URL required'}
            </p>
          </div>
          <div className="settings-status-grid">
            <StatusPill label="API key" value={formatApiKeyState(apiKeySource, apiKeyConfigured)} tone={apiKeyConfigured ? 'ok' : 'warn'} />
            <StatusPill label="Kind" value={selectedProvider?.kind ?? 'openai-compatible'} />
            <StatusPill label="Source" value={selectedProvider?.gatewaySource ? 'AI Gateway' : selectedProvider?.modelsDevSource ? 'Models.dev' : 'Built-in'} />
          </div>
        </section>

        <SettingsSection
          title="Provider"
          description="AI Gateway exposes AI SDK supported language models. DeepSeek direct mode keeps its optimized path."
        >
          <SettingsRow
            title="Search"
            description="Filter by provider name, ID, or npm package."
            control={
              <input
                className="settings-input settings-input-wide"
                value={providerQuery}
                placeholder="Search provider..."
                onChange={event => setProviderQuery(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Provider"
            description={providerDescription(selectedProvider)}
            control={
              <SettingsDropdown
                ariaLabel="Model provider"
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
          title="Credentials"
          description="API keys are stored in secure storage. Environment variables take precedence."
        >
          <SettingsRow
            title="API key"
            description={apiKeySource ? `Current source: ${apiKeySource}` : providerEnvDescription(selectedProvider)}
            control={
              <div className="settings-inline-actions settings-secret-actions">
                <span className={`settings-chip ${apiKeyConfigured ? 'ok' : 'warn'}`}>
                  {formatApiKeyState(apiKeySource, apiKeyConfigured)}
                </span>
                <input
                  className="settings-input"
                  value={apiKey}
                  placeholder="Enter and save"
                  type="password"
                  onChange={event => setApiKey(event.target.value)}
                />
                <button
                  className="settings-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void saveApiKey()}
                >
                  Save
                </button>
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection
          title="Model"
          description={isAIGateway ? 'AI Gateway models use provider/model IDs, for example openai/gpt-4.1.' : 'Model metadata comes from Models.dev and live provider catalogs when available.'}
        >
          <SettingsRow
            title="Search models"
            description="Filter by provider, model, capability, context, price, source, or tag."
            control={
              <input
                className="settings-input settings-input-wide"
                value={modelQuery}
                placeholder="Search model / provider / capability..."
                onChange={event => setModelQuery(event.target.value)}
              />
            }
          />
          <SettingsRow
            title="Model"
            description={selectedModelDescription ?? 'Select a concrete model.'}
            control={
              <SettingsDropdown
                ariaLabel="Model"
                value={dropdownModelValue}
                options={dropdownModelOptions}
                onChange={value => {
                  if (value !== NO_MODEL_OPTION) setModel(value)
                }}
              />
            }
          />
          <SettingsRow
            title="Catalog"
            description={modelError ?? status ?? `Current catalog has ${providerModels.length} models.`}
            control={
              <button
                className="settings-button"
                disabled={busy}
                type="button"
                onClick={() => void fetchModels()}
              >
                Refresh catalog
              </button>
            }
          />
        </SettingsSection>

        {isDeepSeek ? (
          <SettingsSection title="DeepSeek Status" description="DeepSeek direct mode keeps balance checks, thinking parameters, and output-token optimizations.">
            <SettingsRow
              title="Account status"
              description={balanceStatus ?? 'Balance has not been checked yet.'}
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
                    Docs
                  </a>
                </div>
              }
            />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Connection test"
          description="Test current credentials and Base URL. Saved connections apply to new sessions."
        >
          <SettingsRow
            title="Actions"
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
                    Docs
                  </a>
                ) : null}
                <button
                  className="settings-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void testConnection()}
                >
                  Test connection
                </button>
                <button
                  className="settings-button primary"
                  disabled={busy}
                  type="button"
                  onClick={() => void saveProvider()}
                >
                  Save connection
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
  if (provider.providerID === 'ai-gateway') return 'AI SDK Gateway / full catalog'
  if (provider.gatewaySource && provider.modelsDevSource) return 'Gateway + Models.dev'
  if (provider.gatewaySource) return 'Gateway'
  if (provider.modelsDevSource) {
    return provider.requiresBaseURL ? 'Models.dev / needs Base URL' : 'Models.dev'
  }
  return 'Built-in'
}

function providerDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider) return 'Choose the provider used by new sessions.'
  if (provider.providerID === 'ai-gateway') {
    return 'Use AI SDK / Vercel AI Gateway as the unified runtime for supported language models.'
  }
  const parts = [provider.providerID]
  if (provider.npmPackage) parts.push(provider.npmPackage)
  if (provider.requiresBaseURL && !BUILT_IN_PROVIDER_IDS.has(provider.providerID)) {
    parts.push('needs Base URL')
  }
  return parts.join(' / ')
}

function baseURLDescription(
  provider: DesktopModelProviderSummary | undefined,
  isMiniMax: boolean,
): string {
  if (!provider) return 'Select a provider to show its default endpoint.'
  if (provider.providerID === 'ai-gateway') return 'AI Gateway uses its default unified endpoint.'
  if (provider.requiresBaseURL) return 'This Models.dev provider needs an OpenAI-compatible Base URL.'
  if (provider.providerID === 'deepseek') return 'DeepSeek uses the built-in OpenAI-compatible endpoint.'
  if (isMiniMax) return 'MiniMax uses the built-in Anthropic-compatible endpoint.'
  return 'The app manages the built-in provider Base URL.'
}

function providerEnvDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider?.envVars?.length) return 'No environment variable was detected.'
  return `Environment variables: ${provider.envVars.join(', ')}`
}

function connectionHint(provider: DesktopModelProviderSummary | undefined, baseURL: string): string {
  if (provider?.requiresBaseURL && !baseURL.trim()) {
    return 'Fill in Base URL before testing or saving this callable connection.'
  }
  return 'Refresh model catalog, test the connection, or save the current connection.'
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
  if (metadata.contextWindow) parts.push(`context ${formatCompactNumber(metadata.contextWindow)}`)
  if (metadata.outputTokens) parts.push(`output ${formatCompactNumber(metadata.outputTokens)}`)
  if (metadata.inputCost !== undefined && metadata.outputCost !== undefined) {
    parts.push(`price $${metadata.inputCost}/$${metadata.outputCost} per 1M tokens`)
  }
  const caps = formatCapabilities(metadata)
  if (caps) parts.push(caps)
  if (metadata.catalogSources?.length) parts.push(`source ${metadata.catalogSources.join('+')}`)
  return parts.join(' / ')
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
  if (!configured) return 'Not configured'
  if (source && source !== 'secureStorage') return 'From env var'
  return 'Configured'
}

function formatBalanceStatus(result: DesktopProviderBalanceResult): string {
  if (result.error) return result.error
  if (result.balances.length === 0) {
    return result.isAvailable
      ? 'DeepSeek account is available, but no balance details were returned.'
      : 'DeepSeek account is currently unavailable.'
  }
  const balanceText = result.balances
    .map(balance => `${balance.currency} ${balance.totalBalance}`)
    .join('; ')
  return result.isAvailable
    ? `DeepSeek account is available. Balance: ${balanceText}`
    : `DeepSeek balance is insufficient or account is unavailable: ${balanceText}`
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void window.desktopApi.openExternalURL(event.currentTarget.href)
}
