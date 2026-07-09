import { desktopClient } from '../../services/desktopClient.js'
import { withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
﻿import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DesktopCopilotAuthStatus,
  DesktopCopilotLoginStatus,
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderBalanceResult,
  ModelProviderID,
} from '../../../shared/types.js'
import { useDesktopSettings } from './useDesktopSettings.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { fullErrorMessage } from '../../utils/errors.js'
import { Brain, Braces, Eye, Hammer, Link2, RefreshCw, Search, ShieldCheck } from 'lucide-react'

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
  const [copilotAuth, setCopilotAuth] =
    useState<DesktopCopilotAuthStatus | null>(null)
  const [copilotLogin, setCopilotLogin] =
    useState<DesktopCopilotLoginStatus | null>(null)
  const [browserOpenedForCode, setBrowserOpenedForCode] = useState<string | null>(null)

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
  const isGitHubCopilot =
    selectedProvider?.kind === 'github-copilot' ||
    providerID === 'github-copilot'
  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null
  const providerModels = (
    selectedProviderState?.models ?? selectedProvider?.defaultModels ?? []
  ).filter(item => item && item !== NO_MODEL_OPTION)
  const modelMetadata =
    selectedProviderState?.modelMetadata ?? selectedProvider?.modelMetadata ?? {}
  const orphanModelId = useMemo<string | null>(() => {
    if (!model) return null
    if (!providerModels.includes(model)) return model
    return null
  }, [model, providerModels])
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

  useEffect(() => {
    if (!isGitHubCopilot) {
      setCopilotAuth(null)
      return
    }
    let mounted = true
    void desktopClient.getCopilotAuthStatus()
      .then(status => {
        if (mounted) setCopilotAuth(status)
      })
      .catch(() => {
        if (mounted) {
          setCopilotAuth({
            authenticated: false,
            error: '无法读取 GitHub Copilot 登录状态。',
          })
        }
      })
    return () => {
      mounted = false
    }
  }, [isGitHubCopilot])

  async function startCopilotLogin(): Promise<void> {
    setBusy(true)
    setModelError(null)
    setStatus(null)
    setBrowserOpenedForCode(null)
    try {
      const initial = await desktopClient.startCopilotLogin()
      setCopilotLogin(initial)
      if (initial.state === 'failed') {
        setStatus(initial.error ?? '启动 Copilot 登录失败。')
        setBusy(false)
        return
      }
      if (initial.deviceCode) {
        setStatus(
          `请在浏览器中输入设备码 ${initial.deviceCode} 完成登录。`,
        )
      } else {
        setStatus('正在启动 Copilot 登录流程...')
      }
      if (initial.verificationUrl && initial.deviceCode) {
        try {
          await desktopClient.openExternalURL(initial.verificationUrl)
          setBrowserOpenedForCode(initial.deviceCode)
        } catch {
          // user can click the link manually
        }
      }
      void pollCopilotLoginUntilDone()
    } catch (error) {
      showOperationError(error)
      setBusy(false)
    }
  }

  async function pollCopilotLoginUntilDone(): Promise<void> {
    let attempts = 0
    const maxAttempts = 150
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      attempts += 1
      try {
        const status = await desktopClient.pollCopilotLogin()
        setCopilotLogin(status)
        if (status.auth) {
          setCopilotAuth(status.auth)
          if (status.auth.authenticated) {
            setStatus(
              status.auth.user
                ? `已登录为 ${status.auth.user}。`
                : 'GitHub Copilot 已登录。',
            )
            setBrowserOpenedForCode(null)
            setBusy(false)
            return
          }
        }
        if (status.state === 'completed') {
          if (status.auth?.authenticated) return
          setStatus('Copilot CLI 报告登录完成，但 SDK 仍未检测到登录。请点击「刷新状态」重试。')
          setBrowserOpenedForCode(null)
          setBusy(false)
          return
        }
        if (status.state === 'failed') {
          setStatus(status.error ?? 'Copilot 登录失败。')
          setBrowserOpenedForCode(null)
          setBusy(false)
          return
        }
      } catch (error) {
        setStatus(`轮询登录状态时出错：${fullErrorMessage(error)}`)
        setBrowserOpenedForCode(null)
        setBusy(false)
        return
      }
    }
    setStatus('等待登录超时。请重试或点击「刷新状态」查看最新状态。')
    setBrowserOpenedForCode(null)
    setBusy(false)
  }

  async function cancelCopilotLoginFlow(): Promise<void> {
    setBusy(true)
    try {
      await desktopClient.cancelCopilotLogin()
      setCopilotLogin(null)
      setBrowserOpenedForCode(null)
      setStatus('已取消 Copilot 登录流程。')
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function refreshCopilotAuth(): Promise<void> {
    setBusy(true)
    setStatus(null)
    try {
      const [auth, login] = await Promise.all([
        desktopClient.getCopilotAuthStatus(),
        desktopClient.pollCopilotLogin(),
      ])
      setCopilotAuth(auth)
      setCopilotLogin(login)
      if (auth.authenticated) {
        setStatus(
          auth.user
            ? `已登录为 ${auth.user}。`
            : 'GitHub Copilot 已登录。',
        )
        setBrowserOpenedForCode(null)
      } else if (login.state === 'awaiting_auth' && login.deviceCode) {
        setStatus(`等待用户在浏览器中输入设备码 ${login.deviceCode}。`)
      } else {
        setStatus('未检测到 Copilot 登录。可点击「使用 GitHub 登录」启动登录窗口。')
      }
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
      const result = await withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
          apiKey: apiKey.trim() || undefined,
          baseURL: baseURL.trim() || undefined,
        }),
      )
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
      const modelsRequest = withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
          apiKey: apiKey.trim() || undefined,
          baseURL: baseURL.trim() || undefined,
        }),
      )
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
      applyProviderState(nextState, { persistEffectiveSettings: true })
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
	  return (
    <SettingsContentArea>
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">模型</h2>
          <p className="settings-page-desc">
            管理模型供应商、模型、API key、Base URL 和连接状态。已有会话会继续使用创建时保存的配置快照。
          </p>
        </div>

        <section className="settings-connection-summary">
          <div className="settings-connection-summary-header">
            <h2 className="settings-connection-summary-title">
              <Link2 className="settings-connection-summary-icon" />
              当前连接
            </h2>
            {isGitHubCopilot ? (
              <span className={`settings-connection-badge ${copilotAuth?.authenticated ? 'ok' : 'warn'}`}>
                <span className="settings-connection-badge-dot" />
                {copilotAuth?.authenticated ? 'GitHub 已登录' : 'GitHub 未登录'}
              </span>
            ) : (
              <span className={`settings-connection-badge ${apiKeyConfigured ? 'ok' : 'warn'}`}>
                <span className="settings-connection-badge-dot" />
                {apiKeyConfigured ? 'API 密钥已配置' : 'API 密钥未配置'}
              </span>
            )}
          </div>
          <div className="settings-connection-summary-body">
            <div className="settings-connection-summary-main">
              <div className="settings-connection-summary-name">
                {selectedProvider?.displayName ?? providerID}
              </div>
              <div className="settings-connection-summary-detail">
                {model || '未选择模型'} / {baseURL || '无需 Base URL'}
              </div>
            </div>
            <div className="settings-connection-summary-divider" />
            <div className="settings-connection-summary-meta">
              <div className="settings-connection-summary-meta-item">
                <span className="settings-connection-summary-meta-label">类型</span>
                <span className="settings-connection-summary-meta-value">
                  {selectedProvider?.kind ?? 'openai-compatible'}
                </span>
              </div>
              <div className="settings-connection-summary-meta-item">
                <span className="settings-connection-summary-meta-label">来源</span>
                <span className="settings-connection-summary-meta-value">
                  {selectedProvider?.modelsDevSource ? 'Models.dev' : '内置'}
                </span>
              </div>
            </div>
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
                placeholder="按供应商名称、ID 或 npm 包名筛选"
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
          {!isGitHubCopilot ? (
            <SettingsRow
              title="Base URL"
              description={baseURLDescription(selectedProvider, isMiniMax)}
              control={
                <input
                  className="settings-input settings-input-wide settings-input-mono"
                  readOnly={!baseURLEditable}
                  value={baseURL}
                  placeholder={selectedProvider?.baseURL ?? 'https://.../v1'}
                  onChange={event => setBaseURL(event.target.value)}
                />
              }
            />
          ) : null}
        </SettingsSection>

        <SettingsSection
          title="凭据"
          description={
            isGitHubCopilot
              ? 'GitHub Copilot 通过本地 Copilot CLI 完成 OAuth 登录，无需 API 密钥。'
              : 'API 密钥按供应商 ID 保存在安全存储中。'
          }
        >
          {isGitHubCopilot ? (
            <div className="settings-credential-panel">
              <div className="settings-credential-controls">
                <span
                  className={`settings-chip ${
                    copilotAuth?.authenticated
                      ? 'ok'
                      : copilotLogin?.state === 'awaiting_auth'
                        ? 'pending'
                        : 'warn'
                  }`}
                >
                  {copilotAuth?.authenticated
                    ? copilotAuth.user
                      ? `已登录 · ${copilotAuth.user}`
                      : '已登录'
                    : copilotLogin?.state === 'awaiting_auth'
                      ? '等待登录'
                      : copilotLogin?.state === 'starting'
                        ? '启动中'
                        : copilotLogin?.state === 'failed'
                          ? '登录失败'
                          : '未登录'}
                </span>
                {copilotLogin?.state === 'awaiting_auth' && copilotLogin.deviceCode ? (
                  <button
                    className="settings-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void cancelCopilotLoginFlow()}
                  >
                    取消登录
                  </button>
                ) : (
                  <button
                    className="settings-button"
                    disabled={busy || copilotLogin?.state === 'starting'}
                    type="button"
                    onClick={() => void startCopilotLogin()}
                  >
                    {copilotAuth?.authenticated ? '重新登录' : '使用 GitHub 登录'}
                  </button>
                )}
                <button
                  className="settings-button"
                  disabled={busy}
                  type="button"
                  onClick={() => void refreshCopilotAuth()}
                >
                  刷新状态
                </button>
              </div>
              {copilotLogin?.state === 'awaiting_auth' && copilotLogin.deviceCode ? (
                <div className="settings-copilot-device-code">
                  <label className="settings-copilot-device-code-label">
                    设备码
                  </label>
                  <div className="settings-copilot-device-code-row">
                    <input
                      className="settings-input settings-input-mono"
                      readOnly
                      value={copilotLogin.deviceCode}
                      onFocus={event => event.currentTarget.select()}
                    />
                    <button
                      className="settings-button"
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(
                          copilotLogin.deviceCode ?? '',
                        )
                      }}
                    >
                      复制
                    </button>
                  </div>
                  {copilotLogin.verificationUrl ? (
                    <div className="settings-copilot-verification">
                      <a
                        className="settings-row-link"
                        href={copilotLogin.verificationUrl}
                        onClick={event => {
                          event.preventDefault()
                          void desktopClient.openExternalURL(
                            copilotLogin.verificationUrl!,
                          )
                        }}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {copilotLogin.verificationUrl}
                      </a>
                      <button
                        className="settings-button"
                        type="button"
                        onClick={() =>
                          void desktopClient.openExternalURL(
                            copilotLogin.verificationUrl!,
                          )
                        }
                      >
                        打开浏览器
                      </button>
                    </div>
                  ) : null}
                  <p className="settings-copilot-hint">
                    若浏览器未自动打开，请点击上方「打开浏览器」按钮。Copilot CLI 正在等待 GitHub 返回授权结果...
                  </p>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="settings-credential-panel">
              <div className="settings-credential-header">
                <label className="settings-credential-label">API 密钥</label>
                {apiKeySource ? (
                  <span className="settings-credential-source">
                    <ShieldCheck className="settings-credential-source-icon" />
                    当前来源: {apiKeySource}
                  </span>
                ) : null}
              </div>
              <div className="settings-credential-controls">
                <input
                  className="settings-input settings-credential-input"
                  value={apiKey}
                  placeholder={apiKeyConfigured ? '输入后保存 (已配置)' : '输入后保存'}
                  type="password"
                  onChange={event => setApiKey(event.target.value)}
                />
                <span className={`settings-chip ${apiKeyConfigured ? 'ok' : 'warn'}`}>
                  {formatApiKeyState(apiKeySource, apiKeyConfigured)}
                </span>
                <div className="settings-credential-actions">
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
              </div>
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title="模型"
          description="模型元数据来自 Models.dev、供应商实时目录以及模型图标目录（如可用）。"
        >
          <div className="settings-model-toolbar">
            <div className="settings-model-toolbar-main">
              <div className="settings-model-search">
                <Search className="settings-model-search-icon" />
                <input
                  className="settings-input settings-model-search-input"
                  value={modelQuery}
                  placeholder="搜索模型 / 供应商 / 能力..."
                  onChange={event => setModelQuery(event.target.value)}
                />
              </div>
              <button
                className="settings-button"
                disabled={busy}
                type="button"
                onClick={() => void fetchModels()}
              >
                <RefreshCw className="settings-model-toolbar-icon" />
                刷新目录
              </button>
            </div>
            {modelError || status ? (
              <p className="settings-model-toolbar-desc">
                {modelError ?? status}
              </p>
            ) : null}
          </div>
          <div className="settings-model-cards">
            {providerModels.length === 0 ? (
              <div className="model-card-grid-empty">
                暂无模型目录，请先点击「刷新目录」加载模型。
              </div>
            ) : filteredModelIds.length === 0 && !orphanModelId ? (
              <div className="model-card-grid-empty">
                {modelQuery.trim() ? (
                  <>未搜索到匹配「{modelQuery}」的模型。</>
                ) : (
                  <>当前供应商暂无可用模型。</>
                )}
              </div>
            ) : (
              <div className="model-card-grid">
                {orphanModelId && (
                  <ModelCard
                    modelId={orphanModelId}
                    metadata={modelMetadata[orphanModelId]}
                    isSelected={orphanModelId === model}
                    onSelect={setModel}
                    isOrphan
                  />
                )}
                {filteredModelIds.map(id => (
                  <ModelCard
                    key={id}
                    modelId={id}
                    metadata={modelMetadata[id]}
                    isSelected={id === model}
                    onSelect={setModel}
                  />
                ))}
              </div>
            )}
          </div>
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
            title="连接状态"
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

        <SettingsSection
          title="实验 Router"
          description="启用后在 chat-input dropdown 中显示 Router 选项。设置页只控制入口可见性，实际启用需在会话中通过 dropdown 切换。"
        >
          <SettingsRow
            title="启用 Pareto Code Router"
            description="启用后 dropdown 显示 Pareto Code 入口，发送消息时自动本地选择最优模型"
            autoSave
            control={
              <ToggleSwitch
                checked={settings.draft.values.enableParetoCodeRouter ?? false}
                onChange={checked => {
                  settings.draft.setValue('enableParetoCodeRouter', checked)
                  settings.draft.autoSave()
                }}
                ariaLabel="启用 Pareto Code Router"
              />
            }
          />
          <SettingsRow
            title="启用 Fusion Router"
            description="启用后 dropdown 显示 Fusion 入口，发送消息时自动执行多模型会审"
            autoSave
            control={
              <ToggleSwitch
                checked={settings.draft.values.enableFusionRouter ?? false}
                onChange={checked => {
                  settings.draft.setValue('enableFusionRouter', checked)
                  settings.draft.autoSave()
                }}
                ariaLabel="启用 Fusion Router"
              />
            }
          />
        </SettingsSection>
      </div>
    </SettingsContentArea>
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
