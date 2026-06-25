import { expect, test } from 'bun:test'
import {
  createModelProviderState,
  formatProviderModel,
  getProviderApiKeyEnvVar,
  normalizeLegacyProviderID,
  normalizeProviderError,
  splitProviderModel,
} from './provider.js'

test('normalizeProviderError classifies authentication failures', () => {
  const error = normalizeProviderError(
    Object.assign(new Error('invalid API key'), { status: 401 }),
    'openai',
  )

  expect(error).toMatchObject({
    code: 'authentication_failed',
    providerID: 'openai',
    status: 401,
    retryable: false,
  })
})

test('normalizeProviderError marks transient stream and rate errors retryable', () => {
  expect(normalizeProviderError(new Error('stream EOF')).retryable).toBe(true)
  expect(
    normalizeProviderError(Object.assign(new Error('too many requests'), {
      status: 429,
    })).retryable,
  ).toBe(true)
})

test('normalizeProviderError preserves already normalized errors', () => {
  const normalized = {
    code: 'model_not_found',
    message: 'missing model',
    retryable: false,
  } as const

  expect(normalizeProviderError(normalized)).toBe(normalized)
})

test('provider identifiers and model names use shared normalization helpers', () => {
  expect(normalizeLegacyProviderID('zhipu')).toBe('zhipuai')
  expect(normalizeLegacyProviderID('custom')).toBe('minimax')
  expect(getProviderApiKeyEnvVar('openai-compatible')).toBe(
    'OPENAI_COMPATIBLE_API_KEY',
  )
  expect(splitProviderModel('zhipu/glm-4.7-flash')).toEqual({
    providerID: 'zhipu',
    modelID: 'glm-4.7-flash',
  })
  expect(splitProviderModel('missing-model')).toBeNull()
  expect(formatProviderModel('zhipu', null)).toBe('zhipu/default')
})

test('createModelProviderState derives configuration state from shared inputs', () => {
  const state = createModelProviderState({
    selectedProviderID: 'zhipu',
    provider: {
      providerID: 'zhipu',
      kind: 'openai-compatible',
      displayName: '智谱 BigModel',
      defaultModels: ['glm-4.7-flash'],
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
    },
    model: 'glm-4.7-flash',
    apiKeySource: 'secureStorage',
  })

  expect(state).toMatchObject({
    selectedProviderID: 'zhipu',
    model: 'glm-4.7-flash',
    apiKeyConfigured: true,
    apiKeySource: 'secureStorage',
    modelConfigured: true,
    models: ['glm-4.7-flash'],
  })
  expect(state.configurationMessage).toBeUndefined()
})

test('createModelProviderState reports missing shared configuration', () => {
  const state = createModelProviderState({
    selectedProviderID: 'custom',
    provider: {
      providerID: 'custom',
      kind: 'openai-compatible',
      displayName: 'Custom',
      defaultModels: [],
      requiresBaseURL: true,
    },
    model: '',
    apiKeySource: null,
  })

  expect(state).toMatchObject({
    model: '',
    apiKeyConfigured: false,
    modelConfigured: false,
    configurationMessage: '未配置模型，请先在设置中配置模型。',
  })
})
