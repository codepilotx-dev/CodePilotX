import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, expect, mock, test } from 'bun:test'

mock.module('electron', () => ({
  app: {
    getFileIcon: async () => ({ toDataURL: () => '' }),
    getPath: () => '',
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => '',
    showItemInFolder: () => {},
  },
}))

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true })),
  )
})

test('restores a pre-existing dirty file to its turn baseline content', async () => {
  const {
    captureTurnRestoreBaseline,
    restoreTurnBaselineChanges,
  } = await import('./desktopTurnRestore.js')
  const { registerAllowedWorkspace } = await import('./workspaceService.js')
  const root = await mkdtemp(join(tmpdir(), 'desktop-turn-restore-'))
  roots.push(root)
  registerAllowedWorkspace(root)
  await git(root, 'init')
  await git(root, 'config', 'user.email', 'test@example.com')
  await git(root, 'config', 'user.name', 'Test User')
  await writeFile(join(root, 'README.md'), 'clean\n', 'utf8')
  await git(root, 'add', 'README.md')
  await git(root, 'commit', '-m', 'init')
  await writeFile(join(root, 'README.md'), 'dirty before turn\n', 'utf8')

  const baseline = await captureTurnRestoreBaseline(root)
  await writeFile(join(root, 'README.md'), 'dirty after turn\n', 'utf8')

  const result = await restoreTurnBaselineChanges({
    workspacePath: root,
    baseline,
    paths: ['README.md'],
  })

  expect(result.ok).toBe(true)
  expect(await readFile(join(root, 'README.md'), 'utf8')).toBe(
    'dirty before turn\n',
  )
}, 30000)

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}
