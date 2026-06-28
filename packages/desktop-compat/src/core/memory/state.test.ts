import { join, sep } from 'node:path'
import { expect, test } from 'bun:test'
import {
  isPathWithinAutoMemory,
  parseMemoryType,
  resolveAutoMemoryDailyLogPath,
  resolveAutoMemoryPaths,
  resolveAutoMemoryState,
  validateAutoMemoryDirectory,
} from './state.js'

test('resolveAutoMemoryState follows shared disable priority', () => {
  expect(
    resolveAutoMemoryState({
      disableAutoMemoryEnv: 'true',
      settingsEnabled: true,
      defaultEnabled: true,
    }),
  ).toEqual({ enabled: false, disabledReason: 'disabled-env' })
  expect(
    resolveAutoMemoryState({
      disableAutoMemoryEnv: 'false',
      simpleMode: true,
      defaultEnabled: true,
    }),
  ).toEqual({ enabled: true })
  expect(
    resolveAutoMemoryState({
      remoteMode: true,
      defaultEnabled: true,
    }),
  ).toEqual({
    enabled: false,
    disabledReason: 'remote-without-memory-dir',
  })
  expect(
    resolveAutoMemoryState({
      settingsEnabled: false,
      defaultEnabled: true,
    }),
  ).toEqual({ enabled: false, disabledReason: 'settings-disabled' })
})

test('resolveAutoMemoryPaths returns override, setting, and default paths', () => {
  const homeDir = join(sep, 'Users', 'xiao')
  const override = resolveAutoMemoryPaths({
    configHomeDir: join(homeDir, '.claude'),
    homeDir,
    projectRoot: join(homeDir, 'repo'),
    pathOverride: join(homeDir, 'remote-memory'),
  })
  expect(override).toMatchObject({
    autoMemPath: `${join(homeDir, 'remote-memory')}${sep}`,
    hasPathOverride: true,
    source: 'override',
  })

  const setting = resolveAutoMemoryPaths({
    configHomeDir: join(homeDir, '.claude'),
    homeDir,
    projectRoot: join(homeDir, 'repo'),
    trustedDirectorySetting: '~/memories/project',
  })
  expect(setting).toMatchObject({
    autoMemPath: `${join(homeDir, 'memories', 'project')}${sep}`,
    source: 'setting',
  })

  const defaults = resolveAutoMemoryPaths({
    configHomeDir: join(homeDir, '.claude'),
    homeDir,
    projectRoot: join(homeDir, 'repo'),
    canonicalProjectRoot: join(homeDir, 'repo', '..', 'repo'),
  })
  expect(defaults.autoMemPath).toBe(
    `${join(homeDir, '.claude', 'projects', '-Users-xiao-repo', 'memory')}${sep}`,
  )
  expect(defaults.autoMemPath.endsWith(`${sep}memory${sep}`)).toBe(true)
  expect(defaults.entrypointPath.endsWith(`${sep}memory${sep}MEMORY.md`)).toBe(
    true,
  )
})

test('memory path helpers reject dangerous directories and locate files', () => {
  const homeDir = join(sep, 'Users', 'xiao')
  expect(
    validateAutoMemoryDirectory('~/', { expandTilde: true, homeDir }),
  ).toBeUndefined()
  expect(
    validateAutoMemoryDirectory('..', { expandTilde: true, homeDir }),
  ).toBeUndefined()

  const autoMemPath = `${join(homeDir, '.claude', 'projects', 'repo', 'memory')}${sep}`
  expect(
    isPathWithinAutoMemory(autoMemPath, join(autoMemPath, 'MEMORY.md')),
  ).toBe(true)
  expect(
    resolveAutoMemoryDailyLogPath(autoMemPath, new Date('2026-06-25')),
  ).toBe(join(autoMemPath, 'logs', '2026', '06', '2026-06-25.md'))
})

test('parseMemoryType accepts only known memory types', () => {
  expect(parseMemoryType('feedback')).toBe('feedback')
  expect(parseMemoryType('architecture')).toBeUndefined()
  expect(parseMemoryType(null)).toBeUndefined()
})
