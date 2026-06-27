import { expect, mock, test } from 'bun:test'

mock.module('child_process', () => ({
  execSync: () => 'C:\\tools\\rg\\rg.exe\r\n',
}))

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

test('does not overwrite existing CODEPILOTX_RIPGREP_PATH', () => {
  const env: Record<string, string | undefined> = {
    CODEPILOTX_RIPGREP_PATH: '/custom/rg/path',
  }

  applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.CODEPILOTX_RIPGREP_PATH).toBe('/custom/rg/path')
  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
})

test('does not overwrite existing CLAUDE_CODE_RIPGREP_PATH', () => {
  const env: Record<string, string | undefined> = {
    CLAUDE_CODE_RIPGREP_PATH: '/other/rg/path',
  }

  applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.CLAUDE_CODE_RIPGREP_PATH).toBe('/other/rg/path')
  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
})

test('sets both env vars when system rg is found', () => {
  const env: Record<string, string | undefined> = {}

  applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.CODEPILOTX_RIPGREP_PATH).toBe('C:\\tools\\rg\\rg.exe')
  expect(env.CLAUDE_CODE_RIPGREP_PATH).toBe('C:\\tools\\rg\\rg.exe')
  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
})

test('only sets USE_BUILTIN_RIPGREP when system rg not found', async () => {
  mock.module('child_process', () => ({
    execSync: () => { throw new Error('Command failed') },
  }))

  const mod = await import('./desktopRuntimeEnv.js')
  const env: Record<string, string | undefined> = {}
  mod.applyDesktopAgentRuntimeEnvDefaults(env)

  expect(env.USE_BUILTIN_RIPGREP).toBe('0')
  expect(env.CODEPILOTX_RIPGREP_PATH).toBeUndefined()
  expect(env.CLAUDE_CODE_RIPGREP_PATH).toBeUndefined()
})
