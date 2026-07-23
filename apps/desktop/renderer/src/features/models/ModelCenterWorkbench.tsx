
import { desktopClient } from '../../services/desktopClient.js'
import { withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderBalanceResult,
  ModelProviderID,
} from '../../../shared/types.js'
import { useDesktopSettings } from '../settings/useDesktopSettings.js'
import { SettingsDropdown } from '../settings/SettingsDropdown.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { fullErrorMessage } from '../../utils/errors.js'
import {
  Brain,
  Braces,
  Cable,
  Eye,
  Hammer,
  KeyRound,
  RefreshCw,
  Save,
  Search,
  Workflow,
} from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { useSearchParams } from 'react-router-dom'
import { ApiKeyWorkspace } from './ApiKeyWorkspace.js'
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from './ProviderCatalog.js'
import { ProviderDetail } from './ProviderDetail.js'
import { useModelCenterController } from './useModelCenterController.js'
import {
  parseModelCenterSearchParams,
  projectProviderDirectory,
  updateModelCenterSearchParams,
} from './modelCenterState.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'

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
  onNotice: (message: string) => void
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

export function ModelCenterWorkbench({
  onError,
  onNotice,
}: Props): React.ReactNode {
  const settings = useDesktopSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [modelQuery, setModelQuery] = useState('')
  const [baseURL, setBaseURL] = useState(settings.providerBaseURL)
  const [model, setModel] = useState(settings.model)
  const [variant, setVariant] = useState('')
  const [oauthInputs, setOauthInputs] = useState<Record<string, string>>({})
  const [oauthAttempt, setOauthAttempt] = useState<
    Awaited<ReturnType<typeof desktopClient.authorizeIntegration>>['attempt'] | null
  >(null)
  const [oauthCode, setOauthCode] = useState('')
  const [modelError, setModelError] = useState<string | null>(null)
  const [balanceStatus, setBalanceStatus] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')
  const [createKeyRequestToken, setCreateKeyRequestToken] = useState(0)
  const controller = useModelCenterController({
    onInitialProviderState: nextState => applyProviderState(nextState),
    onError: message => {
      setModelError(message)
      onError(message)
    },
  })
  const {
    providers,
    providerState,
    integrations,
    apiKeys,
    setProviderState,
    setApiKeys,
    refreshProviderContext,
  } = controller
  const routeState = useMemo(
    () => parseModelCenterSearchParams(
      searchParams,
      providers.map(provider => provider.providerID),
      providerID,
    ),
    [providerID, providers, searchParams],
  )
  const workspaceView = routeState.view
  const providerSection = routeState.section
  const selectedProvider = useMemo(
    () => providers.find(provider => provider.providerID === providerID),
    [providerID, providers],
  )
  const isDeepSeek = providerID === 'deepseek'
  const isMiniMax = providerID === 'minimax'
  const selectedIntegration = integrations.find(
    integration => integration.id === selectedProvider?.integrationID,
  )
  const oauthMethod = selectedIntegration?.methods.find(
    method => method.type === 'oauth',
  )
  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null
  const providerModels = (
    selectedProviderState?.models ?? selectedProvider?.defaultModels ?? []
  ).filter(item => item && item !== NO_MODEL_OPTION)
  const modelMetadata =
    selectedProviderState?.modelMetadata ?? selectedProvider?.modelMetadata ?? {}
  const modelVariants = modelMetadata[model]?.variants ?? []
  const orphanModelId = useMemo<string | null>(() => {
    if (!model) return null
    if (!providerModels.includes(model)) return model
    return null
  }, [model, providerModels])
  const requiresBaseURL = Boolean(selectedProvider?.requiresBaseURL)
  const baseURLEditable = requiresBaseURL
  const providerApiKeys = useMemo(
    () => apiKeys
      .filter(key => key.providerId === providerID)
      .sort((left, right) => left.priority - right.priority),
    [apiKeys, providerID],
  )
  const activeApiKey = providerApiKeys.find(key => key.active)
  const storedCredentialConfigured = providerApiKeys.some(key => key.enabled)
    || Boolean(selectedIntegration?.connections.some(connection => connection.type === 'credential'))
  const apiKeyConfigured = Boolean(selectedProviderState?.apiKeyConfigured)
    || storedCredentialConfigured
  const apiKeySource = selectedProviderState?.apiKeySource
    ?? (storedCredentialConfigured ? 'secureStorage' : null)
  const providerDirectory = useMemo(() => projectProviderDirectory(
    [...providers].sort((left, right) => left.displayName.localeCompare(
      right.displayName,
      'zh-CN',
      { numeric: true, sensitivity: 'base' },
    )),
    {
      query: providerSearch,
      currentProviderId: providerState?.selectedProviderID,
      currentProviderState: providerState,
      apiKeys,
      integrations,
    },
  ), [apiKeys, integrations, providerSearch, providerState, providers])
  const providerCatalogItems = useMemo<ProviderCatalogItem[]>(() => (
    providerDirectory.map(item => {
      const { connectionStatus, current, provider, sources } = item
      return {
        id: provider.providerID,
        name: provider.displayName,
        logoURL: provider.logoURL,
        source: sources.map(source => (
          source === 'gateway' ? 'Gateway' : source === 'models-dev' ? 'Models.dev' : '内置'
        )).join(' + '),
        modelCount: provider.defaultModels.length,
        current,
        status: {
          label: providerStatusLabel(connectionStatus),
          tone: connectionStatus === 'unconfigured' ? 'neutral' : 'positive',
        },
      }
    })
  ), [providerDirectory])
  const handleApiKeysChanged = useCallback((next: DesktopApiKeySummary[]) => {
    setApiKeys(next)
    void refreshProviderContext().catch(error => onError(fullErrorMessage(error)))
  }, [onError, refreshProviderContext, setApiKeys])

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setVariant('')
    setOauthAttempt(null)
    setOauthCode('')
    setOauthInputs({})
    setModelQuery('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  useEffect(() => {
    if (providers.length === 0 || !routeState.providerId) return
    const requestedProvider = providers.find(
      provider => provider.providerID === routeState.providerId,
    )
    if (requestedProvider && requestedProvider.providerID !== providerID) {
      applyProviderSelection(requestedProvider.providerID, requestedProvider)
    }
  }, [providerID, providers, routeState.providerId])

  function updateLocation(
    patch: {
      view?: 'providers' | 'keys'
      provider?: string | null
      section?: 'connection' | 'models' | 'router' | null
    },
    replace = false,
  ): void {
    setSearchParams(current => {
      return updateModelCenterSearchParams(current, {
        view: patch.view,
        providerId: patch.provider,
        section: patch.section,
      })
    }, { replace })
  }

  function selectProvider(nextProviderID: ModelProviderID): void {
    const nextProvider = providers.find(provider => provider.providerID === nextProviderID)
    applyProviderSelection(nextProviderID, nextProvider)
    updateLocation({ provider: nextProviderID, section: 'connection' })
  }

  function showProviderCatalog(): void {
    updateLocation({ provider: null, section: null })
  }

  function openApiKeys(create = false, nextProviderID = providerID): void {
    updateLocation({ view: 'keys', provider: nextProviderID })
    if (create) setCreateKeyRequestToken(value => value + 1)
  }

  async function refreshIntegrationState(): Promise<void> {
    const result = await refreshProviderContext()
    applyProviderState(result.providerState)
  }

  async function startOAuthAuthorization(): Promise<void> {
    if (!selectedIntegration || !oauthMethod) return
    setBusy(true)
    setModelError(null)
    setStatus('正在启动授权...')
    try {
      const result = await desktopClient.authorizeIntegration({
        integrationID: selectedIntegration.id,
        methodID: oauthMethod.id,
        inputs: oauthInputs,
      })
      setOauthAttempt(result.attempt)
      setStatus(result.attempt.instructions || '请在浏览器中完成授权。')
      void pollOAuthAuthorization(result.attempt.attemptID)
    } catch (error) {
      showOperationError(error)
      setBusy(false)
    }
  }

  async function completeOAuthAuthorization(): Promise<void> {
    if (!oauthAttempt || !oauthCode.trim()) return
    setBusy(true)
    setModelError(null)
    try {
      await desktopClient.completeIntegrationAuthorization({
        attemptID: oauthAttempt.attemptID,
        code: oauthCode.trim(),
      })
      setStatus('授权码已提交，正在确认连接状态...')
    } catch (error) {
      showOperationError(error)
      setBusy(false)
    }
  }

  async function pollOAuthAuthorization(
    attemptID: Awaited<ReturnType<typeof desktopClient.authorizeIntegration>>['attempt']['attemptID'],
  ): Promise<void> {
    for (let attempts = 0; attempts < 150; attempts += 1) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        const result = await desktopClient.getIntegrationAuthorizationStatus({
          attemptID,
        })
        if (result.status.status === 'pending') continue
        if (result.status.status === 'complete') {
          await refreshIntegrationState()
          setOauthAttempt(null)
          setOauthCode('')
          setStatus('授权连接已建立。')
          setBusy(false)
          return
        }
        const message =
          result.status.status === 'failed'
            ? result.status.message
            : '授权已过期，请重新开始。'
        setModelError(message)
        setStatus(null)
        setBusy(false)
        return
      } catch (error) {
        showOperationError(error)
        setBusy(false)
        return
      }
    }
    setModelError('等待授权超时，请重新开始。')
    setStatus(null)
    setBusy(false)
  }

  async function disconnectOAuth(): Promise<void> {
    if (!selectedIntegration) return
    const credentials = selectedIntegration.connections.filter(
      connection => connection.type === 'credential',
    )
    setBusy(true)
    setModelError(null)
    try {
      await Promise.all(
        credentials.map(connection =>
          desktopClient.disconnectIntegration({
            integrationID: selectedIntegration.id,
            credentialID: connection.id,
          }),
        ),
      )
      await refreshIntegrationState()
      setStatus('授权连接已断开。')
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider)
    setProviderID(nextProviderID)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setVariant('')
    setOauthAttempt(null)
    setOauthCode('')
    setOauthInputs({})
    setModelQuery('')
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }

  const filteredModelIds = useMemo(() => {
    const query = modelQuery.trim().toLowerCase()
    return providerModels.filter(item => {
      if (!query) return true
      const metadata = modelMetadata[item]
      return modelSearchText(item, metadata).includes(query)
    })
  }, [modelMetadata, modelQuery, providerModels])

	function applyProviderState(
  nextState: DesktopModelProviderState,
  options: { persistEffectiveSettings?: boolean } = {},
): void {
    const nextModel =
      nextState.model ||
      nextState.models[0] ||
      nextState.provider.defaultModels[0] ||
      ''
    setProviderState(nextState)
    setProviderID(nextState.selectedProviderID)
    setBaseURL(nextState.baseURL ?? '')
    setModel(nextModel)
    setVariant(nextState.variant ?? '')
    if (options.persistEffectiveSettings) {
      settings.syncExternalSettingsPatch({
        providerID: nextState.selectedProviderID,
        providerBaseURL: nextState.baseURL ?? '',
        model: nextModel,
        selectedModelPreset: nextModel,
      })
    }
    settings.draft.setValue('providerID', nextState.selectedProviderID)
    settings.draft.setValue('providerBaseURL', nextState.baseURL ?? '')
    settings.draft.setValue('model', nextModel)
  }

  function applyFetchedModels(
    models: string[],
    error?: string,
    fetchedMetadata?: Record<string, DesktopModelMetadata>,
  ): void {
    const cleanModels = models.filter(Boolean)
    setProviderState(current => {
      if (current && current.selectedProviderID === providerID) {
        return {
          ...current,
          models: cleanModels,
          modelMetadata: { ...current.modelMetadata, ...fetchedMetadata },
          error,
        }
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
        modelMetadata: { ...modelMetadata, ...fetchedMetadata },
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
      const result = await withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
          baseURL: baseURL.trim() || undefined,
        }),
      )
      applyFetchedModels(result.models, result.error, result.modelMetadata)
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
      const testRequest = desktopClient.testModelProvider(providerID)
      const [testResult, balanceResult] = isDeepSeek
        ? await Promise.all([testRequest, fetchBalance()])
        : [await testRequest, null]
      const errors = [
        testResult.ok ? null : testResult.message ?? '连接测试失败。',
        balanceResult?.error,
      ].filter(
        (item): item is string => Boolean(item),
      )
      setModelError(errors.length > 0 ? errors.join('；') : null)
      setStatus(
        errors.length > 0
          ? null
          : testResult.message ?? '连接正常。',
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
        id: model.trim(),
        variant: variant || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      applyProviderState(nextState, { persistEffectiveSettings: true })
      setStatus('模型连接已保存。')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function selectActiveApiKey(credentialId: string): Promise<void> {
    setBusy(true)
    try {
      await desktopClient.setActiveApiKey(providerID, credentialId)
      const [nextKeys, nextState] = await Promise.all([
        desktopClient.listApiKeys(),
        desktopClient.getModelProviderState(),
      ])
      setApiKeys(nextKeys)
      applyProviderState(nextState)
      setStatus('当前 API Key 已切换。')
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

  const showingProviderDetail = workspaceView === 'providers' && routeState.providerId !== null
  const pageTitle = workspaceView === 'keys'
    ? '管理 API Keys'
    : showingProviderDetail
      ? selectedProvider?.displayName ?? providerID
      : '配置模型 Provider'
  const pageDescription = workspaceView === 'keys'
    ? '集中管理模型 Provider 的命名密钥、优先级与健康状态。'
    : showingProviderDetail
      ? providerDescription(selectedProvider)
      : '选择 Provider，配置连接、模型与 Router。'

  return (
    <div className="model-center-shell">
      <WorkspaceHeaderItem
        align="start"
        id="models.tabs"
        order={0}
        slot="left"
      >
        <SegmentedControl<'providers' | 'keys'>
          ariaLabel="模型中心工作区"
          className="model-center-workspace-tabs"
          onChange={view => updateLocation({ view })}
          overflowMode="fit"
          options={[
            { value: 'providers', label: 'Provider' },
            {
              value: 'keys',
              label: <>API Keys <span>{apiKeys.length}</span></>,
            },
          ]}
          semantics="tabs"
          value={workspaceView}
        />
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem
        align="end"
        id="models.actions"
        order={100}
        slot="right"
      >
        <div className="model-center-header-actions">
          {workspaceView === 'providers' && !showingProviderDetail ? (
            <Button
              aria-label="添加 API Key"
              onClick={() => openApiKeys(true)}
              title="添加 API Key"
              variant="primary"
            >
              <KeyRound aria-hidden />
              <span className="model-center-header-action-label">添加 API Key</span>
            </Button>
          ) : null}
          {showingProviderDetail && providerSection === 'connection' ? (
            <>
              <Button
                aria-label="测试连接"
                disabled={busy}
                onClick={() => void testConnection()}
                title="测试连接"
              >
                <Cable aria-hidden />
                <span className="model-center-header-action-label">测试连接</span>
              </Button>
              <Button
                aria-label="保存连接"
                disabled={busy}
                onClick={() => void saveProvider()}
                title="保存连接"
                variant="primary"
              >
                <Save aria-hidden />
                <span className="model-center-header-action-label">保存连接</span>
              </Button>
            </>
          ) : null}
          {showingProviderDetail && providerSection === 'models' ? (
            <>
              <Button
                aria-label="刷新目录"
                disabled={busy}
                onClick={() => void fetchModels()}
                title="刷新目录"
              >
                <RefreshCw aria-hidden />
                <span className="model-center-header-action-label">刷新目录</span>
              </Button>
              <Button
                aria-label="保存模型"
                disabled={busy || !model}
                onClick={() => void saveProvider()}
                title="保存模型"
                variant="primary"
              >
                <Save aria-hidden />
                <span className="model-center-header-action-label">保存模型</span>
              </Button>
            </>
          ) : null}
        </div>
      </WorkspaceHeaderItem>

      {!showingProviderDetail ? (
        <header className="model-center-heading">
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </header>
      ) : null}

      {workspaceView === 'providers' ? (
        showingProviderDetail ? (
          <ProviderDetail
            activeTab={providerSection}
            feedback={modelError ?? status}
            provider={{
              id: providerID,
              name: selectedProvider?.displayName ?? providerID,
              logoURL: selectedProvider?.logoURL,
              description: providerDescription(selectedProvider),
              status: {
                label: formatApiKeyState(apiKeySource, apiKeyConfigured),
                tone: apiKeyConfigured ? 'positive' : 'warning',
              },
            }}
            onBack={showProviderCatalog}
            onTabChange={section => {
              setModelError(null)
              setStatus(null)
              updateLocation({ section }, true)
            }}
          >

            {providerSection === 'connection' ? (
              <div className="model-center-detail-body">
                {!oauthMethod ? (
                  <section className="model-center-detail-section">
                    <header className="model-center-detail-section-heading"><div><h3>Endpoint</h3><p>{baseURLDescription(selectedProvider, isMiniMax)}</p></div><span>{baseURLEditable ? '自定义' : '目录提供'}</span></header>
                    <label className="model-center-detail-field"><span>Base URL</span><Input className="model-center-mono" readOnly={!baseURLEditable} value={baseURL} placeholder={selectedProvider?.baseURL ?? 'https://.../v1'} onChange={event => setBaseURL(event.target.value)} /></label>
                  </section>
                ) : null}

                <section className="model-center-detail-section">
                  <header className="model-center-detail-section-heading"><div><h3>{oauthMethod ? oauthMethod.label : 'API Key'}</h3><p>{oauthMethod ? '完成授权并管理当前连接。' : '选择用于当前 Provider 的活动密钥。'}</p></div><span data-tone={apiKeyConfigured ? 'success' : 'warning'}>{apiKeyConfigured ? (oauthMethod ? '已授权' : '已配置') : '未配置'}</span></header>
                  {oauthMethod && selectedIntegration ? (
                    <div className="model-center-auth-fields">
                      {oauthMethod.prompts?.filter(prompt => {
                        if (!prompt.when) return true
                        const matches = oauthInputs[prompt.when.key] === prompt.when.value
                        return prompt.when.op === 'eq' ? matches : !matches
                      }).map(prompt => (
                        <label className="model-center-detail-field" key={prompt.key}>
                          <span>{prompt.message}</span>
                          {prompt.type === 'select' ? (
                            <SettingsDropdown width={340} ariaLabel={prompt.message} value={oauthInputs[prompt.key] ?? ''} options={prompt.options.map(option => ({ value: option.value, label: option.label, detail: option.hint }))} onChange={value => setOauthInputs(current => ({ ...current, [prompt.key]: value }))} />
                          ) : (
                            <Input value={oauthInputs[prompt.key] ?? ''} placeholder={prompt.placeholder} onChange={event => setOauthInputs(current => ({ ...current, [prompt.key]: event.target.value }))} />
                          )}
                        </label>
                      ))}
                      <div className="model-center-inline-actions">
                        <Button disabled={busy} onClick={() => void startOAuthAuthorization()}>{apiKeyConfigured ? '重新授权' : '开始授权'}</Button>
                        <Button tone="danger" disabled={busy || !apiKeyConfigured} onClick={() => void disconnectOAuth()}>断开</Button>
                      </div>
                      {oauthAttempt ? (
                        <div className="model-center-oauth-attempt">
                          <p>{oauthAttempt.instructions}</p>
                          {oauthAttempt.url ? <a href={oauthAttempt.url} rel="noreferrer" target="_blank" onClick={openExternalLink}>打开授权页面</a> : null}
                          {oauthAttempt.mode === 'code' ? <div className="model-center-inline-actions"><Input className="model-center-mono" value={oauthCode} placeholder="输入授权返回码" onChange={event => setOauthCode(event.target.value)} /><Button disabled={!oauthCode.trim()} onClick={() => void completeOAuthAuthorization()}>提交</Button></div> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="model-center-detail-key-row">
                      {providerApiKeys.length > 0 ? (
                        <SettingsDropdown width={360} ariaLabel="当前 API Key" value={activeApiKey?.id ?? ''} options={providerApiKeys.filter(key => key.enabled).map(key => ({ value: key.id, label: key.label + ' · ' + key.maskedValue, detail: formatApiKeyHealth(key) }))} onChange={value => void selectActiveApiKey(value)} />
                      ) : <p>尚未保存应用内 API Key；没有可用密钥时仍会使用现有环境变量。</p>}
                      <div className="model-center-inline-actions"><Button onClick={() => openApiKeys(true)}>添加 Key</Button><Button variant="ghost" onClick={() => openApiKeys()}>管理 Keys</Button></div>
                    </div>
                  )}
                </section>

                {isDeepSeek ? (
                  <section className="model-center-detail-section">
                    <header className="model-center-detail-section-heading"><div><h3>DeepSeek 账户</h3><p>{balanceStatus ?? '测试连接时会同步查询余额。'}</p></div><div className="model-center-detail-links"><a href="https://platform.deepseek.com/api_keys" onClick={openExternalLink} rel="noreferrer" target="_blank">API 密钥</a><a href="https://api-docs.deepseek.com/" onClick={openExternalLink} rel="noreferrer" target="_blank">文档</a></div></header>
                  </section>
                ) : null}
                {selectedProvider?.docURL ? <div className="model-center-detail-links"><a href={selectedProvider.docURL} onClick={openExternalLink} rel="noreferrer" target="_blank">查看 Provider 文档</a></div> : null}
              </div>
            ) : null}

            {providerSection === 'models' ? (
              <div className="model-center-detail-body">
                <div className="model-center-model-toolbar"><label className="model-center-search"><Search aria-hidden /><input value={modelQuery} placeholder="搜索模型、能力或目录来源" onChange={event => setModelQuery(event.target.value)} /></label></div>
                <div className="model-center-model-grid-wrapper">
                  {providerModels.length === 0 ? <div className="model-center-empty-state">暂无模型目录，请先刷新目录。</div> : filteredModelIds.length === 0 && !orphanModelId ? <div className="model-center-empty-state">{modelQuery.trim() ? '未搜索到匹配“' + modelQuery + '”的模型。' : '当前 Provider 暂无可用模型。'}</div> : (
                    <div className="model-card-grid">
                      {orphanModelId ? <ModelCard modelId={orphanModelId} metadata={modelMetadata[orphanModelId]} isSelected={orphanModelId === model} onSelect={id => { setModel(id); setVariant('') }} isOrphan /> : null}
                      {filteredModelIds.map(id => <ModelCard key={id} modelId={id} metadata={modelMetadata[id]} isSelected={id === model} onSelect={nextModel => { setModel(nextModel); setVariant('') }} />)}
                    </div>
                  )}
                </div>
                {modelVariants.length > 0 ? <section className="model-center-detail-section"><header className="model-center-detail-section-heading"><div><h3>模型变体</h3><p>选择当前模型声明的原生请求变体。</p></div><SettingsDropdown width={280} ariaLabel="模型变体" value={variant} options={[{ value: '', label: '默认变体' }, ...modelVariants.map(id => ({ value: id, label: id }))]} onChange={setVariant} /></header></section> : null}
              </div>
            ) : null}

            {providerSection === 'router' ? (
              <div className="model-center-detail-body">
                <div className="model-center-router-list">
                  <article className="model-center-router-row"><span><Workflow aria-hidden /></span><div><h3>Pareto Code Router</h3><p>发送消息时在本地为任务选择最合适的模型。</p></div><ToggleSwitch checked={settings.draft.values.enableParetoCodeRouter ?? false} onChange={checked => { settings.draft.setValue('enableParetoCodeRouter', checked); settings.draft.autoSave() }} ariaLabel="启用 Pareto Code Router" /></article>
                  <article className="model-center-router-row"><span><Braces aria-hidden /></span><div><h3>Fusion Router</h3><p>在会话中启用多模型并行会审入口。</p></div><ToggleSwitch checked={settings.draft.values.enableFusionRouter ?? false} onChange={checked => { settings.draft.setValue('enableFusionRouter', checked); settings.draft.autoSave() }} ariaLabel="启用 Fusion Router" /></article>
                </div>
              </div>
            ) : null}
          </ProviderDetail>
        ) : (
          <ProviderCatalog
            providers={providerCatalogItems}
            query={providerSearch}
            onAddKey={nextProviderID => {
              applyProviderSelection(
                nextProviderID,
                providers.find(provider => provider.providerID === nextProviderID),
              )
              openApiKeys(true, nextProviderID)
            }}
            onQueryChange={setProviderSearch}
            onSelect={selectProvider}
          />
        )
      ) : (
        <ApiKeyWorkspace providers={providers.filter(provider => {
          const integration = integrations.find(item => item.id === provider.integrationID)
          return !integration?.methods.some(method => method.type === 'oauth')
        })} keys={apiKeys} selectedProviderId={providerID} createRequestToken={createKeyRequestToken} onSelectedProviderIdChange={selectProvider} onChanged={handleApiKeysChanged} onError={onError} onNotice={onNotice} />
      )}
    </div>
  )
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

function providerStatusLabel(
  status: 'stored-key' | 'oauth' | 'environment' | 'configured' | 'unconfigured',
): string {
  if (status === 'stored-key') return '已保存 Key'
  if (status === 'oauth') return 'OAuth 已连接'
  if (status === 'environment') return '环境变量'
  if (status === 'configured') return '已配置'
  return '未配置'
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

function ModelCard({
  modelId,
  metadata,
  isSelected,
  onSelect,
  isOrphan,
}: {
  modelId: string
  metadata: DesktopModelMetadata | undefined
  isSelected: boolean
  onSelect: (model: string) => void
  isOrphan?: boolean
}): React.ReactNode {
  const displayName = metadata?.name || modelId

  const metaParts: string[] = []
  if (metadata?.contextWindow) metaParts.push(`${formatCompactNumber(metadata.contextWindow)} 上下文`)
  if (metadata?.outputTokens) metaParts.push(`${formatCompactNumber(metadata.outputTokens)} 输出`)
  if (metadata?.inputCost !== undefined && metadata?.outputCost !== undefined) {
    metaParts.push(`$${metadata.inputCost}/${metadata.outputCost}/M`)
  }

  const caps = ([
    metadata?.reasoning ? { key: 'reasoning', icon: Brain, label: '推理' } : null,
    metadata?.toolCall ? { key: 'toolCall', icon: Hammer, label: '工具' } : null,
    metadata?.structuredOutput ? { key: 'structured', icon: Braces, label: '结构化' } : null,
    metadata?.vision ? { key: 'vision', icon: Eye, label: '视觉' } : null,
  ].filter(Boolean) as { key: string; icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>; label: string }[])

  return (
    <button
      className={`model-card${isSelected ? ' selected' : ''}${isOrphan ? ' orphan' : ''}`}
      onClick={() => onSelect(modelId)}
      type="button"
    >
      <div className="model-card-header">
        <div className="model-card-name" title={displayName || modelId}>
          {displayName || modelId}
        </div>
        <div className="model-card-id" title={modelId}>
          {modelId}
        </div>
      </div>
      {metaParts.length > 0 && (
        <div className="model-card-meta">
          {metaParts.map((part, i) => (
            <span key={i}>{part}</span>
          ))}
        </div>
      )}
      {caps.length > 0 && (
        <div className="model-card-tags">
          {caps.map(cap => {
            const Icon = cap.icon
            return (
              <span key={cap.key} className="model-card-tag">
                <Icon aria-hidden className="model-card-tag-icon" />
                {cap.label}
              </span>
            )
          })}
        </div>
      )}
      {isOrphan && (
        <div className="model-card-orphan-label">当前保存</div>
      )}
    </button>
  )
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
  return source === 'secureStorage' ? '已配置' : '环境变量'
}

function formatApiKeyHealth(key: DesktopApiKeySummary): string {
  if (key.health.status === 'healthy') return key.active ? '当前 · 健康' : '备用 · 健康'
  if (key.health.status === 'auth-failed') return '鉴权失败'
  if (key.health.status === 'rate-limited') return '限流冷却中'
  if (key.health.status === 'error') return '测试异常'
  return '未测试'
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
