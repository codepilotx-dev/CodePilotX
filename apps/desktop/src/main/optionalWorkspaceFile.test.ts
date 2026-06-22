import { expect, test } from 'bun:test'
import { readOptionalWorkspaceFile } from './optionalWorkspaceFile.js'
import type { DesktopFilePreview } from '../shared/types.js'

test('readOptionalWorkspaceFile returns null for missing optional files', async () => {
  const missing = new Error('missing') as NodeJS.ErrnoException
  missing.code = 'ENOENT'

  const result = await readOptionalWorkspaceFile(async () => {
    throw missing
  }, 'D:\\repo', 'D:\\repo\\AGENTS.override.md')

  expect(result).toBe(null)
})

test('readOptionalWorkspaceFile preserves existing file previews', async () => {
  const preview: DesktopFilePreview = {
    path: 'D:\\repo\\AGENTS.md',
    content: '# Guidance',
    truncated: false,
  }

  const result = await readOptionalWorkspaceFile(
    async () => preview,
    'D:\\repo',
    'D:\\repo\\AGENTS.md',
  )

  expect(result).toBe(preview)
})

test('readOptionalWorkspaceFile rethrows non-missing failures', async () => {
  const denied = new Error('denied') as NodeJS.ErrnoException
  denied.code = 'EACCES'

  await expect(
    readOptionalWorkspaceFile(async () => {
      throw denied
    }, 'D:\\repo', 'D:\\repo\\secret.md'),
  ).rejects.toBe(denied)
})
