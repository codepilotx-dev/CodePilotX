
import { desktopClient } from '../../services/desktop-client/index.js'
import { withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
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
  RefreshCw,
  Save,
  Workflow,
} from 'lucide-react'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  SkeletonBlock,
  SkeletonRegion,
} from '../../components/ui/Skeleton.js'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import { ProviderConnectionDialog } from './provider-management/ProviderConnectionDialog.js'
import type { ApiKeyEditorValue } from './ApiKeyEditorDialog.js'
import {
  providerManagementStore,
  selectConfiguredProviderGroups,
  type ConfiguredProviderGroup,
} from '../provider-management/index.js'

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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [modelQuery, setModelQuery] = useState('')
  const [baseURL, setBaseURL] = useState(settings.providerBaseURL)
  const [model, setModel] = useState(settings.model)
  const [variant, setVariant] = useState('')
  const [modelError, setModelError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')
  const [connectionDialogProviderId, setConnectionDialogProviderId] =
    useState<ModelProviderID | null>(null)
  const controller = useModelCenterController({
    onInitialProviderState: nextState => applyProviderState(nextState),
    onError: message => {
      setModelError(message)
      onError(message)
    },
  })
  const {
    initialLoadState,
    providers,
    providerState,
    integrations,
    apiKeys,
    snapshot,
    setProviderState,
  } = controller
  const configuredGroups = useMemo(
    () => selectConfiguredProviderGroups(snapshot),
    [snapshot],
  )
  const configuredProviderIds = useMemo(
    () => new Set(configuredGroups.map(group => group.provider.providerID)),
    [configuredGroups],
  )
  const configuredGroupByProvider = useMemo(
    () => new Map(
      configuredGroups.map(group => [group.provider.providerID, group]),
    ),
    [configuredGroups],
  )
  const requestedView = searchParams.get('view') === 'keys' ? 'keys' : 'providers'
  const requestedProvider = searchParams.get('provider')
  const requestedSection = searchParams.get('section')
  const initialSkeletonSection =
    requestedSection === 'models' || requestedSection === 'router'
      ? requestedSection
      : 'connection'
  const showInitialSkeleton =
    initialLoadState === 'loading' && providers.length === 0
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
  const isMiniMax = providerID === 'minimax'
  const selectedIntegration = integrations.find(
    integration => integration.id === selectedProvider?.integrationID,
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
  const storedCredentialConfigured = providerApiKeys.length > 0
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
      const effectiveConnectionStatus =
        connectionStatus === 'unconfigured'
        && configuredProviderIds.has(provider.providerID)
          ? 'configured'
          : connectionStatus
      const displayedStatus = providerCatalogConnectionStatus(
        effectiveConnectionStatus,
        configuredGroupByProvider.get(provider.providerID),
      )
      return {
        id: provider.providerID,
        name: provider.displayName,
        logoURL: provider.logoURL,
        source: sources.map(source => (
          source === 'gateway' ? 'Gateway' : source === 'models-dev' ? 'Models.dev' : '内置'
        )).join(' + '),
        modelCount: provider.defaultModels.length,
        current,
        canAddConnection: effectiveConnectionStatus === 'unconfigured',
        status: displayedStatus,
      }
    })
  ), [configuredGroupByProvider, configuredProviderIds, providerDirectory])

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setVariant('')
    setModelQuery('')
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

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider)
    setProviderID(nextProviderID)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setVariant('')
    setModelQuery('')
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

  async function testConnection(): Promise<void> {
    if (requiresBaseURL && !baseURL.trim()) {
      setModelError('测试前请为该供应商配置兼容 OpenAI 的 Base URL。')
      return
    }
    setBusy(true)
    setModelError(null)
    setStatus('正在测试连接...')
    try {
      const testResult = await desktopClient.testModelProvider(providerID)
      const errors = [
        testResult.ok ? null : testResult.message ?? '连接测试失败。',
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

  async function createProviderConnection(
    value: ApiKeyEditorValue,
  ): Promise<boolean> {
    if (!value.key) return false
    setBusy(true)
    try {
      await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      })
      setStatus('连接已安全保存。')
      setConnectionDialogProviderId(null)
      updateLocation({ view: 'keys', provider: value.providerId })
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      showOperationError(error)
      return false
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
    ? '账户连接'
    : showingProviderDetail
      ? selectedProvider?.displayName ?? providerID
      : '供应商'
  const pageDescription = workspaceView === 'keys'
    ? '按供应商统一管理推理 Key、OAuth、订阅与独立账务凭据。'
    : showingProviderDetail
      ? providerDescription(selectedProvider)
      : '浏览供应商目录，配置 Endpoint、模型与 Router。'
  const connectionDialogProvider = connectionDialogProviderId
    ? providers.find(provider => provider.providerID === connectionDialogProviderId) ?? null
    : null
  const connectionDialogIntegration = integrations.find(integration =>
    integration.id === connectionDialogProvider?.integrationID
  )
  const connectionDialogSources = snapshot.usageSources.filter(source =>
    source.providerIds.some(providerId =>
      String(providerId) === String(connectionDialogProviderId)
    )
  )
  const selectedConfiguredGroup = configuredGroups.find(
    group => group.provider.providerID === providerID,
  )
  const connectionSummary = providerConnectionSummary({
    apiKeySource,
    integration: selectedIntegration,
    providerKeys: providerApiKeys,
    group: selectedConfiguredGroup,
  })

  return (
    <div className="model-center-shell">
      <WorkspaceHeaderItem
        align="start"
        id="models.tabs"
        order={0}
        slot="left"
      >
        <SegmentedControl<'providers' | 'keys'>
          ariaLabel="供应商与账户连接工作区"
          className="model-center-workspace-tabs"
          onChange={view => updateLocation({ view })}
          overflowMode="fit"
            options={[
            { value: 'providers', label: '供应商' },
            {
              value: 'keys',
              label: <>账户连接 <span>{configuredGroups.length}</span></>,
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
          {!showInitialSkeleton && showingProviderDetail && providerSection === 'connection' ? (
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
              >
                <Save aria-hidden />
                <span className="model-center-header-action-label">保存连接</span>
              </Button>
            </>
          ) : null}
          {!showInitialSkeleton && showingProviderDetail && providerSection === 'models' ? (
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
              >
                <Save aria-hidden />
                <span className="model-center-header-action-label">保存模型</span>
              </Button>
            </>
          ) : null}
        </div>
      </WorkspaceHeaderItem>

      {!showInitialSkeleton && !showingProviderDetail ? (
        <header className="model-center-heading">
          <h1>{pageTitle}</h1>
          <p>{pageDescription}</p>
        </header>
      ) : null}

      {showInitialSkeleton ? (
        <ModelCenterInitialSkeleton
          section={initialSkeletonSection}
          view={requestedView === 'keys'
            ? 'keys'
            : requestedProvider
              ? 'detail'
              : 'catalog'}
        />
      ) : workspaceView === 'providers' ? (
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
                <section className="model-center-detail-section">
                  <header className="model-center-detail-section-heading"><div><h3>Endpoint</h3><p>{baseURLDescription(selectedProvider, isMiniMax)}</p></div><span>{baseURLEditable ? '自定义' : '目录提供'}</span></header>
                  <label className="model-center-detail-field"><span>Base URL</span><Input className="model-center-mono" readOnly={!baseURLEditable} value={baseURL} placeholder={selectedProvider?.baseURL ?? 'https://.../v1'} onChange={event => setBaseURL(event.target.value)} /></label>
                </section>

                <section className="model-center-detail-section">
                  <header className="model-center-detail-section-heading">
                    <div>
                      <h3>连接摘要</h3>
                      <p>{connectionSummary}</p>
                    </div>
                    <div className="model-center-inline-actions">
                      <Button onClick={() => updateLocation({
                        view: 'keys',
                        provider: providerID,
                      })}>
                        前往账户连接
                      </Button>
                    </div>
                  </header>
                </section>
                {selectedProvider?.docURL ? <div className="model-center-detail-links"><a href={selectedProvider.docURL} onClick={openExternalLink} rel="noreferrer" target="_blank">查看 Provider 文档</a></div> : null}
              </div>
            ) : null}

            {providerSection === 'models' ? (
              <div className="model-center-detail-body">
                <div className="model-center-model-toolbar"><SearchInput aria-label="搜索模型" className="model-center-search" onChange={setModelQuery} placeholder="搜索模型、能力或目录来源" value={modelQuery} variant="standard" /></div>
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
            onAddConnection={nextProviderID => setConnectionDialogProviderId(nextProviderID)}
            onManageConnection={nextProviderID => {
              updateLocation({ view: 'keys', provider: nextProviderID })
            }}
            onQueryChange={setProviderSearch}
            onSelect={selectProvider}
          />
        )
      ) : (
        <ApiKeyWorkspace
          expandedProviderId={routeState.providerId}
          onError={onError}
          onNotice={onNotice}
          onOpenCatalog={() => updateLocation({
            view: 'providers',
            provider: null,
            section: null,
          })}
          onOpenProvider={nextProviderID => {
            applyProviderSelection(
              nextProviderID,
              providers.find(provider => provider.providerID === nextProviderID),
            )
            updateLocation({
              view: 'providers',
              provider: nextProviderID,
              section: 'connection',
            })
          }}
          onOpenUsage={nextProviderID => navigate(
            `/settings/billing?view=accounts&provider=${encodeURIComponent(nextProviderID)}`,
          )}
        />
      )}
      <ProviderConnectionDialog
        busy={busy}
        integration={connectionDialogIntegration}
        integrations={integrations}
        open={connectionDialogProviderId !== null}
        provider={connectionDialogProvider}
        sources={connectionDialogSources}
        onKeySubmit={createProviderConnection}
        onConnected={() => {
          setConnectionDialogProviderId(null)
          if (connectionDialogProvider) {
            updateLocation({
              view: 'keys',
              provider: connectionDialogProvider.providerID,
            })
          }
        }}
        onOpenChange={open => {
          if (!open) setConnectionDialogProviderId(null)
        }}
      />
    </div>
  )
}

type ModelCenterInitialSkeletonProps = {
  view: 'catalog' | 'detail' | 'keys'
  section: 'connection' | 'models' | 'router'
}

function ModelCenterInitialSkeleton({
  view,
  section,
}: ModelCenterInitialSkeletonProps): React.ReactNode {
  if (view === 'keys') {
    return (
      <SkeletonRegion className="model-center-initial-skeleton" label="正在加载账户连接">
        <div className="model-center-heading model-center-skeleton-heading">
          <SkeletonBlock className="model-center-skeleton-page-title" />
          <SkeletonBlock className="model-center-skeleton-page-copy" />
        </div>
        <div className="model-center-skeleton-key-toolbar">
          {Array.from({ length: 4 }, (_, index) => (
            <SkeletonBlock className="model-center-skeleton-control" key={index} />
          ))}
        </div>
        {Array.from({ length: 2 }, (_, groupIndex) => (
          <section className="model-center-skeleton-key-group" key={groupIndex}>
            <header>
              <SkeletonBlock className="model-center-skeleton-logo" />
              <SkeletonBlock className="model-center-skeleton-name" />
              <SkeletonBlock className="model-center-skeleton-count" />
            </header>
            {Array.from({ length: 2 }, (_, rowIndex) => (
              <div className="model-center-skeleton-key-row" key={rowIndex}>
                <SkeletonBlock className="model-center-skeleton-key-order" />
                <div>
                  <SkeletonBlock className="model-center-skeleton-key-title" />
                  <SkeletonBlock className="model-center-skeleton-key-meta" />
                </div>
                <SkeletonBlock className="model-center-skeleton-key-actions" />
              </div>
            ))}
          </section>
        ))}
      </SkeletonRegion>
    )
  }

  if (view === 'detail') {
    return (
      <SkeletonRegion className="model-center-initial-skeleton" label="正在加载 Provider 详情">
        <header className="model-center-skeleton-provider-header">
          <SkeletonBlock className="model-center-skeleton-back" />
          <SkeletonBlock className="model-center-skeleton-provider-logo" />
          <div>
            <SkeletonBlock className="model-center-skeleton-provider-title" />
            <SkeletonBlock className="model-center-skeleton-provider-copy" />
          </div>
        </header>
        <div className="model-center-skeleton-tabs">
          {Array.from({ length: 3 }, (_, index) => (
            <SkeletonBlock className="model-center-skeleton-tab" key={index} />
          ))}
        </div>
        {section === 'models' ? (
          <>
            <SkeletonBlock className="model-center-skeleton-search" />
            <div className="model-center-skeleton-model-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonBlock className="model-center-skeleton-model-card" key={index} />
              ))}
            </div>
          </>
        ) : section === 'router' ? (
          <div className="model-center-skeleton-router-list">
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        ) : (
          <div className="model-center-skeleton-detail-sections">
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        )}
      </SkeletonRegion>
    )
  }

  return (
    <SkeletonRegion className="model-center-initial-skeleton" label="正在加载 Provider 目录">
      <div className="model-center-heading model-center-skeleton-heading">
        <SkeletonBlock className="model-center-skeleton-page-title" />
        <SkeletonBlock className="model-center-skeleton-page-copy" />
      </div>
      <div className="model-center-skeleton-catalog-header">
        <div>
          <SkeletonBlock className="model-center-skeleton-section-title" />
          <SkeletonBlock className="model-center-skeleton-section-copy" />
        </div>
        <SkeletonBlock className="model-center-skeleton-count" />
      </div>
      <SkeletonBlock className="model-center-skeleton-search" />
      <div className="model-center-skeleton-provider-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="model-center-skeleton-provider-card" key={index}>
            <SkeletonBlock className="model-center-skeleton-logo" />
            <div>
              <SkeletonBlock className="model-center-skeleton-name" />
              <SkeletonBlock className="model-center-skeleton-meta" />
            </div>
            <SkeletonBlock className="model-center-skeleton-status" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
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

function providerCatalogConnectionStatus(
  status: 'stored-key' | 'oauth' | 'environment' | 'configured' | 'unconfigured',
  group: ConfiguredProviderGroup | undefined,
): ProviderCatalogItem['status'] {
  const onlyInferenceKeys = Boolean(group)
    && group.connections.every(connection => connection.kind === 'inference-key')
  if (onlyInferenceKeys && group?.apiKeys.length) {
    const enabledKeys = group.apiKeys.filter(key => key.enabled)
    if (enabledKeys.length === 0) {
      return { label: '已配置 · 已停用', tone: 'warning' }
    }
    if (enabledKeys.every(key => key.health.status === 'auth-failed')) {
      return { label: '需要修复', tone: 'danger' }
    }
  }
  return {
    label: providerStatusLabel(status),
    tone: status === 'unconfigured' ? 'neutral' : 'positive',
  }
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

function providerConnectionSummary({
  apiKeySource,
  integration,
  providerKeys,
  group,
}: {
  apiKeySource: string | null
  integration: {
    connections: readonly { type: string }[]
  } | undefined
  providerKeys: readonly {
    active: boolean
    enabled: boolean
    health: { status: string }
    label: string
  }[]
  group: ConfiguredProviderGroup | undefined
}): string {
  if (providerKeys.length > 0) {
    const enabled = providerKeys.filter(key => key.enabled)
    if (enabled.length === 0) {
      return `已保存 ${providerKeys.length} 个推理 Key，当前均已停用。`
    }
    const active = providerKeys.find(key => key.active) ?? enabled[0]
    const health = active?.health.status === 'auth-failed'
      ? '鉴权失败'
      : active?.health.status === 'rate-limited'
        ? '限流冷却中'
        : active?.health.status === 'healthy'
          ? '健康'
          : '尚未验证'
    return `当前推理 Key：${active?.label ?? '已保存 Key'} · ${health}；共 ${providerKeys.length} 个连接。`
  }
  const activeConnection = group?.activeConnection
  if (activeConnection?.kind === 'subscription') {
    return `订阅授权：${activeConnection.label}；可在账户连接中管理。`
  }
  if (activeConnection?.kind === 'billing-key') {
    return `管理凭据：${activeConnection.label}；仅用于余额和账务查询。`
  }
  if (
    activeConnection?.kind === 'oauth'
    || integration?.connections.some(connection => connection.type === 'credential')
  ) {
    return `OAuth 已连接${activeConnection?.label ? `：${activeConnection.label}` : ''}。`
  }
  if (activeConnection?.kind === 'env' || (apiKeySource && apiKeySource !== 'secureStorage')) {
    return `当前凭据来自环境变量${activeConnection?.label ? `：${activeConnection.label}` : ''}。`
  }
  return '尚未建立账户连接；可前往账户连接页查看可用方式。'
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void desktopClient.openExternalURL(event.currentTarget.href)
}
