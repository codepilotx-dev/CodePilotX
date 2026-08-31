import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  Eye,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useId, useMemo, useState } from 'react'
import type {
  DesktopCustomProviderDefinition,
  DesktopModelProviderSummary,
  DesktopProviderModelDefinition,
} from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { Input } from '../../../components/ui/Input.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from '../../../components/ui/iconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'
import { useLastNonNull } from '../../../hooks/usePresenceRetention.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import {
  PROVIDER_PRESETS,
  type ProviderPreset,
} from './providerEditorPresets.js'

const API_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
] as const

type Api = DesktopProviderModelDefinition['api']

type EditableModel = {
  id: string
  name: string
  api: Api
  enabled: boolean
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  imageInput: boolean
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  headers: string
  thinkingLevelMap: string
  compat: string
}

type DialogTab = 'basic' | 'models' | 'advanced'

export type ProviderEditorDialogProps = {
  open: boolean
  provider?: DesktopModelProviderSummary
  onOpenChange: (open: boolean) => void
  onSaved: (providerId: string) => void | Promise<void>
}

export function ProviderEditorDialog({
  open,
  provider: currentProvider,
  onOpenChange,
  onSaved,
}: ProviderEditorDialogProps): React.ReactNode {
  const retainedProvider = useLastNonNull(currentProvider)
  const provider = open ? currentProvider : retainedProvider ?? undefined
  const titleId = useId()
  const editing = provider?.providerKind === 'custom'
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  const [activeTab, setActiveTab] = useState<DialogTab>('basic')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [auth, setAuth] = useState<'api-key' | 'none'>('api-key')
  const [enabled, setEnabled] = useState(true)
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false)
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [models, setModels] = useState<EditableModel[]>([emptyModel()])
  const [expandedModels, setExpandedModels] = useState<Set<number>>(new Set([0]))
  const [candidates, setCandidates] = useState<DesktopProviderModelDefinition[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setActiveTab('basic')
    const customConfig = provider?.config?.kind === 'custom'
      ? provider.config
      : undefined
    const nextModels = customConfig?.models.map(model => editableModel(model))
      ?? provider?.defaultModels.map(modelId => {
        const metadata = provider.modelMetadata?.[modelId]
        return {
          id: modelId,
          name: metadata?.name ?? modelId,
          api: metadata?.providerApi ?? provider.providerApis?.[0] ?? 'openai-completions',
          enabled: true,
          contextWindow: metadata?.contextWindow ?? 32_768,
          maxTokens: metadata?.outputTokens ?? 8_192,
          reasoning: metadata?.reasoning ?? false,
          imageInput: metadata?.vision ?? false,
          inputCost: metadata?.inputCost ?? 0,
          outputCost: metadata?.outputCost ?? 0,
          cacheReadCost: metadata?.cacheReadCost ?? 0,
          cacheWriteCost: metadata?.cacheWriteCost ?? 0,
          headers: '',
          thinkingLevelMap: '',
          compat: '',
        } satisfies EditableModel
      }) ?? []
    setId(provider?.providerID ?? '')
    setName(provider?.displayName ?? '')
    setBaseUrl(provider?.baseURL ?? '')
    setAuth(customConfig?.auth ?? (
      provider?.authMethods?.includes('api-key') === false ? 'none' : 'api-key'
    ))
    setEnabled(customConfig?.enabled ?? provider?.enabled ?? true)
    setAllowInsecureHttp(customConfig?.allowInsecureHttp ?? false)
    setEnv(customConfig?.env.join(', ') ?? provider?.envVars?.join(', ') ?? '')
    setHeaders(headersToText(customConfig?.headers ?? {}))
    setModels(nextModels.length > 0 ? nextModels : [emptyModel()])
    setExpandedModels(new Set([0]))
    setCandidates([])
    setSelectedCandidates(new Set())
    setError(null)
  }, [open, provider])

  function applyPreset(preset: ProviderPreset): void {
    setId(preset.defaultValues.id)
    setName(preset.defaultValues.name)
    setBaseUrl(preset.defaultValues.baseUrl)
    setAuth(preset.defaultValues.auth)
    setModels(
      preset.defaultValues.models.map(item => ({
        ...emptyModel(),
        id: item.id,
        name: item.name,
        api: item.api,
        contextWindow: item.contextWindow,
        maxTokens: item.maxTokens,
        reasoning: item.reasoning,
        imageInput: item.imageInput,
      })),
    )
    setExpandedModels(new Set([0]))
    setError(null)
  }

  function toggleExpandModel(index: number): void {
    setExpandedModels(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const definition = useMemo(() => {
    const headerEntries = parseHeaders(headers)
    if (headerEntries instanceof Error) return headerEntries
    const normalizedModels: DesktopProviderModelDefinition[] = []
    for (const model of models.filter(item => item.id.trim())) {
      const modelHeaders = parseHeaders(model.headers)
      if (modelHeaders instanceof Error) {
        return new Error(`模型 ${model.id || '(未命名)'}：${modelHeaders.message}`)
      }
      const thinkingLevelMap = parseJsonObject(model.thinkingLevelMap, 'thinkingLevelMap')
      if (thinkingLevelMap instanceof Error) return thinkingLevelMap
      const compat = parseJsonObject(model.compat, 'compat')
      if (compat instanceof Error) return compat
      normalizedModels.push({
        id: model.id.trim(),
        name: model.name.trim() || model.id.trim(),
        api: model.api,
        enabled: model.enabled,
        contextWindow: model.contextWindow || 32_768,
        maxTokens: model.maxTokens || 8_192,
        reasoning: model.reasoning,
        input: model.imageInput ? ['text', 'image'] : ['text'],
        cost: {
          input: model.inputCost || 0,
          output: model.outputCost || 0,
          cacheRead: model.cacheReadCost || 0,
          cacheWrite: model.cacheWriteCost || 0,
        },
        ...(Object.keys(modelHeaders).length > 0 ? { headers: modelHeaders } : {}),
        ...(thinkingLevelMap ? { thinkingLevelMap: thinkingLevelMap as never } : {}),
        ...(compat ? { compat } : {}),
      } as unknown as DesktopProviderModelDefinition)
    }
    if (!id.trim() || !name.trim() || !baseUrl.trim()) {
      return new Error('Provider ID、名称和 Base URL 不能为空。')
    }
    if (normalizedModels.length === 0) return new Error('至少添加一个有效模型。')
    return {
      kind: 'custom',
      id: id.trim(),
      name: name.trim(),
      enabled,
      baseUrl: baseUrl.trim(),
      auth,
      env: env.split(',').map(item => item.trim()).filter(Boolean),
      allowInsecureHttp,
      headers: headerEntries,
      models: normalizedModels,
    } as unknown as DesktopCustomProviderDefinition
  }, [allowInsecureHttp, auth, baseUrl, enabled, env, headers, id, models, name])

  async function save(): Promise<void> {
    if (definition instanceof Error) {
      setError(definition.message)
      return
    }
    if (
      definition.allowInsecureHttp
      && /^http:\/\//i.test(definition.baseUrl)
      && !isLoopbackUrl(definition.baseUrl)
      && !window.confirm('此 Endpoint 使用局域网或远程明文 HTTP，凭据可能被窃听。仍要保存吗？')
    ) return
    setBusy(true)
    setError(null)
    try {
      if (editing) {
        await desktopClient.updateProvider(provider.providerID, definition)
      } else {
        await desktopClient.createProvider(definition)
      }
      await onSaved(definition.id)
      onOpenChange(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function discover(): Promise<void> {
    if (!editing) {
      setError('请先保存 Provider，再主动导入 /models。')
      return
    }
    if (definition instanceof Error) {
      setError(definition.message)
      return
    }
    const api = models.find(model => model.api !== 'anthropic-messages')?.api
    if (!api || api === 'anthropic-messages') {
      setError('Anthropic Messages Endpoint 不支持自动发现。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await desktopClient.discoverProviderModels(provider.providerID, api)
      setCandidates(result)
      setSelectedCandidates(new Set(result.map(model => String(model.id))))
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : String(discoverError))
    } finally {
      setBusy(false)
    }
  }

  function importSelected(): void {
    const existing = new Set(models.map(model => model.id))
    const imported = candidates
      .filter(model => selectedCandidates.has(String(model.id)) && !existing.has(String(model.id)))
      .map(model => editableModel(model))
    setModels(current => [...current, ...imported])
    setCandidates([])
    setSelectedCandidates(new Set())
  }

  const isRemoteHttp = /^http:\/\//i.test(baseUrl) && !isLoopbackUrl(baseUrl)

  const tabOptions: readonly { value: DialogTab; label: React.ReactNode }[] = [
    { value: 'basic', label: '基本配置' },
    { value: 'models', label: `模型管理 (${models.length})` },
    { value: 'advanced', label: '高级与网络' },
  ]

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-labelledby={titleId}
          className="ui-dialog-surface ui-dialog-surface--centered provider-editor-dialog"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <header className="provider-editor-header">
            <div className="provider-editor-heading">
              <div className="provider-editor-icon">
                <Server
                  aria-hidden
                  size={APP_ICON_SIZE + 4}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </div>
              <div>
                <Dialog.Title id={titleId}>
                  {editing ? `编辑 ${provider.displayName}` : '新增自定义 Provider'}
                </Dialog.Title>
                <Dialog.Description>
                  配置兼容 OpenAI / Anthropic 协议的自定义模型端点
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <IconButton color="ghostSecondary" size="toolbar" title="关闭">
                <X aria-hidden />
              </IconButton>
            </Dialog.Close>
          </header>

          <div className="provider-editor-tabs-bar">
            <SegmentedControl<DialogTab>
              ariaLabel="配置分类"
              onChange={setActiveTab}
              options={tabOptions}
              semantics="tabs"
              value={activeTab}
            />
          </div>

          <div className="provider-editor-body">
            {activeTab === 'basic' ? (
              <div className="provider-editor-tab-panel">
                {!editing ? (
                  <section className="provider-editor-presets-section">
                    <div className="provider-editor-presets-header">
                      <span>快速套用常用预设</span>
                      <Sparkles
                        aria-hidden
                        size={APP_ICON_SIZE - 2}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    </div>
                    <div className="provider-editor-presets-list">
                      {PROVIDER_PRESETS.map(preset => (
                        <button
                          className="provider-editor-preset-chip"
                          key={preset.id}
                          title={preset.description}
                          type="button"
                          onClick={() => applyPreset(preset)}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="provider-editor-grid">
                  <label className="provider-editor-field provider-editor-field--mono">
                    <span>
                      Provider ID
                      {editing ? <small>（不可修改）</small> : null}
                    </span>
                    <Input
                      placeholder="如：custom-ollama"
                      readOnly={editing}
                      value={id}
                      onChange={event => setId(event.target.value)}
                    />
                  </label>
                  <label className="provider-editor-field">
                    <span>显示名称</span>
                    <Input
                      placeholder="如：Ollama 本地服务"
                      value={name}
                      onChange={event => setName(event.target.value)}
                    />
                  </label>
                </div>

                <label className="provider-editor-field provider-editor-field--mono">
                  <span>Base URL</span>
                  <Input
                    placeholder="https://example.com/v1"
                    value={baseUrl}
                    onChange={event => setBaseUrl(event.target.value)}
                  />
                  <p>端点 URL，例如本地服务 http://localhost:11434/v1 或官方 API 路径。</p>
                </label>

                <div className="provider-editor-grid">
                  <label className="provider-editor-field">
                    <span>认证方式</span>
                    <SettingsDropdown
                      ariaLabel="认证方式"
                      options={[
                        { value: 'api-key', label: 'API Key（需要凭据）' },
                        { value: 'none', label: '无需认证（本地/公开服务）' },
                      ]}
                      value={auth}
                      width="100%"
                      onChange={value => setAuth(value as 'api-key' | 'none')}
                    />
                  </label>
                  <label className="provider-editor-field provider-editor-field--mono">
                    <span>凭据环境变量（逗号分隔）</span>
                    <Input
                      placeholder="如：OLLAMA_API_KEY, CUSTOM_API_KEY"
                      value={env}
                      onChange={event => setEnv(event.target.value)}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {activeTab === 'models' ? (
              <div className="provider-editor-tab-panel">
                <header className="provider-editor-models-header">
                  <div className="provider-editor-models-title">
                    <h3>模型列表</h3>
                    <span>{models.length}</span>
                  </div>
                  <div className="provider-editor-models-actions">
                    {editing ? (
                      <Button
                        color="secondary"
                        disabled={busy}
                        onClick={() => void discover()}
                      >
                        <RefreshCw aria-hidden size={APP_ICON_SIZE} />
                        从 /models 导入
                      </Button>
                    ) : null}
                    <Button
                      color="secondary"
                      onClick={() => {
                        setModels(current => [...current, emptyModel()])
                        setExpandedModels(current => new Set([...current, models.length]))
                      }}
                    >
                      <Plus aria-hidden size={APP_ICON_SIZE} />
                      新增模型
                    </Button>
                  </div>
                </header>

                {candidates.length > 0 ? (
                  <section className="provider-editor-candidates-card">
                    <header>
                      <strong>发现 {candidates.length} 个候选模型</strong>
                      <Button
                        color="primary"
                        disabled={selectedCandidates.size === 0}
                        onClick={importSelected}
                      >
                        导入已选 ({selectedCandidates.size})
                      </Button>
                    </header>
                    <div className="provider-editor-candidates-list">
                      {candidates.map(candidate => (
                        <label
                          className="provider-editor-candidate-row"
                          key={String(candidate.id)}
                        >
                          <input
                            checked={selectedCandidates.has(String(candidate.id))}
                            type="checkbox"
                            onChange={event => setSelectedCandidates(current => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(String(candidate.id))
                              else next.delete(String(candidate.id))
                              return next
                            })}
                          />
                          <span>{String(candidate.id)}</span>
                          <span className="provider-editor-model-card-badge">{candidate.api}</span>
                        </label>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="provider-editor-models-list">
                  {models.map((model, index) => {
                    const isExpanded = expandedModels.has(index)
                    const modelDetailsId = `${titleId}-model-${index}-details`
                    return (
                      <div
                        className="provider-editor-model-card"
                        data-expanded={isExpanded}
                        key={`${index}-${model.id}`}
                      >
                        <div
                          className="provider-editor-model-card-header"
                        >
                          <button
                            aria-controls={modelDetailsId}
                            aria-expanded={isExpanded}
                            className="provider-editor-model-card-summary"
                            type="button"
                            onClick={() => toggleExpandModel(index)}
                          >
                            <span className="provider-editor-model-card-chevron">
                              {isExpanded ? (
                                <ChevronDown aria-hidden size={APP_ICON_SIZE} />
                              ) : (
                                <ChevronRight aria-hidden size={APP_ICON_SIZE} />
                              )}
                            </span>
                            <code>{model.id || '(未命名模型)'}</code>
                            {model.name && model.name !== model.id ? (
                              <span className="provider-editor-model-card-name">({model.name})</span>
                            ) : null}
                            <span className="provider-editor-model-card-badge">{model.api}</span>
                            {model.reasoning ? (
                              <span className="provider-editor-model-card-tag provider-editor-model-tag--reasoning">
                                <Brain aria-hidden size={12} />
                                Reasoning
                              </span>
                            ) : null}
                            {model.imageInput ? (
                              <span className="provider-editor-model-card-tag provider-editor-model-tag--vision">
                                <Eye aria-hidden size={12} />
                                Vision
                              </span>
                            ) : null}
                          </button>

                          <div className="provider-editor-model-card-controls">
                            <ToggleSwitch
                              ariaLabel="启用模型"
                              checked={model.enabled}
                              onChange={enabledVal => setModels(current => current.map((item, itemIndex) => (
                                itemIndex === index ? { ...item, enabled: enabledVal } : item
                              )))}
                            />
                            {models.length > 1 ? (
                              <IconButton
                                color="danger"
                                size="toolbar"
                                title="移除模型"
                                onClick={() => setModels(current => current.filter((_, itemIndex) => itemIndex !== index))}
                              >
                                <Trash2 aria-hidden size={APP_ICON_SIZE} />
                              </IconButton>
                            ) : null}
                          </div>
                        </div>

                        <div
                          className="provider-editor-model-card-body"
                          hidden={!isExpanded}
                          id={modelDetailsId}
                        >
                          {isExpanded ? (
                            <ModelEditor
                              model={model}
                              onChange={next => setModels(current => current.map((item, itemIndex) => (
                                itemIndex === index ? next : item
                              )))}
                            />
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {activeTab === 'advanced' ? (
              <div className="provider-editor-tab-panel">
                <div className="provider-editor-switch-card">
                  <div className="provider-editor-switch-info">
                    <strong>启用此 Provider</strong>
                    <span>在模型选择菜单与 Agent 会话中允许调用此 Provider</span>
                  </div>
                  <ToggleSwitch
                    ariaLabel="启用 Provider"
                    checked={enabled}
                    onChange={setEnabled}
                  />
                </div>

                <div className="provider-editor-switch-card">
                  <div className="provider-editor-switch-info">
                    <strong>允许非 loopback 明文 HTTP</strong>
                    <span>允许连接局域网或远程非 localhost 的 http:// 端点</span>
                  </div>
                  <ToggleSwitch
                    ariaLabel="允许非 loopback HTTP"
                    checked={allowInsecureHttp}
                    onChange={setAllowInsecureHttp}
                  />
                </div>

                {isRemoteHttp && !allowInsecureHttp ? (
                  <div className="provider-editor-alert" data-tone="warning">
                    <AlertTriangle aria-hidden />
                    <div>
                      <strong>检测到非本地明文 HTTP 端点</strong>
                      <p>当前 Base URL 使用明文 HTTP 且不是本机回环地址，建议开启“允许非 loopback 明文 HTTP”或使用 HTTPS。</p>
                    </div>
                  </div>
                ) : null}

                <label className="provider-editor-field">
                  <span>
                    全局非敏感 Headers
                    <small>每行 name: value</small>
                  </span>
                  <textarea
                    className="provider-editor-textarea"
                    placeholder="X-Custom-Header: value&#10;Custom-Client: CodePilotX"
                    rows={4}
                    value={headers}
                    onChange={event => setHeaders(event.target.value)}
                  />
                  <p>仅填写非敏感请求头。Authorization / API Key 等凭据请勿直接写入此处。</p>
                </label>
              </div>
            ) : null}
          </div>

          <footer className="provider-editor-footer">
            <div className="provider-editor-footer-status">
              {error ? (
                <p className="provider-editor-error-text" role="status" title={error}>
                  {error}
                </p>
              ) : null}
            </div>
            <div className="provider-editor-footer-actions">
              <Button color="secondary" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button color="primary" loading={busy} onClick={() => void save()}>
                保存 Provider
              </Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModelEditor({
  model,
  onChange,
}: {
  model: EditableModel
  onChange: (model: EditableModel) => void
}): React.ReactNode {
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  const number = (key: keyof EditableModel, value: string) =>
    onChange({ ...model, [key]: Math.max(0, Number(value) || 0) })

  return (
    <div className="provider-editor-tab-panel">
      <div className="provider-editor-grid">
        <label className="provider-editor-field provider-editor-field--mono">
          <span>模型 ID</span>
          <Input
            placeholder="如：llama3.2 或 gpt-4o"
            value={model.id}
            onChange={event => onChange({ ...model, id: event.target.value })}
          />
        </label>
        <label className="provider-editor-field">
          <span>显示名称</span>
          <Input
            placeholder="默认使用模型 ID"
            value={model.name}
            onChange={event => onChange({ ...model, name: event.target.value })}
          />
        </label>
      </div>

      <div className="provider-editor-grid">
        <label className="provider-editor-field">
          <span>模型 API 协议</span>
          <SettingsDropdown
            ariaLabel="模型 API"
            options={[...API_OPTIONS]}
            value={model.api}
            width="100%"
            onChange={value => onChange({ ...model, api: value as Api })}
          />
        </label>
        <label className="provider-editor-field">
          <span>
            Context Window
            <small>默认 32,768</small>
          </span>
          <Input
            type="number"
            value={String(model.contextWindow)}
            onChange={event => number('contextWindow', event.target.value)}
          />
        </label>
      </div>

      <div className="provider-editor-grid">
        <label className="provider-editor-field">
          <span>
            Max Output Tokens
            <small>默认 8,192</small>
          </span>
          <Input
            type="number"
            value={String(model.maxTokens)}
            onChange={event => number('maxTokens', event.target.value)}
          />
        </label>
      </div>

      <div className="provider-editor-model-toggles-row">
        <div className="provider-editor-model-toggle-pill">
          <span>启用此模型</span>
          <ToggleSwitch
            ariaLabel="启用模型"
            checked={model.enabled}
            onChange={enabled => onChange({ ...model, enabled })}
          />
        </div>
        <div className="provider-editor-model-toggle-pill">
          <span>推理思考 (Reasoning)</span>
          <ToggleSwitch
            ariaLabel="推理模型"
            checked={model.reasoning}
            onChange={reasoning => onChange({ ...model, reasoning })}
          />
        </div>
        <div className="provider-editor-model-toggle-pill">
          <span>图像输入 (Vision)</span>
          <ToggleSwitch
            ariaLabel="图片输入"
            checked={model.imageInput}
            onChange={imageInput => onChange({ ...model, imageInput })}
          />
        </div>
      </div>

      <div
        className="provider-editor-model-advanced-details"
        data-expanded={advanced ? 'true' : 'false'}
      >
        <button
          aria-controls={advancedId}
          aria-expanded={advanced}
          className="provider-editor-model-advanced-summary"
          onClick={() => setAdvanced(current => !current)}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
          高级配置与 Token 计费
        </button>
        <DisclosureContent
          contentClassName="provider-editor-model-advanced-content"
          expanded={advanced}
          id={advancedId}
          mountPolicy="always"
        >
          <div className="provider-editor-grid">
            <label className="provider-editor-field">
              <span>输入成本 ($ / 1M tokens)</span>
              <Input
                type="number"
                value={String(model.inputCost)}
                onChange={event => number('inputCost', event.target.value)}
              />
            </label>
            <label className="provider-editor-field">
              <span>输出成本 ($ / 1M tokens)</span>
              <Input
                type="number"
                value={String(model.outputCost)}
                onChange={event => number('outputCost', event.target.value)}
              />
            </label>
          </div>

          <div className="provider-editor-grid">
            <label className="provider-editor-field">
              <span>缓存读取成本 ($ / 1M tokens)</span>
              <Input
                type="number"
                value={String(model.cacheReadCost)}
                onChange={event => number('cacheReadCost', event.target.value)}
              />
            </label>
            <label className="provider-editor-field">
              <span>缓存写入成本 ($ / 1M tokens)</span>
              <Input
                type="number"
                value={String(model.cacheWriteCost)}
                onChange={event => number('cacheWriteCost', event.target.value)}
              />
            </label>
          </div>

          <label className="provider-editor-field">
            <span>
              模型专属 Headers
              <small>每行 name: value</small>
            </span>
            <textarea
              className="provider-editor-textarea"
              placeholder="X-Model-Specific: value"
              rows={3}
              value={model.headers}
              onChange={event => onChange({ ...model, headers: event.target.value })}
            />
          </label>

          <label className="provider-editor-field provider-editor-field--mono">
            <span>Thinking Level Map (JSON)</span>
            <textarea
              className="provider-editor-textarea"
              placeholder='{"high": "high"}'
              rows={3}
              value={model.thinkingLevelMap}
              onChange={event => onChange({ ...model, thinkingLevelMap: event.target.value })}
            />
          </label>

          <label className="provider-editor-field provider-editor-field--mono">
            <span>API Compat (JSON)</span>
            <textarea
              className="provider-editor-textarea"
              placeholder="{}"
              rows={3}
              value={model.compat}
              onChange={event => onChange({ ...model, compat: event.target.value })}
            />
          </label>
        </DisclosureContent>
      </div>
    </div>
  )
}

function emptyModel(): EditableModel {
  return {
    id: '',
    name: '',
    api: 'openai-completions',
    enabled: true,
    contextWindow: 32_768,
    maxTokens: 8_192,
    reasoning: false,
    imageInput: false,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    headers: '',
    thinkingLevelMap: '',
    compat: '',
  }
}

function editableModel(model: DesktopProviderModelDefinition): EditableModel {
  return {
    id: String(model.id),
    name: model.name ?? String(model.id),
    api: model.api,
    enabled: model.enabled ?? true,
    contextWindow: model.contextWindow ?? 32_768,
    maxTokens: model.maxTokens ?? 8_192,
    reasoning: model.reasoning ?? false,
    imageInput: model.input?.includes('image') ?? false,
    inputCost: model.cost?.input ?? 0,
    outputCost: model.cost?.output ?? 0,
    cacheReadCost: model.cost?.cacheRead ?? 0,
    cacheWriteCost: model.cost?.cacheWrite ?? 0,
    headers: headersToText(model.headers ?? {}),
    thinkingLevelMap: model.thinkingLevelMap
      ? JSON.stringify(model.thinkingLevelMap, null, 2)
      : '',
    compat: model.compat ? JSON.stringify(model.compat, null, 2) : '',
  }
}

function parseHeaders(value: string): Record<string, string> | Error {
  const result: Record<string, string> = {}
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator <= 0) return new Error(`Header 第 ${index + 1} 行格式无效。`)
    const name = line.slice(0, separator).trim()
    if (/^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$/i.test(name)) {
      return new Error(`Header ${name} 包含敏感凭据，请改用加密凭据仓库。`)
    }
    result[name] = line.slice(separator + 1).trim()
  }
  return result
}

function headersToText(headers: Readonly<Record<string, string>>): string {
  return Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\n')
}

function parseJsonObject(
  value: string,
  label: string,
): Record<string, unknown> | null | Error {
  if (!value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return new Error(`${label} 必须是 JSON 对象。`)
    }
    return parsed as Record<string, unknown>
  } catch {
    return new Error(`${label} 不是合法 JSON。`)
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
  } catch {
    return false
  }
}
