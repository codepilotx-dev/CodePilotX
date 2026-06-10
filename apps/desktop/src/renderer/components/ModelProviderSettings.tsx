import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../shared/types.js'
import { useDesktopSettings } from '../features/settings/useDesktopSettings.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'

export function ModelProviderSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerState, setProviderState] =
    useState<DesktopModelProviderState | null>(null)
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  )
  const [baseURL, setBaseURL] = useState(settings.providerBaseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [modelError, setModelError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

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

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    setBaseURL(selectedProvider?.baseURL ?? '')
  }, [providerID, providerState, selectedProvider])

  const modelOptions = useMemo(
    () => [
      { value: '', label: '默认模型' },
      ...(providerState?.models ?? selectedProvider?.defaultModels ?? []).map(
        item => ({ value: item, label: item }),
      ),
    ],
    [providerState, selectedProvider],
  )

  function applyProviderState(nextState: DesktopModelProviderState): void {
    setProviderState(nextState)
    setProviderID(nextState.selectedProviderID)
    setBaseURL(nextState.baseURL ?? '')
    setModel(nextState.model)
    settings.setProviderID(nextState.selectedProviderID)
    settings.setProviderBaseURL(nextState.baseURL ?? '')
    settings.setModel(nextState.model)
  }

  async function fetchModels(): Promise<void> {
    setModelError(null)
    const result = await window.desktopApi.fetchProviderModels({
      providerID,
      apiKey: apiKey.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
    })
    setProviderState(current =>
      current
        ? { ...current, models: result.models, error: result.error }
        : current,
    )
    setModelError(result.error ?? null)
  }

  async function saveProvider(): Promise<void> {
    setModelError(null)
    const nextState = await window.desktopApi.saveModelProvider({
      providerID,
      modelID: model.trim() || undefined,
      baseURL: baseURL.trim() || undefined,
    })
    applyProviderState(nextState)
    setStatus('模型连接已保存')
    window.dispatchEvent(new Event('desktop:model-provider-changed'))
  }

  async function saveApiKey(): Promise<void> {
    if (!apiKey.trim()) {
      setModelError('请输入 API key。')
      return
    }
    setModelError(null)
    const nextState = await window.desktopApi.saveProviderApiKey(
      providerID,
      apiKey.trim(),
    )
    setApiKey('')
    applyProviderState(nextState)
    setStatus('API key 已保存')
    window.dispatchEvent(new Event('desktop:model-provider-changed'))
  }

  return (
    <SettingsSection
      title="模型连接"
      description="配置桌面端新会话使用的模型提供商、模型和 API key。"
    >
      <SettingsRow
        title="提供商"
        description="新会话会使用这里选择的 provider。"
        control={
          <SettingsDropdown
            ariaLabel="模型提供商"
            value={providerID}
            options={providers.map(provider => ({
              value: provider.providerID,
              label: provider.displayName,
            }))}
            onChange={value => setProviderID(value as ModelProviderID)}
          />
        }
      />
      <SettingsRow
        title="Base URL"
        description="Custom provider 需要填写 OpenAI-compatible base URL。"
        control={
          <input
            className="settings-input"
            value={baseURL}
            placeholder={selectedProvider?.baseURL ?? 'https://.../v1'}
            onChange={event => setBaseURL(event.target.value)}
          />
        }
      />
      <SettingsRow
        title="API key"
        description={
          providerState?.apiKeyConfigured
            ? `已配置：${providerState.apiKeySource ?? 'secureStorage'}`
            : '不会明文写入桌面配置 JSON。'
        }
        control={
          <div className="settings-inline-actions">
            <input
              className="settings-input"
              value={apiKey}
              placeholder="输入后保存"
              type="password"
              onChange={event => setApiKey(event.target.value)}
            />
            <button
              className="settings-button"
              type="button"
              onClick={() => void saveApiKey()}
            >
              保存
            </button>
          </div>
        }
      />
      <SettingsRow
        title="模型"
        description="留空表示使用该 provider 的默认模型。"
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
        title="操作"
        description={modelError ?? status ?? '拉取模型列表或保存当前连接。'}
        control={
          <div className="settings-inline-actions">
            <button
              className="settings-button"
              type="button"
              onClick={() => void fetchModels()}
            >
              拉取模型
            </button>
            <button
              className="settings-button"
              type="button"
              onClick={() => void saveProvider()}
            >
              保存连接
            </button>
          </div>
        }
      />
    </SettingsSection>
  )
}
