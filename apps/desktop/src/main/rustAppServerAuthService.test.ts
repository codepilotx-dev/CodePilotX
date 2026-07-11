import { expect, test } from 'bun:test'
import { createAuthSidecarOptions } from './rustAppServerAuthService.js'

test('provider auth control sidecar excludes inherited credential variables', () => {
  const previous = process.env.SENTINEL_PROVIDER_API_KEY
  process.env.SENTINEL_PROVIDER_API_KEY = 'sentinel-secret-value'
  try {
    const options = createAuthSidecarOptions('codepilotx-app-server')

    expect(options.options.env?.SENTINEL_PROVIDER_API_KEY).toBeUndefined()
    expect(options.options.env?.Path ?? options.options.env?.PATH).toBeTruthy()
  } finally {
    if (previous === undefined) {
      delete process.env.SENTINEL_PROVIDER_API_KEY
    } else {
      process.env.SENTINEL_PROVIDER_API_KEY = previous
    }
  }
})

test('provider auth control sidecar injects trusted endpoints without keys', () => {
  const options = createAuthSidecarOptions('codepilotx-app-server', [
    {
      providerID: 'deepseek',
      kind: 'openai-compatible',
      displayName: 'DeepSeek',
      baseURL: 'https://api.deepseek.com/v1',
      defaultModels: [],
      wireApi: 'chat_completions',
    },
    {
      providerID: 'zhipu',
      kind: 'openai-compatible',
      displayName: 'Zhipu "Secure"',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4/',
      defaultModels: [],
      wireApi: 'chat_completions',
    },
  ])

  expect(options.args).toContain(
    'model_providers.deepseek.base_url="https://api.deepseek.com/v1"',
  )
  expect(options.args).toContain(
    'model_providers.zhipu.base_url="https://open.bigmodel.cn/api/paas/v4/"',
  )
  expect(options.args).toContain(
    'model_providers.zhipu.name="Zhipu \\"Secure\\""',
  )
  expect(options.args.join(' ')).not.toContain('sentinel-secret-value')
})

test('provider auth control sidecar rejects unsafe provider paths and endpoints', () => {
  const options = createAuthSidecarOptions('codepilotx-app-server', [
    {
      providerID: 'deepseek.injected=true',
      kind: 'openai-compatible',
      displayName: 'Unsafe ID',
      baseURL: 'https://attacker.example/v1',
      defaultModels: [],
    },
    {
      providerID: 'local-http',
      kind: 'openai-compatible',
      displayName: 'Unsafe URL',
      baseURL: 'http://attacker.example/v1',
      defaultModels: [],
    },
  ])

  expect(options.args).toEqual(['--listen', 'stdio://'])
})
