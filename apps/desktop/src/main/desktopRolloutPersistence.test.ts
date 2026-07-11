import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  appendDesktopRolloutItems,
  createRolloutWriteScheduler,
  desktopAgentEventToRolloutItems,
  isUnsupportedDirectorySyncError,
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

test('rollout append retry recognizes a fully-written batch after append reports failure', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    const item = eventItem('message', { content: 'new' })
    await expect(
      appendDesktopRolloutItems(rolloutPath, [item], {
        batchId: 'batch-1',
        now: () => '2026-01-01T00:00:00.000Z',
        faultAfterAppend: async () => {
          throw Object.assign(new Error('unknown append result'), { code: 'EIO' })
        },
      }),
    ).rejects.toMatchObject({ code: 'EIO' })
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)
    expect(await fileExists(`${rolloutPath}.desktop-recovery.json`)).toBe(true)

    await appendDesktopRolloutItems(rolloutPath, [item], {
      batchId: 'batch-1',
      now: () => '2026-01-01T00:00:00.000Z',
    })
    const persisted = await readFile(rolloutPath, 'utf8')
    expect(persisted.match(/"content":"new"/g)).toHaveLength(1)
    expect(await fileExists(`${rolloutPath}.desktop-recovery.json`)).toBe(true)
    expect(JSON.parse(await readFile(`${rolloutPath}.desktop-recovery.json`, 'utf8'))).toMatchObject({
      state: 'committed', batchId: 'batch-1',
    })
  })
})

test('rollout append separates a valid existing line without trailing newline', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const meta = sessionMetaItem('session-1', dir)
    await writeFile(
      rolloutPath,
      JSON.stringify({ timestamp: new Date().toISOString(), ...meta }),
      'utf8',
    )
    await appendDesktopRolloutItems(
      rolloutPath,
      [eventItem('message', { role: 'assistant', content: 'new' })],
      { batchId: 'batch-tail' },
    )
    const parsed = await parseDesktopRolloutSnapshot(rolloutPath, 'session-1')
    expect(parsed.view.messages.map(message => message.text)).toEqual(['new'])
  })
})

test('rollout retry skips a partial tail and loader returns each completed batch item once', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const items = [
      eventItem('message', { role: 'user', content: 'first' }),
      eventItem('message', { role: 'assistant', content: 'second' }),
    ]
    const timestamp = '2026-01-01T00:00:00.000Z'
    const intended = `${items.map(item => JSON.stringify({ timestamp, ...item })).join('\n')}\n`
    await writeFile(rolloutPath, intended.slice(0, 41), 'utf8')
    await writeFile(
      `${rolloutPath}.desktop-recovery.json`,
      JSON.stringify(recoveryJournalFor(rolloutPath, 'batch-partial', intended)),
      'utf8',
    )
    await appendDesktopRolloutItems(rolloutPath, items, {
      batchId: 'batch-partial',
      now: () => timestamp,
    })
    const parsed = await parseDesktopRolloutSnapshot(rolloutPath, 'session-1')
    expect(parsed.view.messages.map(message => message.text)).toEqual([
      'first',
      'second',
    ])
  })
})

test('independent schedulers serialize large batches without interleaving lines', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const first = createRolloutWriteScheduler()
    const second = createRolloutWriteScheduler()
    const large = 'x'.repeat(64 * 1024)
    first.append(rolloutPath, Array.from({ length: 12 }, (_, index) =>
      eventItem('message', { role: 'user', content: `first-${index}-${large}` })))
    second.append(rolloutPath, Array.from({ length: 12 }, (_, index) =>
      eventItem('message', { role: 'assistant', content: `second-${index}-${large}` })))
    await Promise.all([first.flush(), second.flush()])
    const lines = (await readFile(rolloutPath, 'utf8')).trim().split('\n')
    expect(lines).toHaveLength(24)
    expect(lines.every(line => JSON.parse(line))).toBe(true)
    const sources = lines.map(line => JSON.parse(line).payload.content.split('-')[0])
    expect(sources.join(',')).toMatch(/^(first,){11}first,(second,){11}second$|^(second,){11}second,(first,){11}first$/)
  })
})

test('rollout records contain only protocol fields and no batch metadata', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    await appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'visible' })])
    const record = JSON.parse((await readFile(rolloutPath, 'utf8')).trim())
    expect(Object.keys(record).sort()).toEqual(['payload', 'timestamp', 'type'])
  })
})

test('rollout append reclaims a stale lock and removes it after writing', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const lockPath = `${rolloutPath}.desktop-lock`
    await mkdir(lockPath)
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
      token: 'dead-owner', pid: 999_999, heartbeat: Date.now() - 60_000,
    }))
    await appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'ok' })], {
      lockOptions: { staleMs: 10, retryDelaysMs: [0, 0], isProcessAlive: () => false },
    })
    expect(await fileExists(lockPath)).toBe(false)
  })
})

test('active heartbeat older than stale threshold is never reclaimed', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    let entered!: () => void
    const acquired = new Promise<void>(resolve => { entered = resolve })
    let unblock!: () => void
    const blocked = new Promise<void>(resolve => { unblock = resolve })
    const first = appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'first' })], {
      lockOptions: { staleMs: 30, heartbeatMs: 5, token: 'active-owner' },
      faultAfterAppend: async () => { entered(); await blocked },
    })
    await acquired
    await new Promise(resolve => setTimeout(resolve, 70))
    const second = appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'second' })], {
      lockOptions: { staleMs: 30, retryDelaysMs: [0, 20, 40, 80], isProcessAlive: () => false },
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    unblock()
    await Promise.all([first, second])
    expect((await readFile(rolloutPath, 'utf8')).trim().split('\n')).toHaveLength(2)
  })
})

test('two reclaimers cannot both own one stale lock', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const lockPath = `${rolloutPath}.desktop-lock`
    await mkdir(lockPath)
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
      token: 'dead-owner', pid: 999_999, heartbeat: Date.now() - 60_000,
    }))
    const lockOptions = { staleMs: 10, retryDelaysMs: [0, 0, 10, 20, 40], isProcessAlive: () => false }
    await Promise.all([
      appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'first' })], { lockOptions }),
      appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'second' })], { lockOptions }),
    ])
    expect((await readFile(rolloutPath, 'utf8')).trim().split('\n')).toHaveLength(2)
  })
})

test('old owner release never removes a replacement owner lock', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const lockPath = `${rolloutPath}.desktop-lock`
    await appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'first' })], {
      lockOptions: { token: 'old-owner', heartbeatMs: 10_000 },
      faultAfterAppend: async () => {
        await rm(lockPath, { recursive: true, force: true })
        await mkdir(lockPath)
        await writeFile(join(lockPath, 'owner.json'), JSON.stringify({
          token: 'new-owner', pid: process.pid, heartbeat: Date.now(),
        }))
      },
    })
    const owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8'))
    expect(owner.token).toBe('new-owner')
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'third' })], {
      lockOptions: { retryDelaysMs: [0] },
    })).rejects.toMatchObject({ code: 'EBUSY' })
    expect(JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')).token).toBe('new-owner')
    await rm(lockPath, { recursive: true, force: true })
  })
})

test('heartbeats are serialized and release waits for the active refresh', async () => {
  await withTempDir(async dir => {
    const callbacks: Array<() => void> = []
    let active = 0
    let maxActive = 0
    let finishHeartbeat!: () => void
    const heartbeatGate = new Promise<void>(resolve => { finishHeartbeat = resolve })
    let entered!: () => void
    const bodyEntered = new Promise<void>(resolve => { entered = resolve })
    let finishBody!: () => void
    const bodyGate = new Promise<void>(resolve => { finishBody = resolve })
    const append = appendDesktopRolloutItems(join(dir, 'session.jsonl'), [eventItem('message', { content: 'one' })], {
      lockOptions: {
        scheduleHeartbeat: callback => { callbacks.push(callback); return callback },
        cancelHeartbeat: () => {},
        onHeartbeat: async () => {
          active += 1
          maxActive = Math.max(maxActive, active)
          await heartbeatGate
          active -= 1
        },
      },
      faultAfterAppend: async () => { entered(); await bodyGate },
    })
    await bodyEntered
    expect(callbacks).toHaveLength(1)
    callbacks.shift()?.()
    await Promise.resolve()
    expect(callbacks).toHaveLength(0)
    finishBody()
    await Promise.resolve()
    expect(active).toBe(1)
    finishHeartbeat()
    await append
    expect(maxActive).toBe(1)
  })
})

test('heartbeat failure propagates after releasing its owned lock', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    const callbacks: Array<() => void> = []
    let entered!: () => void
    const bodyEntered = new Promise<void>(resolve => { entered = resolve })
    let finishBody!: () => void
    const bodyGate = new Promise<void>(resolve => { finishBody = resolve })
    const append = appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'one' })], {
      lockOptions: {
        scheduleHeartbeat: callback => { callbacks.push(callback); return callback },
        cancelHeartbeat: () => {},
        onHeartbeat: async () => { throw Object.assign(new Error('heartbeat failed'), { code: 'EIO' }) },
      },
      faultAfterAppend: async () => { entered(); await bodyGate },
    })
    await bodyEntered
    callbacks.shift()?.()
    await Promise.resolve()
    finishBody()
    await expect(append).rejects.toMatchObject({ code: 'EIO' })
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)
  })
})

test('heartbeat failure rejects first flush then retries the same batch exactly once', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    let firstAttempt = true
    const scheduler = createRolloutWriteScheduler({
      retryDelaysMs: [],
      writeItems: async (path, items, options) => {
        if (!firstAttempt) {
          await appendDesktopRolloutItems(path, items, options)
          return
        }
        firstAttempt = false
        let heartbeat!: () => void
        await appendDesktopRolloutItems(path, items, {
          ...options,
          lockOptions: {
            scheduleHeartbeat: callback => { heartbeat = callback; return callback },
            cancelHeartbeat: () => {},
            onHeartbeat: async () => {
              throw Object.assign(new Error('heartbeat EIO'), { code: 'EIO' })
            },
          },
          faultAfterAppend: async () => {
            heartbeat()
            await Promise.resolve()
          },
        })
      },
    })
    scheduler.append(rolloutPath, [eventItem('message', { content: 'exactly-once' })])
    await expect(scheduler.flush()).rejects.toMatchObject({ code: 'EIO' })
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)

    await scheduler.flush()
    expect((await readFile(rolloutPath, 'utf8')).match(/"content":"exactly-once"/g)).toHaveLength(1)
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)
  })
})

test('published lock is removed when parent sync fails after rename', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    let calls = 0
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'one' })], {
      lockOptions: {
        syncDirectory: async () => {
          calls += 1
          if (calls >= 2) throw Object.assign(new Error('sync denied'), { code: 'EACCES' })
        },
      },
    })).rejects.toThrow()
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)
  })
})

test('directory EACCES is propagated and never treated as unsupported', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'one' })], {
      lockOptions: {
        syncDirectory: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) },
      },
    })).rejects.toMatchObject({ code: 'EACCES' })
    expect(await fileExists(`${rolloutPath}.desktop-lock`)).toBe(false)
    expect(isUnsupportedDirectorySyncError('win32', 'sync', 'EACCES')).toBe(false)
    expect(isUnsupportedDirectorySyncError('win32', 'sync', 'EPERM')).toBe(true)
    expect(isUnsupportedDirectorySyncError('win32', 'open', 'EPERM')).toBe(false)
    expect(isUnsupportedDirectorySyncError('linux', 'sync', 'EPERM')).toBe(false)
  })
})

test('journal temp file is removed when write sync or rename preparation fails', async () => {
  await withTempDir(async dir => {
    for (const phase of ['after-write', 'after-sync', 'before-rename'] as const) {
      const rolloutPath = join(dir, `${phase}.jsonl`)
      await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'one' })], {
        faultJournalPhase: async current => {
          if (current === phase) throw new Error(`fault ${phase}`)
        },
      })).rejects.toThrow(`fault ${phase}`)
    }
    expect((await readdir(dir)).some(name => name.includes('.desktop-recovery.json.tmp-'))).toBe(false)
  })
})

test('acquire cleanup removes only stale protocol claim directories', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.jsonl')
    const protocolClaim = `${rolloutPath}.desktop-lock.acquire-abandoned-token`
    const unrelated = join(dir, 'unrelated.acquire-abandoned-token')
    await mkdir(protocolClaim)
    await mkdir(unrelated)
    const old = new Date(Date.now() - 60_000)
    await utimes(protocolClaim, old, old)
    await utimes(unrelated, old, old)
    await appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'one' })], {
      lockOptions: { staleMs: 10 },
    })
    expect(await fileExists(protocolClaim)).toBe(false)
    expect(await fileExists(unrelated)).toBe(true)
  })
})

test('unknown mixed recovery tail fails closed and preserves evidence', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const journalPath = `${rolloutPath}.desktop-recovery.json`
    const intended = '{"expected":true}\n'
    await writeFile(rolloutPath, '{"unknown":true}\n')
    await writeFile(journalPath, JSON.stringify(recoveryJournalFor(rolloutPath, 'batch-x', intended)))
    const beforeRollout = await readFile(rolloutPath)
    const beforeJournal = await readFile(journalPath)
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'new' })]))
      .rejects.toMatchObject({ code: 'EROLLOUTRECOVERY' })
    expect(await readFile(rolloutPath)).toEqual(beforeRollout)
    expect(await readFile(journalPath)).toEqual(beforeJournal)
  })
})

test('invalid recovery journal fails closed without deleting evidence', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const journalPath = `${rolloutPath}.desktop-recovery.json`
    await writeFile(rolloutPath, '{"existing":true}\n')
    await writeFile(journalPath, JSON.stringify({
      ...recoveryJournalFor(rolloutPath, 'batch-invalid', 'payload'),
      originalSize: Number.MAX_SAFE_INTEGER + 1,
    }))
    const before = await readFile(journalPath)
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'new' })]))
      .rejects.toMatchObject({ code: 'EROLLOUTRECOVERY' })
    expect(await readFile(journalPath)).toEqual(before)
    expect(await readFile(rolloutPath, 'utf8')).toBe('{"existing":true}\n')
  })
})

test('recovery fails closed when the original prefix was replaced at the same size', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const journalPath = `${rolloutPath}.desktop-recovery.json`
    const expectedTail = '{"expected":true}\n'
    await writeFile(rolloutPath, `BBBB${expectedTail}`)
    await writeFile(
      journalPath,
      JSON.stringify(recoveryJournalFor(rolloutPath, 'batch-prefix', expectedTail, 4, 'AAAA')),
    )
    const before = await readFile(rolloutPath)
    await expect(appendDesktopRolloutItems(rolloutPath, [eventItem('message', { content: 'new' })]))
      .rejects.toMatchObject({ code: 'EROLLOUTRECOVERY' })
    expect(await readFile(rolloutPath)).toEqual(before)
    expect(await fileExists(journalPath)).toBe(true)
  })
})

test('completed recovery batch preserves valid subsequent bytes', async () => {
  await withTempDir(async dir => {
    const rolloutPath = join(dir, 'session.rollout.jsonl')
    const item = eventItem('message', { content: 'first' })
    const timestamp = '2026-01-01T00:00:00.000Z'
    await expect(appendDesktopRolloutItems(rolloutPath, [item], {
      batchId: 'batch-first', now: () => timestamp,
      faultAfterAppend: async () => { throw new Error('crash') },
    })).rejects.toThrow('crash')
    const later = `${JSON.stringify({ timestamp, ...eventItem('message', { content: 'later' }) })}\n`
    await appendFile(rolloutPath, later)
    await appendDesktopRolloutItems(rolloutPath, [item], { batchId: 'batch-first', now: () => timestamp })
    expect((await readFile(rolloutPath, 'utf8')).match(/"content":"first"/g)).toHaveLength(1)
    expect((await readFile(rolloutPath, 'utf8')).match(/"content":"later"/g)).toHaveLength(1)
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function recoveryJournalFor(
  rolloutPath: string,
  batchId: string,
  payload: string,
  originalSize = 0,
  originalPrefix = '',
) {
  const bytes = Buffer.from(payload)
  return {
    state: 'prepared',
    batchId,
    token: 'journal-token',
    rolloutPathHash: createHash('sha256').update(rolloutPath).digest('hex'),
    originalPrefixSha256: createHash('sha256').update(originalPrefix).digest('hex'),
    originalSize,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    payloadBase64: bytes.toString('base64'),
  }
}

function memoryAppendOperations(
  files: Map<string, string>,
  overrides: {
    appendFile?(path: string, content: string): void
  } = {},
) {
  return {
    mkdir: async () => {},
    readFile: async (path: string) => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)!
    },
    appendFile: async (path: string, content: string) => {
      if (overrides.appendFile) overrides.appendFile(path, content)
      else files.set(path, `${files.get(path) ?? ''}${content}`)
    },
  }
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

for (const code of ['ENOSPC', 'EACCES', 'ENOTDIR', 'EIO']) {
  test(`rollout write scheduler retains ordered batch and rejects flush after ${code}`, async () => {
    const writes: DesktopRolloutItem[][] = []
    const statuses: string[] = []
    let failing = true
    const scheduler = createRolloutWriteScheduler({
      retryDelaysMs: [],
      writeItems: async (_rolloutPath, items) => {
        if (failing) {
          throw Object.assign(new Error(code), { code })
        }
        writes.push([...items])
      },
      onStatusChange: status => statuses.push(status),
    })
    const first = eventItem('message', { role: 'user', content: 'first' })
    const second = eventItem('message', { role: 'assistant', content: 'second' })

    scheduler.append('session.rollout.jsonl', [first])
    scheduler.append('session.rollout.jsonl', [second])

    await expect(scheduler.flush()).rejects.toMatchObject({ code })
    expect(writes).toEqual([])
    expect(statuses.at(-1)).toBe('unsaved')

    failing = false
    await scheduler.flush()

    expect(writes).toEqual([[first], [second]])
    expect(statuses.at(-1)).toBe('saved')
  })
}

test('rollout write scheduler retries a retained batch once without duplicating later appends', async () => {
  const writes: string[][] = []
  let attempts = 0
  const scheduler = createRolloutWriteScheduler({
    retryDelaysMs: [],
    writeItems: async (_rolloutPath, items) => {
      attempts += 1
      if (attempts === 1) throw new Error('rename failed')
      writes.push(
        items.map(item =>
          String((item.payload as Record<string, unknown>).content ?? ''),
        ),
      )
    },
  })

  scheduler.append('session.rollout.jsonl', [
    eventItem('message', { content: 'one' }),
  ])
  scheduler.append('session.rollout.jsonl', [
    eventItem('message', { content: 'two' }),
  ])
  await expect(scheduler.flush()).rejects.toThrow('rename failed')

  scheduler.append('session.rollout.jsonl', [
    eventItem('message', { content: 'three' }),
  ])
  await scheduler.flush()

  expect(writes).toEqual([['one'], ['two'], ['three']])
})
