import type { ModelRef, ProviderSetting, ProvidersResponse } from '@codepilotx/shared'
import { Check, KeyRound, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useState } from 'react'

export function ProviderSettings({ data, busy, onClose, onRefresh, onSaveCredential, onDeleteCredential, onSetDefaultModel, onSetReviewerModel, onSaveProvider }: {
  data: ProvidersResponse | null
  busy: boolean
  onClose: () => void
  onRefresh: () => void
  onSaveCredential: (providerID: string, apiKey: string) => Promise<void>
  onDeleteCredential: (providerID: string) => Promise<void>
  onSetDefaultModel: (model: ModelRef) => Promise<void>
  onSetReviewerModel: (model: ModelRef | null) => Promise<void>
  onSaveProvider: (setting: ProviderSetting) => Promise<void>
}) {
  const [keys, setKeys] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [custom, setCustom] = useState({ providerID: '', name: '', baseURL: '', modelID: '' })
  return (
    <section className="settings-panel" aria-label="Provider 设置">
      <header>
        <div><h1>模型与 Provider</h1><p>密钥写入 Windows Credential Manager，不会保存在 SQLite 或返回到页面。</p></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={19} /></button>
      </header>
      <div className="settings-toolbar">
        <ModelSetting label="默认模型" model={data?.defaultModel ?? null} data={data} onChange={async (next) => { if (next) await onSetDefaultModel(next) }} />
        <ModelSetting label="审查模型" model={data?.reviewerModel ?? null} data={data} optional onChange={onSetReviewerModel} />
        <button onClick={onRefresh} disabled={busy}><RefreshCw className={busy ? 'spin' : ''} size={15} />手动刷新模型目录</button>
      </div>
      <div className="provider-list">
        {data?.providers.map((provider) => (
          <article className="provider-card" key={provider.id}>
            <div className="provider-heading"><div><strong>{provider.name}</strong><small>{provider.id} · {provider.kind}</small></div><span className={provider.configured ? 'provider-ready' : ''}>{provider.configured ? '已配置' : '未配置'}</span></div>
            {provider.baseURL ? <code>{provider.baseURL}</code> : null}
            <div className="provider-models">{provider.models.map((model) => <span key={model.id}>{model.name}{model.capabilities.toolCall ? ' · 工具' : ''}</span>)}</div>
            <div className="credential-row">
              <KeyRound size={15} />
              <input type="password" autoComplete="new-password" placeholder="输入新的 API Key" value={keys[provider.id] ?? ''} onChange={(event) => setKeys((current) => ({ ...current, [provider.id]: event.target.value }))} />
              <button disabled={!keys[provider.id]?.trim()} onClick={async () => { await onSaveCredential(provider.id, keys[provider.id]); setKeys((current) => ({ ...current, [provider.id]: '' })); setSaved(provider.id) }}>{saved === provider.id ? <Check size={14} /> : null}保存</button>
              {provider.configured ? <button onClick={() => onDeleteCredential(provider.id)} aria-label={`删除 ${provider.name} 密钥`}><Trash2 size={14} />删除</button> : null}
            </div>
          </article>
        )) ?? <p className="settings-empty">正在读取 Provider…</p>}
        <article className="provider-card custom-provider-card">
          <div className="provider-heading"><div><strong>添加 OpenAI-Compatible 实例</strong><small>适用于 DeepSeek、MiniMax、智谱、Ollama 或自建网关</small></div></div>
          <div className="custom-provider-grid">
            <input placeholder="Provider ID，例如 deepseek" value={custom.providerID} onChange={(event) => setCustom({ ...custom, providerID: event.target.value })} />
            <input placeholder="显示名称" value={custom.name} onChange={(event) => setCustom({ ...custom, name: event.target.value })} />
            <input placeholder="Base URL，例如 https://api.example.com/v1" value={custom.baseURL} onChange={(event) => setCustom({ ...custom, baseURL: event.target.value })} />
            <input placeholder="模型 ID" value={custom.modelID} onChange={(event) => setCustom({ ...custom, modelID: event.target.value })} />
          </div>
          <button className="custom-provider-submit" disabled={!custom.providerID.trim() || !custom.baseURL.trim() || !custom.modelID.trim()} onClick={async () => {
            const providerID = custom.providerID.trim()
            const modelID = custom.modelID.trim()
            await onSaveProvider({
              providerID,
              name: custom.name.trim() || providerID,
              kind: 'openai-compatible',
              baseURL: custom.baseURL.trim(),
              models: [{ id: modelID, name: modelID, api: 'openai-chat-completions', limits: { context: 128000, output: 8192 }, capabilities: { reasoning: false, toolCall: true, imageInput: false } }],
            })
            setCustom({ providerID: '', name: '', baseURL: '', modelID: '' })
          }}><Plus size={14} />添加实例</button>
        </article>
      </div>
    </section>
  )
}

function ModelSetting({ label, model, data, optional, onChange }: { label: string; model: ModelRef | null; data: ProvidersResponse | null; optional?: boolean; onChange: (model: ModelRef | null) => Promise<void> }) {
  return (
    <label className="model-summary"><small>{label}</small>
      <select value={model ? `${model.providerID}/${model.modelID}` : ''} onChange={(event) => {
        if (!event.target.value) { void onChange(null); return }
        const [providerID, ...rest] = event.target.value.split('/')
        void onChange({ providerID, modelID: rest.join('/') })
      }}>
        {optional ? <option value="">未配置（转人工确认）</option> : null}
        {data?.providers.flatMap((provider) => provider.models.map((candidate) => (
          <option key={`${provider.id}/${candidate.id}`} value={`${provider.id}/${candidate.id}`}>{provider.name} · {candidate.name}{provider.configured ? '' : '（未配置）'}</option>
        )))}
      </select>
    </label>
  )
}
