import {
  Check,
  ChevronLeft,
  KeyRound,
  Server,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { WindowControls } from '../../layout/MenuBar.js'
import { providerManagementStore } from '../../provider-management/providerManagementStore.js'
import { useProviderManagementSnapshot } from '../../provider-management/useProviderManagementSnapshot.js'
import { useDesktopSettings } from '../../settings/useDesktopSettings.js'
import type { ApiKeyEditorValue } from '../ApiKeyEditorDialog.js'
import { ProviderConnectionDialog } from '../provider-management/ProviderConnectionDialog.js'
import { ProviderEditorDialog } from '../provider-management/ProviderEditorDialog.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
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
  const [baseURL, setBaseURL] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelMetadata, setModelMetadata] = useState<Record<string, DesktopModelMetadata>>({})
  const [keyLabel, setKeyLabel] = useState('个人账号')
  const [apiKey, setApiKey] = useState('')
  const [createdCredentialId, setCreatedCredentialId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const interactionStarted = useRef(false)

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
    if (!snapshot.loaded || providerId || providers.length === 0) return
    const preferred = providers.find(provider => (
      provider.providerID === snapshot.currentProviderState?.selectedProviderID
    )) ?? providers.find(provider => isProviderConnected(provider, snapshot)) ?? providers[0]
    setProviderId(preferred?.providerID ?? null)
    setBaseURL(preferred?.baseURL ?? '')
    setKeyLabel(preferred ? `${preferred.displayName} 账号` : '个人账号')
    setStatus('ready')
  }, [providerId, providers, snapshot])

  useEffect(() => {
    if (step !== 'model' || !selectedProvider) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    setNotice('正在加载模型目录…')
    void desktopClient.fetchProviderModels({
      providerID: selectedProvider.providerID,
      baseURL: baseURL.trim() || undefined,
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
        ? `远端目录刷新失败，正在使用已有目录：${result.error}`
        : `已加载 ${nextModels.length} 个模型。`)
      setStatus('ready')
    }).catch(fetchError => {
      if (cancelled) return
      const fallback = [...selectedProvider.defaultModels]
      setModels(fallback)
      setModelMetadata(selectedProvider.modelMetadata ?? {})
      setModelId(current => fallback.includes(current) ? current : fallback[0] ?? '')
      setNotice(fallback.length > 0 ? '远端目录暂不可用，正在使用已有目录。' : null)
      setError(fallback.length > 0 ? null : safeErrorMessage(fetchError, '没有可用模型，请重试。'))
      setStatus(fallback.length > 0 ? 'ready' : 'error')
    })
    return () => {
      cancelled = true
    }
  }, [baseURL, selectedProvider, snapshot.currentProviderState, step])

  if (!snapshot.loaded) return <SetupBootState />
  if (snapshot.error && !snapshot.currentProviderState) {
    return (
      <SetupRecoveryState
        message={snapshot.error}
        onRetry={() => void providerManagementStore.refresh()}
      />
    )
  }
  if (!interactionStarted.current && snapshot.currentProviderState?.modelConfigured) {
    return <Navigate replace to="/new" />
  }

  function chooseProvider(provider: DesktopModelProviderSummary): void {
    interactionStarted.current = true
    setProviderId(provider.providerID)
    setBaseURL(provider.baseURL ?? '')
    setKeyLabel(`${provider.displayName} 账号`)
    setCreatedCredentialId(null)
    setNotice(null)
    setError(null)
  }

  function continueToModels(): void {
    if (!selectedProvider || !providerConnected) return
    interactionStarted.current = true
    setStep('model')
    setModelQuery('')
    setVariant('')
    setNotice(null)
    setError(null)
  }

  async function saveApiKey(): Promise<void> {
    if (!selectedProvider || !apiKey.trim() || !keyLabel.trim()) return
    interactionStarted.current = true
    setStatus('saving')
    setError(null)
    setNotice(null)
    const secret = apiKey.trim()
    setApiKey('')
    try {
      const credential = await providerManagementStore.createApiKey({
        providerId: selectedProvider.providerID,
        label: keyLabel.trim(),
        key: secret,
      })
      setCreatedCredentialId(credential.id)
      setNotice('凭据已安全保存，尚未验证。')
      setStatus('ready')
      setStep('model')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (saveError) {
      setError(safeErrorMessage(saveError, '凭据保存失败，请重试。'))
      setStatus('error')
    }
  }

  async function saveConnectionFromDialog(value: ApiKeyEditorValue): Promise<boolean> {
    if (!value.key) return false
    setStatus('saving')
    setError(null)
    try {
      const credential = await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      })
      setCreatedCredentialId(credential.id)
      setNotice('凭据已安全保存，尚未验证。')
      setStep('model')
      setStatus('ready')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (saveError) {
      setError(safeErrorMessage(saveError, '凭据保存失败，请重试。'))
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
        : await desktopClient.testModelProvider(selectedProvider.providerID)
      setNotice(result.ok ? result.message ?? '连接正常。' : null)
      setError(result.ok ? null : result.message ?? '连接测试失败；你仍可保存模型并稍后重试。')
    } catch (testError) {
      setError(safeErrorMessage(testError, '连接测试失败；你仍可保存模型并稍后重试。'))
      setNotice(null)
    } finally {
      setStatus('ready')
    }
  }

  async function finishSetup(): Promise<void> {
    if (!selectedProvider || !modelId) return
    setStatus('saving')
    setError(null)
    try {
      const nextState = await desktopClient.saveModelProvider({
        providerID: selectedProvider.providerID,
        id: modelId,
        variant: variant || undefined,
        baseURL: baseURL.trim() || undefined,
      })
      if (!nextState.modelConfigured) {
        throw new Error(nextState.configurationMessage || '模型尚未完成配置。')
      }
      const nextModel = nextState.model || modelId
      settings.syncExternalSettingsPatch({
        providerID: nextState.selectedProviderID,
        providerBaseURL: nextState.baseURL ?? '',
        model: nextModel,
        selectedModelPreset: nextModel,
      })
      await providerManagementStore.refresh()
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      navigate('/new', { replace: true })
    } catch (saveError) {
      setError(safeErrorMessage(saveError, '模型保存失败，请重试。'))
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
                onChange={setProviderQuery}
                placeholder="搜索供应商"
                value={providerQuery}
              />
              <div className="model-setup-provider-list" role="listbox" aria-label="供应商">
                {filteredProviders.map(provider => {
                  const connected = isProviderConnected(provider, snapshot)
                  const selected = provider.providerID === providerId
                  return (
                    <button
                      aria-selected={selected}
                      className="model-setup-provider-row"
                      data-selected={selected || undefined}
                      key={provider.providerID}
                      role="option"
                      type="button"
                      onClick={() => chooseProvider(provider)}
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
                    <form className="model-setup-key-form" onSubmit={event => {
                      event.preventDefault()
                      void saveApiKey()
                    }}>
                      <label>
                        <span>名称</span>
                        <Input maxLength={80} value={keyLabel} onChange={event => setKeyLabel(event.target.value)} />
                      </label>
                      <label>
                        <span>API Key</span>
                        <Input
                          autoComplete="off"
                          placeholder="粘贴 API Key"
                          type="password"
                          value={apiKey}
                          onChange={event => setApiKey(event.target.value)}
                        />
                      </label>
                      <Button
                        color="secondary"
                        disabled={!apiKey.trim() || !keyLabel.trim()}
                        loading={status === 'saving'}
                        type="submit"
                      >
                        <KeyRound aria-hidden />安全保存
                      </Button>
                    </form>
                  ) : null}
                  <div className="model-setup-actions">
                    {!providerConnected && selectedProvider.authMethods?.includes('oauth') ? (
                      <Button color="secondary" onClick={() => {
                        interactionStarted.current = true
                        setConnectionDialogOpen(true)
                      }}>使用 OAuth</Button>
                    ) : null}
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
                  onChange={setModelQuery}
                  placeholder="搜索模型"
                  value={modelQuery}
                />
                <Button color="ghostSecondary" disabled={status === 'loading'} onClick={() => {
                  setStep('provider')
                  setNotice(null)
                  setError(null)
                }}><ChevronLeft aria-hidden />更换供应商</Button>
              </div>
              {selectedProvider?.requiresBaseURL ? (
                <label className="model-setup-base-url">
                  <span>Base URL</span>
                  <Input value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://example.com/v1" />
                </label>
              ) : null}
              <div className="model-setup-model-list" role="listbox" aria-label="模型">
                {filteredModels.map(id => {
                  const metadata = modelMetadata[id]
                  return (
                    <button
                      aria-selected={modelId === id}
                      className="model-setup-model-row"
                      data-selected={modelId === id || undefined}
                      key={id}
                      role="option"
                      type="button"
                      onClick={() => {
                        setModelId(id)
                        setVariant('')
                      }}
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
                <Button
                  color="secondary"
                  disabled={!modelId || (Boolean(selectedProvider?.requiresBaseURL) && !baseURL.trim())}
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

      <ProviderConnectionDialog
        busy={status === 'saving'}
        open={connectionDialogOpen}
        provider={selectedProvider}
        sources={[]}
        onConnected={async () => {
          interactionStarted.current = true
          await providerManagementStore.refresh()
          setStep('model')
          setNotice('供应商已连接。')
          window.dispatchEvent(new Event('desktop:model-provider-changed'))
        }}
        onKeySubmit={saveConnectionFromDialog}
        onOpenChange={setConnectionDialogOpen}
      />
      <ProviderEditorDialog
        open={providerEditorOpen}
        onOpenChange={setProviderEditorOpen}
        onSaved={async savedProviderId => {
          interactionStarted.current = true
          const next = await providerManagementStore.refresh()
          const saved = next.providers.find(provider => provider.providerID === savedProviderId)
          setProviderId(savedProviderId as ModelProviderID)
          setBaseURL(saved?.baseURL ?? '')
          setKeyLabel(saved ? `${saved.displayName} 账号` : '自定义供应商账号')
        }}
      />
    </div>
  )
}

function isProviderConnected(
  provider: DesktopModelProviderSummary,
  snapshot: ReturnType<typeof providerManagementStore.getSnapshot>,
): boolean {
  if (snapshot.credentials.some(credential => (
    credential.providerId === provider.providerID && credential.enabled
  ))) return true
  if (provider.apiKeyConfigured) return true
  return snapshot.currentProviderState?.selectedProviderID === provider.providerID
    && snapshot.currentProviderState.apiKeyConfigured
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}
