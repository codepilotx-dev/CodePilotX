import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  getProjectDir,
  loadAllProjectsMessageLogs,
  loadFullLog,
  saveAiGeneratedTitle,
  sqliteRowToLogOption,
} from './storage.js'
import type { LogOption, SerializedMessage } from './logs.js'

test('session storage facade exposes desktop session persistence entrypoints', () => {
  expect(typeof getProjectDir).toBe('function')
  expect(typeof loadAllProjectsMessageLogs).toBe('function')
  expect(typeof loadFullLog).toBe('function')
  expect(typeof saveAiGeneratedTitle).toBe('function')
})

test('core log types cover desktop transcript parsing shape', () => {
  const message: SerializedMessage = {
    type: 'user',
    message: { role: 'user', content: 'hello' },
    cwd: 'D:\\project',
    sessionId: 'session-id',
    timestamp: '2026-01-01T00:00:00.000Z',
    version: 'test',
    userType: 'external',
  }
  const log: LogOption = {
    date: message.timestamp,
    messages: [message],
    value: 0,
    created: new Date(message.timestamp),
    modified: new Date(message.timestamp),
    firstPrompt: 'hello',
    messageCount: 1,
    isSidechain: false,
  }

  expect(log.messages[0]?.message).toEqual({ role: 'user', content: 'hello' })
})

test('saveAiGeneratedTitle can write to an explicit transcript path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'core-session-storage-'))
  const sessionId =
    randomUUID() as `${string}-${string}-${string}-${string}-${string}`
  const transcriptPath = join(dir, `${sessionId}.jsonl`)

  try {
    saveAiGeneratedTitle(sessionId, 'Core title', transcriptPath)

    const lines = (await readFile(transcriptPath, 'utf8')).trim().split('\n')
    expect(JSON.parse(lines[0]!)).toEqual({
      type: 'ai-title',
      sessionId,
      aiTitle: 'Core title',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('sqlite session rows keep the original workspace path in log options', () => {
  const log = sqliteRowToLogOption(
    {
      id: randomUUID(),
      project_path: 'D:\\VueProject\\ClaudeCode',
      transcript_path: 'D:\\VueProject\\ClaudeCode\\.codepilotx\\session.jsonl',
      created_at_ms: 1,
      updated_at_ms: 2,
      preview: 'hello',
      title: 'hello',
      message_count: 1,
      file_size: 10,
      is_sidechain: 0,
    },
    0,
  )

  expect(log.projectPath).toBe('D:\\VueProject\\ClaudeCode')
})
