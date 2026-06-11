import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  DesktopAgentEvent,
  DesktopPermissionRequest,
  DesktopSessionListItem,
  DesktopSessionMessage,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
  DesktopSessionViewSnapshot,
  DesktopToolLogEntry,
  DesktopWorkspace,
} from '../shared/types.js'
import {
  getDesktopConfigDirectoryPath,
  getOpenAgentConfigHomeDir,
} from './desktopSettings.js'

type PersistedDesktopSessions = {
  activeSessionId: string | null
  sessions: DesktopSessionSnapshot[]
}

type TranscriptEntry = {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  message?: {
    role?: string
    content?: unknown
  }
}

const SESSION_INDEX_FILE_NAME = 'sessions.json'
const MAX_SANITIZED_LENGTH = 200

export function getDesktopSessionIndexPath(): string {
  return join(getDesktopConfigDirectoryPath(), SESSION_INDEX_FILE_NAME)
}

export async function loadDesktopSessionStore(): Promise<PersistedDesktopSessions> {
  let persisted: PersistedDesktopSessions
  try {
    const raw = await readFile(getDesktopSessionIndexPath(), 'utf8')
    persisted = normalizePersistedSessions(JSON.parse(raw))
  } catch {
    persisted = { activeSessionId: null, sessions: [] }
  }

  const sessions = await Promise.all(
    persisted.sessions.map(snapshot => hydrateSessionFromTranscript(snapshot)),
  )
  const visibleSessions = sessions.filter(
    (snapshot): snapshot is DesktopSessionSnapshot => Boolean(snapshot),
  )
  const activeSessionId = visibleSessions.some(
    snapshot => snapshot.item.id === persisted.activeSessionId,
  )
    ? persisted.activeSessionId
    : visibleSessions[0]?.item.id ?? null
  return { activeSessionId, sessions: visibleSessions }
}

export async function desktopSessionTranscriptExists(
  snapshot: DesktopSessionSnapshot,
): Promise<boolean> {
  try {
    await stat(getTranscriptPath(snapshot.workspace.path, snapshot.item.id))
    return true
  } catch {
    return false
  }
}

export async function saveDesktopSessionStore(
  state: PersistedDesktopSessions,
): Promise<void> {
  const filePath = getDesktopSessionIndexPath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf8')
}

export function createDesktopSessionSnapshot(params: {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
  settings: DesktopSessionSettingsSnapshot
}): DesktopSessionSnapshot {
  const now = new Date()
  const lastMessageAt = now.toISOString()
  const createdAt = new Date().toLocaleTimeString()
  return {
    item: {
      id: params.sessionId,
      sessionName: params.settings.sessionName ?? null,
      workspaceName: params.workspace.name,
      workspacePath: params.workspace.path,
      standalone: params.standalone,
      pinnedAt: null,
      archivedAt: null,
      permissionMode: params.settings.permissionMode,
      model: params.settings.model ?? null,
      fallbackModel: params.settings.fallbackModel ?? null,
      thinkingMode: params.settings.thinkingMode,
      hasSystemPrompt: Boolean(params.settings.systemPrompt),
      hasAppendSystemPrompt: Boolean(params.settings.appendSystemPrompt),
      additionalDirectoryCount: params.settings.additionalDirectories.length,
      status: 'idle',
      lastMessageAt,
      createdAt,
    },
    workspace: params.workspace,
    settings: params.settings,
    view: createEmptyViewSnapshot(),
    updatedAt: new Date().toISOString(),
  }
}

export function applyDesktopAgentEventToSnapshot(
  snapshot: DesktopSessionSnapshot,
  event: DesktopAgentEvent,
): DesktopSessionSnapshot {
  const next: DesktopSessionSnapshot = {
    ...snapshot,
    item: { ...snapshot.item },
    view: {
      messages: [...snapshot.view.messages],
      toolLog: [...snapshot.view.toolLog],
      pendingPermissions: [...snapshot.view.pendingPermissions],
    },
    updatedAt: new Date().toISOString(),
  }

  if (event.type === 'status') {
    next.item.status = event.status
    return next
  }

  if (event.type === 'message') {
    const createdAt = normalizeTimestampString(event.createdAt) ?? new Date().toISOString()
    next.item.lastMessageAt = createdAt
    next.view.messages = [
      ...next.view.messages.filter(message => !message.streaming),
      {
        id: randomId(),
        role: event.role,
        text: event.text,
        createdAt,
      },
    ]
    return next
  }

  if (event.type === 'partial_message') {
    const index = next.view.messages.findIndex(message => message.streaming)
    const createdAt =
      normalizeTimestampString(event.createdAt) ??
      (index >= 0 ? next.view.messages[index]?.createdAt : undefined) ??
      new Date().toISOString()
    const partialMessage: DesktopSessionMessage = {
      id: index >= 0 ? next.view.messages[index]!.id : randomId(),
      role: 'assistant',
      text: event.text,
      createdAt,
      streaming: true,
    }
    if (index === -1) {
      next.view.messages = [...next.view.messages, partialMessage]
    } else {
      next.view.messages = next.view.messages.map((message, messageIndex) =>
        messageIndex === index ? partialMessage : message,
      )
    }
    return next
  }

  if (event.type === 'tool_start') {
    next.view.toolLog = [
      createToolLogEntry({
        toolName: event.toolName,
        summary: event.summary,
        kind: 'start',
      }),
      ...next.view.toolLog,
    ]
    return next
  }

  if (event.type === 'tool_result') {
    next.view.toolLog = [
      createToolLogEntry({
        toolName: event.toolName,
        summary: event.summary,
        kind: 'result',
        isError: event.isError,
      }),
      ...next.view.toolLog,
    ]
    return next
  }

  if (event.type === 'permission_request') {
    next.view.pendingPermissions = [
      event.request,
      ...next.view.pendingPermissions,
    ]
    return next
  }

  if (event.type === 'error') {
    const createdAt = new Date().toISOString()
    next.item.status = 'error'
    next.item.lastMessageAt = createdAt
    next.view.pendingPermissions = []
    next.view.messages = [
      ...next.view.messages.map(message =>
        message.streaming ? { ...message, streaming: false } : message,
      ),
      {
        id: randomId(),
        role: 'system',
        text: event.message,
        createdAt,
      },
    ]
    return next
  }

  if (event.type === 'done') {
    next.item.status = 'done'
    next.view.pendingPermissions = []
    next.view.messages = next.view.messages.map(message =>
      message.streaming ? { ...message, streaming: false } : message,
    )
    return next
  }

  return next
}

export function removePendingPermissionFromSnapshot(
  snapshot: DesktopSessionSnapshot,
  requestId: string,
): DesktopSessionSnapshot {
  return {
    ...snapshot,
    view: {
      ...snapshot.view,
      pendingPermissions: snapshot.view.pendingPermissions.filter(
        request => request.requestId !== requestId,
      ),
    },
    updatedAt: new Date().toISOString(),
  }
}

function normalizePersistedSessions(value: unknown): PersistedDesktopSessions {
  if (!value || typeof value !== 'object') {
    return { activeSessionId: null, sessions: [] }
  }
  const parsed = value as Partial<PersistedDesktopSessions>
  const sessions = Array.isArray(parsed.sessions)
    ? parsed.sessions.flatMap(normalizeSessionSnapshot)
    : []
  const activeSessionId =
    typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null
  return { activeSessionId, sessions }
}

function normalizeSessionSnapshot(value: unknown): DesktopSessionSnapshot[] {
  if (!value || typeof value !== 'object') return []
  const snapshot = value as Partial<DesktopSessionSnapshot>
  if (!snapshot.item || !snapshot.workspace || !snapshot.settings) return []
  if (typeof snapshot.item.id !== 'string') return []
  if (typeof snapshot.workspace.path !== 'string') return []
  if (typeof snapshot.workspace.name !== 'string') return []

  const item = normalizeSessionItem(snapshot.item)
  const view = normalizeViewSnapshot(snapshot.view)
  const updatedAt =
    typeof snapshot.updatedAt === 'string'
      ? snapshot.updatedAt
      : new Date().toISOString()
  const lastMessageAt =
    item.lastMessageAt ?? latestMessageTimestamp(view.messages) ?? updatedAt
  return [
    {
      item: {
        ...item,
        lastMessageAt,
        status:
          item.status === 'running' || item.status === 'waiting'
            ? 'done'
            : item.status,
      },
      workspace: snapshot.workspace,
      settings: normalizeSettingsSnapshot(snapshot.settings),
      view: {
        ...view,
        pendingPermissions: [],
        messages: view.messages.map(message => ({
          ...message,
          streaming: false,
        })),
      },
      updatedAt,
    },
  ]
}

function normalizeSessionItem(
  item: Partial<DesktopSessionListItem>,
): DesktopSessionListItem {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    sessionName:
      typeof item.sessionName === 'string' ? item.sessionName : null,
    workspaceName:
      typeof item.workspaceName === 'string' ? item.workspaceName : '',
    workspacePath:
      typeof item.workspacePath === 'string' ? item.workspacePath : '',
    standalone: item.standalone === true,
    pinnedAt: typeof item.pinnedAt === 'string' ? item.pinnedAt : null,
    archivedAt: typeof item.archivedAt === 'string' ? item.archivedAt : null,
    permissionMode:
      item.permissionMode === 'acceptEdits' ||
      item.permissionMode === 'bypassPermissions' ||
      item.permissionMode === 'dontAsk'
        ? item.permissionMode
        : 'default',
    model: typeof item.model === 'string' ? item.model : null,
    fallbackModel:
      typeof item.fallbackModel === 'string' ? item.fallbackModel : null,
    thinkingMode:
      item.thinkingMode === 'enabled' ||
      item.thinkingMode === 'adaptive' ||
      item.thinkingMode === 'disabled'
        ? item.thinkingMode
        : 'default',
    hasSystemPrompt: item.hasSystemPrompt === true,
    hasAppendSystemPrompt: item.hasAppendSystemPrompt === true,
    additionalDirectoryCount:
      typeof item.additionalDirectoryCount === 'number'
        ? item.additionalDirectoryCount
        : 0,
    status: normalizeStatus(item.status),
    lastMessageAt: normalizeTimestampString(item.lastMessageAt),
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  }
}

function normalizeSettingsSnapshot(
  settings: Partial<DesktopSessionSettingsSnapshot>,
): DesktopSessionSettingsSnapshot {
  return {
    permissionMode:
      settings.permissionMode === 'acceptEdits' ||
      settings.permissionMode === 'bypassPermissions' ||
      settings.permissionMode === 'dontAsk'
        ? settings.permissionMode
        : 'default',
    model: stringOrUndefined(settings.model),
    fallbackModel: stringOrUndefined(settings.fallbackModel),
    sessionName: stringOrUndefined(settings.sessionName),
    thinkingMode:
      settings.thinkingMode === 'enabled' ||
      settings.thinkingMode === 'adaptive' ||
      settings.thinkingMode === 'disabled'
        ? settings.thinkingMode
        : 'default',
    systemPrompt: stringOrUndefined(settings.systemPrompt),
    appendSystemPrompt: stringOrUndefined(settings.appendSystemPrompt),
    additionalDirectories: Array.isArray(settings.additionalDirectories)
      ? settings.additionalDirectories.filter(
          (directory): directory is string => typeof directory === 'string',
        )
      : [],
  }
}

function normalizeViewSnapshot(
  view: DesktopSessionViewSnapshot | undefined,
): DesktopSessionViewSnapshot {
  if (!view || typeof view !== 'object') return createEmptyViewSnapshot()
  return {
    messages: Array.isArray(view.messages)
      ? view.messages.flatMap(normalizeMessage)
      : [],
    toolLog: Array.isArray(view.toolLog)
      ? view.toolLog.flatMap(normalizeToolLogEntry)
      : [],
    pendingPermissions: Array.isArray(view.pendingPermissions)
      ? view.pendingPermissions.flatMap(normalizePermissionRequest)
      : [],
  }
}

function normalizeMessage(value: unknown): DesktopSessionMessage[] {
  if (!value || typeof value !== 'object') return []
  const message = value as Partial<DesktopSessionMessage>
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system') {
    return []
  }
  if (typeof message.text !== 'string') return []
  return [
    {
      id: typeof message.id === 'string' ? message.id : randomId(),
      role: message.role,
      text: message.text,
      createdAt:
        normalizeTimestampString(message.createdAt) ??
        new Date().toISOString(),
      streaming: message.streaming === true,
    },
  ]
}

function normalizeToolLogEntry(value: unknown): DesktopToolLogEntry[] {
  if (!value || typeof value !== 'object') return []
  const entry = value as Partial<DesktopToolLogEntry>
  if (typeof entry.toolName !== 'string') return []
  if (typeof entry.summary !== 'string') return []
  if (entry.kind !== 'start' && entry.kind !== 'result') return []
  return [
    {
      id: typeof entry.id === 'string' ? entry.id : randomId(),
      toolName: entry.toolName,
      summary: entry.summary,
      kind: entry.kind,
      isError: entry.isError === true,
      expanded: entry.expanded === true,
      createdAt:
        typeof entry.createdAt === 'string'
          ? entry.createdAt
          : new Date().toLocaleTimeString(),
    },
  ]
}

function normalizePermissionRequest(value: unknown): DesktopPermissionRequest[] {
  if (!value || typeof value !== 'object') return []
  const request = value as Partial<DesktopPermissionRequest>
  if (typeof request.requestId !== 'string') return []
  if (typeof request.toolName !== 'string') return []
  if (!request.input || typeof request.input !== 'object') return []
  if (typeof request.description !== 'string') return []
  return [
    {
      requestId: request.requestId,
      toolName: request.toolName,
      input: request.input as Record<string, unknown>,
      description: request.description,
    },
  ]
}

async function hydrateSessionFromTranscript(
  snapshot: DesktopSessionSnapshot,
): Promise<DesktopSessionSnapshot | null> {
  const transcriptPath = getTranscriptPath(snapshot.workspace.path, snapshot.item.id)
  try {
    await stat(transcriptPath)
  } catch {
    return snapshot
  }

  try {
    const raw = await readFile(transcriptPath, 'utf8')
    const view = parseTranscriptView(raw)
    if (view.messages.length === 0 && view.toolLog.length === 0) {
      return snapshot
    }
    return {
      ...snapshot,
      item: {
        ...snapshot.item,
        lastMessageAt:
          latestMessageTimestamp(view.messages) ?? snapshot.item.lastMessageAt,
        status:
          snapshot.item.status === 'running' || snapshot.item.status === 'waiting'
            ? 'done'
            : snapshot.item.status,
      },
      view: {
        ...view,
        pendingPermissions: [],
      },
    }
  } catch {
    return snapshot
  }
}

function parseTranscriptView(raw: string): DesktopSessionViewSnapshot {
  const messages: DesktopSessionMessage[] = []
  const toolLog: DesktopToolLogEntry[] = []
  const toolNamesById = new Map<string, string>()

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    let entry: TranscriptEntry
    try {
      entry = JSON.parse(line) as TranscriptEntry
    } catch {
      continue
    }

    if (entry.type === 'user') {
      const content = entry.message?.content
      const userText = extractTextContent(content)
      if (userText) {
        messages.push({
          id: entry.uuid ?? randomId(),
          role: 'user',
          text: userText,
          createdAt:
            normalizeTimestampString(entry.timestamp) ??
            new Date().toISOString(),
        })
      }
      collectToolResults(content, toolLog, toolNamesById, entry.timestamp)
      continue
    }

    if (entry.type === 'assistant') {
      const content = entry.message?.content
      const assistantText = extractTextContent(content)
      if (assistantText) {
        messages.push({
          id: entry.uuid ?? randomId(),
          role: 'assistant',
          text: assistantText,
          createdAt:
            normalizeTimestampString(entry.timestamp) ??
            new Date().toISOString(),
        })
      }
      collectToolUses(content, toolLog, toolNamesById, entry.timestamp)
      continue
    }

    if (entry.type === 'system') {
      const text = extractTextContent(entry.message?.content)
      if (text) {
        messages.push({
          id: entry.uuid ?? randomId(),
          role: 'system',
          text,
          createdAt:
            normalizeTimestampString(entry.timestamp) ??
            new Date().toISOString(),
        })
      }
    }
  }

  return {
    messages,
    toolLog: toolLog.reverse(),
    pendingPermissions: [],
  }
}

function collectToolUses(
  content: unknown,
  toolLog: DesktopToolLogEntry[],
  toolNamesById: Map<string, string>,
  timestamp: string | undefined,
): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'tool_use') continue
    const toolName = typeof item.name === 'string' ? item.name : 'Tool'
    if (typeof item.id === 'string') {
      toolNamesById.set(item.id, toolName)
    }
    toolLog.push(
      createToolLogEntry({
        toolName,
        summary: summarizeToolInput(toolName, item.input),
        kind: 'start',
        timestamp,
      }),
    )
  }
}

function collectToolResults(
  content: unknown,
  toolLog: DesktopToolLogEntry[],
  toolNamesById: Map<string, string>,
  timestamp: string | undefined,
): void {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if (item.type !== 'tool_result') continue
    const toolName =
      typeof item.tool_use_id === 'string'
        ? toolNamesById.get(item.tool_use_id) ?? 'Tool'
        : 'Tool'
    toolLog.push(
      createToolLogEntry({
        toolName,
        summary: summarizeToolInput(toolName, item.content),
        kind: 'result',
        isError: item.is_error === true,
        timestamp,
      }),
    )
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(block => {
      if (!block || typeof block !== 'object') return []
      const item = block as Record<string, unknown>
      if (item.type !== 'text' || typeof item.text !== 'string') return []
      return [item.text]
    })
    .join('\n\n')
    .trim()
}

function createEmptyViewSnapshot(): DesktopSessionViewSnapshot {
  return {
    messages: [],
    toolLog: [],
    pendingPermissions: [],
  }
}

function createToolLogEntry(params: {
  toolName: string
  summary: string
  kind: 'start' | 'result'
  isError?: boolean
  timestamp?: string
}): DesktopToolLogEntry {
  return {
    id: randomId(),
    toolName: params.toolName,
    summary: params.summary,
    kind: params.kind,
    isError: params.isError,
    expanded: params.isError === true,
    createdAt: formatTimestamp(params.timestamp),
  }
}

function summarizeToolInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') {
    return toolName
  }
  const record = input as Record<string, unknown>
  const target =
    record.file_path ??
    record.filePath ??
    record.pattern ??
    record.command ??
    record.url ??
    record.query
  return typeof target === 'string' ? `${toolName}: ${target}` : toolName
}

function getTranscriptPath(workspacePath: string, sessionId: string): string {
  return join(
    getOpenAgentConfigHomeDir(),
    'projects',
    sanitizePath(workspacePath),
    `${sessionId}.jsonl`,
  )
}

function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${simpleHash(name)}`
}

function simpleHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

function normalizeStatus(status: unknown): DesktopSessionStatus {
  return status === 'running' ||
    status === 'waiting' ||
    status === 'done' ||
    status === 'error'
    ? status
    : 'idle'
}

function formatTimestamp(timestamp: string | undefined): string {
  if (!timestamp) return new Date().toLocaleTimeString()
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime())
    ? new Date().toLocaleTimeString()
    : date.toLocaleTimeString()
}

function normalizeTimestampString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function latestMessageTimestamp(messages: DesktopSessionMessage[]): string | null {
  const latest = messages.at(-1)?.createdAt
  return normalizeTimestampString(latest)
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}
