import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'bun:test'
import {
  deleteProjectMemory,
  listProjectMemories,
  listProjectMemoryRecalls,
  readProjectMemory,
  resetProjectMemory,
  saveProjectMemory,
} from './desktopMemoryService.js'

async function makeWorkspace() {
  const root = await Bun.file(
    join(tmpdir(), `codepilotx-memory-${crypto.randomUUID()}`, 'marker'),
  )
  const workspacePath = join(tmpdir(), `codepilotx-workspace-${crypto.randomUUID()}`)
  const configHomeDir = join(tmpdir(), `codepilotx-config-${crypto.randomUUID()}`)
  await mkdir(workspacePath, { recursive: true })
  await mkdir(configHomeDir, { recursive: true })
  return { workspacePath, configHomeDir, cleanup: () => rm(join(root.name, '..'), { recursive: true, force: true }) }
}

test('project memory service lists reads saves and deletes markdown memories', async () => {
  const { workspacePath, configHomeDir } = await makeWorkspace()
  const saved = await saveProjectMemory({
    workspacePath,
    configHomeDir,
    relativePath: 'prefs.md',
    content: '---\ntype: feedback\ndescription: User prefers concise replies\n---\n\nKeep replies short.\n',
  })

  expect(saved.relativePath).toBe('prefs.md')
  expect(saved.type).toBe('feedback')
  expect(saved.description).toBe('User prefers concise replies')

  const listed = await listProjectMemories(workspacePath, configHomeDir)
  expect(listed.memories.map(memory => memory.relativePath)).toEqual(['prefs.md'])
  expect(listed.memories[0]?.type).toBe('feedback')

  const read = await readProjectMemory(workspacePath, configHomeDir, 'prefs.md')
  expect(read.content).toContain('Keep replies short.')

  await deleteProjectMemory({ workspacePath, configHomeDir, relativePath: 'prefs.md' })
  expect((await listProjectMemories(workspacePath, configHomeDir)).memories).toEqual([])
})

test('project memory service rejects path traversal', async () => {
  const { workspacePath, configHomeDir } = await makeWorkspace()
  await expect(
    saveProjectMemory({
      workspacePath,
      configHomeDir,
      relativePath: '../escape.md',
      content: 'nope',
    }),
  ).rejects.toThrow('Invalid memory path')
})

test('project memory reset can preserve or delete recall log', async () => {
  const { workspacePath, configHomeDir } = await makeWorkspace()
  const listing = await listProjectMemories(workspacePath, configHomeDir)
  await mkdir(listing.memoryDir, { recursive: true })
  await writeFile(join(listing.memoryDir, 'MEMORY.md'), '- [Prefs](prefs.md)\n', 'utf8')
  await writeFile(join(listing.memoryDir, 'prefs.md'), 'content\n', 'utf8')
  await writeFile(
    join(listing.memoryDir, '.recall-events.jsonl'),
    JSON.stringify({
      sessionId: 's1',
      createdAt: '2026-06-30T00:00:00.000Z',
      querySummary: 'Need help with settings',
      status: 'injected',
      consumedOnIteration: 0,
      memories: [{ relativePath: 'prefs.md', truncated: false }],
    }) + '\n',
    'utf8',
  )

  expect((await listProjectMemoryRecalls(workspacePath, configHomeDir)).recalls).toHaveLength(1)
  await resetProjectMemory({ workspacePath, configHomeDir, includeRecallLog: false })
  expect((await listProjectMemoryRecalls(workspacePath, configHomeDir)).recalls).toHaveLength(1)
  expect((await listProjectMemories(workspacePath, configHomeDir)).memories).toEqual([])

  await resetProjectMemory({ workspacePath, configHomeDir, includeRecallLog: true })
  expect((await listProjectMemoryRecalls(workspacePath, configHomeDir)).recalls).toEqual([])
})
