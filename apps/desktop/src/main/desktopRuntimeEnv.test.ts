import { expect, test } from 'bun:test'
import { applyDesktopAgentRuntimeEnvDefaults } from './desktopRuntimeEnv.js'

test('applyDesktopAgentRuntimeEnvDefaults prefers system ripgrep for desktop runtime', () => {
  const env: Record<string, string | undefined> = {}

  applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
})

test('applyDesktopAgentRuntimeEnvDefaults overrides builtin ripgrep for desktop runtime', () => {
  const env: Record<string, string | undefined> = {
    USE_BUILTIN_RIPGREP: '1',
  }

  applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
})
