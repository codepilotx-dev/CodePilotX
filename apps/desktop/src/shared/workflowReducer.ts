import type {
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
} from './types.js'

export type WorkflowToolRun = {
  id: string
  toolUseId: string
  toolName: string
  callContent: string
  resultContent: string
  callCreatedAt?: string
  resultCreatedAt?: string
  isError: boolean
  isRunning: boolean
}

export type WorkflowReducerDiagnostics = {
  duplicateEventIds: string[]
  missingToolResults: string[]
  outOfOrderSequences: Array<{ previous: number; current: number }>
}

export type WorkflowDerivedSessionState = {
  events: DesktopSessionEvent[]
  toolRuns: WorkflowToolRun[]
  pendingPermissions: DesktopPermissionRequest[]
  turnStatus: DesktopSessionStatus
  diagnostics: WorkflowReducerDiagnostics
}

export function deriveWorkflowSessionState(
  workflowEvents: DesktopWorkflowEvent[],
  threadId?: string | null,
): WorkflowDerivedSessionState {
  const events: DesktopSessionEvent[] = []
  const toolRunsById = new Map<string, WorkflowToolRun>()
  const pendingPermissions = new Map<string, DesktopPermissionRequest>()
  const seenEventIds = new Set<string>()
  const duplicateEventIds: string[] = []
  const outOfOrderSequences: Array<{ previous: number; current: number }> = []
  let previousSequence: number | null = null
  let turnStatus: DesktopSessionStatus = 'idle'

  for (const event of workflowEvents) {
    if (threadId && event.threadId !== threadId) continue
    if (event.eventId) {
      if (seenEventIds.has(event.eventId)) {
        duplicateEventIds.push(event.eventId)
        continue
      }
      seenEventIds.add(event.eventId)
    }
    if (typeof event.sequence === 'number') {
      if (previousSequence !== null && event.sequence < previousSequence) {
        outOfOrderSequences.push({
          previous: previousSequence,
          current: event.sequence,
        })
      }
      previousSequence = event.sequence
    }

    if (event.type === 'turn.started') {
      turnStatus = 'running'
      continue
    }
    if (event.type === 'turn.completed') {
      turnStatus = 'done'
      events.push({
        id: event.eventId ?? eventId(event),
        sessionId: event.threadId,
        type: 'checkpoint',
        content: event.stopReason ?? 'done',
        createdAt: event.createdAt,
        metadata: {
          status: 'done',
          usage: event.usage,
          costUsd: event.costUsd,
        },
      })
      continue
    }
    if (event.type === 'turn.failed') {
      turnStatus = 'error'
      events.push({
        id: event.eventId ?? eventId(event),
        sessionId: event.threadId,
        type: 'error',
        role: 'system',
        content: event.error.message,
        createdAt: event.createdAt,
        metadata: { code: event.error.code },
      })
      continue
    }
    if (event.type === 'turn.interrupted') {
      turnStatus = 'done'
      events.push({
        id: event.eventId ?? eventId(event),
        sessionId: event.threadId,
        type: 'checkpoint',
        content: event.reason ?? 'interrupted',
        createdAt: event.createdAt,
        metadata: { status: 'interrupted' },
      })
      continue
    }
    if (!('item' in event)) continue

    const item = event.item
    const sessionEventId = event.eventId ?? item.id
    if (item.type === 'user_message' || item.type === 'agent_message') {
      events.push({
        id: sessionEventId,
        sessionId: event.threadId,
        type:
          item.type === 'agent_message' && item.streaming
            ? 'assistant_delta'
            : 'message',
        role: item.type === 'user_message' ? 'user' : 'assistant',
        content: item.text,
        createdAt: event.createdAt,
        metadata: item.metadata,
      })
      continue
    }
    if (item.type === 'tool_call') {
      const toolUseId = item.toolUseId ?? metadataString(item.metadata, 'toolUseId') ?? item.id
      upsertToolRun(toolRunsById, toolUseId, {
        id: item.id,
        toolUseId,
        toolName: item.toolName,
        callContent: item.summary,
        resultContent: '',
        callCreatedAt: event.createdAt,
        isError: false,
        isRunning: item.status === 'in_progress',
      })
      events.push({
        id: sessionEventId,
        sessionId: event.threadId,
        type: 'tool_call',
        content: item.summary,
        createdAt: event.createdAt,
        metadata: {
          ...item.metadata,
          toolName: item.toolName,
          toolUseId,
        },
      })
      continue
    }
    if (item.type === 'tool_result') {
      const toolUseId = item.toolUseId ?? metadataString(item.metadata, 'toolUseId') ?? item.id
      const existing = toolRunsById.get(toolUseId)
      toolRunsById.set(toolUseId, {
        id: existing?.id ?? item.id,
        toolUseId,
        toolName: item.toolName,
        callContent: existing?.callContent ?? '',
        resultContent: item.summary,
        callCreatedAt: existing?.callCreatedAt,
        resultCreatedAt: event.createdAt,
        isError: item.isError === true || item.status === 'failed',
        isRunning: false,
      })
      events.push({
        id: sessionEventId,
        sessionId: event.threadId,
        type: 'tool_result',
        content: item.summary,
        createdAt: event.createdAt,
        metadata: {
          ...item.metadata,
          toolName: item.toolName,
          toolUseId,
          isError: item.isError === true || item.status === 'failed',
        },
      })
      continue
    }
    if (item.type === 'permission_request') {
      const requestId = item.request.requestId
      if (item.status === 'in_progress') {
        pendingPermissions.set(requestId, item.request)
        events.push({
          id: sessionEventId,
          sessionId: event.threadId,
          type: 'permission_request',
          content: item.request.description,
          createdAt: event.createdAt,
          metadata: { request: item.request, decision: item.metadata?.decision },
        })
      } else {
        pendingPermissions.delete(requestId)
      }
      continue
    }
    if (item.type === 'file_change') {
      events.push({
        id: sessionEventId,
        sessionId: event.threadId,
        type: 'file_patch',
        content: summarizePatch(item.patch),
        createdAt: event.createdAt,
        metadata: {
          ...item.metadata,
          filePath: item.filePath,
          patch: item.patch,
          ...parsePatchStats(item.patch),
        },
      })
      continue
    }
    if (item.type === 'error') {
      events.push({
        id: sessionEventId,
        sessionId: event.threadId,
        type: 'error',
        role: 'system',
        content: item.message,
        createdAt: event.createdAt,
        metadata: { code: item.code },
      })
    }
  }

  return {
    events,
    toolRuns: [...toolRunsById.values()],
    pendingPermissions: [...pendingPermissions.values()],
    turnStatus,
    diagnostics: {
      duplicateEventIds,
      missingToolResults: [...toolRunsById.values()]
        .filter(run => run.isRunning)
        .map(run => run.toolUseId),
      outOfOrderSequences,
    },
  }
}

function upsertToolRun(
  toolRunsById: Map<string, WorkflowToolRun>,
  toolUseId: string,
  next: WorkflowToolRun,
): void {
  const current = toolRunsById.get(toolUseId)
  toolRunsById.set(toolUseId, {
    ...next,
    callContent: next.callContent || current?.callContent || '',
    resultContent: next.resultContent || current?.resultContent || '',
    callCreatedAt: next.callCreatedAt ?? current?.callCreatedAt,
    resultCreatedAt: next.resultCreatedAt ?? current?.resultCreatedAt,
    isError: next.isError || current?.isError === true,
  })
}

function eventId(event: DesktopWorkflowEvent): string {
  const turnId = 'turnId' in event ? event.turnId : 'thread'
  return `${event.threadId}-${turnId}-${event.type}-${event.createdAt}`
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : null
}

function summarizePatch(patch: string): string {
  const stats = parsePatchStats(patch)
  if (stats.files.length === 0) return 'Updated workspace files'
  const count = stats.files.length
  return `Edited ${count} ${count === 1 ? 'file' : 'files'}`
}

function parsePatchStats(patch: string): {
  files: Array<{ path: string; additions: number; deletions: number }>
  additions: number
  deletions: number
} {
  const files: Array<{ path: string; additions: number; deletions: number }> = []
  let current: { path: string; additions: number; deletions: number } | null =
    null

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      current = { path: parseDiffPath(line), additions: 0, deletions: 0 }
      continue
    }
    if (!current) continue
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue
    if (line.startsWith('+')) {
      current.additions += 1
    } else if (line.startsWith('-')) {
      current.deletions += 1
    }
  }

  if (current) files.push(current)
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  }
}

function parseDiffPath(line: string): string {
  const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
  return match?.[2] ?? line.replace(/^diff --git\s+/, '').trim()
}
