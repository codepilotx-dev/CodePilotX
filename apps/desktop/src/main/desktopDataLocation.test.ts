import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  CODEPILOTX_CONFIG_DIR_NAME,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'

// Import pure functions that do NOT depend on Electron
import {
  normalizeSelectedDirectory,
  validateTargetDirectory,
  migrateConfigDir,
  readBootstrapConfigDirWithPath,
  getDataLocationControlSource,
} from './desktopDataLocation.js'

const originalCodepilotxConfig = process.env[CODEPILOTX_CONFIG_DIR_ENV]
const originalClaudeConfig = process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]

afterEach(() => {
  restoreEnv(CODEPILOTX_CONFIG_DIR_ENV, originalCodepilotxConfig)
  restoreEnv(LEGACY_CLAUDE_CONFIG_DIR_ENV, originalClaudeConfig)
})

// ---- normalizeSelectedDirectory ----

test('normalizeSelectedDirectory appends .codepilotx to a normal directory', () => {
  const result = normalizeSelectedDirectory('/home/user/my-data')
  // resolve() normalizes the path (drive letter on Windows, absolute on POSIX)
  const expected = resolve(join('/home/user/my-data', CODEPILOTX_CONFIG_DIR_NAME))
  expect(result).toBe(expected)
})

test('normalizeSelectedDirectory uses the directory directly when basename is .codepilotx', () => {
  const result = normalizeSelectedDirectory('/home/user/.codepilotx')
  expect(result).toBe(resolve('/home/user/.codepilotx'))
})

test('normalizeSelectedDirectory handles Windows-style paths', () => {
  const result = normalizeSelectedDirectory('C:\\Users\\me\\data')
  expect(result).toBe(
    join('C:\\Users\\me\\data', CODEPILOTX_CONFIG_DIR_NAME),
  )
})

test('normalizeSelectedDirectory trims whitespace', () => {
  const result = normalizeSelectedDirectory('  /tmp/mydir  ')
  const expected = resolve(join('/tmp/mydir', CODEPILOTX_CONFIG_DIR_NAME))
  expect(result).toBe(expected)
})

// ---- validateTargetDirectory ----

test('validateTargetDirectory throws when target equals source', () => {
  const src = resolve('/tmp/.codepilotx')
  expect(() => validateTargetDirectory(src, src)).toThrow(
    '目标目录与当前数据目录相同',
  )
})

test('validateTargetDirectory throws when target is inside source', () => {
  expect(() =>
    validateTargetDirectory('/tmp/.codepilotx', '/tmp/.codepilotx/sub'),
  ).toThrow('新目录不能位于当前数据目录内部')
})

test('validateTargetDirectory does not throw for unrelated directories', () => {
  expect(() =>
    validateTargetDirectory('/tmp/.codepilotx', '/other/.codepilotx'),
  ).not.toThrow()
})

test('validateTargetDirectory does not throw when source is inside target', () => {
  // source inside target is allowed (target is the parent, not the child)
  expect(() =>
    validateTargetDirectory('/tmp/.codepilotx/sub', '/other/.codepilotx'),
  ).not.toThrow()
})

// ---- migrateConfigDir ----

test('migrateConfigDir copies all files from source to target', async () => {
  const srcDir = await makeTempDir()
  const tgtDir = await makeTempDir()

  // Create source files
  await mkdir(join(srcDir, 'desktop'), { recursive: true })
  await writeFile(join(srcDir, 'settings.json'), JSON.stringify({ key: 'value' }), 'utf8')
  await writeFile(join(srcDir, 'desktop', 'data.txt'), 'hello', 'utf8')
  await mkdir(join(srcDir, 'sessions'), { recursive: true })
  await writeFile(join(srcDir, 'sessions', 'session1.json'), '{}', 'utf8')

  await migrateConfigDir(srcDir, tgtDir)

  // Verify all files were copied
  expect(
    await readFile(join(tgtDir, 'settings.json'), 'utf8'),
  ).toBe(JSON.stringify({ key: 'value' }))
  expect(await readFile(join(tgtDir, 'desktop', 'data.txt'), 'utf8')).toBe('hello')
  expect(await readFile(join(tgtDir, 'sessions', 'session1.json'), 'utf8')).toBe('{}')

  await rm(srcDir, { recursive: true, force: true })
  await rm(tgtDir, { recursive: true, force: true })
})

test('migrateConfigDir overwrites existing files in target', async () => {
  const srcDir = await makeTempDir()
  const tgtDir = await makeTempDir()

  // Create source file
  await writeFile(join(srcDir, 'settings.json'), 'from source', 'utf8')
  // Create target file with different content
  await writeFile(join(tgtDir, 'settings.json'), 'from target', 'utf8')

  await migrateConfigDir(srcDir, tgtDir)

  // Source file should overwrite
  expect(await readFile(join(tgtDir, 'settings.json'), 'utf8')).toBe('from source')

  await rm(srcDir, { recursive: true, force: true })
  await rm(tgtDir, { recursive: true, force: true })
})

// ---- readBootstrapConfigDirWithPath ----

test('readBootstrapConfigDirWithPath returns null when no bootstrap file exists', async () => {
  const userDataPath = await makeTempDir()
  const result = readBootstrapConfigDirWithPath(userDataPath)
  expect(result).toBeNull()
  await rm(userDataPath, { recursive: true, force: true })
})

test('readBootstrapConfigDirWithPath reads a previously written bootstrap file', async () => {
  const userDataPath = await makeTempDir()
  const bootstrapFile = join(userDataPath, 'codepilotx-config-bootstrap')
  const testDir = '/home/user/.codepilotx'

  // Manually write the bootstrap file
  await writeFile(bootstrapFile, testDir + '\n', 'utf8')

  const result = readBootstrapConfigDirWithPath(userDataPath)
  expect(result).toBe(testDir)

  await rm(userDataPath, { recursive: true, force: true })
})

test('readBootstrapConfigDirWithPath returns null for malformed bootstrap content', async () => {
  const userDataPath = await makeTempDir()
  const bootstrapFile = join(userDataPath, 'codepilotx-config-bootstrap')

  // Write invalid content (not an absolute path)
  await writeFile(bootstrapFile, 'relative/path\n', 'utf8')

  const result = readBootstrapConfigDirWithPath(userDataPath)
  expect(result).toBeNull()

  await rm(userDataPath, { recursive: true, force: true })
})

// ---- getDataLocationControlSource ----

test('getDataLocationControlSource returns env when CODEPILOTX_CONFIG_DIR is set', () => {
  process.env[CODEPILOTX_CONFIG_DIR_ENV] = '/custom/.codepilotx'
  expect(getDataLocationControlSource()).toBe('env')
})

test('getDataLocationControlSource returns env when CLAUDE_CONFIG_DIR is set', () => {
  process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = '/custom/.codepilotx'
  expect(getDataLocationControlSource()).toBe('env')
})

test('getDataLocationControlSource returns default when no env and no bootstrap', () => {
  delete process.env[CODEPILOTX_CONFIG_DIR_ENV]
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]
  expect(getDataLocationControlSource()).toBe('default')
})

test('getDataLocationControlSource returns bootstrap when bootstrap file exists', async () => {
  // Clean up env
  delete process.env[CODEPILOTX_CONFIG_DIR_ENV]
  delete process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV]

  const userDataPath = await makeTempDir()
  const bootstrapFile = join(userDataPath, 'codepilotx-config-bootstrap')
  await writeFile(bootstrapFile, '/bootstrap/.codepilotx\n', 'utf8')

  const result = getDataLocationControlSource(userDataPath)
  expect(result).toBe('bootstrap')

  await rm(userDataPath, { recursive: true, force: true })
})

// ---- Helpers ----

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dataloc-test-'))
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
