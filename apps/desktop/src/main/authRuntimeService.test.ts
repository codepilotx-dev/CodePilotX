import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { join } from 'node:path'
import { getRuntimeStatus } from './authRuntimeService.js'
import { withCoreAppRuntime } from '@codepilotx/core/runtime/appRuntime.js'
import type { AppRuntime } from '@codepilotx/core/runtime/appRuntime.js'

const toolchainStatus = {
  enabled: false,
  root: null,
  managedRoot: '',
  packagedRoot: '',
  pathEntries: [],
  binaries: [],
}

test('runtime status reports rust-sidecar runtime kind', async () => {
  const status = await getRuntimeStatus({
    agentExecutablePath: join(process.cwd(), 'package.json'),
    configDirectoryPath: process.cwd(),
    runtimePreference: 'rust-sidecar',
    runtimeSelectionSource: 'env',
    toolchainStatus,
  })

  expect(status.runtimeKind).toBe('rust-sidecar')
  expect(status.runtimePreference).toBe('rust-sidecar')
})

test('runtime status reports explicit rust-sidecar preference', async () => {
  const status = await getRuntimeStatus({
    agentExecutablePath: join(process.cwd(), 'package.json'),
    configDirectoryPath: process.cwd(),
    runtimePreference: 'rust-sidecar',
    runtimeSelectionSource: 'env',
    toolchainStatus,
  })

  expect(status.runtimeKind).toBe('rust-sidecar')
  expect(status.runtimePreference).toBe('rust-sidecar')
})

describe('getAuthStatus', () => {
  /**
   * A minimal runtime that satisfies the auth/config/settings shims.
   * Tests that need real file I/O will be covered by integration tests.
   */
  const testRuntime: AppRuntime = {
    auth: {
      hasProfileScope: () => false,
      isClaudeAISubscriber: () => false,
      saveApiKey: async () => {},
      getAnthropicApiKey: () => null,
      getAuthTokenSource: () => ({ source: 'none', hasToken: false }),
      getOauthAccountInfo: () => undefined,
      hasAnthropicApiKeyAuth: () => false,
    },
    config: {
      enableConfigs: () => {},
      getGlobalConfig: <T>() => ({}) as T,
      saveGlobalConfig: () => {},
    },
    settings: {
      getSettings_DEPRECATED: () => undefined,
      getInitialSettings: () => ({}),
      getSettingsForSource: () => undefined,
      updateSettingsForSource: () => {},
    },
  }

  test('module exports getAuthStatus', async () => {
    const mod = await import('./authRuntimeService.js')
    expect(typeof mod.getAuthStatus).toBe('function')
  })

  test('getAuthStatus returns DesktopAuthStatus shape', async () => {
    const prevToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token-placeholder'
    try {
      const { getAuthStatus } = await import('./authRuntimeService.js')
      // Temporarily set the token in the test runtime
      const runtimeWithEnv: AppRuntime = {
        ...testRuntime,
        auth: {
          ...testRuntime.auth,
          getAuthTokenSource: () => ({
            source: 'CLAUDE_CODE_OAUTH_TOKEN',
            hasToken: true,
          }),
        },
      }
      const status = await withCoreAppRuntime(runtimeWithEnv, () =>
        getAuthStatus(),
      )
      expect(status).toHaveProperty('authenticated')
      expect(status).toHaveProperty('method')
      expect(status).toHaveProperty('email')
      expect(status).toHaveProperty('organizationName')
      expect(status.authenticated).toBe(true)
      expect(status.method).toBe('CLAUDE_CODE_OAUTH_TOKEN')
    } finally {
      if (prevToken === undefined) {
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      } else {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = prevToken
      }
    }
  })

  test('getAuthStatus returns unauthenticated with no credentials', async () => {
    const { getAuthStatus } = await import('./authRuntimeService.js')
    const status = await withCoreAppRuntime(testRuntime, () => getAuthStatus())
    expect(status.authenticated).toBe(false)
    expect(status.method).toBe('none')
  })
})
