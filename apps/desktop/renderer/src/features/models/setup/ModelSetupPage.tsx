import {
  Check,
  ChevronLeft,
  Server,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopModelRef,
  ModelProviderID,
} from '../../../../shared/types.js'
import { AgentRpcError } from '../../../services/agentRpcClient.js'
import { Button } from '../../../components/ui/Button.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { WindowControls } from '../../layout/MenuBar.js'
import { providerManagementStore } from '../../provider-management/providerManagementStore.js'
import { useProviderManagementSnapshot } from '../../provider-management/useProviderManagementSnapshot.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import {
  ApiKeyEditorForm,
  type ApiKeyEditorValue,
} from '../ApiKeyEditorDialog.js'
import { OAuthConnection } from '../provider-management/OAuthConnection.js'
import { ProviderEditorDialog } from '../provider-management/ProviderEditorDialog.js'
import { SetupBootState, SetupRecoveryState } from './RequireConfiguredModel.js'
import '../../../styles/lazy/model-setup.scss'

export type ModelSetupStep = 'provider' | 'model'
export type ModelSetupStatus = 'loading' | 'ready' | 'saving' | 'error'

export function ModelSetupPage(): React.ReactNode {
  const navigate = useNavigate()
  const settings = useDesktopSettings()
  const snapshot = useProviderManagementSnapshot()
  const [step, setStep] = useState<ModelSetupStep>('provider')
  const [status, setStatus] = useState<ModelSetupStatus>('loading')
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [providerId, setProviderId] = useState<ModelProviderID | null>(null)
  const [modelId, setModelId] = useState('')
  const [variant, setVariant] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelMetadata, setModelMetadata] = useState<Record<string, DesktopModelMetadata>>({})
  const [createdCredentialId, setCreatedCredentialId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelReloadToken, setModelReloadToken] = useState(0)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const providerListboxId = useRef(`model-setup-provider-list-${Math.random().toString(36).slice(2)}`)
  const modelListboxId = useRef(`model-setup-model-list-${Math.random().toString(36).slice(2)}`)

  const providers = useMemo(
    () => [...snapshot.providers].sort((left, right) => (
      left.displayName.localeCompare(right.displayName, 'zh-CN', {
        numeric: true,
        sensitivity: 'base',
      })
    )),
    [snapshot.providers],
  )
  const selectedProvider = providers.find(provider => provider.providerID === providerId) ?? null
  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLocaleLowerCase()
    if (!query) return providers
    return providers.filter(provider => (
      `${provider.displayName} ${provider.providerID}`.toLocaleLowerCase().includes(query)
    ))
  }, [providerQuery, providers])
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase()
    if (!query) return models
    return models.filter(id => {
      const metadata = modelMetadata[id]
      return `${id} ${metadata?.name ?? ''}`.toLocaleLowerCase().includes(query)
    })
  }, [modelMetadata, modelQuery, models])
  const selectedVariants = modelMetadata[modelId]?.variants ?? []
  const providerConnected = selectedProvider
    ? isProviderConnected(selectedProvider, snapshot)
    : false
  const supportsApiKey = selectedProvider?.authMethods?.includes('api-key') !== false
  const keyFormProviders = useMemo(
    () => selectedProvider ? [selectedProvider] : [],
    [selectedProvider],
  )
  const providerNav = useListboxNavigation({
    count: filteredProviders.length,
    onSelect: index => chooseProvider(filteredProviders[index]),
  })
  const modelNav = useListboxNavigation({
    count: filteredModels.length,
    onSelect: index => {
      const id = filteredModels[index]
      if (!id) return
      setModelId(id)
      setVariant('')
    },
  })

  useEffect(() => {
    let mounted = true
    void desktopClient.isWindowMaximized()
      .then(value => {
        if (mounted) setIsMaximized(value)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (
      !settings.settingsLoaded
      || !snapshot.loaded
      || snapshot.configurationError
      || !snapshot.currentProviderState
      || settings.firstUseSetupCompleted !== undefined
    ) return
    const inferred = snapshot.currentProviderState.modelConfigured ? 1 : 0
    void settings.saveFirstUseSetupCompleted(inferred).catch(() => undefined)
  }, [
    settings.firstUseSetupCompleted,
    settings.saveFirstUseSetupCompleted,
    settings.settingsLoaded,
    snapshot.configurationError,
    snapshot.currentProviderState,
    snapshot.loaded,
  ])

  useEffect(() => {
    if (!snapshot.loaded || providerId || providers.length === 0) return
    const preferred = providers.find(provider => (
      provider.providerID === snapshot.currentProviderState?.selectedProviderID
    )) ?? providers.find(provider => isProviderConnected(provider, snapshot)) ?? providers[0]
    setProviderId(preferred?.providerID ?? null)
    // 显式重置为 0，或旧配置尚未完成首次引导时，始终从第 1 步开始；
    // Provider 已连接只影响“继续”按钮，不再跳过首次引导页面。
    const fullGuideRequested = settings.firstUseSetupCompleted === 0
      || (
        settings.firstUseSetupCompleted === undefined
        && snapshot.currentProviderState?.modelConfigured !== true
      )
    setStep(
      !fullGuideRequested && isProviderConnected(preferred, snapshot)
        ? 'model'
        : 'provider',
    )
    setStatus('ready')
  }, [providerId, providers, settings.firstUseSetupCompleted, snapshot])

  useEffect(() => {
    if (step !== 'model' || !selectedProvider) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    setNotice('正在加载模型目录…')
    void desktopClient.fetchProviderModels({
      providerID: selectedProvider.providerID,
      limit: 100,
    }).then(result => {
      if (cancelled) return
      const nextModels = result.models.length > 0
        ? result.models
        : [...selectedProvider.defaultModels]
      setModels(nextModels)
      setModelMetadata({
        ...selectedProvider.modelMetadata,
        ...result.modelMetadata,
      })
      setModelId(current => (
        nextModels.includes(current)
          ? current
          : snapshot.currentProviderState?.selectedProviderID === selectedProvider.providerID
            && nextModels.includes(snapshot.currentProviderState.model)
            ? snapshot.currentProviderState.model
            : nextModels[0] ?? ''
      ))
      setNotice(result.error
        ? '远端目录刷新失败，正在使用已有目录。'
        : `已加载 ${nextModels.length} 个模型。`)
      setStatus('ready')
    }).catch(() => {
      if (cancelled) return
      const fallback = [...selectedProvider.defaultModels]
      setModels(fallback)
      setModelMetadata(selectedProvider.modelMetadata ?? {})
      setModelId(current => fallback.includes(current) ? current : fallback[0] ?? '')
      setNotice(fallback.length > 0 ? '远端目录暂不可用，正在使用已有目录。' : null)
      setError(fallback.length > 0 ? null : '没有可用模型，请稍后重试。')
      setStatus(fallback.length > 0 ? 'ready' : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [modelReloadToken, selectedProvider, snapshot.currentProviderState, step])

  if (!snapshot.loaded || !settings.settingsLoaded) return <SetupBootState />
  if (snapshot.configurationError || !snapshot.currentProviderState) {
    return (
      <SetupRecoveryState
        message={snapshot.configurationError}
        onRetry={() => void providerManagementStore.refresh()}
      />
    )
  }
  const effectiveFirstUseSetupCompleted = settings.firstUseSetupCompleted
    ?? (snapshot.currentProviderState.modelConfigured ? 1 : 0)
  if (effectiveFirstUseSetupCompleted === 1) {
    return <Navigate replace to="/new" />
  }

  function chooseProvider(provider: DesktopModelProviderSummary): void {
    setProviderId(provider.providerID)
    setCreatedCredentialId(null)
    setNotice(null)
    setError(null)
  }

  function continueToModels(): void {
    if (!selectedProvider || !providerConnected) return
    setStep('model')
    setModelQuery('')
    setVariant('')
    setNotice(null)
    setError(null)
  }

  async function saveApiKey(value: ApiKeyEditorValue): Promise<boolean> {
    if (!value.key) return false
    setStatus('saving')
    setError(null)
    setNotice(null)
    try {
      const credential = await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      })
      setCreatedCredentialId(credential.id)
      setNotice('凭据已安全保存，尚未验证。')
      setStatus('ready')
      setStep('model')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (saveError) {
      setError(setupErrorText(saveError, '凭据保存失败，请重试。'))
      setStatus('error')
      return false
    }
  }

  async function testConnection(): Promise<void> {
    if (!selectedProvider) return
    setStatus('loading')
    setError(null)
    setNotice('正在测试连接…')
    try {
      const result = createdCredentialId
        ? await providerManagementStore.testApiKey(createdCredentialId)
        : await desktopClient.testModelProvider(
            selectedProvider.providerID,
            modelId
              ? {
                  providerID: selectedProvider.providerID,
                  id: modelId,
                  ...(variant ? { variant } : {}),
                } as DesktopModelRef
              : undefined,
          )
      const ok = 'ok' in result ? result.ok : result.status === 'reachable'
      setNotice(ok ? '连接正常。' : null)
      setError(ok ? null : '连接测试失败；你仍可保存模型并稍后重试。')
    } catch (testError) {
      setError(setupErrorText(testError, '连接测试失败；你仍可保存模型并稍后重试。'))
      setNotice(null)
    } finally {
      setStatus('ready')
    }
  }

  async function finishSetup(): Promise<void> {
    if (!selectedProvider || !modelId) return
    setStatus('saving')
    setError(null)
    let modelSaved = false
    try {
      const nextState = await desktopClient.saveModelProvider({
        providerID: selectedProvider.providerID,
        id: modelId,
        variant: variant || undefined,
      })
      const sameSelection = nextState.modelConfigured
        && nextState.selectedProviderID === selectedProvider.providerID
        && nextState.model === modelId
        && (nextState.variant ?? '') === (variant ?? '')
      if (!sameSelection) {
        setError('保存结果与所选不一致，请重试。')
        setStatus('error')
        return
      }
      modelSaved = true
      settings.syncExternalSettingsPatch({
        providerID: nextState.selectedProviderID,
        providerBaseURL: nextState.baseURL ?? '',
        model: nextState.model,
        selectedModelPreset: nextState.model,
      })
      await providerManagementStore.refresh()
      await settings.saveFirstUseSetupCompleted(1)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      navigate('/new', { replace: true })
    } catch (saveError) {
      setError(setupErrorText(
        saveError,
        modelSaved
          ? '模型已保存，但首次引导状态保存失败，请重试。'
          : '模型保存失败，请重试。',
      ))
      setStatus('error')
    }
  }

  return (
    <div className="model-setup-page">
      <header className="model-setup-titlebar">
        <span className="model-setup-brand">CodePilotX</span>
        <WindowControls
          isMaximized={isMaximized}
          onClose={() => void desktopClient.closeWindow()}
          onMinimize={() => void desktopClient.minimizeWindow()}
          onToggleMaximize={() => {
            void desktopClient.toggleWindowMaximized().then(setIsMaximized)
          }}
        />
      </header>

      <main className="model-setup-main">
        <section className="model-setup-workspace" aria-labelledby="model-setup-title">
          <header className="model-setup-heading">
            <div className="model-setup-progress" aria-label={`第 ${step === 'provider' ? 1 : 2} 步，共 2 步`}>
              <span data-active="true">1</span>
              <i aria-hidden />
              <span data-active={step === 'model' || undefined}>2</span>
            </div>
            <div>
              <p className="model-setup-eyebrow">{step === 'provider' ? '1 / 2 · 连接供应商' : '2 / 2 · 选择模型'}</p>
              <h1 id="model-setup-title">{step === 'provider' ? '先连接一个模型供应商' : '选择默认模型'}</h1>
              <p>{step === 'provider'
                ? '凭据只会保存到现有安全凭据仓库。连接测试可稍后进行。'
                : `CodePilotX 将在新任务中默认使用 ${selectedProvider?.displayName ?? '此供应商'}。`}</p>
            </div>
          </header>

          {step === 'provider' ? (
            <div className="model-setup-content">
              <SearchInput
                aria-label="搜索供应商"
                mode="combobox"
                controls={providerListboxId.current}
                expanded
                activeDescendant={
                  providerNav.activeIndex >= 0
                    ? `model-setup-provider-option-${providerNav.activeIndex}`
                    : undefined
                }
                onChange={value => {
                  setProviderQuery(value)
                  providerNav.moveToFirst()
                }}
                onKeyDown={providerNav.onKeyDown}
                placeholder="搜索供应商"
                value={providerQuery}
              />
              <div
                aria-label="供应商"
                className="model-setup-provider-list"
                id={providerListboxId.current}
                onKeyDown={providerNav.onKeyDown}
                role="listbox"
              >
                {filteredProviders.map((provider, index) => {
                  const connected = isProviderConnected(provider, snapshot)
                  const selected = provider.providerID === providerId
                  return (
                    <button
                      aria-selected={selected}
                      className="model-setup-provider-row"
                      data-active={providerNav.activeIndex === index || undefined}
                      data-selected={selected || undefined}
                      id={`model-setup-provider-option-${index}`}
                      key={provider.providerID}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      onClick={() => chooseProvider(provider)}
                      onMouseEnter={() => providerNav.setActive(index)}
                    >
                      {provider.logoURL ? (
                        <RemoteImage
                          alt=""
                          className="model-setup-provider-logo"
                          fallback={<Server aria-hidden />}
                          src={provider.logoURL}
                        />
                      ) : <span className="model-setup-provider-logo"><Server aria-hidden /></span>}
                      <span className="model-setup-provider-copy">
                        <strong>{provider.displayName}</strong>
                        <small>{provider.providerID} · {provider.defaultModels.length} 个模型</small>
                      </span>
                      <span className="model-setup-provider-status" data-connected={connected || undefined}>
                        {connected ? <><Check aria-hidden />已连接</> : '未连接'}
                      </span>
                    </button>
                  )
                })}
                {filteredProviders.length === 0 ? (
                  <p className="model-setup-empty">没有匹配的供应商。</p>
                ) : null}
              </div>

              {selectedProvider ? (
                <div className="model-setup-connection">
                  <div className="model-setup-connection-heading">
                    <div>
                      <strong>{selectedProvider.displayName}</strong>
                      <p>{providerConnected ? '此供应商已经可以用于模型请求。' : '添加 API Key，或使用供应商支持的 OAuth。'}</p>
                    </div>
                    {providerConnected ? <span className="model-setup-connected"><Check aria-hidden />已连接</span> : null}
                  </div>
                  {!providerConnected && supportsApiKey ? (
                    <ApiKeyEditorForm
                      busy={status === 'saving'}
                      className="model-setup-key-form"
                      defaultLabel={selectedProvider ? `${selectedProvider.displayName} 账号` : '个人账号'}
                      hideProvider
                      initialProviderId={selectedProvider.providerID}
                      providers={keyFormProviders}
                      resetSignal={selectedProvider.providerID}
                      submitLabel="安全保存"
                      onSubmit={saveApiKey}
                    />
                  ) : null}
                  {!providerConnected && selectedProvider.authMethods?.includes('oauth') ? (
                    <OAuthConnection
                      connected={false}
                      description="此授权用于模型推理；令牌保存在当前 Provider 凭据仓库。"
                      target={{ kind: 'provider', providerId: selectedProvider.providerID } as never}
                      title={`${selectedProvider.displayName} OAuth 授权`}
                      onChanged={async () => {
                        await providerManagementStore.refresh()
                        setStep('model')
                        setNotice('供应商已连接。')
                        window.dispatchEvent(new Event('desktop:model-provider-changed'))
                      }}
                    />
                  ) : null}
                  <div className="model-setup-actions">
                    <Button color="secondary" disabled={!providerConnected} onClick={continueToModels}>
                      继续
                    </Button>
                  </div>
                </div>
              ) : null}

              <Button color="ghostSecondary" onClick={() => setProviderEditorOpen(true)}>
                添加自定义供应商
              </Button>
            </div>
          ) : (
            <div className="model-setup-content">
              <div className="model-setup-model-toolbar">
                <SearchInput
                  aria-label="搜索模型"
                  mode="combobox"
                  controls={modelListboxId.current}
                  expanded
                  activeDescendant={
                    modelNav.activeIndex >= 0
                      ? `model-setup-model-option-${modelNav.activeIndex}`
                      : undefined
                  }
                  onChange={value => {
                    setModelQuery(value)
                    modelNav.moveToFirst()
                  }}
                  onKeyDown={modelNav.onKeyDown}
                  placeholder="搜索模型"
                  value={modelQuery}
                />
                <Button color="ghostSecondary" disabled={status === 'loading'} onClick={() => {
                  setStep('provider')
                  setNotice(null)
                  setError(null)
                }}><ChevronLeft aria-hidden />更换供应商</Button>
              </div>
              <div
                aria-label="模型"
                className="model-setup-model-list"
                id={modelListboxId.current}
                onKeyDown={modelNav.onKeyDown}
                role="listbox"
              >
                {filteredModels.map((id, index) => {
                  const metadata = modelMetadata[id]
                  return (
                    <button
                      aria-selected={modelId === id}
                      className="model-setup-model-row"
                      data-active={modelNav.activeIndex === index || undefined}
                      data-selected={modelId === id || undefined}
                      id={`model-setup-model-option-${index}`}
                      key={id}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      onClick={() => {
                        setModelId(id)
                        setVariant('')
                      }}
                      onMouseEnter={() => modelNav.setActive(index)}
                    >
                      <span><strong>{metadata?.name ?? id}</strong><small>{id}</small></span>
                      <span className="model-setup-model-capabilities">
                        {metadata?.reasoning ? '推理' : null}
                        {metadata?.vision ? '图片' : null}
                      </span>
                      {modelId === id ? <Check aria-hidden /> : null}
                    </button>
                  )
                })}
                {status === 'loading' ? <p className="model-setup-empty">正在加载模型目录…</p> : null}
                {status !== 'loading' && filteredModels.length === 0 ? <p className="model-setup-empty">没有匹配的模型。</p> : null}
              </div>
              {selectedVariants.length > 0 ? (
                <label className="model-setup-variants">
                  <span>模型变体</span>
                  <select value={variant} onChange={event => setVariant(event.target.value)}>
                    <option value="">默认</option>
                    {selectedVariants.map(item => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              ) : null}
              <div className="model-setup-actions model-setup-actions--finish">
                <Button color="ghostSecondary" disabled={status === 'loading'} onClick={() => void testConnection()}>
                  测试连接（可选）
                </Button>
                {status === 'error' ? (
                  <Button color="secondary" onClick={() => setModelReloadToken(token => token + 1)}>
                    重试
                  </Button>
                ) : null}
                <Button
                  color="secondary"
                  disabled={!modelId}
                  loading={status === 'saving'}
                  onClick={() => void finishSetup()}
                >
                  开始使用
                </Button>
              </div>
            </div>
          )}

          <div className="model-setup-feedback" aria-live="polite">
            {notice ? <p className="model-setup-notice">{notice}</p> : null}
            {error ? <p className="model-setup-error">{error}</p> : null}
          </div>
        </section>
      </main>

      <ProviderEditorDialog
        open={providerEditorOpen}
        onOpenChange={setProviderEditorOpen}
        onSaved={async savedProviderId => {
          const next = await providerManagementStore.refresh()
          const saved = next.providers.find(provider => provider.providerID === savedProviderId)
          setProviderId(savedProviderId as ModelProviderID)
        }}
      />
    </div>
  )
}

function useListboxNavigation({
  count,
  onSelect,
}: {
  count: number
  onSelect: (index: number) => void
}): {
  activeIndex: number
  moveToFirst: () => void
  setActive: (index: number) => void
  onKeyDown: (event: React.KeyboardEvent) => void
} {
  const [activeIndex, setActiveIndex] = useState(-1)
  const moveToFirst = useCallback(
    () => setActiveIndex(count > 0 ? 0 : -1),
    [count],
  )
  const setActive = useCallback((index: number) => setActiveIndex(index), [])
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (count === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(current => {
        if (current < 0) return event.key === 'ArrowDown' ? 0 : count - 1
        const next = current + (event.key === 'ArrowDown' ? 1 : -1)
        if (next < 0) return count - 1
        if (next >= count) return 0
        return next
      })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setActiveIndex(event.key === 'Home' ? 0 : count - 1)
      return
    }
    if (event.key === 'Enter' && activeIndex >= 0 && activeIndex < count) {
      event.preventDefault()
      onSelect(activeIndex)
    }
  }, [activeIndex, count, onSelect])
  return { activeIndex, moveToFirst, setActive, onKeyDown }
}

function isProviderConnected(
  provider: DesktopModelProviderSummary,
  snapshot: ReturnType<typeof providerManagementStore.getSnapshot>,
): boolean {
  // 只认可：Agent authConfigured 状态、enabled 且 active 的安全凭据，
  // 或当前 Provider state 明确返回已配置凭据；enabled 但未激活的凭据不算连接。
  if (provider.apiKeyConfigured) return true
  if (snapshot.credentials.some(credential => (
    credential.providerId === provider.providerID
    && credential.enabled
    && credential.active
  ))) return true
  return snapshot.currentProviderState?.selectedProviderID === provider.providerID
    && snapshot.currentProviderState.apiKeyConfigured
}

function setupErrorText(error: unknown, fallback: string): string {
  if (error instanceof AgentRpcError) {
    switch (error.errorCode) {
      case 'RATE_LIMITED': return '操作过于频繁，请稍后重试。'
      case 'CONFLICT': return '当前操作冲突，请重试。'
      case 'PERMISSION_DENIED': return '没有执行此操作的权限。'
      case 'MODEL_UNAVAILABLE': return '所选模型当前不可用，请选择其他模型。'
      case 'CURSOR_EXPIRED': return '模型目录已刷新，请重新选择。'
      case 'AGENT_OPERATION_UNSUPPORTED': return '当前 Agent 不支持此操作，请重启后重试。'
    }
    if (error.status === 429) return '操作过于频繁，请稍后重试。'
  }
  if (error instanceof Error && /fetch|network|timeout|socket|connect|ECONN/i.test(error.message)) {
    return '无法连接本地 Agent，请确认 Agent 已启动后重试。'
  }
  return fallback
}
