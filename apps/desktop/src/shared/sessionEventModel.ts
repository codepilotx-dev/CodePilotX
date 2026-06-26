import type {
  DesktopAgentEvent,
  DesktopSessionEvent,
  DesktopSessionMessage,
} from './types.js'

export function desktopAgentEventToSessionEvent(
  event: DesktopAgentEvent,
): DesktopSessionEvent | null {
  const createdAt = eventCreatedAt(event)
  switch (event.type) {
    case 'message':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'message',
        role: event.role,
        content: event.text,
        createdAt,
        ...eventSource(event),
      }
    case 'partial_message':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'assistant_delta',
        role: 'assistant',
        content: event.text,
        createdAt,
        ...eventSource(event),
      }
    case 'context_usage':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'context_usage',
        createdAt,
        metadata: { usage: event.usage },
      }
    case 'tool_start':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'tool_call',
        content: event.summary,
        createdAt,
        metadata: toolMetadata(event.toolName, event.toolUseId),
        ...eventSource(event),
      }
    case 'tool_result':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'tool_result',
        content: event.summary,
        createdAt,
        metadata: {
          ...toolMetadata(event.toolName, event.toolUseId),
          isError: event.isError === true,
        },
        ...eventSource(event),
      }
    case 'permission_request':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'permission_request',
        content: event.request.description,
        createdAt,
        metadata: { request: event.request },
        ...eventSource(event),
      }
    case 'status':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'status',
        content: event.status,
        createdAt,
        metadata: { status: event.status },
      }
    case 'diff':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'file_patch',
        content: summarizePatch(event.patch),
        createdAt,
        metadata: {
          filePath: event.filePath,
          patch: event.patch,
          ...parsePatchStats(event.patch),
        },
        ...eventSource(event),
      }
    case 'error':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'error',
        role: 'system',
        content: event.message,
        createdAt,
      }
    case 'done':
      return {
        id: randomId(),
        sessionId: event.sessionId,
        type: 'checkpoint',
        content: 'done',
        createdAt,
        metadata: { status: 'done' },
      }
    case 'session_title':
      return null
  }
}

export function legacyMessagesToSessionEvents(
  sessionId: string,
  messages: DesktopSessionMessage[],
): DesktopSessionEvent[] {
  return messages.map(message => ({
    id: message.id,
    sessionId,
    type: message.streaming ? 'assistant_delta' : 'message',
    role: message.role,
    content: message.text,
    createdAt: message.createdAt,
  }))
}

function toolMetadata(
  toolName: string,
  toolUseId: string | undefined,
): Record<string, unknown> {
  return {
    toolName,
    ...(toolUseId ? { toolUseId } : {}),
  }
}

function eventCreatedAt(event: DesktopAgentEvent): string {
  if (
    (event.type === 'message' || event.type === 'partial_message') &&
    event.createdAt
  ) {
    return event.createdAt
  }
  return new Date().toISOString()
}

function eventSource(event: DesktopAgentEvent): {
  sourceThreadId?: string
  sourceLabel?: string
} {
  return 'sourceThreadId' in event || 'sourceLabel' in event
    ? {
        sourceThreadId: event.sourceThreadId,
        sourceLabel: event.sourceLabel,
      }
    : {}
}

function summarizePatch(patch: string): string {
  const stats = parsePatchStats(patch)
  if (stats.files.length === 0) {
    return 'Updated workspace files'
  }
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
      if (current) {
        files.push(current)
      }
      current = {
        path: parseDiffPath(line),
        additions: 0,
        deletions: 0,
      }
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

  if (current) {
    files.push(current)
  }

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

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}
