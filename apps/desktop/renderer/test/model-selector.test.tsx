import { expect, test } from 'bun:test'
import type { ModelRef, ProviderInfo, ProvidersResponse } from '@codepilotx/shared'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveProjectModel } from '../src/App'
import { ModelSelector } from '../src/components/ModelSelector'

const providers: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    configured: false,
    models: [
      {
        id: 'gpt-5',
        name: 'GPT-5',
        api: 'openai-responses',
        limits: { context: 128_000, output: 8_192 },
        capabilities: { reasoning: true, toolCall: true, imageInput: true },
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    configured: false,
    models: [
      {
        id: 'claude',
        name: 'Claude',
        api: 'anthropic-messages',
        limits: { context: 128_000, output: 8_192 },
        capabilities: { reasoning: true, toolCall: true, imageInput: true },
      },
    ],
  },
]

test('未配置凭据时仍允许切换目录中的模型', () => {
  const selected: ModelRef[] = []
  const selector = ModelSelector({
    providers,
    value: { providerID: 'openai', modelID: 'gpt-5' },
    onChange: (model) => selected.push(model),
  })
  const markup = renderToStaticMarkup(
    selector,
  )

  expect(markup).toContain('value="anthropic/claude"')
  expect(markup).toContain('Anthropic · Claude（未配置）')
  expect(markup).not.toContain('disabled=""')

  const selectProps = selector.props as { onChange: (event: { target: { value: string } }) => void }
  selectProps.onChange({ target: { value: 'anthropic/claude' } })
  expect(selected).toEqual([{ providerID: 'anthropic', modelID: 'claude' }])
})

test('项目模型使用本次加载的 Provider 快照回退', () => {
  const providerData: ProvidersResponse = {
    providers,
    defaultModel: { providerID: 'openai', modelID: 'gpt-5' },
    reviewerModel: null,
  }
  const emptySettings = { defaultModel: null, plannerModel: null, developerModel: null, reviewerModel: null }

  expect(resolveProjectModel(emptySettings, providerData)).toEqual({ providerID: 'openai', modelID: 'gpt-5' })
  expect(resolveProjectModel({ ...emptySettings, defaultModel: { providerID: 'anthropic', modelID: 'claude' } }, providerData))
    .toEqual({ providerID: 'anthropic', modelID: 'claude' })
})
