import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test } from 'bun:test'
import { appendMemoryRecallEvent } from './memoryRecallLog.js'

test('appendMemoryRecallEvent records metadata without full memory content', async () => {
  const memoryDir = join(tmpdir(), `codepilotx-recall-${crypto.randomUUID()}`)
  await mkdir(memoryDir, { recursive: true })
  try {
    await appendMemoryRecallEvent({
      memoryDir,
      sessionId: 'session-1',
      query: 'Please use the very sensitive deployment token abc123 while fixing this long issue',
      consumedOnIteration: 0,
      memories: [
        {
          path: join(memoryDir, 'prefs.md'),
          content: 'secret memory body that must not be copied',
          mtimeMs: 1782777600000,
          header: 'Memory: prefs.md',
          limit: 10,
        },
      ],
    })

    const raw = await readFile(join(memoryDir, '.recall-events.jsonl'), 'utf8')
    expect(raw).toContain('"sessionId":"session-1"')
    expect(raw).toContain('"relativePath":"prefs.md"')
    expect(raw).toContain('"truncated":true')
    expect(raw).not.toContain('secret memory body')
    expect(raw).not.toContain('abc123')
  } finally {
    await rm(memoryDir, { recursive: true, force: true })
  }
})
