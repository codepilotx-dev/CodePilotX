import { expect, mock, test, beforeEach } from 'bun:test'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '../utils/envUtils.js'
import { resetStateForTests } from '../bootstrap/state.js'

// Dynamic import of the module under test.
const {
  captureDesktopRuntimeGlobalState,
  restoreDesktopRuntimeGlobalState,
  createDesktopHeadlessRuntime,
  normalizeMcpConfigEntries,
} = await import('./desktopRuntime.js')

beforeEach(() => {
  resetStateForTests()
  // Clear env vars that desktop runtime manipulates so tests don't leak
  delete process.env[CODEPILOTX_CONFIG_DIR_ENV]
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  delete process.env.CODEPILOTX_DISABLE_MDM_READ
  delete process.env.CODEPILOTX_DISABLE_MIN_VERSION_CHECK
  delete process.env.CLAUDE_CODE_ENTRYPOINT
  delete process.env.CODEPILOTX_INSTALL_CODEX_DEPENDENCIES
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.USE_BUILTIN_RIPGREP
  delete process.env.CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS
  delete process.env.ANTHROPIC_SMALL_FAST_MODEL
  delete process.env.CODEPILOTX_FAST_MODEL
  delete process.env.CODEPILOTX_DEFAULT_MODEL
  delete process.env.CODEPILOTX_DEEP_MODEL
})

// ---------------------------------------------------------------------------
// captureDesktopRuntimeGlobalState / restoreDesktopRuntimeGlobalState
// ---------------------------------------------------------------------------

test('capture and restore preserves all captured env fields', () => {
  process.env.CODEPILOTX_DISABLE_MDM_READ = 'parent-value'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'parent-entrypoint'
  process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
  process.env.ANTHROPIC_SMALL_FAST_MODEL = 'parent-small-model'

  const snapshot = captureDesktopRuntimeGlobalState()

  // Simulate a runtime applying its own state
  process.env.CODEPILOTX_DISABLE_MDM_READ = '1'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  process.env.ANTHROPIC_SMALL_FAST_MODEL = 'runtime-model'

  // Restore
  restoreDesktopRuntimeGlobalState(snapshot)

  expect(process.env.CODEPILOTX_DISABLE_MDM_READ).toBe('parent-value')
  expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('parent-entrypoint')
  expect(process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe('0')
  expect(process.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('parent-small-model')
})

test('capture and restore handles undefined env keys (deletes them)', () => {
  delete process.env.CODEPILOTX_DISABLE_MDM_READ
  delete process.env.CODEPILOTX_INSTALL_CODEX_DEPENDENCIES

  const snapshot = captureDesktopRuntimeGlobalState()

  // Runtime sets them
  process.env.CODEPILOTX_DISABLE_MDM_READ = '1'
  process.env.CODEPILOTX_INSTALL_CODEX_DEPENDENCIES = '1'

  restoreDesktopRuntimeGlobalState(snapshot)

  expect(process.env.CODEPILOTX_DISABLE_MDM_READ).toBeUndefined()
  expect(process.env.CODEPILOTX_INSTALL_CODEX_DEPENDENCIES).toBeUndefined()
})

test('nested capture and restore: env fields', () => {
  // --- Layer 0: original (baseline) ---
  const originalConfigDir = '/home/user/.config'
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = originalConfigDir
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = originalConfigDir
  delete process.env.CODEPILOTX_DISABLE_MDM_READ
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'

  const outerSnapshot = captureDesktopRuntimeGlobalState()

  // --- Layer 1: parent runtime ---
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = '/parent/config'
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = '/parent/config'
  process.env.CODEPILOTX_DISABLE_MDM_READ = '1'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
  process.env.ANTHROPIC_SMALL_FAST_MODEL = 'parent-model'

  const innerSnapshot = captureDesktopRuntimeGlobalState()

  // --- Layer 2: reviewer runtime (nested inside parent) ---
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = '/reviewer/config'
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = '/reviewer/config'
  process.env.CODEPILOTX_DISABLE_MDM_READ = '0'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop-reviewer'
  process.env.ANTHROPIC_SMALL_FAST_MODEL = 'reviewer-model'

  // Restore reviewer → back to parent state
  restoreDesktopRuntimeGlobalState(innerSnapshot)

  expect(process.env[CODEPILOTX_CONFIG_DIR_ENV]).toBe('/parent/config')
  expect(process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]).toBe('/parent/config')
  expect(process.env.CODEPILOTX_DISABLE_MDM_READ).toBe('1')
  expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('desktop')
  expect(process.env.ANTHROPIC_SMALL_FAST_MODEL).toBe('parent-model')

  // Restore parent → back to original
  restoreDesktopRuntimeGlobalState(outerSnapshot)

  expect(process.env[CODEPILOTX_CONFIG_DIR_ENV]).toBe(originalConfigDir)
  expect(process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]).toBe(originalConfigDir)
  expect(process.env.CODEPILOTX_DISABLE_MDM_READ).toBeUndefined()
  expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli')
  expect(process.env.ANTHROPIC_SMALL_FAST_MODEL).toBeUndefined()
})

test('capture and restore preserves bootstrap state fields', async () => {
  const state = await import('../bootstrap/state.js')

  const knownSessionId = state.regenerateSessionId()
  state.switchSession(knownSessionId, '/some/project/dir')
  state.setOriginalCwd('/original/cwd')
  state.setProjectRoot('/original/root')
  state.setCwdState('/original/cwd')
  state.setClientType('cli')
  state.setSessionTrustAccepted(false)

  const snapshot = captureDesktopRuntimeGlobalState()

  // Apply runtime state (simulates prepareGlobalSessionState)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.switchSession('runtime-session' as any, null)
  state.setOriginalCwd('/runtime/cwd')
  state.setProjectRoot('/runtime/root')
  state.setCwdState('/runtime/cwd')
  state.setClientType('desktop')
  state.setSessionTrustAccepted(true)

  restoreDesktopRuntimeGlobalState(snapshot)

  expect(state.getSessionId()).toBe(knownSessionId)
  expect(state.getSessionProjectDir()).toBe('/some/project/dir')
  expect(state.getOriginalCwd()).toBe('/original/cwd')
  expect(state.getProjectRoot()).toBe('/original/root')
  expect(state.getCwdState()).toBe('/original/cwd')
  expect(state.getClientType()).toBe('cli')
  expect(state.getSessionTrustAccepted()).toBe(false)
})

test('nested bootstrap state restore: reviewer inside parent', async () => {
  const state = await import('../bootstrap/state.js')

  // Baseline
  const baselineSessionId = state.regenerateSessionId()
  state.switchSession(baselineSessionId, null)
  state.setOriginalCwd('/baseline/cwd')
  state.setClientType('cli')

  const outerSnapshot = captureDesktopRuntimeGlobalState()

  // Parent runtime
  state.setOriginalCwd('/parent/cwd')
  state.setClientType('desktop')

  const innerSnapshot = captureDesktopRuntimeGlobalState()

  // Reviewer (nested)
  state.setOriginalCwd('/reviewer/cwd')
  state.setClientType('desktop-reviewer')

  // Restore reviewer → parent
  restoreDesktopRuntimeGlobalState(innerSnapshot)
  expect(state.getOriginalCwd()).toBe('/parent/cwd')
  expect(state.getClientType()).toBe('desktop')

  // Restore parent → baseline
  restoreDesktopRuntimeGlobalState(outerSnapshot)
  expect(state.getOriginalCwd()).toBe('/baseline/cwd')
  expect(state.getClientType()).toBe('cli')
})

// ---------------------------------------------------------------------------
// Constructor behaviour
// ---------------------------------------------------------------------------

test('constructor does not modify process.env', () => {
  const before: Record<string, string | undefined> = {}
  const trackedKeys = [
    CODEPILOTX_CONFIG_DIR_ENV,
    LEGACY_CLAUDE_CONFIG_DIR_ENV,
    'CODEPILOTX_DISABLE_MDM_READ',
    'CODEPILOTX_DISABLE_MIN_VERSION_CHECK',
    'CLAUDE_CODE_ENTRYPOINT',
    'CODEPILOTX_INSTALL_CODEX_DEPENDENCIES',
    'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
    'USE_BUILTIN_RIPGREP',
    'CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CODEPILOTX_FAST_MODEL',
    'CODEPILOTX_DEFAULT_MODEL',
    'CODEPILOTX_DEEP_MODEL',
  ] as const
  for (const key of trackedKeys) {
    before[key] = process.env[key]
  }

  createDesktopHeadlessRuntime({
    sessionId: 'test-ctor-1',
    workspacePath: '/tmp/test-workspace',
    configDirectoryPath: '/tmp/test-config',
    model: 'claude-sonnet-4-6',
    smallFastModel: 'claude-haiku-4-5',
    fastModel: 'claude-haiku-4-5',
    defaultModel: 'claude-sonnet-4-6',
    deepModel: 'claude-opus-4-6',
    enableMemory: true,
    installCodexDependencies: true,
    askUserQuestionMaxQuestions: 5,
  })

  for (const key of trackedKeys) {
    expect(process.env[key]).toBe(before[key])
  }
})

test('constructor does not modify bootstrap state', async () => {
  const state = await import('../bootstrap/state.js')

  const sessionIdBefore = state.getSessionId()
  const projectDirBefore = state.getSessionProjectDir()
  const cwdBefore = state.getOriginalCwd()
  const clientTypeBefore = state.getClientType()
  const trustBefore = state.getSessionTrustAccepted()

  createDesktopHeadlessRuntime({
    sessionId: 'test-ctor-2',
    workspacePath: '/tmp/test-workspace',
    model: 'claude-sonnet-4-6',
  })

  expect(state.getSessionId()).toBe(sessionIdBefore)
  expect(state.getSessionProjectDir()).toBe(projectDirBefore)
  expect(state.getOriginalCwd()).toBe(cwdBefore)
  expect(state.getClientType()).toBe(clientTypeBefore)
  expect(state.getSessionTrustAccepted()).toBe(trustBefore)
})

test('normalizes MCP config record into named entries', () => {
  const entries = normalizeMcpConfigEntries({
    filesystem: {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      scope: 'user',
    },
  })

  expect(entries).toEqual([
    {
      name: 'filesystem',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      scope: 'user',
    },
  ])
})

// ---------------------------------------------------------------------------
// Error / abort path — restore is called even when the operation fails
// ---------------------------------------------------------------------------

test('error path: capture → modify → try/finally → restore resets state', () => {
  // This simulates the exact contract the runtime uses:
  //   const snapshot = captureDesktopRuntimeGlobalState()
  //   prepare...()
  //   try { runHeadless(...) } finally { restore(snapshot) }

  const configDirBefore = '/baseline/config'
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDirBefore
  process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  delete process.env.CODEPILOTX_DISABLE_MDM_READ

  const snapshot = captureDesktopRuntimeGlobalState()

  // Simulate prepareDesktopRuntimeEnv + prepareGlobalSessionState
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = '/runtime/config'
  process.env.CLAUDE_CODE_ENTRYPOINT = 'desktop'
  process.env.CODEPILOTX_DISABLE_MDM_READ = '1'

  // Simulate an error during headless execution (inside try/finally)
  try {
    try {
      throw new Error('simulated headless error')
    } finally {
      restoreDesktopRuntimeGlobalState(snapshot)
    }
  } catch {
    // Expected — error from the simulated headless execution
  }

  // Verify state is fully restored despite the error
  expect(process.env[CODEPILOTX_CONFIG_DIR_ENV]).toBe(configDirBefore)
  expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe('cli')
  expect(process.env.CODEPILOTX_DISABLE_MDM_READ).toBeUndefined()
})

test('error path also restores bootstrap state', async () => {
  const state = await import('../bootstrap/state.js')

  // Baseline
  const sessionIdBefore = state.getSessionId()
  state.switchSession(sessionIdBefore, '/baseline/project')
  state.setOriginalCwd('/baseline/cwd')
  state.setClientType('cli')

  const snapshot = captureDesktopRuntimeGlobalState()

  // Simulate prepare
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.switchSession('runtime-session' as any, null)
  state.setOriginalCwd('/runtime/cwd')
  state.setClientType('desktop')

  // Simulate error
  try {
    try {
      throw new Error('simulated error')
    } finally {
      restoreDesktopRuntimeGlobalState(snapshot)
    }
  } catch {
    // Expected
  }

  expect(state.getSessionId()).toBe(sessionIdBefore)
  expect(state.getSessionProjectDir()).toBe('/baseline/project')
  expect(state.getOriginalCwd()).toBe('/baseline/cwd')
  expect(state.getClientType()).toBe('cli')
})
