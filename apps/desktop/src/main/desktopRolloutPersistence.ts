import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
  CodexRolloutItem,
  CodexRolloutLine,
  CodexSessionMetaPayload,
} from '../generated/protocol/rollout.js'

export type DesktopRolloutSource = 'user' | 'internal_guardian' | 'subagent'

export type DesktopRolloutMetadata = CodexSessionMetaPayload & {
  originator: 'desktop'
  source: DesktopRolloutSource
  parentSessionId?: string
  guardianRolloutPath?: string
}

export type DesktopRolloutItem =
  | CodexRolloutItem<DesktopRolloutMetadata> & {
      type: 'session_meta'
    }
  | CodexRolloutItem<Record<string, unknown>> & {
      type: 'turn_context'
    }
  | CodexRolloutItem<Record<string, unknown>> & {
      type: 'response_item'
    }
  | CodexRolloutItem<DesktopRolloutEventPayload> & {
      type: 'event_msg'
    }
  | CodexRolloutItem<Record<string, unknown>> & {
      type: 'compacted'
    }

export type DesktopRolloutLine = CodexRolloutLine & DesktopRolloutItem

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

export function createRolloutWriteScheduler(options?: {
  onError?: (error: unknown, rolloutPath: string) => void
}): RolloutWriteScheduler {
  const queues = new Map<string, DesktopRolloutItem[]>()
  const inFlight = new Map<string, Promise<void>>()

  const drainQueue = async (rolloutPath: string): Promise<void> => {
    let items = queues.get(rolloutPath)
    if (!items || items.length === 0) {
      inFlight.delete(rolloutPath)
      return
    }

    do {
      queues.delete(rolloutPath)
      try {
        await appendDesktopRolloutItems(rolloutPath, items)
      } catch (error) {
        options.onError?.(error, rolloutPath)
      }
      items = queues.get(rolloutPath)
    } while (items && items.length > 0)

    inFlight.delete(rolloutPath)
  }

  return {
    append(rolloutPath: string, items: DesktopRolloutItem[]) {
      let existing = queues.get(rolloutPath)
      if (!existing) {
        existing = []
        queues.set(rolloutPath, existing)
      }
      existing.push(...items)

      if (!inFlight.has(rolloutPath)) {
        const promise = drainQueue(rolloutPath)
        inFlight.set(rolloutPath, promise)
      }
    },

    async flush() {
      const promises = [...inFlight.values()]
      if (promises.length > 0) {
        await Promise.all(promises)
      }
    },
  }
}

export async function appendDesktopRolloutItems(
  rolloutPath: string,
  items: DesktopRolloutItem[],
  options: { includeInternal?: boolean } = {},
): Promise<void> {
  const lines = items
    .filter(item => shouldPersistDesktopRolloutItem(item, options))
    .map(item =>
      JSON.stringify({
        timestamp: new Date().toISOString(),
        ...item,
      } satisfies DesktopRolloutLine),
    )
  if (lines.length === 0) return
  await mkdir(dirname(rolloutPath), { recursive: true })
  await appendFile(rolloutPath, `${lines.join('\n')}\n`, 'utf8')
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
