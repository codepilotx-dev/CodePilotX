import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  recordConversationDebugApi,
  recordConversationDebugError,
  recordConversationDebugStreamEvent,
  recordConversationDebugToolFlow,
  runWithConversationDebugDump,
} from './conversationDebugDump.js'

test('conversation debug dump does not write when disabled', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'conversation-dump-off-'))
  try {
    await runWithConversationDebugDump(
      {
        enabled: false,
        sessionId: 'session-off',
        workspacePath,
        turnInput: { content: 'hello' },
      },
      async () => {
        recordConversationDebugApi('request', { url: 'https://example.test' })
        return 'ok'
      },
    )

    expect(await listDumpFiles(workspacePath)).toEqual([])
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})

test('conversation debug dump writes full turn JSON under workspace .Temp', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'conversation-dump-on-'))
  try {
    const result = await runWithConversationDebugDump(
      {
        enabled: true,
        sessionId: 'session-on',
        workspacePath,
        turnInput: { content: '请用 Glob 查找 package.json' },
      },
      async () => {
        recordConversationDebugApi('request', {
          url: 'https://api.minimaxi.com/anthropic/v1/messages',
          headers: {
            Authorization: 'Bearer secret-token',
            'x-api-key': 'secret-key',
            'content-type': 'application/json',
          },
          body: { model: 'MiniMax-M3' },
        })
        recordConversationDebugStreamEvent('part', {
          type: 'tool-call',
          toolName: 'Glob',
        })
        recordConversationDebugToolFlow('tool_result', {
          toolUseId: 'call_glob',
          content: 'package.json',
        })
        return 'ok'
      },
    )

    expect(result).toBe('ok')
    const files = await listDumpFiles(workspacePath)
    expect(files).toHaveLength(1)
    expect(files[0]).toStartWith('conversation-flow-session-on-')

    const raw = await readFile(join(workspacePath, '.Temp', files[0]!), 'utf8')
    expect(raw).toContain('package.json')
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('secret-key')

    const parsed = JSON.parse(raw)
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      sessionId: 'session-on',
      workspacePath,
      turnInput: { content: '请用 Glob 查找 package.json' },
    })
    expect(parsed.api[0]).toMatchObject({
      event: 'request',
      data: {
        headers: {
          Authorization: { redacted: true, length: 19 },
          'x-api-key': { redacted: true, length: 10 },
          'content-type': 'application/json',
        },
      },
    })
    expect(parsed.streamEvents[0].data.toolName).toBe('Glob')
    expect(parsed.toolFlow[0].data.content).toBe('package.json')
    expect(parsed.endedAt).toEqual(expect.any(String))
    expect(parsed.durationMs).toEqual(expect.any(Number))
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})

test('conversation debug dump captures thrown errors and preserves original throw', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'conversation-dump-error-'))
  try {
    const error = new Error('provider failed')
    await expect(
      runWithConversationDebugDump(
        {
          enabled: true,
          sessionId: 'session-error',
          workspacePath,
          turnInput: { content: 'hello' },
        },
        async () => {
          recordConversationDebugError(error)
          throw error
        },
      ),
    ).rejects.toThrow('provider failed')

    const files = await listDumpFiles(workspacePath)
    expect(files).toHaveLength(1)
    const parsed = JSON.parse(
      await readFile(join(workspacePath, '.Temp', files[0]!), 'utf8'),
    )
    expect(parsed.errors[0]).toMatchObject({ message: 'provider failed' })
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})

test('conversation debug dump write failures do not fail the wrapped operation', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'conversation-dump-fail-'))
  try {
    await writeFile(join(workspacePath, '.Temp'), 'not a directory', 'utf8')

    await expect(
      runWithConversationDebugDump(
        {
          enabled: true,
          sessionId: 'session-write-fail',
          workspacePath,
          turnInput: { content: 'hello' },
        },
        async () => 'ok',
      ),
    ).resolves.toBe('ok')
  } finally {
    await rm(workspacePath, { recursive: true, force: true })
  }
})

async function listDumpFiles(workspacePath: string): Promise<string[]> {
  try {
    return (await readdir(join(workspacePath, '.Temp')))
      .filter(file => file.startsWith('conversation-flow-'))
      .sort()
  } catch {
    return []
  }
}
