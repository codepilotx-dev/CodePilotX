import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, unlink, utimes } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DesktopAgentEvent,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionViewSnapshot,
  DesktopToolLogEntry,
} from '../shared/types.js'
import {
  isInternalReviewerMessageText,
  isInternalReviewerPromptText,
} from '../shared/sessionEventModel.js'
import type {
  CodePilotXRolloutItem,
  CodePilotXRolloutLine,
  CodePilotXSessionMetaPayload,
} from '../generated/protocol/rollout.js'

export type DesktopRolloutSource = 'user' | 'internal_guardian' | 'subagent'

export type DesktopRolloutMetadata = CodePilotXSessionMetaPayload & {
  originator: 'desktop'
  source: DesktopRolloutSource
  parentSessionId?: string
  guardianRolloutPath?: string
}

export type DesktopRolloutItem =
  | CodePilotXRolloutItem<DesktopRolloutMetadata> & {
      type: 'session_meta'
    }
  | CodePilotXRolloutItem<Record<string, unknown>> & {
      type: 'turn_context'
    }
  | CodePilotXRolloutItem<Record<string, unknown>> & {
      type: 'response_item'
    }
  | CodePilotXRolloutItem<DesktopRolloutEventPayload> & {
      type: 'event_msg'
    }
  | CodePilotXRolloutItem<Record<string, unknown>> & {
      type: 'compacted'
    }

export type DesktopRolloutLine = CodePilotXRolloutLine & DesktopRolloutItem

export type DesktopRolloutEventPayload = {
  eventType: string
  createdAt?: string
  role?: 'user' | 'assistant' | 'system'
  content?: string
  toolName?: string
  toolUseId?: string
  isError?: boolean
  request?: DesktopPermissionRequest
  reviewId?: string
  targetRequestId?: string
  status?: string
  riskLevel?: string
  userAuthorization?: string
  rationale?: string
  metadata?: Record<string, unknown>
  guardianRolloutPath?: string
}

export type ParsedDesktopRolloutSnapshot = {
  view: DesktopSessionViewSnapshot
  events: DesktopSessionEvent[]
  effectiveModel?: string
}

export type RolloutWriteScheduler = {
  append(rolloutPath: string, items: DesktopRolloutItem[]): void
  flush(): Promise<void>
}

type RolloutAppendOperations = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  appendFile(path: string, content: string, encoding: 'utf8'): Promise<unknown>
}

export type DesktopPersistenceStatus = 'saved' | 'unsaved'

export function createRolloutWriteScheduler(options?: {
  onError?: (error: unknown, rolloutPath: string) => void
  onStatusChange?: (
    status: DesktopPersistenceStatus,
    rolloutPath: string,
  ) => void
  retryDelaysMs?: readonly number[]
  sleep?: (delayMs: number) => Promise<void>
  writeItems?: typeof appendDesktopRolloutItems
}): RolloutWriteScheduler {
  const queues = new Map<
    string,
    Array<{ id: string; items: DesktopRolloutItem[] }>
  >()
  const inFlight = new Map<string, Promise<void>>()
  const failures = new Map<string, unknown>()
  const retryDelaysMs = options?.retryDelaysMs ?? [50, 150]
  const sleep = options?.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)))
  const writeItems = options?.writeItems ?? appendDesktopRolloutItems

  const drainQueue = async (rolloutPath: string): Promise<void> => {
    let recovered = failures.has(rolloutPath)
    while (true) {
      const queue = queues.get(rolloutPath)
      if (!queue || queue.length === 0) {
        queues.delete(rolloutPath)
        failures.delete(rolloutPath)
        if (recovered) options?.onStatusChange?.('saved', rolloutPath)
        return
      }

      const batch = queue[0]!
      let failure: unknown
      let failed = true
      for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
        try {
          await writeItems(rolloutPath, batch.items, { batchId: batch.id })
          failed = false
          break
        } catch (error) {
          failure = error
          if (attempt < retryDelaysMs.length) {
            await sleep(retryDelaysMs[attempt]!)
          }
        }
      }

      if (failed) {
        failures.set(rolloutPath, failure)
        options?.onError?.(failure, rolloutPath)
        options?.onStatusChange?.('unsaved', rolloutPath)
        return
      }

      queue.shift()
      recovered = recovered || failures.delete(rolloutPath)
    }
  }

  const startDrain = (rolloutPath: string): Promise<void> => {
    const current = inFlight.get(rolloutPath)
    if (current) return current
    const promise = drainQueue(rolloutPath).finally(() => {
      if (inFlight.get(rolloutPath) === promise) {
        inFlight.delete(rolloutPath)
      }
    })
    inFlight.set(rolloutPath, promise)
    return promise
  }

  return {
    append(rolloutPath: string, items: DesktopRolloutItem[]) {
      let existing = queues.get(rolloutPath)
      if (!existing) {
        existing = []
        queues.set(rolloutPath, existing)
      }
      existing.push({ id: randomUUID(), items: [...items] })

      if (!inFlight.has(rolloutPath)) {
        void startDrain(rolloutPath)
      }
    },

    async flush() {
      if (inFlight.size === 0) {
        for (const [rolloutPath, batches] of queues) {
          if (batches.length > 0) startDrain(rolloutPath)
        }
      }
      await Promise.all([...inFlight.values()])
      if (failures.size > 0) throw failures.values().next().value
    },
  }
}

export async function appendDesktopRolloutItems(
  rolloutPath: string,
  items: DesktopRolloutItem[],
  options: {
    includeInternal?: boolean
    operations?: RolloutAppendOperations
    batchId?: string
    faultAfterAppend?: () => Promise<void>
    now?: () => string
    lockOptions?: Partial<RolloutLockOptions>
  } = {},
): Promise<void> {
  const lines = items
    .filter(item => shouldPersistDesktopRolloutItem(item, options))
    .map(item =>
      JSON.stringify({
        timestamp: options.now?.() ?? new Date().toISOString(),
        ...item,
      } satisfies DesktopRolloutLine),
    )
  if (lines.length === 0) return
  if (!options.operations) {
    await appendDesktopRolloutBatchWithRecovery(
      rolloutPath,
      lines.join('\n'),
      options.batchId ?? randomUUID(),
      options.faultAfterAppend,
      options.lockOptions,
    )
    return
  }
  const operations = options.operations
  await operations.mkdir(dirname(rolloutPath), { recursive: true })
  let existing = ''
  try {
    existing = await operations.readFile(rolloutPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  await operations.appendFile(
    rolloutPath,
    `${separator}${lines.join('\n')}\n`,
    'utf8',
  )
}

type RecoveryJournal = {
  state: 'prepared' | 'committed'
  batchId: string
  token: string
  rolloutPathHash: string
  originalSize: number
  byteLength: number
  sha256: string
  payloadBase64: string
}

type LockOwner = { token: string; pid: number; heartbeat: number }
type RolloutLockOptions = {
  staleMs: number
  heartbeatMs: number
  retryDelaysMs: number[]
  token: string
  pid: number
  isProcessAlive(pid: number): boolean
}

type RolloutLockHandle = { token: string; release(): Promise<void> }

async function appendDesktopRolloutBatchWithRecovery(
  rolloutPath: string,
  lines: string,
  batchId: string,
  faultAfterAppend?: () => Promise<void>,
  lockOverrides: Partial<RolloutLockOptions> = {},
): Promise<void> {
  const parentPath = dirname(rolloutPath)
  await mkdir(parentPath, { recursive: true })
  const lockPath = `${rolloutPath}.desktop-lock`
  const journalPath = `${rolloutPath}.desktop-recovery.json`
  const lock = await acquireRolloutLock(lockPath, lockOverrides)
  let bodyFailure: unknown
  try {
    const recoveredBatchId = await recoverRolloutJournal(
      rolloutPath,
      journalPath,
    )
    if (recoveredBatchId === batchId) return
    if (recoveredBatchId !== undefined) await unlinkDurably(journalPath)
    let existing = ''
    try {
      existing = await readFile(rolloutPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
    const bytes = Buffer.from(`${separator}${lines}\n`, 'utf8')
    const originalSize = await fileSizeOrZero(rolloutPath)
    const journal: RecoveryJournal = {
      state: 'prepared',
      batchId,
      token: randomUUID(),
      rolloutPathHash: createHash('sha256').update(rolloutPath).digest('hex'),
      originalSize,
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      payloadBase64: bytes.toString('base64'),
    }
    await writeFileAtomicallyDurable(journalPath, JSON.stringify(journal))
    await appendBufferDurably(rolloutPath, bytes)
    await faultAfterAppend?.()
    const tail = await readTail(rolloutPath, originalSize)
    if (!tail.subarray(0, bytes.length).equals(bytes)) {
      throw recoveryError('rollout append verification failed')
    }
    await writeFileAtomicallyDurable(
      journalPath,
      JSON.stringify({ ...journal, state: 'committed' } satisfies RecoveryJournal),
    )
  } catch (error) {
    bodyFailure = error
    throw error
  } finally {
    try {
      await lock.release()
    } catch (releaseError) {
      if (bodyFailure) {
        throw new AggregateError(
          [bodyFailure, releaseError],
          'rollout append and lock release both failed',
        )
      }
      throw releaseError
    }
  }
}

async function acquireRolloutLock(
  lockPath: string,
  overrides: Partial<RolloutLockOptions> = {},
): Promise<RolloutLockHandle> {
  const options: RolloutLockOptions = {
    staleMs: 30_000,
    heartbeatMs: 5_000,
    retryDelaysMs: [0, 50, 100, 200, 400, 800, 1_000],
    token: randomUUID(),
    pid: process.pid,
    isProcessAlive: isProcessAlive,
    ...overrides,
  }
  for (const delayMs of options.retryDelaysMs) {
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs))
    const claimPath = `${lockPath}.acquire-${options.token}-${randomUUID()}`
    try {
      await mkdir(claimPath)
      await syncDirectory(dirname(lockPath))
      await writeLockOwner(join(claimPath, 'owner.json'), {
        token: options.token,
        pid: options.pid,
        heartbeat: Date.now(),
      })
      await rename(claimPath, lockPath)
      await syncDirectory(dirname(lockPath))
      let released = false
      let heartbeatInFlight: Promise<void> | null = null
      const heartbeat = setInterval(() => {
        heartbeatInFlight = refreshLockOwner(lockPath, options).catch(() => {})
      }, options.heartbeatMs)
      heartbeat.unref?.()
      return {
        token: options.token,
        async release() {
          if (released) return
          released = true
          clearInterval(heartbeat)
          await heartbeatInFlight
          await releaseOwnedLock(lockPath, options.token)
        },
      }
    } catch (error) {
      await rm(claimPath, { recursive: true, force: true }).catch(() => {})
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      await reclaimStaleLock(lockPath, options)
    }
  }
  throw Object.assign(new Error('rollout lock is busy'), { code: 'EBUSY' })
}

async function refreshLockOwner(
  lockPath: string,
  options: RolloutLockOptions,
): Promise<void> {
  const owner = await readLockOwner(join(lockPath, 'owner.json'))
  if (owner.token !== options.token) return
  await writeLockOwner(join(lockPath, 'owner.json'), {
    token: options.token,
    pid: options.pid,
    heartbeat: Date.now(),
  })
  const now = new Date()
  await utimes(lockPath, now, now)
}

async function reclaimStaleLock(
  lockPath: string,
  options: RolloutLockOptions,
): Promise<void> {
  let observed: LockOwner
  try {
    observed = await readLockOwner(join(lockPath, 'owner.json'))
  } catch {
    return
  }
  if (!isReclaimableOwner(observed, options)) return
  const claimPath = `${lockPath}.claim-${options.token}-${randomUUID()}`
  try {
    await rename(lockPath, claimPath)
  } catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) return
    throw error
  }
  let removeClaim = false
  try {
    const claimed = await readLockOwner(join(claimPath, 'owner.json'))
    removeClaim = claimed.token === observed.token && isReclaimableOwner(claimed, options)
    if (!removeClaim) {
      await rename(claimPath, lockPath)
      return
    }
    await rm(claimPath, { recursive: true, force: true })
    await syncDirectory(dirname(lockPath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    if (!removeClaim) await rename(claimPath, lockPath).catch(() => {})
    throw error
  }
}

function isReclaimableOwner(owner: LockOwner, options: RolloutLockOptions): boolean {
  return Date.now() - owner.heartbeat > options.staleMs && !options.isProcessAlive(owner.pid)
}

async function releaseOwnedLock(lockPath: string, token: string): Promise<void> {
  const claimPath = `${lockPath}.release-${token}-${randomUUID()}`
  try {
    await rename(lockPath, claimPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  const owner = await readLockOwner(join(claimPath, 'owner.json')).catch(() => null)
  if (owner?.token !== token) {
    await rename(claimPath, lockPath).catch(() => {})
    return
  }
  await rm(claimPath, { recursive: true, force: true })
  await syncDirectory(dirname(lockPath))
}

async function readLockOwner(path: string): Promise<LockOwner> {
  const value = JSON.parse(await readFile(path, 'utf8')) as Partial<LockOwner>
  if (
    typeof value.token !== 'string' || value.token.length === 0 ||
    !Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0 ||
    !Number.isSafeInteger(value.heartbeat) || (value.heartbeat ?? -1) < 0
  ) throw recoveryError('invalid rollout lock owner')
  return value as LockOwner
}

async function writeLockOwner(path: string, owner: LockOwner): Promise<void> {
  await writeFileAtomicallyDurable(path, JSON.stringify(owner))
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function recoverRolloutJournal(
  rolloutPath: string,
  journalPath: string,
): Promise<string | undefined> {
  let journal: RecoveryJournal
  try {
    journal = parseRecoveryJournal(await readFile(journalPath, 'utf8'), rolloutPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const fileSize = await fileSizeOrZero(rolloutPath)
  if (fileSize < journal.originalSize) throw recoveryError('rollout is shorter than recovery offset')
  const tail = await readTail(rolloutPath, journal.originalSize)
  const expected = Buffer.from(journal.payloadBase64, 'base64')
  if (tail.length >= expected.length && tail.subarray(0, expected.length).equals(expected)) {
    if (journal.state !== 'committed') {
      await writeFileAtomicallyDurable(
        journalPath,
        JSON.stringify({ ...journal, state: 'committed' } satisfies RecoveryJournal),
      )
    }
    return journal.batchId
  }
  if (tail.length < expected.length && expected.subarray(0, tail.length).equals(tail)) {
    await truncateDurably(rolloutPath, journal.originalSize)
    await unlinkDurably(journalPath)
    return undefined
  }
  throw recoveryError('rollout recovery tail does not belong to journal batch')
}

function parseRecoveryJournal(content: string, rolloutPath: string): RecoveryJournal {
  let value: Partial<RecoveryJournal>
  try {
    value = JSON.parse(content) as Partial<RecoveryJournal>
  } catch {
    throw recoveryError('invalid rollout recovery journal JSON')
  }
  if (
    (value.state !== 'prepared' && value.state !== 'committed') ||
    typeof value.batchId !== 'string' || value.batchId.length === 0 ||
    typeof value.token !== 'string' || value.token.length === 0 ||
    value.rolloutPathHash !== createHash('sha256').update(rolloutPath).digest('hex') ||
    !Number.isSafeInteger(value.originalSize) || (value.originalSize ?? -1) < 0 ||
    !Number.isSafeInteger(value.byteLength) || (value.byteLength ?? -1) < 0 ||
    typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.payloadBase64 !== 'string'
  ) throw recoveryError('invalid rollout recovery journal')
  const payload = Buffer.from(value.payloadBase64, 'base64')
  if (
    payload.toString('base64') !== value.payloadBase64 ||
    payload.length !== value.byteLength ||
    createHash('sha256').update(payload).digest('hex') !== value.sha256
  ) throw recoveryError('invalid rollout recovery payload')
  return value as RecoveryJournal
}

function recoveryError(message: string): Error {
  return Object.assign(new Error(message), { code: 'EROLLOUTRECOVERY' })
}

async function fileSizeOrZero(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

async function readTail(path: string, offset: number): Promise<Buffer> {
  try {
    return (await readFile(path)).subarray(offset)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0)
    throw error
  }
}

async function writeFileAtomicallyDurable(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${randomUUID()}`
  const file = await open(tempPath, 'wx')
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    await rename(tempPath, path)
    await syncDirectory(dirname(path))
  } catch (error) {
    await unlink(tempPath).catch(() => {})
    throw error
  }
}

async function appendBufferDurably(path: string, content: Buffer): Promise<void> {
  const existed = await fileSizeOrZero(path) > 0 || await pathExists(path)
  const file = await open(path, 'a')
  try {
    await file.writeFile(content)
    await file.sync()
  } finally {
    await file.close()
  }
  if (!existed) await syncDirectory(dirname(path))
}

async function truncateDurably(path: string, size: number): Promise<void> {
  const file = await open(path, 'r+')
  try {
    await file.truncate(size)
    await file.sync()
  } finally {
    await file.close()
  }
}

async function unlinkDurably(path: string): Promise<void> {
  await unlink(path)
  await syncDirectory(dirname(path))
}

async function pathExists(path: string): Promise<boolean> {
  try { await stat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function syncDirectory(path: string): Promise<void> {
  let directory
  try {
    directory = await open(path, 'r')
    await directory.sync()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (process.platform === 'win32' && ['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes(code ?? '')) return
    throw error
  } finally {
    await directory?.close().catch(() => {})
  }
}

async function appendFileDurably(
  path: string,
  content: string,
  _encoding: 'utf8',
): Promise<void> {
  const file = await open(path, 'a')
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
  } finally {
    await file.close()
  }
}

export function shouldPersistDesktopRolloutItem(
  item: DesktopRolloutItem,
  options: { includeInternal?: boolean } = {},
): boolean {
  if (item.type === 'turn_context' || item.type === 'session_meta') return true
  if (item.type === 'compacted' || item.type === 'response_item') return true
  if (item.type !== 'event_msg') return false
  const payload = item.payload
  if (payload.eventType === 'partial_message') return false
  if (
    options.includeInternal !== true &&
    payload.eventType === 'message' &&
    typeof payload.content === 'string' &&
    isInternalReviewerMessageText(payload.content)
  ) {
    return false
  }
  return (
    payload.eventType === 'message' ||
    payload.eventType === 'tool_call' ||
    payload.eventType === 'tool_result' ||
    payload.eventType === 'permission_request' ||
    payload.eventType === 'guardian_review' ||
    payload.eventType === 'status' ||
    payload.eventType === 'file_patch' ||
    payload.eventType === 'error' ||
    payload.eventType === 'checkpoint' ||
    payload.eventType === 'proposed_plan' ||
    payload.eventType === 'context_usage'
  )
}

export function desktopAgentEventToRolloutItems(
  event: DesktopAgentEvent,
): DesktopRolloutItem[] {
  const item = desktopAgentEventToRolloutItem(event)
  return item && shouldPersistDesktopRolloutItem(item) ? [item] : []
}

export async function parseDesktopRolloutSnapshot(
  rolloutPath: string,
  sessionId: string,
): Promise<ParsedDesktopRolloutSnapshot> {
  const text = await readFile(rolloutPath, 'utf8')
  const messages: DesktopSessionViewSnapshot['messages'] = []
  const toolLog: DesktopToolLogEntry[] = []
  const pendingPermissions: DesktopPermissionRequest[] = []
  const events: DesktopSessionEvent[] = []
  let contextUsage: DesktopSessionViewSnapshot['contextUsage'] = null
  let effectiveModel: string | undefined

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = parseRolloutLine(trimmed)
    if (!parsed || parsed.type !== 'event_msg') continue
    const payload = parsed.payload
    const createdAt = payload.createdAt ?? parsed.timestamp
    if (!shouldPersistDesktopRolloutItem(parsed)) continue

    if (
      payload.eventType === 'message' &&
      payload.role &&
      typeof payload.content === 'string'
    ) {
      const message = {
        id: randomId(),
        role: payload.role,
        text: payload.content,
        createdAt,
      }
      messages.push(message)
      events.push({
        id: randomId(),
        sessionId,
        type: 'message',
        role: payload.role,
        content: payload.content,
        createdAt,
      })
      continue
    }

    if (payload.eventType === 'tool_call' || payload.eventType === 'tool_result') {
      const toolName = payload.toolName ?? 'Tool'
      const entry: DesktopToolLogEntry = {
        id: randomId(),
        toolName,
        summary: payload.content ?? '',
        kind: payload.eventType === 'tool_call' ? 'start' : 'result',
        isError: payload.isError,
        createdAt,
        expanded: payload.isError === true,
      }
      toolLog.unshift(entry)
      events.push({
        id: randomId(),
        sessionId,
        type: payload.eventType,
        content: payload.content ?? '',
        createdAt,
        metadata: {
          toolName,
          ...(payload.toolUseId ? { toolUseId: payload.toolUseId } : {}),
          ...(payload.eventType === 'tool_result'
            ? { isError: payload.isError === true }
            : {}),
        },
      })
      continue
    }

    if (payload.eventType === 'permission_request' && payload.request) {
      pendingPermissions.unshift(payload.request)
      events.push({
        id: randomId(),
        sessionId,
        type: 'permission_request',
        content: payload.request.description,
        createdAt,
        metadata: { request: payload.request },
      })
      continue
    }

    if (payload.eventType === 'guardian_review') {
      events.push({
        id: randomId(),
        sessionId,
        type: 'guardian_review',
        content:
          payload.status === 'in_progress'
            ? 'Guardian review started'
            : payload.rationale ?? `Guardian review ${payload.status}`,
        createdAt,
        metadata: {
          reviewId: payload.reviewId,
          targetRequestId: payload.targetRequestId,
          status: payload.status,
          riskLevel: payload.riskLevel,
          userAuthorization: payload.userAuthorization,
          rationale: payload.rationale,
          guardianRolloutPath: payload.guardianRolloutPath,
        },
      })
      continue
    }

    if (payload.eventType === 'context_usage' && payload.metadata?.usage) {
      contextUsage = payload.metadata.usage as DesktopSessionViewSnapshot['contextUsage']
      const model = (contextUsage as { model?: unknown } | null)?.model
      if (typeof model === 'string') effectiveModel = model
    }
  }

  return {
    view: {
      messages,
      toolLog,
      pendingPermissions,
      contextUsage,
    },
    events,
    effectiveModel,
  }
}

function desktopAgentEventToRolloutItem(
  event: DesktopAgentEvent,
): DesktopRolloutItem | null {
  switch (event.type) {
    case 'message':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'message',
          role: event.role,
          content: event.text,
          createdAt: event.createdAt,
        },
      }
    case 'partial_message':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'partial_message',
          role: 'assistant',
          content: event.text,
          createdAt: event.createdAt,
        },
      }
    case 'tool_start':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'tool_call',
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          content: event.summary,
        },
      }
    case 'tool_result':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'tool_result',
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          content: event.summary,
          isError: event.isError,
        },
      }
    case 'permission_request':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'permission_request',
          content: event.request.description,
          request: event.request,
        },
      }
    case 'guardian_review':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'guardian_review',
          reviewId: event.reviewId,
          targetRequestId: event.targetRequestId,
          status: event.status,
          riskLevel: event.riskLevel,
          userAuthorization: event.userAuthorization,
          rationale: event.rationale,
          guardianRolloutPath: event.guardianRolloutPath,
          metadata: { action: event.action },
        },
      }
    case 'context_usage':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'context_usage',
          metadata: { usage: event.usage },
        },
      }
    case 'status':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'status',
          content: event.status,
        },
      }
    case 'error':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'error',
          role: 'system',
          content: event.message,
        },
      }
    case 'done':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'checkpoint',
          content: 'done',
        },
      }
    case 'proposed_plan':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'proposed_plan',
          role: 'assistant',
          content: event.text,
          metadata: { streaming: event.streaming === true },
        },
      }
    case 'diff':
      return {
        type: 'event_msg',
        payload: {
          eventType: 'file_patch',
          content: event.patch,
          metadata: {
            filePath: event.filePath,
            ...(event.metadata?.turnScoped === true
              ? { turnScoped: true }
              : {}),
          },
        },
      }
    case 'session_title':
      return null
  }
}

function parseRolloutLine(line: string): DesktopRolloutLine | null {
  try {
    const parsed = JSON.parse(line) as Partial<DesktopRolloutLine>
    if (
      typeof parsed.timestamp !== 'string' ||
      typeof parsed.type !== 'string' ||
      !parsed.payload ||
      typeof parsed.payload !== 'object'
    ) {
      return null
    }
    return parsed as DesktopRolloutLine
  } catch {
    return null
  }
}

function isInternalReviewerPrompt(text: string): boolean {
  return isInternalReviewerPromptText(text)
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}
