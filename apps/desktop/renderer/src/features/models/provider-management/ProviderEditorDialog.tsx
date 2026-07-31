import * as Dialog from '@radix-ui/react-dialog'
import { Plus, Trash2, X } from 'lucide-react'
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
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { useDialogFocusRestore } from '../../../components/ui/useDialogFocusRestore.js'

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

export type ProviderEditorDialogProps = {
  open: boolean
  provider?: DesktopModelProviderSummary
  onOpenChange: (open: boolean) => void
  onSaved: (providerId: string) => void | Promise<void>
}

export function ProviderEditorDialog({
  open,
  provider,
  onOpenChange,
  onSaved,
}: ProviderEditorDialogProps): React.ReactNode {
  const titleId = useId()
  const editing = provider?.providerKind === 'custom'
  const { onCloseAutoFocus } = useDialogFocusRestore(open)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [auth, setAuth] = useState<'api-key' | 'none'>('api-key')
  const [enabled, setEnabled] = useState(true)
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false)
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [models, setModels] = useState<EditableModel[]>([emptyModel()])
  const [candidates, setCandidates] = useState<DesktopProviderModelDefinition[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
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
    setCandidates([])
    setSelectedCandidates(new Set())
    setError(null)
  }, [open, provider])

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
    if (normalizedModels.length === 0) return new Error('至少添加一个模型。')
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="permission-modal-backdrop">
          <Dialog.Content
            aria-labelledby={titleId}
            className="model-center-key-dialog model-center-connection-dialog"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <header className="model-center-key-dialog-header">
              <div className="model-center-key-dialog-heading">
                <div>
                  <Dialog.Title id={titleId}>
                    {editing ? `编辑 ${provider.displayName}` : '新增自定义 Provider'}
                  </Dialog.Title>
                  <Dialog.Description>
                    Pi 原生 Provider 配置；内置 Provider 的 Endpoint 与认证不可覆盖。
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close asChild><IconButton title="关闭"><X aria-hidden /></IconButton></Dialog.Close>
            </header>

            <div className="model-center-account-fields">
              <label className="model-center-account-field"><span>Provider ID</span><Input readOnly={editing} value={id} onChange={event => setId(event.target.value)} /></label>
              <label className="model-center-account-field"><span>名称</span><Input value={name} onChange={event => setName(event.target.value)} /></label>
              <label className="model-center-account-field"><span>Base URL</span><Input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://example.com/v1" /></label>
              <label className="model-center-account-field"><span>认证</span><SettingsDropdown ariaLabel="认证方式" value={auth} width={280} options={[{ value: 'api-key', label: 'API Key' }, { value: 'none', label: '无需认证' }]} onChange={value => setAuth(value as 'api-key' | 'none')} /></label>
              <label className="model-center-account-field"><span>凭据环境变量（逗号分隔）</span><Input value={env} onChange={event => setEnv(event.target.value)} /></label>
              <label className="model-center-account-field"><span>非敏感 Headers（每行 name: value）</span><textarea value={headers} onChange={event => setHeaders(event.target.value)} /></label>
              <label className="model-center-account-field"><span>启用 Provider</span><ToggleSwitch ariaLabel="启用 Provider" checked={enabled} onChange={setEnabled} /></label>
              <label className="model-center-account-field"><span>允许非 loopback HTTP</span><ToggleSwitch ariaLabel="允许不安全 HTTP" checked={allowInsecureHttp} onChange={setAllowInsecureHttp} /></label>

              <section className="model-center-account-section">
                <header>
                  <div><h3>模型</h3><p>只需填写 ID 与 API，其余使用保守默认值。</p></div>
                  <div className="model-center-account-actions">
                    {editing ? <Button disabled={busy} onClick={() => void discover()}>从 /models 导入</Button> : null}
                    <Button onClick={() => setModels(current => [...current, emptyModel()])}><Plus aria-hidden />新增模型</Button>
                  </div>
                </header>
                {models.map((model, index) => (
                  <ModelEditor
                    key={`${index}-${model.id}`}
                    model={model}
                    onChange={next => setModels(current => current.map((item, itemIndex) => itemIndex === index ? next : item))}
                    onRemove={() => setModels(current => current.filter((_, itemIndex) => itemIndex !== index))}
                  />
                ))}
              </section>

              {candidates.length > 0 ? (
                <section className="model-center-account-section">
                  <header><div><h3>确认导入候选模型</h3><p>勾选后仅加入表单，保存 Provider 时才会持久化。</p></div></header>
                  {candidates.map(candidate => (
                    <label className="model-center-account-field" key={String(candidate.id)}>
                      <input
                        checked={selectedCandidates.has(String(candidate.id))}
                        onChange={event => setSelectedCandidates(current => {
                          const next = new Set(current)
                          if (event.target.checked) next.add(String(candidate.id))
                          else next.delete(String(candidate.id))
                          return next
                        })}
                        type="checkbox"
                      />
                      <span>{String(candidate.id)} · {candidate.api}</span>
                    </label>
                  ))}
                  <Button disabled={selectedCandidates.size === 0} onClick={importSelected}>导入已选模型</Button>
                </section>
              ) : null}

              {error ? <p className="model-center-account-error" role="status">{error}</p> : null}
              <div className="model-center-account-actions">
                <Button loading={busy} onClick={() => void save()}>保存 Provider</Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ModelEditor({
  model,
  onChange,
  onRemove,
}: {
  model: EditableModel
  onChange: (model: EditableModel) => void
  onRemove: () => void
}): React.ReactNode {
  const number = (key: keyof EditableModel, value: string) =>
    onChange({ ...model, [key]: Math.max(0, Number(value) || 0) })
  return (
    <div className="model-center-account-connection">
      <label className="model-center-account-field"><span>模型 ID</span><Input value={model.id} onChange={event => onChange({ ...model, id: event.target.value })} /></label>
      <label className="model-center-account-field"><span>名称</span><Input value={model.name} onChange={event => onChange({ ...model, name: event.target.value })} placeholder="默认使用模型 ID" /></label>
      <label className="model-center-account-field"><span>API</span><SettingsDropdown ariaLabel="模型 API" value={model.api} width={280} options={[...API_OPTIONS]} onChange={value => onChange({ ...model, api: value as Api })} /></label>
      <label className="model-center-account-field"><span>Context Window</span><Input type="number" value={String(model.contextWindow)} onChange={event => number('contextWindow', event.target.value)} /></label>
      <label className="model-center-account-field"><span>Max Tokens</span><Input type="number" value={String(model.maxTokens)} onChange={event => number('maxTokens', event.target.value)} /></label>
      <label className="model-center-account-field"><span>启用模型</span><ToggleSwitch ariaLabel="启用模型" checked={model.enabled} onChange={enabled => onChange({ ...model, enabled })} /></label>
      <label className="model-center-account-field"><span>推理</span><ToggleSwitch ariaLabel="推理模型" checked={model.reasoning} onChange={reasoning => onChange({ ...model, reasoning })} /></label>
      <label className="model-center-account-field"><span>图片输入</span><ToggleSwitch ariaLabel="图片输入" checked={model.imageInput} onChange={imageInput => onChange({ ...model, imageInput })} /></label>
      <details>
        <summary>成本与 API 高级设置</summary>
        <label className="model-center-account-field"><span>输入成本</span><Input type="number" value={String(model.inputCost)} onChange={event => number('inputCost', event.target.value)} /></label>
        <label className="model-center-account-field"><span>输出成本</span><Input type="number" value={String(model.outputCost)} onChange={event => number('outputCost', event.target.value)} /></label>
        <label className="model-center-account-field"><span>缓存读取成本</span><Input type="number" value={String(model.cacheReadCost)} onChange={event => number('cacheReadCost', event.target.value)} /></label>
        <label className="model-center-account-field"><span>缓存写入成本</span><Input type="number" value={String(model.cacheWriteCost)} onChange={event => number('cacheWriteCost', event.target.value)} /></label>
        <label className="model-center-account-field"><span>模型 Headers（每行 name: value）</span><textarea value={model.headers} onChange={event => onChange({ ...model, headers: event.target.value })} /></label>
        <label className="model-center-account-field"><span>Thinking Level Map（JSON）</span><textarea value={model.thinkingLevelMap} onChange={event => onChange({ ...model, thinkingLevelMap: event.target.value })} placeholder='{"high":"high"}' /></label>
        <label className="model-center-account-field"><span>API Compat（JSON）</span><textarea value={model.compat} onChange={event => onChange({ ...model, compat: event.target.value })} placeholder="{}" /></label>
      </details>
      <Button tone="danger" onClick={onRemove}><Trash2 aria-hidden />移除模型</Button>
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
