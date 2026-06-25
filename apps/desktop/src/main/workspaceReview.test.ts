import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'

mock.module('electron', () => ({
  app: {
    getFileIcon: async () => ({ toDataURL: () => '' }),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => '',
    showItemInFolder: () => undefined,
  },
}))

const execFileAsync = promisify(execFile)
let workspaceService:
  | typeof import('./workspaceService.js')
  | null = null

async function loadWorkspaceService(): Promise<typeof import('./workspaceService.js')> {
  workspaceService ??= await import('./workspaceService.js')
  return workspaceService
}

describe('workspace review diff', () => {
  test('returns structured unstaged hunks with line numbers', async () => {
    await withGitRepo(async repo => {
      await writeFile(join(repo, 'alpha.ts'), [
        'const first = 1',
        'const second = 2',
        'const third = 3',
        '',
      ].join('\n'), 'utf8')
      await git(repo, 'add', 'alpha.ts')
      await git(repo, 'commit', '-m', 'initial')
      await writeFile(join(repo, 'alpha.ts'), [
        'const first = 10',
        'const second = 2',
        'const third = 30',
        '',
      ].join('\n'), 'utf8')

      const { getWorkspaceReviewDiff } = await loadWorkspaceService()
      const result = await getWorkspaceReviewDiff({
        workspacePath: repo,
        scope: 'unstaged',
      })

      expect(result.activeScope).toBe('unstaged')
      expect(result.files).toHaveLength(1)
      expect(result.files[0]?.path).toBe('alpha.ts')
      expect(result.files[0]?.hunks).toHaveLength(1)
      expect(result.files[0]?.hunks[0]?.lines).toContainEqual(
        expect.objectContaining({
          type: 'removed',
          oldLine: 1,
          newLine: null,
          content: 'const first = 1',
        }),
      )
      expect(result.files[0]?.hunks[0]?.lines).toContainEqual(
        expect.objectContaining({
          type: 'added',
          oldLine: null,
          newLine: 3,
          content: 'const third = 30',
        }),
      )
    })
  })

  test('separates staged and unstaged scopes for the same file', async () => {
    await withGitRepo(async repo => {
      await writeFile(join(repo, 'alpha.ts'), 'one\ntwo\nthree\n', 'utf8')
      await git(repo, 'add', 'alpha.ts')
      await git(repo, 'commit', '-m', 'initial')
      await writeFile(join(repo, 'alpha.ts'), 'ONE\ntwo\nthree\n', 'utf8')
      await git(repo, 'add', 'alpha.ts')
      await writeFile(join(repo, 'alpha.ts'), 'ONE\ntwo\nTHREE\n', 'utf8')

      const { getWorkspaceReviewDiff } = await loadWorkspaceService()
      const staged = await getWorkspaceReviewDiff({
        workspacePath: repo,
        scope: 'staged',
      })
      const unstaged = await getWorkspaceReviewDiff({
        workspacePath: repo,
        scope: 'unstaged',
      })

      expect(staged.files[0]?.hunks[0]?.lines).toContainEqual(
        expect.objectContaining({ type: 'added', newLine: 1, content: 'ONE' }),
      )
      expect(staged.files[0]?.hunks[0]?.lines).not.toContainEqual(
        expect.objectContaining({ type: 'added', newLine: 3, content: 'THREE' }),
      )
      expect(unstaged.files[0]?.hunks[0]?.lines).toContainEqual(
        expect.objectContaining({ type: 'added', newLine: 3, content: 'THREE' }),
      )
    })
  })

  test('stages and unstages a single hunk without staging neighboring hunks', async () => {
    await withGitRepo(async repo => {
      const original = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)
      await writeFile(join(repo, 'alpha.txt'), `${original.join('\n')}\n`, 'utf8')
      await git(repo, 'add', 'alpha.txt')
      await git(repo, 'commit', '-m', 'initial')
      const edited = [...original]
      edited[0] = 'line 1 edited'
      edited[29] = 'line 30 edited'
      await writeFile(join(repo, 'alpha.txt'), `${edited.join('\n')}\n`, 'utf8')
      const {
        applyWorkspaceReviewOperation,
        getWorkspaceReviewDiff,
      } = await loadWorkspaceService()
      const review = await getWorkspaceReviewDiff({
        workspacePath: repo,
        scope: 'unstaged',
      })
      const hunkId = review.files[0]?.hunks[0]?.id
      expect(hunkId).toBeTruthy()

      const stageResult = await applyWorkspaceReviewOperation({
        workspacePath: repo,
        scope: 'unstaged',
        action: 'stage',
        target: { type: 'hunk', path: 'alpha.txt', hunkId: hunkId! },
      })
      expect(stageResult.ok).toBe(true)
      const cached = await git(repo, 'diff', '--cached')
      const unstaged = await git(repo, 'diff')
      expect(cached).toContain('line 1 edited')
      expect(cached).not.toContain('line 30 edited')
      expect(unstaged).toContain('line 30 edited')

      const unstageResult = await applyWorkspaceReviewOperation({
        workspacePath: repo,
        scope: 'staged',
        action: 'unstage',
        target: { type: 'hunk', path: 'alpha.txt', hunkId: hunkId! },
      })
      expect(unstageResult.ok).toBe(true)
      expect(await git(repo, 'diff', '--cached')).not.toContain('line 1 edited')
    })
  })
})

async function withGitRepo(run: (repo: string) => Promise<void>): Promise<void> {
  const repo = await mkdtemp(join(tmpdir(), `desktop-review-${randomUUID()}-`))
  try {
    await git(repo, 'init')
    await git(repo, 'config', 'user.email', 'test@example.com')
    await git(repo, 'config', 'user.name', 'Test User')
    const { registerAllowedWorkspace } = await loadWorkspaceService()
    registerAllowedWorkspace(repo)
    await run(repo)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
}

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: repo })
  return stdout
}
