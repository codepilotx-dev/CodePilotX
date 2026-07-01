import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  appendDesktopRolloutItems,
  createRolloutWriteScheduler,
  desktopAgentEventToRolloutItems,
  parseDesktopRolloutSnapshot,
  shouldPersistDesktopRolloutItem,
  type DesktopRolloutLine,
  type DesktopRolloutItem,
} from './desktopRolloutPersistence.js'
import type { DesktopAgentEvent } from '../shared/types.js'

test('appendDesktopRolloutItems writes utf8 jsonl in append order', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const first = sessionMetaItem('session-1', dir)
    const second = eventItem('message', {
      role: 'user',
      content: 'hello',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    await appendDesktopRolloutItems(rolloutPath, [first])
    await appendDesktopRolloutItems(rolloutPath, [second])

    const lines = (await readFile(rolloutPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!) as DesktopRolloutLine).toMatchObject({
      type: 'session_meta',
      payload: first.payload,
    })
    expect(JSON.parse(lines[1]!) as DesktopRolloutLine).toMatchObject({
      type: 'event_msg',
      payload: second.payload,
    })
  })
})

test('rollout persist policy rejects transient and internal prompt messages', () => {
  expect(
    shouldPersistDesktopRolloutItem(
      eventItem('partial_message', { content: 'streaming' }),
    ),
  ).toBe(false)
  expect(
    shouldPersistDesktopRolloutItem(
      eventItem('message', {
        role: 'assistant',
        content:
          'Review this permission request. Return only JSON.\n\nInput JSON: {}\n\nAllowed output schema:',
      }),
    ),
  ).toBe(false)
  expect(
    shouldPersistDesktopRolloutItem(
      eventItem('message', {
        role: 'user',
        content: 'Review this permission request. Return only JSON.',
      }),
    ),
  ).toBe(false)
  expect(
    shouldPersistDesktopRolloutItem(
      eventItem('message', {
        role: 'assistant',
        content: '{"error":"No permission request provided to review."}',
      }),
    ),
  ).toBe(false)
  expect(
    shouldPersistDesktopRolloutItem(
      eventItem('message', { role: 'assistant', content: 'visible reply' }),
    ),
  ).toBe(true)
})

test('parseDesktopRolloutSnapshot reconstructs visible messages tools and guardian events', async () => {
  await withTempDir(async dir => {
    const sessionId = randomUUID()
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    await appendDesktopRolloutItems(rolloutPath, [
      sessionMetaItem(sessionId, dir),
      eventItem('message', {
        role: 'user',
        content: 'Run command',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      eventItem('tool_call', {
        toolName: 'PowerShell',
        toolUseId: 'call-1',
        content: 'PowerShell: echo ok',
        createdAt: '2026-01-01T00:00:01.000Z',
      }),
      eventItem('tool_result', {
        toolName: 'PowerShell',
        toolUseId: 'call-1',
        content: 'ok',
        createdAt: '2026-01-01T00:00:02.000Z',
      }),
      eventItem('guardian_review', {
        reviewId: 'guardian-1',
        targetRequestId: 'request-1',
        status: 'approved',
        riskLevel: 'low',
        userAuthorization: 'high',
        rationale: 'low risk',
        createdAt: '2026-01-01T00:00:03.000Z',
      }),
      eventItem('message', {
        role: 'assistant',
        content: 'Done',
        createdAt: '2026-01-01T00:00:04.000Z',
      }),
    ])

    const parsed = await parseDesktopRolloutSnapshot(rolloutPath, sessionId)

    expect(parsed.view.messages.map(message => message.text)).toEqual([
      'Run command',
      'Done',
    ])
    expect(parsed.view.toolLog.map(entry => entry.toolName)).toEqual([
      'PowerShell',
      'PowerShell',
    ])
    expect(parsed.events.map(event => event.type)).toEqual([
      'message',
      'tool_call',
      'tool_result',
      'guardian_review',
      'message',
    ])
    expect(parsed.view.pendingPermissions).toEqual([])
  })
})

test('desktopAgentEventToRolloutItems keeps guardian summaries but not internal reviewer prompts', () => {
  const promptEvent: DesktopAgentEvent = {
    type: 'message',
    sessionId: 'session-1',
    role: 'assistant',
    text:
      'Review this permission request. Return only JSON.\n\nPermission profile: :workspace\nInput JSON: {}\n\nAllowed output schema:',
  }
  const guardianEvent: DesktopAgentEvent = {
    type: 'guardian_review',
    sessionId: 'session-1',
    reviewId: 'guardian-1',
    targetRequestId: 'request-1',
    status: 'approved',
    riskLevel: 'low',
    userAuthorization: 'high',
    rationale: 'low risk',
    action: {
      type: 'command',
      source: 'PowerShell',
      command: 'echo ok',
    },
  }

  expect(desktopAgentEventToRolloutItems(promptEvent)).toEqual([])
  expect(desktopAgentEventToRolloutItems(guardianEvent)).toHaveLength(1)
})

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-rollout-test-'))
  try {
    await mkdir(dir, { recursive: true })
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function sessionMetaItem(sessionId: string, cwd: string) {
  return {
    type: 'session_meta' as const,
    payload: {
      id: sessionId,
      timestamp: '2026-01-01T00:00:00.000Z',
      cwd,
      originator: 'desktop',
      cli_version: 'test',
      source: 'user',
    },
  } satisfies DesktopRolloutItem
}

function eventItem(eventType: string, payload: Record<string, unknown>) {
  return {
    type: 'event_msg' as const,
    payload: {
      eventType,
      ...payload,
    },
  } satisfies DesktopRolloutItem
}

test('rollout write scheduler flush returns after all pending writes complete', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const scheduler = createRolloutWriteScheduler()

    scheduler.append(rolloutPath, [sessionMetaItem('session-1', dir)])
    scheduler.append(rolloutPath, [
      eventItem('message', {
        role: 'user',
        content: 'hello',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ])
    scheduler.append(rolloutPath, [
      eventItem('message', {
        role: 'assistant',
        content: 'hi there',
        createdAt: '2026-01-01T00:00:01.000Z',
      }),
    ])

    await scheduler.flush()

    const lines = (await readFile(rolloutPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]!).toContain('"type":"session_meta"')
    expect(lines[1]!).toContain('"type":"event_msg"')
    expect(lines[2]!).toContain('"type":"event_msg"')
  })
})

test('rollout write scheduler maintains order across multiple appends', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const scheduler = createRolloutWriteScheduler()

    for (let i = 0; i < 10; i++) {
      scheduler.append(rolloutPath, [
        eventItem('message', {
          role: 'user',
          content: `message ${i}`,
          createdAt: `2026-01-01T00:00:0${i}.000Z`,
        }),
      ])
    }

    await scheduler.flush()

    const lines = (await readFile(rolloutPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(lines[i]!).toContain(`message ${i}`)
    }
  })
})

test('rollout write scheduler continues after single append failure', async () => {
  await withTempDir(async dir => {
    const validPath = join(dir, 'valid.rollout.jsonl')
    const invalidPath = join(dir, 'nonexistent', 'invalid.rollout.jsonl')
    const scheduler = createRolloutWriteScheduler({
      onError: () => {},
    })

    scheduler.append(validPath, [sessionMetaItem('session-1', dir)])
    scheduler.append(invalidPath, [
      eventItem('message', { role: 'user', content: 'this will fail' }),
    ])
    scheduler.append(validPath, [
      eventItem('message', {
        role: 'user',
        content: 'after failure',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ])

    await scheduler.flush()

    const lines = (await readFile(validPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]!).toContain('"type":"session_meta"')
    expect(lines[1]!).toContain('after failure')
  })
})
