import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, mock, test } from 'bun:test'

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

test('listWorkspaceFiles ignores desktop cache and temp directories', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'desktop-workspace-'))
  await mkdir(join(workspacePath, '.cache', 'desktop-runtime'), {
    recursive: true,
  })
  await mkdir(join(workspacePath, '.Temp'), { recursive: true })
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await writeFile(join(workspacePath, '.cache', 'desktop-runtime', 'node.zip'), 'zip')
  await writeFile(join(workspacePath, '.Temp', 'conversation-flow.json'), '{}')
  await writeFile(join(workspacePath, 'src', 'index.ts'), 'export {}\n')
  const { listWorkspaceFiles, registerAllowedWorkspace } = await import(
    './workspaceService.js'
  )
  registerAllowedWorkspace(workspacePath)

  const entries = await listWorkspaceFiles(workspacePath)
  const paths = entries.map(entry => entry.path)

  expect(paths).toContain(join(workspacePath, 'src'))
  expect(paths).toContain(join(workspacePath, 'src', 'index.ts'))
  expect(paths.some(path => path.includes(`${join('.cache')}`))).toBe(false)
  expect(paths.some(path => path.includes(`${join('.Temp')}`))).toBe(false)
})
