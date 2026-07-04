import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const coreSrc = join(repoRoot, 'packages', 'core', 'src')
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src')

/**
 * Files in packages/core/src that still re-export from apps/tui (not yet migrated).
 *
 * Each entry here is a core shim that forwards its API from the TUI implementation.
 * When the implementation is moved into core, the file's re-export is replaced with
 * the real code and this entry is removed.
 */
const coreToTuiAllowlist = new Set([
  // Still re-exports from TUI — large dependency closures pending refactoring:
  'packages/core/src/utils/auth.ts',
  'packages/core/src/utils/config.ts',
  'packages/core/src/utils/settings/settings.ts',
])

const desktopTuiImportBaseline = 9

test('tui appServer protocol.ts re-exports from core rather than defining its own protocol', async () => {
  const protocolPath = join(
    repoRoot,
    'apps/tui/src/appServer/protocol.ts',
  )
  const text = await readFile(protocolPath, 'utf8')
  const lines = text.split('\n')

  // Must not define its own protocol constants
  const localDefinitions = lines.filter(
    l =>
      /^export\s+(const|function|type|interface)\s/.test(l) &&
      !l.includes('export type {') &&
      !l.includes('export {'),
  )
  expect(localDefinitions).toEqual([])

  // Must re-export from core
  expect(text).toContain("@codepilotx/core/appServer/protocol.js")
})

test('tui appServer server.ts re-exports JsonRpcAppServer from core', async () => {
  const serverPath = join(
    repoRoot,
    'apps/tui/src/appServer/server.ts',
  )
  const text = await readFile(serverPath, 'utf8')

  // Must re-export JsonRpcAppServer from core
  expect(text).toContain(
    "export { JsonRpcAppServer } from '@codepilotx/core/appServer/server.js",
  )

  // Must not define its own JsonRpcAppServer class
  expect(text).not.toContain('class JsonRpcAppServer')
})

test('core does not add new dependencies on tui internals', async () => {
  const offenders: string[] = []

  for (const file of await sourceFiles(coreSrc)) {
    const repoPath = toRepoPath(file)
    if (repoPath === 'packages/core/src/boundary.test.ts') continue
    const text = await readFile(file, 'utf8')
    if (!referencesTui(text)) continue
    if (coreToTuiAllowlist.has(repoPath)) continue
    offenders.push(repoPath)
  }

  expect(offenders).toEqual([])
})

test('desktop tui import count does not grow during migration', async () => {
  let count = 0

  for (const file of await sourceFiles(desktopSrc)) {
    const repoPath = toRepoPath(file)
    if (repoPath.startsWith('apps/desktop/src/typecheck-shims/')) continue
    const text = await readFile(file, 'utf8')
    count += countMatches(text, /@codepilotx\/tui/g)
  }

  expect(count).toBeLessThanOrEqual(desktopTuiImportBaseline)
})

/**
 * New test: verify that core's OAuth constants file exists and is
 * self-contained (no TUI references).
 */
test('core OAuth constants are self-contained', async () => {
  const constantsPath = join(
    coreSrc,
    'services',
    'oauth',
    'constants.ts',
  )
  const text = await readFile(constantsPath, 'utf8')
  expect(text).not.toContain('@codepilotx/tui')
  expect(text).not.toContain('apps/tui')
})

/**
 * New test: verify that core's OAuth types definition exists and is
 * self-contained.
 */
test('core OAuth types are self-contained', async () => {
  const typesPath = join(
    coreSrc,
    'services',
    'oauth',
    'types.ts',
  )
  const text = await readFile(typesPath, 'utf8')
  expect(text).not.toContain('@codepilotx/tui')
  expect(text).not.toContain('apps/tui')
})

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async entry => {
      const path = join(root, entry.name)
      if (entry.isDirectory()) return sourceFiles(path)
      if (!entry.isFile()) return []
      if (!/\.[cm]?[tj]sx?$/.test(entry.name)) return []
      return [path]
    }),
  )
  return files.flat()
}

function referencesTui(text: string): boolean {
  return (
    text.includes('@codepilotx/tui') ||
    text.includes('apps/tui') ||
    /\.\.\/(?:\.\.\/)*apps\/tui/.test(text)
  )
}

function countMatches(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length
}

function toRepoPath(file: string): string {
  return relative(repoRoot, file).split(sep).join('/')
}
