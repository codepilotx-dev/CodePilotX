import { desktopClient } from '../../services/desktopClient.js'
import { withModelCatalogLoading } from '../../hooks/useModelCatalogLoading.js'
﻿import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { SettingsRow } from './SettingsRow.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsSection } from './SettingsSection.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { fullErrorMessage } from '../../utils/errors.js'
import { Brain, Braces, Eye, EyeOff, Hammer, Link2 } from 'lucide-react'
import { ModelConnectionDialog } from './ModelConnectionDialog.js'
import {
  createModelConnectionDraft,
  isModelConnectionDraftDirty,
  restoreModelConnectionDraft,
  type ModelConnectionDraft,
} from './modelConnectionDraft.js'
import { getConfiguredProviderIDs } from './modelProviderConfiguration.js'
import {
  collectAvailableModelIDs,
  getCredentialVerificationLabel,
  getModelVerificationLabel,
  isVerificationRequestCurrent,
  type ModelConnectionVerificationStatus,
} from './modelConnectionVerification.js'
import {
  getApiKeyConnectionSavePlan,
  isConnectionSaveContextCurrent,
  type ConnectionSaveContext,
} from './modelConnectionSave.js'

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
  const [baseURL, setBaseURL] = useState(settings.providerBaseURL)
  const [apiKey, setApiKey] = useState('')
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [model, setModel] = useState(settings.model)
  const [savedConnection, setSavedConnection] = useState<ModelConnectionDraft>(() => ({
    providerID: settings.providerID,
    baseURL: settings.providerBaseURL,
    model: settings.model,
  }))
  const [dialogOpen, setDialogOpen] = useState(false)
  const configureConnectionButtonRef = useRef<HTMLButtonElement | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [balanceStatus, setBalanceStatus] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [verificationStatus, setVerificationStatus] =
    useState<ModelConnectionVerificationStatus>('idle')
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [availableModelIDs, setAvailableModelIDs] = useState<Set<string>>(
    () => new Set(),
  )
  const verificationRequestIDRef = useRef(0)
  const connectionContextRef = useRef({ providerID, baseURL })
  connectionContextRef.current = { providerID, baseURL }
  const saveRequestIDRef = useRef(0)
  const saveContextRef = useRef({ providerID, baseURL, model })
  saveContextRef.current = { providerID, baseURL, model }
  const copilotAutoSaveAttemptRef = useRef<string | null>(null)
  const [copilotAutoSaveRetry, setCopilotAutoSaveRetry] = useState(0)
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
  const hasGitHubCopilotProvider = providers.some(
    provider =>
      provider.kind === 'github-copilot' ||
      provider.providerID === 'github-copilot',
  )
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
  const displayModelIds = useMemo(
    () => (orphanModelId ? [orphanModelId, ...providerModels] : providerModels),
    [orphanModelId, providerModels],
  )
  const requiresBaseURL = Boolean(selectedProvider?.requiresBaseURL)
  const baseURLEditable = requiresBaseURL
  const apiKeyConfigured = Boolean(
    selectedProviderState?.apiKeyConfigured ?? selectedProvider?.apiKeyConfigured,
  )
  const connectionDraft = useMemo<ModelConnectionDraft>(
    () => ({ providerID, baseURL, model }),
    [baseURL, model, providerID],
  )
  const connectionDirty = isModelConnectionDraftDirty(
    connectionDraft,
    savedConnection,
  )
  const savedProvider = useMemo(
    () => providers.find(provider => provider.providerID === savedConnection.providerID),
    [providers, savedConnection.providerID],
  )
  const savedIsGitHubCopilot =
    savedProvider?.kind === 'github-copilot' ||
    savedConnection.providerID === 'github-copilot'
  const configuredProviderIDs = useMemo(
    () => getConfiguredProviderIDs(providers, Boolean(copilotAuth?.authenticated)),
    [copilotAuth?.authenticated, providers],
  )
  const credentialVerificationLabel = getCredentialVerificationLabel(
    verificationStatus,
    isGitHubCopilot ? Boolean(copilotAuth?.authenticated) : apiKeyConfigured,
  )
  const modelVerificationLabel = getModelVerificationLabel(
    verificationStatus,
    availableModelIDs.size,
    displayModelIds.length,
  )

  function resetVerification(): void {
    verificationRequestIDRef.current += 1
    if (verificationStatus === 'testing') setBusy(false)
    setVerificationStatus('idle')
    setVerificationError(null)
    setAvailableModelIDs(new Set())
  }

  function invalidateConnectionSaves(): void {
    saveRequestIDRef.current += 1
  }

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setBaseURL(nextSelection.baseURL)
    setModel(nextSelection.model)
    setApiKey('')
    setApiKeyVisible(false)
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  useEffect(() => {
    if (!hasGitHubCopilotProvider) return
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
  }, [hasGitHubCopilotProvider])

  useEffect(() => {
    resetVerification()
    invalidateConnectionSaves()
  }, [copilotAuth?.authenticated])

  useEffect(() => {
    if (!isGitHubCopilot || !copilotAuth?.authenticated || !connectionDirty) return
    const attemptKey = [providerID, baseURL, model, copilotAutoSaveRetry].join('\u0000')
    if (copilotAutoSaveAttemptRef.current === attemptKey) return
    copilotAutoSaveAttemptRef.current = attemptKey
    setBusy(true)
    void saveCurrentProviderConnection(
      'GitHub Copilot 模型连接已自动保存。',
    ).then(result => {
      if (result === 'error') {
        setStatus('GitHub Copilot 连接自动保存失败。请点击「刷新状态」重试。')
      }
      if (copilotAutoSaveAttemptRef.current === attemptKey) setBusy(false)
    })
  }, [
    baseURL,
    connectionDirty,
    copilotAuth?.authenticated,
    copilotAutoSaveRetry,
    isGitHubCopilot,
    model,
    onError,
    providerID,
  ])

  async function startCopilotLogin(): Promise<void> {
    resetVerification()
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
    resetVerification()
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
    resetVerification()
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
      setCopilotAutoSaveRetry(value => value + 1)
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
    setBalanceStatus(null)
    setStatus(null)
    setModelError(null)
    resetVerification()
    invalidateConnectionSaves()
    copilotAutoSaveAttemptRef.current = null
  }

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
    setSavedConnection({
      providerID: nextState.selectedProviderID,
      baseURL: nextState.baseURL ?? '',
      model: nextModel,
    })
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

  async function fetchBalance(): Promise<DesktopProviderBalanceResult> {
    return desktopClient.fetchProviderBalance({
      providerID,
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
    })
  }

  async function testConnection(): Promise<void> {
    if (apiKey.trim()) {
      const message = '测试连接前请先保存输入的 API 密钥。'
      setModelError(message)
      setVerificationError(message)
      setVerificationStatus('error')
      setAvailableModelIDs(new Set())
      onError(message)
      return
    }
    if (requiresBaseURL && !baseURL.trim()) {
      const message = '测试前请为该供应商配置兼容 OpenAI 的 Base URL。'
      setModelError(message)
      setVerificationError(message)
      setVerificationStatus('error')
      setAvailableModelIDs(new Set())
      onError(message)
      return
    }
    setBusy(true)
    const request = {
      id: verificationRequestIDRef.current + 1,
      providerID,
      baseURL,
    }
    verificationRequestIDRef.current = request.id
    setVerificationStatus('testing')
    setVerificationError(null)
    setAvailableModelIDs(new Set())
    setModelError(null)
    setStatus('正在测试连接...')
    try {
      const modelsRequest = withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
          baseURL: baseURL.trim() || undefined,
        }),
      )
const [modelsResult, balanceResult] = isDeepSeek
        ? await Promise.all([modelsRequest, fetchBalance()])
        : [await modelsRequest, null]
      const currentContext = connectionContextRef.current
      if (
        !isVerificationRequestCurrent(
          request,
          verificationRequestIDRef.current,
          currentContext.providerID,
          currentContext.baseURL,
        )
      ) {
        return
      }
      if (balanceResult) setBalanceStatus(formatBalanceStatus(balanceResult))
      applyFetchedModels(modelsResult.models, modelsResult.error)
      const errors = [modelsResult.error, balanceResult?.error].filter(
        (item): item is string => Boolean(item),
      )
      const errorMessage = errors.length > 0 ? errors.join('；') : null
      setModelError(errorMessage)
      setVerificationError(errorMessage)
      setVerificationStatus(errorMessage ? 'error' : 'success')
      setAvailableModelIDs(
        errorMessage
          ? new Set()
          : collectAvailableModelIDs(
              [...displayModelIds, ...modelsResult.models],
              modelsResult.models,
            ),
      )
      if (errorMessage) onError(errorMessage)
      setStatus(
        errors.length > 0
          ? null
          : `连接正常。共找到 ${modelsResult.models.length} 个模型。`,
      )
    } catch (error) {
      const currentContext = connectionContextRef.current
      if (
        !isVerificationRequestCurrent(
          request,
          verificationRequestIDRef.current,
          currentContext.providerID,
          currentContext.baseURL,
        )
      ) {
        return
      }
      setVerificationStatus('error')
      setVerificationError(fullErrorMessage(error))
      setAvailableModelIDs(new Set())
      showOperationError(error)
    } finally {
      const currentContext = connectionContextRef.current
      if (
        isVerificationRequestCurrent(
          request,
          verificationRequestIDRef.current,
          currentContext.providerID,
          currentContext.baseURL,
        )
      ) {
        setBusy(false)
      }
    }
  }

  async function saveCurrentProviderConnection(
    successMessage: string,
    existingRequest?: ConnectionSaveContext,
  ): Promise<'saved' | 'error' | 'stale'> {
    const request = existingRequest ?? {
      id: saveRequestIDRef.current + 1,
      providerID,
      baseURL,
      model,
    }
    saveRequestIDRef.current = request.id
    if (requiresBaseURL && !request.baseURL.trim()) {
      const message = '保存为可调用连接前，该 Models.dev 供应商需要 Base URL。'
      setModelError(message)
      onError(message)
      return 'error'
    }
    if (!request.model.trim()) {
      const message = '保存前请选择一个具体模型。'
      setModelError(message)
      onError(message)
      return 'error'
    }
    setModelError(null)
    try {
      const nextState = await desktopClient.saveModelProvider({
        providerID: request.providerID as ModelProviderID,
        modelID: request.model.trim(),
        baseURL: request.baseURL.trim() || undefined,
      })
      if (
        !isConnectionSaveContextCurrent(
          request,
          saveRequestIDRef.current,
          saveContextRef.current,
        )
      ) {
        return 'stale'
      }
      applyProviderState(nextState, { persistEffectiveSettings: true })
      setStatus(successMessage)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return 'saved'
    } catch (error) {
      if (
        !isConnectionSaveContextCurrent(
          request,
          saveRequestIDRef.current,
          saveContextRef.current,
        )
      ) {
        return 'stale'
      }
      showOperationError(error)
      return 'error'
    }
  }

  async function saveApiKeyAndConnection(): Promise<void> {
    const plan = getApiKeyConnectionSavePlan(apiKey, apiKeyConfigured)
    if (plan.kind === 'missing-credential') {
      const message = '请输入 API 密钥后再保存连接。'
      setModelError(message)
      onError(message)
      return
    }
    setBusy(true)
    setModelError(null)
    const request: ConnectionSaveContext = {
      id: saveRequestIDRef.current + 1,
      providerID,
      baseURL,
      model,
    }
    saveRequestIDRef.current = request.id
    try {
      if (plan.kind === 'save-key-and-connection') {
        await desktopClient.saveProviderApiKey(
          request.providerID as ModelProviderID,
          plan.apiKey,
        )
        if (
          !isConnectionSaveContextCurrent(
            request,
            saveRequestIDRef.current,
            saveContextRef.current,
          )
        ) {
          const message = 'API 密钥已保存，但连接配置已变化，未继续保存模型连接。'
          setModelError(message)
          onError(message)
          return
        }
        setApiKey('')
        setApiKeyVisible(false)
        resetVerification()
        setProviders(current =>
          current.map(provider =>
            provider.providerID === providerID
              ? { ...provider, apiKeyConfigured: true }
              : provider,
          ),
        )
        setProviderState(current => {
          if (!current || current.selectedProviderID !== providerID) return current
          return {
            ...current,
            apiKeyConfigured: true,
            apiKeySource: 'secureStorage',
            provider: { ...current.provider, apiKeyConfigured: true },
          }
        })
      }
      await saveCurrentProviderConnection(
        plan.kind === 'save-key-and-connection'
          ? 'API 密钥与模型连接已保存。'
          : '模型连接已保存。',
        request,
      )
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
      setApiKeyVisible(false)
      resetVerification()
      setProviders(current =>
        current.map(provider =>
          provider.providerID === providerID
            ? { ...provider, apiKeyConfigured: false }
            : provider,
        ),
      )
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
            {savedIsGitHubCopilot ? (
              <span className={`settings-connection-badge ${copilotAuth?.authenticated ? 'ok' : 'warn'}`}>
                <span className="settings-connection-badge-dot" />
                {copilotAuth?.authenticated ? 'GitHub 已登录' : 'GitHub 未登录'}
              </span>
            ) : (
              <span className={`settings-connection-badge ${savedProvider?.apiKeyConfigured ? 'ok' : 'warn'}`}>
                <span className="settings-connection-badge-dot" />
                {savedProvider?.apiKeyConfigured ? 'API 密钥已配置' : 'API 密钥未配置'}
              </span>
            )}
            <button
              ref={configureConnectionButtonRef}
              className="settings-button primary settings-connection-summary-action"
              type="button"
              onClick={() => {
                const restored = createModelConnectionDraft(savedConnection)
                setProviderID(restored.providerID)
                setBaseURL(restored.baseURL)
                setModel(restored.model)
                setApiKey('')
                setApiKeyVisible(false)
                setModelError(null)
                setStatus(null)
                resetVerification()
                setDialogOpen(true)
              }}
            >
              配置连接
            </button>
          </div>
          <div className="settings-connection-summary-body">
            <div className="settings-connection-summary-main">
              <div className="settings-connection-summary-name">
                {savedProvider?.displayName ?? savedConnection.providerID}
              </div>
              <div className="settings-connection-summary-detail">
                {savedConnection.model || '未选择模型'} / {savedConnection.baseURL || '无需 Base URL'}
              </div>
            </div>
            <div className="settings-connection-summary-divider" />
            <div className="settings-connection-summary-meta">
              <div className="settings-connection-summary-meta-item">
                <span className="settings-connection-summary-meta-label">类型</span>
                <span className="settings-connection-summary-meta-value">
                  {savedProvider?.kind ?? 'openai-compatible'}
                </span>
              </div>
              <div className="settings-connection-summary-meta-item">
                <span className="settings-connection-summary-meta-label">来源</span>
                <span className="settings-connection-summary-meta-value">
                  {savedProvider?.modelsDevSource ? 'Models.dev' : '内置'}
                </span>
              </div>
            </div>
          </div>
        </section>

        <ModelConnectionDialog
          open={dialogOpen}
          dirty={connectionDirty}
          busy={busy}
          providerID={providerID}
          providers={providers}
          configuredProviderIDs={configuredProviderIDs}
          returnFocusRef={configureConnectionButtonRef}
          onOpen={() => setDialogOpen(true)}
          onClose={() => setDialogOpen(false)}
          onDiscard={() => {
            const restored = restoreModelConnectionDraft(savedConnection)
            setProviderID(restored.providerID)
            setBaseURL(restored.baseURL)
            setModel(restored.model)
            setApiKey('')
            setApiKeyVisible(false)
            resetVerification()
            invalidateConnectionSaves()
            setDialogOpen(false)
          }}
          onProviderSelect={provider =>
            applyProviderSelection(provider.providerID, provider)
          }
        >
        <SettingsSection
          title="连接详情"
          description={providerDescription(selectedProvider)}
        >
          {!isGitHubCopilot ? (
            <SettingsRow
              title="Base URL"
              description={baseURLDescription(selectedProvider, isMiniMax)}
              control={
                <input
                  className="settings-input settings-input-wide settings-input-mono"
                  disabled={busy}
                  readOnly={!baseURLEditable}
                  value={baseURL}
                  placeholder={selectedProvider?.baseURL ?? 'https://.../v1'}
                  onChange={event => {
                    setBaseURL(event.target.value)
                    resetVerification()
                    invalidateConnectionSaves()
                  }}
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
          actions={
            <div className="settings-section-inline-actions">
              <span
                aria-label={`凭据状态：${credentialVerificationLabel}${verificationError ? `。${verificationError}` : ''}`}
                className={`settings-chip ${verificationStatus === 'success' ? 'ok' : verificationStatus === 'testing' ? 'pending' : 'warn'}`}
                title={verificationError ?? credentialVerificationLabel}
              >
                {credentialVerificationLabel}
              </span>
              <button
                className="settings-button"
                disabled={busy}
                type="button"
                onClick={() => void testConnection()}
              >
                测试连接
              </button>
            </div>
          }
        >
          {isGitHubCopilot ? (
            <div className="settings-credential-panel">
              <div className="settings-credential-controls">
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
              </div>
              <div className="settings-credential-controls">
                <div className="settings-credential-input-wrap">
                  <input
                    className="settings-input settings-credential-input"
                    disabled={busy}
                    value={apiKey}
                    placeholder={apiKeyConfigured ? '输入后保存 (已配置)' : '输入后保存'}
                    type={apiKeyVisible ? 'text' : 'password'}
                    onChange={event => {
                      setApiKey(event.target.value)
                      resetVerification()
                    }}
                  />
                  <button
                    aria-label={apiKeyVisible ? '隐藏 API 密钥' : '显示 API 密钥'}
                    className="settings-credential-visibility"
                    disabled={!apiKey}
                    title={apiKeyVisible ? '隐藏 API 密钥' : '显示 API 密钥'}
                    type="button"
                    onClick={() => setApiKeyVisible(visible => !visible)}
                  >
                    {apiKeyVisible ? <EyeOff /> : <Eye />}
                  </button>
                </div>
                <div className="settings-credential-actions">
                  <button
                    className="settings-button"
                    disabled={busy}
                    type="button"
                    onClick={() => void saveApiKeyAndConnection()}
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
          description="只读展示当前供应商提供的模型与元数据。切换供应商时使用其默认模型。"
          actions={
            <span
              aria-label={`模型状态：${modelVerificationLabel}${verificationError ? `。${verificationError}` : ''}`}
              className={`settings-chip ${verificationStatus === 'success' ? 'ok' : verificationStatus === 'testing' ? 'pending' : 'warn'}`}
              title={verificationError ?? modelVerificationLabel}
            >
              {modelVerificationLabel}
            </span>
          }
        >
          <div className="settings-model-cards">
            {displayModelIds.length === 0 ? (
              <div className="model-card-grid-empty">
                当前供应商暂无可展示的模型信息。
              </div>
            ) : (
              <div className="model-card-grid">
                {displayModelIds.map(id => (
                  <ModelCard
                    key={id}
                    modelId={id}
                    metadata={modelMetadata[id]}
                    available={
                      verificationStatus === 'success' &&
                      availableModelIDs.has(id)
                    }
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

        </ModelConnectionDialog>

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

function ModelCard({
  modelId,
  metadata,
  available,
}: {
  modelId: string
  metadata: DesktopModelMetadata | undefined
  available: boolean
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
    <div
      aria-label={`${displayName || modelId}${available ? '，可用' : ''}`}
      className="model-card"
      data-available={available ? '' : undefined}
      role="group"
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
    </div>
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
