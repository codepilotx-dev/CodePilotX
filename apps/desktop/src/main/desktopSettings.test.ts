import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import { defaultDesktopStoredSettings } from '../shared/settingsSchema.js'

const originalCodepilotxConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
const originalClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
const originalUserProfile = process.env.USERPROFILE

afterEach(() => {
  restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodepilotxConfig)
  restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
  restoreEnv('USERPROFILE', originalUserProfile)
})

test('readDesktopStoredSettings prefers global AGENTS.md for custom instructions', async () => {
  const configDir = await makeConfigDir()
  const userProfile = await makeConfigDir()
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env.USERPROFILE = userProfile
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  await mkdir(join(userProfile, '.codepilotx'), { recursive: true })
  await writeFile(
    join(userProfile, '.codepilotx', 'AGENTS.md'),
    'global instructions',
    'utf8',
  )

  const settings = await readDesktopStoredSettings()

  expect(settings.customInstructions).toBe('global instructions')

  await rm(configDir, { recursive: true, force: true })
  await rm(userProfile, { recursive: true, force: true })
})

test('readDesktopStoredSettings reads AGENTS.md not AGENTS.override.md', async () => {
  const configDir = await makeConfigDir()
  const userProfile = await makeConfigDir()
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env.USERPROFILE = userProfile
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  await mkdir(join(userProfile, '.codepilotx'), { recursive: true })
  await writeFile(
    join(userProfile, '.codepilotx', 'AGENTS.md'),
    'settings content',
    'utf8',
  )
  await writeFile(
    join(userProfile, '.codepilotx', 'AGENTS.override.md'),
    'override content',
    'utf8',
  )

  const settings = await readDesktopStoredSettings()

  expect(settings.customInstructions).toBe('settings content')

  await rm(configDir, { recursive: true, force: true })
  await rm(userProfile, { recursive: true, force: true })
})

test('saveDesktopStoredSettings synchronizes custom instructions to global AGENTS.md', async () => {
  const configDir = await makeConfigDir()
  const userProfile = await makeConfigDir()
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env.USERPROFILE = userProfile
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]

  await saveDesktopStoredSettings({
    ...defaultDesktopStoredSettings(),
    customInstructions: '中文 instructions',
  })

  expect(
    await readFile(join(userProfile, '.codepilotx', 'AGENTS.md'), 'utf8'),
  ).toBe('中文 instructions')

  await rm(configDir, { recursive: true, force: true })
  await rm(userProfile, { recursive: true, force: true })
})

test('saveDesktopStoredSettings does NOT write AGENTS.override.md', async () => {
  const configDir = await makeConfigDir()
  const userProfile = await makeConfigDir()
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = configDir
  process.env.USERPROFILE = userProfile
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  await mkdir(join(userProfile, '.codepilotx'), { recursive: true })
  await writeFile(
    join(userProfile, '.codepilotx', 'AGENTS.override.md'),
    'preserved override',
    'utf8',
  )

  await saveDesktopStoredSettings({
    ...defaultDesktopStoredSettings(),
    customInstructions: 'saved from settings',
  })

  expect(
    await readFile(join(userProfile, '.codepilotx', 'AGENTS.override.md'), 'utf8'),
  ).toBe('preserved override')
  expect(
    await readFile(join(userProfile, '.codepilotx', 'AGENTS.md'), 'utf8'),
  ).toBe('saved from settings')

  await rm(configDir, { recursive: true, force: true })
  await rm(userProfile, { recursive: true, force: true })
})

async function makeConfigDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'desktop-settings-'))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
