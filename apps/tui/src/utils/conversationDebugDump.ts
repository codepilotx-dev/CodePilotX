import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type ConversationDebugEvent = {
  event: string
  timestamp: string
  data?: unknown
}

type ConversationDebugDump = {
  schemaVersion: 1
  sessionId: string
  workspacePath: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  provider: Record<string, unknown> | null
  turnInput: Record<string, unknown>
  api: ConversationDebugEvent[]
  streamEvents: ConversationDebugEvent[]
  toolFlow: ConversationDebugEvent[]
  finalState: Record<string, unknown> | null
  errors: unknown[]
}

type ConversationDebugContext = {
  document: ConversationDebugDump
  startedAtMs: number
}

type RunWithConversationDebugDumpOptions = {
  enabled: boolean
  sessionId: string
  workspacePath: string
  turnInput?: Record<string, unknown>
}

let activeContext: ConversationDebugContext | null = null

const sensitiveKeyPattern =
  /authorization|api-key|x-api-key|token|secret|cookie|password/i

export async function runWithConversationDebugDump<T>(
  options: RunWithConversationDebugDumpOptions,
  operation: () => Promise<T>,
): Promise<T> {
  if (!options.enabled) {
    return operation()
  }

  const previousContext = activeContext
  const context = createConversationDebugContext(options)
  activeContext = context
  let thrown: unknown
  try {
    return await operation()
  } catch (error) {
    thrown = error
    recordConversationDebugError(error)
    throw error
  } finally {
    if (activeContext === context) {
      activeContext = previousContext
    }
    await writeConversationDebugDump(context).catch(error => {
      writeConversationDebugFailure(error)
    })
    if (thrown && activeContext === context) {
      activeContext = previousContext
    }
  }
}

export function isConversationDebugDumpActive(): boolean {
  return activeContext !== null
}

export function setConversationDebugTurnInput(
  data: Record<string, unknown>,
): void {
  if (!activeContext) return
  activeContext.document.turnInput = sanitizeForConversationDump({
    ...activeContext.document.turnInput,
    ...data,
  }) as Record<string, unknown>
}

export function setConversationDebugProvider(
  data: Record<string, unknown>,
): void {
  if (!activeContext) return
  activeContext.document.provider = sanitizeForConversationDump(data) as Record<
    string,
    unknown
  >
}

export function recordConversationDebugApi(
  event: string,
  data?: unknown,
): void {
  recordConversationDebugEvent('api', event, data)
}

export function recordConversationDebugStreamEvent(
  event: string,
  data?: unknown,
): void {
  recordConversationDebugEvent('streamEvents', event, data)
}

export function recordConversationDebugToolFlow(
  event: string,
  data?: unknown,
): void {
  recordConversationDebugEvent('toolFlow', event, data)
}

export function setConversationDebugFinalState(
  data: Record<string, unknown>,
): void {
  if (!activeContext) return
  activeContext.document.finalState = sanitizeForConversationDump(data) as Record<
    string,
    unknown
  >
}

export function recordConversationDebugError(error: unknown): void {
  if (!activeContext) return
  activeContext.document.errors.push(sanitizeForConversationDump(error))
}

function createConversationDebugContext({
  sessionId,
  workspacePath,
  turnInput,
}: RunWithConversationDebugDumpOptions): ConversationDebugContext {
  const startedAt = new Date().toISOString()
  return {
    startedAtMs: Date.now(),
    document: {
      schemaVersion: 1,
      sessionId,
      workspacePath,
      startedAt,
      provider: null,
      turnInput: sanitizeForConversationDump(turnInput ?? {}) as Record<
        string,
        unknown
      >,
      api: [],
      streamEvents: [],
      toolFlow: [],
      finalState: null,
      errors: [],
    },
  }
}

function recordConversationDebugEvent(
  section: 'api' | 'streamEvents' | 'toolFlow',
  event: string,
  data?: unknown,
): void {
  if (!activeContext) return
  activeContext.document[section].push({
    event,
    timestamp: new Date().toISOString(),
    ...(data !== undefined ? { data: sanitizeForConversationDump(data) } : {}),
  })
}

async function writeConversationDebugDump(
  context: ConversationDebugContext,
): Promise<void> {
  const endedAt = new Date().toISOString()
  context.document.endedAt = endedAt
  context.document.durationMs = Date.now() - context.startedAtMs
  const outputDir = join(context.document.workspacePath, '.Temp')
  await mkdir(outputDir, { recursive: true })
  const fileName = [
    'conversation-flow',
    sanitizeFileSegment(context.document.sessionId),
    sanitizeFileSegment(context.document.startedAt),
    randomUUID().slice(0, 8),
  ].join('-')
  await writeFile(
    join(outputDir, `${fileName}.json`),
    `${JSON.stringify(context.document, null, 2)}\n`,
    'utf8',
  )
}

function sanitizeForConversationDump(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), '')
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  key: string,
): unknown {
  if (sensitiveKeyPattern.test(key)) {
    return redactSecret(value)
  }
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...sanitizeObjectEntries(value, seen),
    }
  }
  if (value instanceof Headers) {
    return sanitizeObjectEntries(Object.fromEntries(value.entries()), seen)
  }
  if (value instanceof URL) {
    return value.href
  }
  if (typeof Request !== 'undefined' && value instanceof Request) {
    return {
      url: value.url,
      method: value.method,
      headers: sanitizeValue(value.headers, seen, 'headers'),
    }
  }
  if (typeof Response !== 'undefined' && value instanceof Response) {
    return {
      url: value.url,
      status: value.status,
      statusText: value.statusText,
      headers: sanitizeValue(value.headers, seen, 'headers'),
    }
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    return value.map(item => sanitizeValue(item, seen, ''))
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    return sanitizeObjectEntries(value, seen)
  }
  return String(value)
}

function sanitizeObjectEntries(
  value: object,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    result[entryKey] = sanitizeValue(entryValue, seen, entryKey)
  }
  return result
}

function redactSecret(value: unknown): Record<string, unknown> {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return {
    redacted: true,
    length: text.length,
    fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 12),
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
}

function writeConversationDebugFailure(error: unknown): void {
  try {
    process.stderr.write(
      `[desktop-debug] ${new Date().toISOString()} conversation_debug_dump_write_failed ${JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      })}\n`,
    )
  } catch {
    // Best-effort diagnostics only.
  }
}
