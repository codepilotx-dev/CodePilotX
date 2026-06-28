import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { expect, test } from 'bun:test'

const repoRoot = join(import.meta.dir, '..', '..', '..')
const coreSrc = join(repoRoot, 'packages', 'core', 'src')
const desktopSrc = join(repoRoot, 'apps', 'desktop', 'src')

const coreToTuiAllowlist = new Set([
  'packages/core/src/session/title.ts',
  'packages/core/src/services/api/firstTokenDate.ts',
  'packages/core/src/services/oauth/client.ts',
  'packages/core/src/services/oauth/getOauthProfile.ts',
  'packages/core/src/services/oauth/index.ts',
  'packages/core/src/services/oauth/types.ts',
  'packages/core/src/utils/auth.ts',
  'packages/core/src/utils/config.ts',
  'packages/core/src/utils/plugins/cache.ts',
  'packages/core/src/utils/settings/settings.ts',
])

const desktopTuiImportBaseline = 22

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
    const text = await readFile(file, 'utf8')
    count += countMatches(text, /@codepilotx\/tui/g)
  }

  expect(count).toBeLessThanOrEqual(desktopTuiImportBaseline)
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
