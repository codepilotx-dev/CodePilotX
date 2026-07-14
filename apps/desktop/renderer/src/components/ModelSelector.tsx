import type { ModelRef, ProviderInfo } from '@codepilotx/shared'
import { modelRefKey } from '../api/agent-client'

export function ModelSelector({ providers, value, onChange }: {
  providers: readonly ProviderInfo[]
  value: ModelRef | null
  onChange: (model: ModelRef) => void
}) {
  const available = providers.flatMap((provider) => provider.models.map((model) => ({ provider, model })))
  return (
    <select
      className="model-select"
      aria-label="选择模型"
      value={value ? modelRefKey(value) : ''}
      onChange={(event) => {
        const [providerID, ...rest] = event.target.value.split('/')
        if (providerID && rest.length) onChange({ providerID, modelID: rest.join('/') })
      }}
    >
      {!value ? <option value="">选择模型</option> : null}
      {available.map(({ provider, model }) => (
        <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
          {provider.name} · {model.name}{model.capabilities.toolCall ? '' : '（仅聊天）'}{provider.configured ? '' : '（未配置）'}
        </option>
      ))}
    </select>
  )
}
