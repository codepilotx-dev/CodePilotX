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
