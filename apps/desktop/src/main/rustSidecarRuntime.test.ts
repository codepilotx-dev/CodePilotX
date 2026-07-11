import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
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
  buildRustInitializeParams,
  createRustSidecarOptions,
  isPackagedElectronProcess,
  resolveRustAppServerExecutable,
  resolveRustAppServerExecutableInfo,
} from './rustSidecarRuntime.js'
import type { DesktopAgentRuntimeContext } from './agentRuntime.js'
import type { DesktopPermissionDecision } from '../shared/types.js'

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
  test('detects packaged Electron without relying on NODE_ENV', () => {
    expect(
      isPackagedElectronProcess({
        versions: { electron: '40.0.0' },
      }),
    ).toBe(true)
    expect(
      isPackagedElectronProcess({
        versions: { electron: '40.0.0' },
        defaultApp: true,
      }),
    ).toBe(false)
    expect(isPackagedElectronProcess({ versions: {} })).toBe(false)
  })

  test('declares experimental API capability for dynamic tools', () => {
    expect(buildRustInitializeParams().capabilities).toEqual({
      experimentalApi: true,
      requestAttestation: false,
      mcpServerOpenaiFormElicitation: true,
    })
  })

  test('resolves explicit Rust app-server executable from env', () => {
    const envPath = process.platform === 'win32'
      ? 'C:\\tools\\codepilotx-app-server.exe'
      : '/tools/codepilotx-app-server'

    expect(
      resolveRustAppServerExecutable({
        [RUST_APP_SERVER_BINARY_ENV]: envPath,
      } as NodeJS.ProcessEnv),
    ).toBe(resolve(envPath))
  })

  test('ignores reference codex-main Rust app-server env override', () => {
    const binaryName = process.platform === 'win32'
      ? 'codepilotx-app-server.exe'
      : 'codepilotx-app-server'
    const referencePath = process.platform === 'win32'
      ? 'D:\\GitHubProject\\Agent\\codex-main\\codex-rs\\target\\debug\\codepilotx-app-server.exe'
      : '/GitHubProject/Agent/codex-main/codex-rs/target/debug/codepilotx-app-server'

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
      ? 'codepilotx-app-server.exe'
      : 'codepilotx-app-server'

    expect(resolveRustAppServerExecutable({} as NodeJS.ProcessEnv)).toBe(
      resolve(process.cwd(), 'rust', 'codex-rs', 'target', 'debug', binaryName),
    )
    expect(resolveRustAppServerExecutableInfo({} as NodeJS.ProcessEnv)).toEqual({
      path: resolve(process.cwd(), 'rust', 'codex-rs', 'target', 'debug', binaryName),
      source: 'workspace',
    })
  })

  test('packaged resolver only uses the resources sidecar path', () => {
    const binaryName = process.platform === 'win32'
      ? 'codepilotx-app-server.exe'
      : 'codepilotx-app-server'
    const resourcesPath = resolve('tmp', 'packaged-resources')

    expect(
      resolveRustAppServerExecutableInfo(
        { [RUST_APP_SERVER_BINARY_ENV]: resolve('rust', 'codex-rs', 'target', 'debug', binaryName) } as NodeJS.ProcessEnv,
        { isPackaged: true, resourcesPath },
      ),
    ).toEqual({
      path: resolve(resourcesPath, 'desktop-rust-sidecar', binaryName),
      source: 'bundled',
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

  test('sets CODEPILOTX_CONFIG_DIR and CODEPILOTX_SQLITE_HOME from configDirectoryPath, overriding process.env', async () => {
    using _restore = withEnv('CODEPILOTX_CONFIG_DIR', '/should-be-overridden')

    const context = {
      sessionId: 'session-2',
      workspacePath: process.cwd(),
      model: 'test-model',
      configDirectoryPath: 'C:\\Users\\TestUser\\.codepilotx',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = await createRustSidecarOptions(context)

    // CODEPILOTX_CONFIG_DIR must be the explicit configDirectoryPath, NOT inherited from process.env
    expect(options.env.CODEPILOTX_CONFIG_DIR).toBe('C:\\Users\\TestUser\\.codepilotx')
    // CODEPILOTX_SQLITE_HOME must point to the same directory
    expect(options.env.CODEPILOTX_SQLITE_HOME).toBe('C:\\Users\\TestUser\\.codepilotx')
    // sidecar 专属变量仍正常生成
    expect(options.env.CODEPILOTX_SIDECAR_SESSION_ID).toBe('session-2')
    expect(options.env.CODEPILOTX_SIDECAR_MODEL).toBe('test-model')
  })

  test('sets CODEPILOTX_CONFIG_DIR and CODEPILOTX_SQLITE_HOME from configDirectoryPath even without env override', async () => {
    const context = {
      sessionId: 'session-2b',
      workspacePath: process.cwd(),
      model: 'test-model',
      configDirectoryPath: '/home/test/.codepilotx',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    } satisfies DesktopAgentRuntimeContext

    const options = await createRustSidecarOptions(context)

    expect(options.env.CODEPILOTX_CONFIG_DIR).toBe('/home/test/.codepilotx')
    expect(options.env.CODEPILOTX_SQLITE_HOME).toBe('/home/test/.codepilotx')
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
      expect(options.args).not.toContain(
        'model_providers.minimax-cn.env_key="MINIMAX_API_KEY"',
      )
      expect(options.args).toContain(
        'model_providers.minimax-cn.env_key="keyring:minimax-cn"',
      )
      expect(options.args).not.toContain('sk-minimax-test-key')
      expect(options.env.MINIMAX_API_KEY).toBeUndefined()
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
      expect(options.args).toContain(
        'model_providers.openai.env_key="keyring:openai"',
      )
      expect(options.args).not.toContain('sk-openai-test')
      expect(options.env.OPENAI_API_KEY).toBeUndefined()
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
        'model_providers.deepseek.env_key="keyring:deepseek"',
      )
      expect(options.args).not.toContain('sk-deepseek-test-key')
      expect(options.env.DEEPSEEK_API_KEY).toBeUndefined()
    } finally {
      await rm(configDir, { force: true, recursive: true })
    }
  })
})

// ── requestUserInput handler ───────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime requestUserInput', () => {
  test('returns answers for single question with user input', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: { answer: 'Tokyo' },
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'City', question: 'What city?', options: null },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['Tokyo'] },
      },
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  test('returns declined answer when user denies', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'deny' as const,
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'City', question: 'What city?', options: null },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['[User declined to answer]'] },
      },
    })
  })

  test('batches multiple questions into a single permission request', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: {
        answers: {
          q1: 'Alice',
          q2: '30',
        },
      },
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'Name', question: 'Your name?' },
          { id: 'q2', header: 'Age', question: 'Your age?' },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['Alice'] },
        q2: { answers: ['30'] },
      },
    })
    // Must be a single batch call, not one per question
    expect(requestPermission).toHaveBeenCalledTimes(1)
    // Verify the batch input shape
    const callArgs = requestPermission.mock.calls[0] as unknown[]
    const callInput = callArgs[0] as { input: Record<string, unknown> }
    expect(Array.isArray(callInput.input.questions)).toBe(true)
    expect((callInput.input.questions as Array<unknown>)).toHaveLength(2)
  })

  test('reads answers by question id from updatedInput.answers', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: {
        answers: {
          q1: 'Alice',
          q2: '30',
        },
      },
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'Name', question: 'Your name?' },
          { id: 'q2', header: 'Age', question: 'Your age?' },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['Alice'] },
        q2: { answers: ['30'] },
      },
    })
  })

  test('falls back to legacy updatedInput.answer for backward compatibility', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: { answer: 'Tokyo' },
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'City', question: 'What city?', options: null },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['Tokyo'] },
      },
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  test('reads answers by question text when id is not found', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: {
        answers: {
          'Your name?': 'Bob',
        },
      },
    }))

    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })

    const handler = (
      runtime as unknown as {
        handleRequestUserInputRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleRequestUserInputRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        questions: [
          { id: 'q1', header: 'Name', question: 'Your name?' },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    expect(result).toEqual({
      answers: {
        q1: { answers: ['Bob'] },
      },
    })
  })
})

// ── Server approval request handlers ───────────────────────────────

describe('RustSidecarDesktopAgentRuntime server approvals', () => {
  function createRuntime(requestPermission: DesktopAgentRuntimeContext['requestPermission']) {
    return new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })
  }

  test('grants only requested permission categories and maps session scope', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      rememberOptionId: 'session' as const,
    }))
    const runtime = createRuntime(requestPermission)
    const handler = (
      runtime as unknown as {
        handlePermissionRequest: (params: unknown, id: unknown, method: string) => Promise<unknown>
      }
    ).handlePermissionRequest.bind(runtime)

    const result = await handler(
      {
        itemId: 'item-1',
        permissions: {
          fileSystem: { read: ['/workspace'] },
          network: null,
        },
      },
      1,
      'item/permissions/requestApproval',
    )

    expect(result).toEqual({
      permissions: { fileSystem: { read: ['/workspace'] } },
      scope: 'session',
    })
  })

  test('denies permissions with an empty grant profile', async () => {
    const runtime = createRuntime(async () => ({ behavior: 'deny' as const }))
    const handler = (
      runtime as unknown as {
        handlePermissionRequest: (params: unknown, id: unknown, method: string) => Promise<unknown>
      }
    ).handlePermissionRequest.bind(runtime)

    await expect(
      handler(
        {
          itemId: 'item-1',
          permissions: { fileSystem: { read: ['/workspace'] }, network: {} },
        },
        1,
        'item/permissions/requestApproval',
      ),
    ).resolves.toEqual({ permissions: {}, scope: 'turn' })
  })

  test('maps session command and file approvals to acceptForSession', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      rememberOptionId: 'session' as const,
    }))
    const runtime = createRuntime(requestPermission)
    const handler = (
      runtime as unknown as {
        handlePermissionRequest: (params: unknown, id: unknown, method: string) => Promise<unknown>
      }
    ).handlePermissionRequest.bind(runtime)

    await expect(
      handler({ itemId: 'cmd-1', command: 'echo hi' }, 1, 'item/commandExecution/requestApproval'),
    ).resolves.toEqual({ decision: 'acceptForSession' })
    await expect(
      handler({ itemId: 'file-1', filePath: 'note.txt' }, 2, 'item/fileChange/requestApproval'),
    ).resolves.toEqual({ decision: 'acceptForSession' })
  })

  test('maps a compatible cancellation decision without changing the desktop decision union', async () => {
    const runtime = createRuntime(async () => ({
      behavior: 'cancel',
    } as unknown as DesktopPermissionDecision))
    const handler = (
      runtime as unknown as {
        handlePermissionRequest: (params: unknown, id: unknown, method: string) => Promise<unknown>
      }
    ).handlePermissionRequest.bind(runtime)

    await expect(
      handler({ itemId: 'cmd-1', command: 'echo hi' }, 1, 'item/commandExecution/requestApproval'),
    ).resolves.toEqual({ decision: 'cancel' })
  })
})

// ── MCP elicitation handler ────────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime MCP elicitation', () => {
  test('returns accepted submitted form content', async () => {
    const requestPermission = mock(async () => ({
      behavior: 'allow' as const,
      updatedInput: { content: { confirmed: true, name: 'Ada' } },
    }))
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission,
    })
    const handler = (
      runtime as unknown as {
        handleMcpElicitationRequest: (params: unknown, id: unknown) => Promise<unknown>
      }
    ).handleMcpElicitationRequest.bind(runtime)

    await expect(
      handler({ serverName: 'demo', mode: 'form', message: 'Confirm?', requestedSchema: {} }, 1),
    ).resolves.toMatchObject({
      action: 'accept',
      content: { confirmed: true, name: 'Ada' },
    })
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })

  test('returns decline for denied elicitation', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const handler = (
      runtime as unknown as {
        handleMcpElicitationRequest: (params: unknown, id: unknown) => Promise<unknown>
      }
    ).handleMcpElicitationRequest.bind(runtime)

    await expect(handler({ serverName: 'demo', mode: 'form' }, 1)).resolves.toMatchObject({
      action: 'decline',
    })
  })

  test('returns cancel when a compatible cancellation decision is supplied', async () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'cancel' } as unknown as DesktopPermissionDecision),
    })
    const handler = (
      runtime as unknown as {
        handleMcpElicitationRequest: (params: unknown, id: unknown) => Promise<unknown>
      }
    ).handleMcpElicitationRequest.bind(runtime)

    await expect(handler({ serverName: 'demo', mode: 'form' }, 1)).resolves.toMatchObject({
      action: 'cancel',
    })
  })
})

// ── Dynamic tool call handler ──────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime dynamicToolCall', () => {
  test('returns DynamicToolCallResponse with success=false for unregistered tool', async () => {
    const emit = mock(() => {})
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit,
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const handler = (
      runtime as unknown as {
        handleToolCallRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleToolCallRequest.bind(runtime)

    const result = await handler(
      {
        tool: 'Bash',
        callId: 'call-1',
        arguments: { command: 'ls' },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    // Must be a DynamicToolCallResponse with success=false
    expect(result).toMatchObject({
      success: false,
      contentItems: [
        { type: 'inputText' },
      ],
    })
    // Should NOT have old fields
    expect(result).not.toHaveProperty('status')
    // Should have emitted tool_start
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_start',
        toolName: 'Bash',
      }),
    )
  })

  test('uses v2 fields only (no old field fallback)', async () => {
    const emit = mock(() => {})
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit,
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const handler = (
      runtime as unknown as {
        handleToolCallRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleToolCallRequest.bind(runtime)

    // Send params with ONLY old fields — should NOT be picked up
    const result = await handler(
      {
        name: 'OldTool',
        tool_name: 'OldToolName',
        id: 'old-id',
        tool_use_id: 'old-use-id',
        input: { oldField: true },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      1,
    )

    // With v2-only parsing, old field values should NOT be used.
    // tool defaults to 'Tool' when 'tool' is missing
    expect(result).toMatchObject({
      success: false,
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Tool',
      }),
    )
  })

	})

	// ── Duplicate tool_start guard ─────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime duplicate tool_start guard', () => {
  test('same toolUseId does not emit tool_start twice', async () => {
    const emit = mock(() => {})
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit,
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const handler = (
      runtime as unknown as {
        handleToolCallRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleToolCallRequest.bind(runtime)

    // First call should emit tool_start
    await handler(
      {
        tool: 'Bash',
        callId: 'call-1',
        arguments: { command: 'ls' },
      },
      1,
    )

    // Second call with same callId should NOT emit tool_start
    await handler(
      {
        tool: 'Bash',
        callId: 'call-1',
        arguments: { command: 'ls' },
      },
      2,
    )

    const toolStartCalls = emit.mock.calls.filter(
      ([event]: unknown[]) =>
        (event as { type: string }).type === 'tool_start',
    )
    expect(toolStartCalls).toHaveLength(1)
  })

  test('different toolUseId emits separate tool_start events', async () => {
    const emit = mock(() => {})
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit,
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const handler = (
      runtime as unknown as {
        handleToolCallRequest: (
          params: unknown,
          id: unknown,
        ) => Promise<unknown>
      }
    ).handleToolCallRequest.bind(runtime)

    await handler(
      { tool: 'Bash', callId: 'call-1', arguments: {} },
      1,
    )
    await handler(
      { tool: 'Bash', callId: 'call-2', arguments: {} },
      2,
    )

    const toolStartCalls = emit.mock.calls.filter(
      ([event]: unknown[]) =>
        (event as { type: string }).type === 'tool_start',
    )
    expect(toolStartCalls).toHaveLength(2)
  })
})

// ── Thread start params ───────────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime threadStartParams', () => {
	  test('does not include dynamicTools field', () => {
	    const runtime = new RustSidecarDesktopAgentRuntime({
	      sessionId: 'test-session',
	      workspacePath: process.cwd(),
	      emit: () => {},
	      requestPermission: async () => ({ behavior: 'deny' }),
	    })

	    const params = (
	      runtime as unknown as {
	        buildThreadStartParams: () => Record<string, unknown>
	      }
	    ).buildThreadStartParams()

	    expect(params).not.toHaveProperty('dynamicTools')
	    expect(params).toHaveProperty('ephemeral', false)
	  })

  test('uses persistent thread start when no app-server thread id is provided', () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const params = (runtime as unknown as { buildThreadStartParams: () => Record<string, unknown> })
      .buildThreadStartParams()
    expect(params.ephemeral).toBe(false)
  })

  test('builds thread resume params from persisted app-server thread id', () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      appServerThreadId: 'thread-persisted',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const params = (runtime as unknown as { buildThreadResumeParams: () => Record<string, unknown> })
      .buildThreadResumeParams()
    expect(params).toEqual({
      threadId: 'thread-persisted',
      cwd: process.cwd(),
    })
  })

  test('falls back to a fresh persistent thread when resume fails', async () => {
    const resumeThread = mock(async () => {
      throw new Error('thread not found')
    })
    const startThread = mock(async () => ({ thread: { id: 'thread-new' } }))
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      appServerThreadId: 'thread-stale',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const internals = runtime as unknown as {
      appServerClient: { resumeThread: typeof resumeThread; startThread: typeof startThread }
      startOrResumeThread: (threadId: string | null) => Promise<{ thread: { id: string } }>
    }
    internals.appServerClient = { resumeThread, startThread }

    const result = await internals.startOrResumeThread('thread-stale')

    expect(resumeThread).toHaveBeenCalledTimes(1)
    expect(startThread).toHaveBeenCalledTimes(1)
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: false }),
    )
    expect(result.thread.id).toBe('thread-new')
  })
})

describe('RustSidecarDesktopAgentRuntime model provider switching', () => {
  test('forks the active thread before the next turn when provider changes', async () => {
    const forkThread = mock(async () => ({
      thread: { id: 'thread-2' },
      model: 'deepseek-v4-pro',
      modelProvider: 'deepseek',
    }))
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-session',
      workspacePath: process.cwd(),
      providerID: 'minimax-cn',
      providerBaseURL: 'https://api.minimaxi.com/anthropic/v1',
      model: 'MiniMax-M3',
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const internals = runtime as unknown as {
      appServerClient: { forkThread: typeof forkThread }
      workflowState: { threadId: string | null }
      initialized: boolean
      threadStarted: boolean
      applyPendingProviderChange: () => Promise<void>
    }
    internals.appServerClient = { forkThread }
    internals.workflowState.threadId = 'thread-1'
    internals.initialized = true
    internals.threadStarted = true

    runtime.setModelProvider('deepseek', 'deepseek-v4-pro', 'https://api.deepseek.com')
    await internals.applyPendingProviderChange()

    expect(forkThread).toHaveBeenCalledWith({
      threadId: 'thread-1',
      model: 'deepseek-v4-pro',
      modelProvider: 'deepseek',
      cwd: process.cwd(),
      ephemeral: true,
    })
    expect(internals.workflowState.threadId).toBe('thread-2')
  })
})

	// ── Attachment input conversion ─────────────────────────────────────

describe('RustSidecarDesktopAgentRuntime input validation', () => {
  test('converts structured text and attachments into v2 user input', () => {
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'session-1',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })

    const input = (
      runtime as unknown as {
        buildUserInputFromContent: (content: unknown) => unknown[]
      }
    ).buildUserInputFromContent({
      text: 'hello',
      attachments: [
        {
          kind: 'image',
          name: 'screen.png',
          path: 'C:/tmp/screen.png',
          mediaType: 'image/png',
          sizeBytes: 10,
          contentBase64: 'aW1hZ2U=',
        },
        {
          kind: 'document',
          name: 'brief.pdf',
          path: 'C:/tmp/brief.pdf',
          mediaType: 'application/pdf',
          sizeBytes: 20,
          contentBase64: 'cGRm',
        },
        {
          kind: 'text',
          name: 'notes.txt',
          path: 'C:/tmp/notes.txt',
          mediaType: 'text/plain',
          sizeBytes: 30,
          textContent: 'notes',
        },
        {
          kind: 'audio',
          name: 'voice.mp3',
          path: 'C:/tmp/voice.mp3',
          mediaType: 'audio/mpeg',
          sizeBytes: 40,
          contentBase64: 'YXVkaW8=',
        },
        {
          kind: 'video',
          name: 'clip.mp4',
          path: 'C:/tmp/clip.mp4',
          mediaType: 'video/mp4',
          sizeBytes: 50,
          contentBase64: 'dmlkZW8=',
        },
        {
          kind: 'binary',
          name: 'archive.zip',
          path: 'C:/tmp/archive.zip',
          mediaType: 'application/zip',
          sizeBytes: 60,
          contentBase64: 'emlw',
        },
      ],
    })

    expect(input).toEqual([
      { type: 'text', text: 'hello', text_elements: [] },
      {
        type: 'image',
        url: 'data:image/png;base64,aW1hZ2U=',
        detail: 'auto',
      },
      {
        type: 'document',
        data: 'cGRm',
        mediaType: 'application/pdf',
        name: 'brief.pdf',
      },
      {
        type: 'textFile',
        text: 'notes',
        mediaType: 'text/plain',
        name: 'notes.txt',
      },
      {
        type: 'audio',
        data: 'YXVkaW8=',
        mediaType: 'audio/mpeg',
        name: 'voice.mp3',
      },
      {
        type: 'video',
        data: 'dmlkZW8=',
        mediaType: 'video/mp4',
        name: 'clip.mp4',
      },
      {
        type: 'file',
        data: 'emlw',
        mediaType: 'application/zip',
        name: 'archive.zip',
      },
    ])
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
    ).rejects.toThrow('not supported')
  })
})

describe('RustSidecarDesktopAgentRuntime lifecycle', () => {
  test('failed turn emits only error and never resolves before rejecting', () => {
    const events: unknown[] = []
    let resolveCount = 0
    let rejected: Error | undefined
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-terminal-error',
      workspacePath: process.cwd(),
      emit: event => events.push(event),
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const internals = runtime as unknown as {
      currentTurnResolve: () => void
      currentTurnReject: (error: Error) => void
      handleNotification: (method: string, params: unknown) => void
    }
    internals.currentTurnResolve = () => {
      resolveCount += 1
    }
    internals.currentTurnReject = error => {
      rejected = error
    }

    internals.handleNotification('error', { error: { message: 'turn failed' } })
    internals.handleNotification('turn/completed', {
      turn: { id: 'turn-1', status: 'completed' },
    })

    expect(events).toEqual([
      { type: 'error', sessionId: 'test-terminal-error', message: 'turn failed' },
    ])
    expect(resolveCount).toBe(0)
    expect(rejected?.message).toBe('turn failed')
  })

  test('dispose is idempotent and waits for the child exit', async () => {
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      kill: ReturnType<typeof mock>
    }
    child.killed = false
    child.kill = mock(() => {
      child.killed = true
      return true
    })
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-dispose',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    ;(runtime as unknown as { child: typeof child }).child = child

    let settled = false
    const first = runtime.dispose().then(() => {
      settled = true
    })
    const second = runtime.dispose()
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(child.kill).toHaveBeenCalledTimes(1)

    child.emit('exit', 0, null)
    await Promise.all([first, second])
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  test('an interrupted old turn cannot complete a newer turn', async () => {
    const events: unknown[] = []
    const interruptTurn = mock(async () => ({}))
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-turn-race',
      workspacePath: process.cwd(),
      emit: event => events.push(event),
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const internals = runtime as unknown as {
      appServerClient: { interruptTurn: typeof interruptTurn }
      workflowState: { threadId: string; activeTurnId: string | null }
      activeRuntimeTurnId: string | null
      currentTurnResolve: () => void
      interruptActiveTurn(): Promise<void>
      handleNotification(method: string, params: unknown): void
    }
    internals.appServerClient = { interruptTurn }
    internals.workflowState = { threadId: 'thread-1', activeTurnId: 'turn-old' }
    internals.activeRuntimeTurnId = 'turn-old'
    internals.currentTurnResolve = () => {}

    await internals.interruptActiveTurn()
    expect(events).toEqual([{ type: 'done', sessionId: 'test-turn-race' }])

    internals.activeRuntimeTurnId = 'turn-new'
    internals.handleNotification('turn/completed', {
      turn: { id: 'turn-old', status: 'completed' },
    })
    expect(events).toEqual([{ type: 'done', sessionId: 'test-turn-race' }])
  })

  test('fatal transport synchronously marks runtime failed and shares cleanup', async () => {
    const child = new EventEmitter() as EventEmitter & {
      killed: boolean
      exitCode: number | null
      signalCode: NodeJS.Signals | null
      kill: ReturnType<typeof mock>
    }
    child.killed = false
    child.exitCode = null
    child.signalCode = null
    child.kill = mock(() => {
      child.killed = true
      return true
    })
    const runtime = new RustSidecarDesktopAgentRuntime({
      sessionId: 'test-fatal-cleanup',
      workspacePath: process.cwd(),
      emit: () => {},
      requestPermission: async () => ({ behavior: 'deny' }),
    })
    const internals = runtime as unknown as {
      initialized: boolean
      threadStarted: boolean
      child: typeof child | null
      cleanupPromise: Promise<void> | null
      handleFatalTransport(error: Error): void
    }
    internals.initialized = true
    internals.threadStarted = true
    internals.child = child

    internals.handleFatalTransport(new Error('EPIPE'))
    internals.handleFatalTransport(new Error('EPIPE again'))
    expect(internals.initialized).toBe(false)
    expect(internals.threadStarted).toBe(false)
    expect(child.kill).toHaveBeenCalledTimes(1)

    child.exitCode = 1
    child.emit('exit', 1, null)
    await internals.cleanupPromise
    expect(internals.child).toBeNull()
  })
})
