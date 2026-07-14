import type { ModelRef, ProviderInfo } from '@codepilotx/shared'
import type { ProjectSettings } from '../api/agent-client'

const roles: ReadonlyArray<{ key: keyof ProjectSettings; label: string; hint: string }> = [
  { key: 'defaultModel', label: '项目默认模型', hint: '未设置时使用全局默认模型' },
  { key: 'plannerModel', label: '规划 Agent', hint: '留空则继承项目默认模型' },
  { key: 'developerModel', label: '开发 Agent', hint: '留空则继承项目默认模型' },
  { key: 'reviewerModel', label: '审查 Agent', hint: '留空则继承项目默认模型' },
]

export function ProjectSettingsPanel({ settings, providers, busy, onSave }: { settings: ProjectSettings | null; providers: readonly ProviderInfo[]; busy?: boolean; onSave: (settings: ProjectSettings) => void }) {
  if (!settings) return <p className="settings-empty">正在读取项目设置…</p>
  return <section className="project-settings-panel"><header><h2>项目模型</h2><p>角色覆盖仅影响当前项目；留空会逐级回退到项目和全局默认模型。</p></header><div className="project-model-grid">
    {roles.map(({ key, label, hint }) => <label key={key} className="project-model-field"><span>{label}<small>{hint}</small></span><select disabled={busy} value={toValue(settings[key])} onChange={(event) => onSave({ ...settings, [key]: fromValue(event.target.value) })}><option value="">未设置（继承）</option>{providers.flatMap((provider) => provider.models.map((model) => <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>{provider.name} · {model.name}</option>))}</select></label>)}
  </div></section>
}

function toValue(model: ModelRef | null): string { return model ? `${model.providerID}/${model.modelID}` : '' }
function fromValue(value: string): ModelRef | null { if (!value) return null; const [providerID, ...model] = value.split('/'); return { providerID, modelID: model.join('/') } }
