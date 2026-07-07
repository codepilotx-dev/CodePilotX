import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  clearProviderConfigCatalogCacheForTests,
  withProviderConfigRuntime,
} from '@codepilotx/core/models/providerConfig.js'
import {
  RUST_APP_SERVER_BINARY_ENV,
  RustSidecarDesktopAgentRuntime,
  createRustSidecarOptions,
  resolveRustAppServerExecutable,
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'
import type { DesktopAgentRuntimeContext } from './agentRuntime.js'

/** Temporarily set process.env[key] and restore on dispose. */
function withEnv(key: string, value: string): Disposable {
  const previous = process.env[key]
  process.env[key] = value
  return {
    [Symbol.dispose]() {
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    },
  }
}

// ── Options / executable resolution tests ───────────────────────────

describe('rust sidecar runtime options', () => {
  test('resolves explicit Rust app-server executable from env', () => {
    const envPath = process.platform === 'win32'
      ? 'C:\\tools\\codex-app-server.exe'
      : '/tools/codex-app-server'

    expect(
      resolveRustAppServerExecutable({
        [RUST_APP_SERVER_BINARY_ENV]: envPath,
      } as NodeJS.ProcessEnv),
    ).toBe(resolve(envPath))
  })

  test('ignores reference codex-main Rust app-server env override', () => {
    const binaryName = process.platform === 'win32'
      ? 'codex-app-server.exe'
      : 'codex-app-server'
    const referencePath = process.platform === 'win32'
      ? 'D:\\GitHubProject\\Agent\\codex-main\\codex-rs\\target\\debug\\codex-app-server.exe'
      : '/GitHubProject/Agent/codex-main/codex-rs/target/debug/codex-app-server'

    expect(
      resolveRustAppServerExecutableInfo({
        [RUST_APP_SERVER_BINARY_ENV]: referencePath,
      } as NodeJS.ProcessEnv),
    ).toEqual({
      path: resolve(process.cwd(), 'rust', 'codex-rs', 'target', 'debug', binaryName),
      source: 'workspace',
    })
  })

  test('defaults to current workspace Rust app-server executable', () => {
    const binaryName = process.platform === 'win32'
      ? 'codex-app-server.exe'
      : 'codex-app-server'

    expect(resolveRustAppServerExecutable({} as NodeJS.ProcessEnv)).toBe(
      resolve(process.cwd(), 'rust', 'codex-rs', 'target', 'debug', binaryName),
    )
    expect(resolveRustAppServerExecutableInfo({} as NodeJS.ProcessEnv)).toEqual({
      path: resolve(process.cwd(), 'rust', 'codex-rs', 'target', 'debug', binaryName),
      source: 'workspace',
    })
  })

  test('creates stdio app-server launch options', async () => {
    const context = {
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      model: 'test-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = await createRustSidecarOptions(context)

    expect(options.args).toEqual([
      '--listen',
      'stdio://',
      '--session-source',
      'vscode',
    ])
    expect(options.cwd).toBe(process.cwd())
    expect(options.env.CODEPILOTX_SIDECAR_SESSION_ID).toBe('session-1')
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('test-model')
  })

  test('inherits process.env including CODEX_HOME', async () => {
    using _restore = withEnv('CODEX_HOME', '/custom/codex-home')

    const context = {
      sessionId: 'session-2',
      workspacePath: process.cwd(),
      model: 'test-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = await createRustSidecarOptions(context)

    // CODEX_HOME 已透传
    expect(options.env.CODEX_HOME).toBe('/custom/codex-home')
    // sidecar 专属变量仍正常生成
    expect(options.env.CODEPILOTX_SIDECAR_SESSION_ID).toBe('session-2')
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('test-model')
  })

  test('sidecar env overrides process.env on conflict', async () => {
    using _restore = withEnv('CODEPILOTX_SIDECAR_MODEL', 'should-be-overridden')

    const context = {
      sessionId: 'session-3',
      workspacePath: process.cwd(),
      model: 'override-model',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = await createRustSidecarOptions(context)

    // sidecar 专属变量应覆盖 process.env 中的同名值
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('override-model')
  })

  test('registers selected models.dev provider with Rust config overrides', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'rust-sidecar-provider-'))
    using _restoreCodePilotX = withEnv(CODEPILOTX_CONFIG_DIR_ENV, configDir)
    using _restoreClaude = withEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, configDir)
    using _restoreKey = withEnv('MINIMAX_API_KEY', 'sk-minimax-test-key')

    try {
      const context = {
        sessionId: 'session-4',
        workspacePath: process.cwd(),
        providerID: 'minimax-cn',
        providerBaseURL: 'https://api.minimaxi.com/anthropic/v1',
        model: 'MiniMax-M3',
        emit: () => {},
        requestPermission: async () => ({ behavior: 'deny' }),
      } satisfies DesktopAgentRuntimeContext

      clearProviderConfigCatalogCacheForTests()
      const options = await withProviderConfigRuntime(
        {
          fetch: (async () => {
            throw new Error('network disabled in rust sidecar test')
          }) as unknown as typeof fetch,
        },
        () => createRustSidecarOptions(context),
      )

      expect(options.args).toContain('-c')
      expect(options.args).toContain('model="MiniMax-M3"')
      expect(options.args).toContain('model_provider="minimax-cn"')
      expect(options.args).toContain(
        'model_providers.minimax-cn.name="MiniMax (minimaxi.com)"',
      )
      expect(options.args).toContain(
        'model_providers.minimax-cn.wire_api="anthropic_messages"',
      )
      expect(options.args).toContain(
        'model_providers.minimax-cn.base_url="https://api.minimaxi.com/anthropic/v1"',
      )
      expect(options.args).toContain(
        'model_providers.minimax-cn.env_key="MINIMAX_API_KEY"',
      )
      expect(options.args).not.toContain('sk-minimax-test-key')
      expect(options.env.MINIMAX_API_KEY).toBe('sk-minimax-test-key')
    } finally {
      await rm(configDir, { force: true, recursive: true })
    }
  })

  test('logs provider config with wireApi and endpoint (no api key)', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'rust-sidecar-logging-'))
    const restore1 = withEnv(CODEPILOTX_CONFIG_DIR_ENV, configDir)
    const restore2 = withEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, configDir)
    const restore3 = withEnv('MINIMAX_API_KEY', 'sk-minimax-test-key')

    try {
      const context = {
        sessionId: 'session-log-1',
        workspacePath: process.cwd(),
        providerID: 'minimax-cn',
        providerBaseURL: 'https://api.minimaxi.com/anthropic/v1',
        model: 'MiniMax-M3',
        emit: () => {},
        requestPermission: async () => ({ behavior: 'deny' }),
      } satisfies DesktopAgentRuntimeContext

      // Capture process.stdout.write to verify debug output
      const captured: string[] = []
      const originalWrite = process.stdout.write.bind(process.stdout)
      process.stdout.write = ((chunk: unknown) => {
        captured.push(String(chunk))
        return true
      }) as typeof process.stdout.write

      try {
        clearProviderConfigCatalogCacheForTests()
        await withProviderConfigRuntime(
          {
            fetch: (async () => {
              throw new Error('network disabled')
            }) as unknown as typeof fetch,
          },
          () => createRustSidecarOptions(context),
        )
      } finally {
        process.stdout.write = originalWrite
      }

      const configLine = captured.find(line =>
        line.includes('rust_provider_config'),
      )
      expect(configLine).toBeTruthy()
      expect(configLine).toContain('"providerID":"minimax-cn"')
      expect(configLine).toContain('"wireApi":"anthropic_messages"')
      expect(configLine).toContain(
        '"endpoint":"https://api.minimaxi.com/anthropic/v1"',
      )
      // API key must NOT appear in any debug line
      const anyKeyLeak = captured.find(line => line.includes('sk-minimax'))
      expect(anyKeyLeak).toBeUndefined()
    } finally {
      restore1[Symbol.dispose]()
      restore2[Symbol.dispose]()
      restore3[Symbol.dispose]()
      await rm(configDir, { force: true, recursive: true })
    }
  })

  test('openai provider uses responses wire_api without endpoint leak', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'rust-sidecar-openai-'))
    using _restoreConfigDir = withEnv(CODEPILOTX_CONFIG_DIR_ENV, configDir)
    using _restoreClaude = withEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, configDir)
    using _restoreKey = withEnv('OPENAI_API_KEY', 'sk-openai-test')

    try {
      const context = {
        sessionId: 'session-openai-1',
        workspacePath: process.cwd(),
        providerID: 'openai',
        model: 'gpt-4o',
        emit: () => {},
        requestPermission: async () => ({ behavior: 'deny' }),
      } satisfies DesktopAgentRuntimeContext

      clearProviderConfigCatalogCacheForTests()
      const options = await withProviderConfigRuntime(
        {
          fetch: (async () => {
            throw new Error('network disabled')
          }) as unknown as typeof fetch,
        },
        () => createRustSidecarOptions(context),
      )

      expect(options.args).toContain('model="gpt-4o"')
      expect(options.args).toContain('model_provider="openai"')
      expect(options.args).toContain(
        'model_providers.openai.wire_api="responses"',
      )
      // No base_url set → no base_url arg
      expect(
        options.args.find(a => a.startsWith('model_providers.openai.base_url')),
      ).toBeUndefined()
      // API key is in env, not args
      expect(options.args).not.toContain('sk-openai-test')
      expect(options.env.OPENAI_API_KEY).toBe('sk-openai-test')
    } finally {
      await rm(configDir, { force: true, recursive: true })
    }
  })

  test('deepseek provider uses chat_completions wire_api', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'rust-sidecar-deepseek-'))
    using _restoreConfigDir = withEnv(CODEPILOTX_CONFIG_DIR_ENV, configDir)
    using _restoreClaude = withEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, configDir)
    using _restoreKey = withEnv('DEEPSEEK_API_KEY', 'sk-deepseek-test-key')

    try {
      const context = {
        sessionId: 'session-deepseek-1',
        workspacePath: process.cwd(),
        providerID: 'deepseek',
        model: 'deepseek-chat',
        emit: () => {},
        requestPermission: async () => ({ behavior: 'deny' }),
      } satisfies DesktopAgentRuntimeContext

      clearProviderConfigCatalogCacheForTests()
      const options = await withProviderConfigRuntime(
        {
          fetch: (async () => {
            throw new Error('network disabled')
          }) as unknown as typeof fetch,
        },
        () => createRustSidecarOptions(context),
      )

      expect(options.args).toContain('model="deepseek-chat"')
      expect(options.args).toContain('model_provider="deepseek"')
      expect(options.args).toContain(
        'model_providers.deepseek.wire_api="chat_completions"',
      )
      expect(options.args).toContain(
        'model_providers.deepseek.base_url="https://api.deepseek.com"',
      )
      expect(options.args).toContain(
        'model_providers.deepseek.env_key="DEEPSEEK_API_KEY"',
      )
      // API key is in env, not args
      expect(options.args).not.toContain('sk-deepseek-test-key')
      expect(options.env.DEEPSEEK_API_KEY).toBe('sk-deepseek-test-key')
    } finally {
      await rm(configDir, { force: true, recursive: true })
    }
  })
})

// ── Non-text input rejection ────────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime input validation', () => {
  test('rejects non-text input with clear error', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    await expect(
      runtime.runUserTurn(
        [{ type: 'text', text: 'hello' }],
        new AbortController().signal,
      ),
    ).rejects.toThrow('text-only')
  })

  test('rejects control responses with clear error', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    await expect(
      runtime.runControlResponse(
        { behavior: 'allow' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('unsupported')
  })
})
