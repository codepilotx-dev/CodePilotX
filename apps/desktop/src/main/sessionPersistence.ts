import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  isAgentApprovalMode,
  isAgentPermissionProfile,
} from '@codepilotx/core/agent/permissions.js'
import { normalizeThreadEvent } from '@codepilotx/core/agent/workflow.js'
import {
  getProjectDir,
  loadAllProjectsMessageLogs,
  loadFullLog,
} from '@codepilotx/tui/utils/sessionStorage.js'
import type {
  LogOption,
  SerializedMessage,
} from '@codepilotx/tui/types/logs.js'
import type {
  DesktopAgentEvent,
  DesktopContextUsage,
  DesktopPermissionRequest,
  DesktopReviewComment,
  DesktopSessionEvent,
  DesktopSessionListItem,
  DesktopSessionMessage,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
  DesktopSessionViewSnapshot,
  DesktopToolLogEntry,
  DesktopWorkflowEvent,
  DesktopWorkspace,
} from '../shared/types.js'
import { desktopAgentEventToSessionEvent } from '../shared/sessionEventModel.js'
import {
  normalizeDesktopApprovalPolicy,
  normalizeDesktopApprovalsReviewer,
  normalizeAskUserQuestionMaxQuestions,
  normalizeDesktopPermissionProfile,
  normalizeDesktopPermissionMode,
} from '../shared/settingsSchema.js'
import { getDesktopConfigDirectoryPath } from './desktopSettings.js'
import {
  buildDesktopContextUsage,
  getUsageFromAssistantRecord,
  inferProviderFromModel,
} from './desktopContextUsage.js'
import { summarizeToolInput } from './agentRuntimeSupport.js'
import {
  getStandaloneWorkspaceMetadata,
  isStandaloneWorkspacePath,
} from './standaloneWorkspace.js'

type PersistedDesktopSessions = {
  activeSessionId: string | null
  sessions: DesktopSessionSnapshot[]
}

type PersistedDesktopSessionOverlayStore = {
  activeSessionId: string | null
  sessions: DesktopSessionOverlay[]
}

type DesktopSessionOverlay = {
  id: string
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  standalone?: boolean
  pinnedAt?: string | null
  archivedAt?: string | null
  sessionName?: string | null
  aiTitle?: string | null
  customTitle?: string | null
  status?: DesktopSessionStatus
  createdAt?: string
  lastMessageAt?: string | null
  updatedAt?: string
  workflowEvents?: DesktopWorkflowEvent[]
  workflowEventModelVersion?: 1
  reviewComments?: DesktopReviewComment[]
  legacySnapshot?: DesktopSessionSnapshot
}

type ParsedTranscriptView = DesktopSessionViewSnapshot & {
  effectiveModel?: string
  events: DesktopSessionEvent[]
}

const SESSION_INDEX_FILE_NAME = 'sessions.json'
const TRANSCRIPT_ENRICH_LIMIT = Number.MAX_SAFE_INTEGER

export function getDesktopSessionIndexPath(): string {
  return join(getDesktopConfigDirectoryPath(), SESSION_INDEX_FILE_NAME)
}

export async function loadDesktopSessionStore(): Promise<PersistedDesktopSessions> {
  const persisted = await readDesktopSessionOverlayStore()
  const overlaysById = new Map(
    persisted.sessions.map(overlay => [overlay.id, overlay]),
  )
  const snapshotsById = new Map<string, DesktopSessionSnapshot>()

  for (const snapshot of await loadTranscriptSessionSnapshots(overlaysById)) {
    snapshotsById.set(snapshot.item.id, snapshot)
  }

  for (const overlay of persisted.sessions) {
    if (!snapshotsById.has(overlay.id)) {
      snapshotsById.set(overlay.id, snapshotFromOverlay(overlay))
    }
  }

  const sessions = [...snapshotsById.values()].sort(compareSnapshotsByRecency)
  const activeSessionId = sessions.some(
    snapshot => snapshot.item.id === persisted.activeSessionId,
  )
    ? persisted.activeSessionId
    : sessions.find(snapshot => !snapshot.item.archivedAt)?.item.id ??
      sessions[0]?.item.id ??
      null

  return { activeSessionId, sessions }
}

export async function desktopSessionTranscriptExists(
  snapshot: DesktopSessionSnapshot,
): Promise<boolean> {
  try {
    await stat(transcriptPathForSnapshot(snapshot))
    return true
  } catch {
    return false
  }
}

export async function hydrateDesktopSessionSnapshot(
  snapshot: DesktopSessionSnapshot,
): Promise<DesktopSessionSnapshot> {
  const transcriptPath = transcriptPathForSnapshot(snapshot)
  try {
    await stat(transcriptPath)
  } catch {
    return snapshot
  }

  try {
    const log = await loadFullLog(logOptionFromSnapshot(snapshot, transcriptPath))
    return snapshotFromTranscriptLog(log, overlayFromSnapshot(snapshot), true)
  } catch {
    return snapshot
  }
}

export async function saveDesktopSessionStore(
  state: PersistedDesktopSessions,
): Promise<void> {
  const filePath = getDesktopSessionIndexPath()
  const overlayStore: PersistedDesktopSessionOverlayStore = {
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map(snapshot => {
      const overlay = overlayFromSnapshot(snapshot)
      return {
        id: overlay.id,
        workspace: overlay.workspace,
        settings: overlay.settings,
        standalone: overlay.standalone,
        pinnedAt: overlay.pinnedAt,
        archivedAt: overlay.archivedAt,
        sessionName: overlay.sessionName,
        aiTitle: overlay.aiTitle,
        customTitle: overlay.customTitle,
        status: overlay.status,
        createdAt: overlay.createdAt,
        lastMessageAt: overlay.lastMessageAt,
        updatedAt: overlay.updatedAt,
        workflowEvents: overlay.workflowEvents,
        workflowEventModelVersion: overlay.workflowEventModelVersion,
        reviewComments: overlay.reviewComments,
      }
    }),
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(overlayStore, null, 2), 'utf8')
}

export function createDesktopSessionSnapshot(params: {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
  settings: DesktopSessionSettingsSnapshot
}): DesktopSessionSnapshot {
  const now = new Date()
  const lastMessageAt = now.toISOString()
  const createdAt = now.toISOString()
  const workspace = normalizeStandaloneWorkspace(params.workspace)
  const standalone = isStandaloneSession(workspace, params.standalone)
  return {
    item: {
      id: params.sessionId,
      sessionName: params.settings.sessionName ?? null,
      aiTitle: null,
      customTitle: null,
      tag: null,
      summary: null,
      gitBranch: workspace.branchName ?? null,
      firstPrompt: null,
      prNumber: null,
      prUrl: null,
      prRepository: null,
      transcriptPath: getTranscriptPath(workspace.path, params.sessionId),
      fileSize: null,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone,
      pinnedAt: null,
      archivedAt: null,
      permissionProfile: params.settings.permissionProfile,
      approvalPolicy: params.settings.approvalPolicy,
      approvalsReviewer: params.settings.approvalsReviewer,
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
    workspace,
    settings: params.settings,
    view: createEmptyViewSnapshot(),
    events: [],
    eventModelVersion: 1,
    workflowEvents: [],
    workflowEventModelVersion: 1,
    reviewComments: [],
    updatedAt: now.toISOString(),
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
      contextUsage: snapshot.view.contextUsage ?? null,
    },
    events: snapshot.events ? [...snapshot.events] : undefined,
    eventModelVersion: snapshot.eventModelVersion,
    workflowEvents: snapshot.workflowEvents
      ? [...snapshot.workflowEvents]
      : undefined,
    workflowEventModelVersion: snapshot.workflowEventModelVersion,
    reviewComments: snapshot.reviewComments
      ? [...snapshot.reviewComments]
      : undefined,
    updatedAt: new Date().toISOString(),
  }
  const sessionEvent = desktopAgentEventToSessionEvent(event)
  if (next.events && sessionEvent) {
    next.events = [...next.events, sessionEvent]
  }

  if (event.type === 'status') {
    next.item.status = event.status
    return next
  }

  if (event.type === 'message') {
    const createdAt =
      normalizeTimestampString(event.createdAt) ?? new Date().toISOString()
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

  if (event.type === 'context_usage') {
    next.item.model = event.usage.model
    next.settings = {
      ...next.settings,
      model: event.usage.model,
    }
    next.view.contextUsage = event.usage
    return next
  }

  if (event.type === 'session_title') {
    next.item.aiTitle = event.title
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

export function applyDesktopWorkflowEventsToSnapshot(
  snapshot: DesktopSessionSnapshot,
  workflowEvents: DesktopWorkflowEvent[],
): DesktopSessionSnapshot {
  const normalizedEvents = workflowEvents.flatMap(normalizeWorkflowEvent)
  if (normalizedEvents.length === 0) return snapshot

  const existingEvents =
    snapshot.workflowEventModelVersion === 1 && snapshot.workflowEvents
      ? snapshot.workflowEvents.flatMap(normalizeWorkflowEvent)
      : []
  const seen = new Set(existingEvents.map(workflowEventKey))
  const appendedEvents = normalizedEvents.filter(event => {
    const key = workflowEventKey(event)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (appendedEvents.length === 0) return snapshot

  return {
    ...snapshot,
    workflowEvents: [...existingEvents, ...appendedEvents],
    workflowEventModelVersion: 1,
    updatedAt: new Date().toISOString(),
  }
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

async function readDesktopSessionOverlayStore(): Promise<PersistedDesktopSessionOverlayStore> {
  try {
    const raw = await readFile(getDesktopSessionIndexPath(), 'utf8')
    return normalizePersistedOverlayStore(JSON.parse(raw))
  } catch {
    return { activeSessionId: null, sessions: [] }
  }
}

function normalizePersistedOverlayStore(
  value: unknown,
): PersistedDesktopSessionOverlayStore {
  if (!value || typeof value !== 'object') {
    return { activeSessionId: null, sessions: [] }
  }
  const parsed = value as Partial<{
    activeSessionId: unknown
    sessions: unknown
  }>
  return {
    activeSessionId:
      typeof parsed.activeSessionId === 'string'
        ? parsed.activeSessionId
        : null,
    sessions: Array.isArray(parsed.sessions)
      ? parsed.sessions.flatMap(normalizeSessionOverlay)
      : [],
  }
}

function normalizeSessionOverlay(value: unknown): DesktopSessionOverlay[] {
  if (!value || typeof value !== 'object') return []
  const raw = value as Record<string, unknown>
  if (raw.item && raw.workspace && raw.settings) {
    const legacy = normalizeSessionSnapshot(value)[0]
    return legacy ? [overlayFromSnapshot(legacy, legacy)] : []
  }
  if (typeof raw.id !== 'string') return []
  const workspace = normalizeWorkspace(raw.workspace)
  if (!workspace) return []
  const normalizedWorkspace = normalizeStandaloneWorkspace(workspace)
  const settings = normalizeSettingsSnapshot(raw.settings)
  const workflowEvents =
    raw.workflowEventModelVersion === 1 && Array.isArray(raw.workflowEvents)
      ? raw.workflowEvents.flatMap(normalizeWorkflowEvent)
      : undefined
  const reviewComments = Array.isArray(raw.reviewComments)
    ? raw.reviewComments.flatMap(normalizeReviewComment)
    : undefined
  return [
    {
      id: raw.id,
      workspace: normalizedWorkspace,
      settings,
      standalone: isStandaloneSession(
        normalizedWorkspace,
        raw.standalone === true,
      ),
      pinnedAt: nullableString(raw.pinnedAt),
      archivedAt: nullableString(raw.archivedAt),
      sessionName: nullableString(raw.sessionName),
      aiTitle: nullableString(raw.aiTitle),
      customTitle: nullableString(raw.customTitle),
      status: normalizeStatus(raw.status),
      createdAt: stringOrUndefined(raw.createdAt),
      lastMessageAt: normalizeTimestampString(raw.lastMessageAt),
      updatedAt: stringOrUndefined(raw.updatedAt),
      workflowEvents,
      workflowEventModelVersion: workflowEvents ? 1 : undefined,
      reviewComments,
    },
  ]
}

function normalizeSessionSnapshot(value: unknown): DesktopSessionSnapshot[] {
  if (!value || typeof value !== 'object') return []
  const snapshot = value as Partial<DesktopSessionSnapshot>
  if (!snapshot.item || !snapshot.workspace || !snapshot.settings) return []
  if (typeof snapshot.item.id !== 'string') return []
  const workspace = normalizeWorkspace(snapshot.workspace)
  if (!workspace) return []
  const normalizedWorkspace = normalizeStandaloneWorkspace(workspace)

  const item = normalizeSessionItem(snapshot.item)
  const view = normalizeViewSnapshot(snapshot.view)
  const events =
    snapshot.eventModelVersion === 1 && Array.isArray(snapshot.events)
      ? snapshot.events.flatMap(normalizeSessionEvent)
      : undefined
  const workflowEvents =
    snapshot.workflowEventModelVersion === 1 &&
    Array.isArray(snapshot.workflowEvents)
      ? snapshot.workflowEvents.flatMap(normalizeWorkflowEvent)
      : undefined
  const reviewComments = Array.isArray(snapshot.reviewComments)
    ? snapshot.reviewComments.flatMap(normalizeReviewComment)
    : undefined
  const settings = normalizeSettingsSnapshot(snapshot.settings)
  const effectiveModel =
    validModelName(view.contextUsage?.model) ??
    validModelName(item.model) ??
    validModelName(settings.model)
  if (effectiveModel) {
    item.model = effectiveModel
    settings.model = effectiveModel
  }
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
        workspaceName: normalizedWorkspace.name,
        workspacePath: normalizedWorkspace.path,
        standalone: isStandaloneSession(
          normalizedWorkspace,
          item.standalone === true,
        ),
        lastMessageAt,
        status:
          item.status === 'running' || item.status === 'waiting'
            ? 'done'
            : item.status,
      },
      workspace: normalizedWorkspace,
      settings,
      view: {
        ...view,
        pendingPermissions: [],
        messages: view.messages.map(message => ({
          ...message,
          streaming: false,
        })),
      },
      events,
      eventModelVersion: events ? 1 : undefined,
      workflowEvents,
      workflowEventModelVersion: workflowEvents ? 1 : undefined,
      reviewComments,
      updatedAt,
    },
  ]
}

async function loadTranscriptSessionSnapshots(
  overlaysById: Map<string, DesktopSessionOverlay>,
): Promise<DesktopSessionSnapshot[]> {
  let logs: LogOption[]
  try {
    logs = await loadAllProjectsMessageLogs(undefined, {
      initialEnrichCount: TRANSCRIPT_ENRICH_LIMIT,
    })
  } catch {
    logs = []
  }

  const snapshots: DesktopSessionSnapshot[] = []
  for (const log of logs) {
    const snapshot = snapshotFromTranscriptLog(
      log,
      log.sessionId ? overlaysById.get(log.sessionId) : undefined,
      false,
    )
    if (snapshot) {
      snapshots.push(snapshot)
    }
  }
  return snapshots
}

function snapshotFromTranscriptLog(
  log: LogOption,
  overlay: DesktopSessionOverlay | undefined,
  includeView: boolean,
): DesktopSessionSnapshot | null {
  const sessionId = log.sessionId ?? overlay?.id
  const workspacePath = log.projectPath ?? overlay?.workspace.path
  if (!sessionId || !workspacePath) return null

  const workspace = normalizeStandaloneWorkspace(overlay?.workspace ?? {
    path: workspacePath,
    name: basename(workspacePath),
    branchName: log.gitBranch ?? null,
    isGitRepo: Boolean(log.gitBranch),
  })
  const standalone = isStandaloneSession(
    workspace,
    overlay?.standalone === true || isStandaloneWorkspacePath(workspacePath),
  )
  const settings = overlay?.settings ?? defaultSettingsSnapshot()
  const parsed = includeView
    ? parseTranscriptLogView(sessionId, log.messages)
    : {
        ...createEmptyViewSnapshot(),
        events: [] as DesktopSessionEvent[],
        effectiveModel: undefined,
      }
  const effectiveModel =
    validModelName(parsed.effectiveModel) ??
    validModelName(parsed.contextUsage?.model) ??
    validModelName(settings.model)
  const createdAt = log.created.toISOString()
  const lastMessageAt = log.modified.toISOString()
  const transcriptPath = log.fullPath ?? getTranscriptPath(workspace.path, sessionId)
  const item: DesktopSessionListItem = {
    id: sessionId,
    sessionName: overlay?.sessionName ?? settings.sessionName ?? null,
    aiTitle: overlay?.aiTitle ?? null,
    customTitle: log.customTitle ?? overlay?.customTitle ?? null,
    tag: log.tag ?? null,
    summary: log.summary ?? null,
    gitBranch: log.gitBranch ?? workspace.branchName ?? null,
    firstPrompt: log.firstPrompt || null,
    prNumber: log.prNumber ?? null,
    prUrl: log.prUrl ?? null,
    prRepository: log.prRepository ?? null,
    transcriptPath,
    fileSize: log.fileSize ?? null,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    standalone,
    pinnedAt: overlay?.pinnedAt ?? null,
    archivedAt: overlay?.archivedAt ?? null,
    permissionProfile: settings.permissionProfile,
    approvalPolicy: settings.approvalPolicy,
    approvalsReviewer: settings.approvalsReviewer,
    permissionMode: settings.permissionMode,
    model: effectiveModel ?? null,
    fallbackModel: settings.fallbackModel ?? null,
    thinkingMode: settings.thinkingMode,
    hasSystemPrompt: Boolean(settings.systemPrompt),
    hasAppendSystemPrompt: Boolean(settings.appendSystemPrompt),
    additionalDirectoryCount: settings.additionalDirectories.length,
    status:
      overlay?.status === 'running' || overlay?.status === 'waiting'
        ? 'done'
        : overlay?.status ?? 'done',
    lastMessageAt,
    createdAt,
  }
  const nextSettings =
    effectiveModel && effectiveModel !== settings.model
      ? { ...settings, model: effectiveModel }
      : settings

  return {
    item,
    workspace,
    settings: nextSettings,
    view: {
      messages: parsed.messages,
      toolLog: parsed.toolLog,
      pendingPermissions: [],
      contextUsage: parsed.contextUsage,
    },
    events: parsed.events,
    eventModelVersion: 1,
    workflowEvents: overlay?.workflowEvents
      ? [...overlay.workflowEvents]
      : undefined,
    workflowEventModelVersion: overlay?.workflowEvents ? 1 : undefined,
    reviewComments: overlay?.reviewComments ? [...overlay.reviewComments] : [],
    updatedAt: overlay?.updatedAt ?? lastMessageAt,
  }
}

function snapshotFromOverlay(overlay: DesktopSessionOverlay): DesktopSessionSnapshot {
  if (overlay.legacySnapshot) {
    const legacySnapshot = normalizeSnapshotStandalone(overlay.legacySnapshot)
    return {
      ...legacySnapshot,
      item: {
        ...legacySnapshot.item,
        pinnedAt: overlay.pinnedAt ?? legacySnapshot.item.pinnedAt,
        archivedAt: overlay.archivedAt ?? legacySnapshot.item.archivedAt,
      },
    }
  }
  const settings = overlay.settings
  const createdAt = overlay.createdAt ?? new Date().toISOString()
  const workspace = normalizeStandaloneWorkspace(overlay.workspace)
  const standalone = isStandaloneSession(workspace, overlay.standalone === true)
  return {
    item: {
      id: overlay.id,
      sessionName: overlay.sessionName ?? settings.sessionName ?? null,
      aiTitle: overlay.aiTitle ?? null,
      customTitle: overlay.customTitle ?? null,
      tag: null,
      summary: null,
      gitBranch: workspace.branchName ?? null,
      firstPrompt: null,
      prNumber: null,
      prUrl: null,
      prRepository: null,
      transcriptPath: getTranscriptPath(workspace.path, overlay.id),
      fileSize: null,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone,
      pinnedAt: overlay.pinnedAt ?? null,
      archivedAt: overlay.archivedAt ?? null,
      permissionProfile: settings.permissionProfile,
      approvalPolicy: settings.approvalPolicy,
      approvalsReviewer: settings.approvalsReviewer,
      permissionMode: settings.permissionMode,
      model: settings.model ?? null,
      fallbackModel: settings.fallbackModel ?? null,
      thinkingMode: settings.thinkingMode,
      hasSystemPrompt: Boolean(settings.systemPrompt),
      hasAppendSystemPrompt: Boolean(settings.appendSystemPrompt),
      additionalDirectoryCount: settings.additionalDirectories.length,
      status:
        overlay.status === 'running' || overlay.status === 'waiting'
          ? 'done'
          : overlay.status ?? 'idle',
      lastMessageAt: overlay.lastMessageAt ?? createdAt,
      createdAt,
    },
    workspace,
    settings,
    view: createEmptyViewSnapshot(),
    events: [],
    eventModelVersion: 1,
    workflowEvents: overlay.workflowEvents ? [...overlay.workflowEvents] : [],
    workflowEventModelVersion: 1,
    reviewComments: overlay.reviewComments ? [...overlay.reviewComments] : [],
    updatedAt: overlay.updatedAt ?? createdAt,
  }
}

function overlayFromSnapshot(
  snapshot: DesktopSessionSnapshot,
  legacySnapshot?: DesktopSessionSnapshot,
): DesktopSessionOverlay {
  const normalizedSnapshot = normalizeSnapshotStandalone(snapshot)
  return {
    id: normalizedSnapshot.item.id,
    workspace: normalizedSnapshot.workspace,
    settings: normalizedSnapshot.settings,
    standalone: normalizedSnapshot.item.standalone === true,
    pinnedAt: normalizedSnapshot.item.pinnedAt ?? null,
    archivedAt: normalizedSnapshot.item.archivedAt ?? null,
    sessionName: normalizedSnapshot.item.sessionName ?? null,
    aiTitle: normalizedSnapshot.item.aiTitle ?? null,
    customTitle: normalizedSnapshot.item.customTitle ?? null,
    status: normalizedSnapshot.item.status,
    createdAt: normalizedSnapshot.item.createdAt,
    lastMessageAt: normalizedSnapshot.item.lastMessageAt ?? null,
    updatedAt: normalizedSnapshot.updatedAt,
    workflowEvents:
      normalizedSnapshot.workflowEventModelVersion === 1 &&
      normalizedSnapshot.workflowEvents
        ? [...normalizedSnapshot.workflowEvents]
        : undefined,
    workflowEventModelVersion:
      normalizedSnapshot.workflowEventModelVersion === 1 ? 1 : undefined,
    reviewComments: normalizedSnapshot.reviewComments
      ? [...normalizedSnapshot.reviewComments]
      : undefined,
    legacySnapshot: legacySnapshot
      ? normalizeSnapshotStandalone(legacySnapshot)
      : undefined,
  }
}

function normalizeStandaloneWorkspace(
  workspace: DesktopWorkspace,
): DesktopWorkspace {
  return isStandaloneWorkspacePath(workspace.path)
    ? getStandaloneWorkspaceMetadata()
    : workspace
}

function isStandaloneSession(
  workspace: DesktopWorkspace,
  standalone: boolean,
): boolean {
  return (
    standalone ||
    workspace.isStandalone === true ||
    isStandaloneWorkspacePath(workspace.path)
  )
}

function normalizeSnapshotStandalone(
  snapshot: DesktopSessionSnapshot,
): DesktopSessionSnapshot {
  const workspace = normalizeStandaloneWorkspace(snapshot.workspace)
  const standalone = isStandaloneSession(
    workspace,
    snapshot.item.standalone === true,
  )
  return {
    ...snapshot,
    workspace,
    item: {
      ...snapshot.item,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone,
    },
  }
}

function logOptionFromSnapshot(
  snapshot: DesktopSessionSnapshot,
  transcriptPath: string,
): LogOption {
  const created = dateFromString(snapshot.item.createdAt)
  const modified = dateFromString(snapshot.item.lastMessageAt) ?? created
  return {
    date: modified.toISOString(),
    messages: [],
    fullPath: transcriptPath,
    value: 0,
    created,
    modified,
    firstPrompt: snapshot.item.firstPrompt ?? '',
    messageCount: 0,
    fileSize: snapshot.item.fileSize ?? undefined,
    isSidechain: false,
    isLite: true,
    sessionId: snapshot.item.id,
    customTitle: snapshot.item.customTitle ?? undefined,
    tag: snapshot.item.tag ?? undefined,
    summary: snapshot.item.summary ?? undefined,
    gitBranch: snapshot.item.gitBranch ?? undefined,
    projectPath: snapshot.workspace.path,
    prNumber: snapshot.item.prNumber ?? undefined,
    prUrl: snapshot.item.prUrl ?? undefined,
    prRepository: snapshot.item.prRepository ?? undefined,
  }
}

function parseTranscriptLogView(
  sessionId: string,
  messages: SerializedMessage[],
): ParsedTranscriptView {
  const viewMessages: DesktopSessionMessage[] = []
  const toolLog: DesktopToolLogEntry[] = []
  const events: DesktopSessionEvent[] = []
  const toolNamesById = new Map<string, string>()
  let contextUsage: DesktopContextUsage | null = null
  let effectiveModel: string | undefined

  for (const message of messages) {
    const record = message as unknown as Record<string, unknown>
    const timestamp = normalizeTimestampString(record.timestamp) ?? undefined
    const messageRecord = record.message as
      | { role?: unknown; content?: unknown; model?: unknown }
      | undefined
    const content = messageRecord?.content

    if (message.type === 'user') {
      const text = extractTextContent(content)
      if (text) {
        addMessage(sessionId, viewMessages, events, {
          id: typeof record.uuid === 'string' ? record.uuid : randomId(),
          role: 'user',
          text,
          createdAt: timestamp ?? new Date().toISOString(),
        })
      }
      collectToolResults(sessionId, content, toolLog, events, toolNamesById, timestamp)
      continue
    }

    if (message.type === 'assistant') {
      const usageRecord = getUsageFromAssistantRecord(record)
      if (usageRecord) {
        const usage = buildDesktopContextUsage({
          ...usageRecord,
          provider: inferProviderFromModel(usageRecord.model) ?? null,
        })
        contextUsage = usage ?? contextUsage
        effectiveModel = validModelName(usageRecord.model) ?? effectiveModel
      } else {
        effectiveModel = validModelName(messageRecord?.model) ?? effectiveModel
      }
      const text = extractTextContent(content)
      if (text) {
        addMessage(sessionId, viewMessages, events, {
          id: typeof record.uuid === 'string' ? record.uuid : randomId(),
          role: 'assistant',
          text,
          createdAt: timestamp ?? new Date().toISOString(),
        })
      }
      collectToolUses(sessionId, content, toolLog, events, toolNamesById, timestamp)
      continue
    }

    if (message.type === 'system') {
      const text = extractTextContent(content)
      if (text) {
        addMessage(sessionId, viewMessages, events, {
          id: typeof record.uuid === 'string' ? record.uuid : randomId(),
          role: 'system',
          text,
          createdAt: timestamp ?? new Date().toISOString(),
        })
      }
    }
  }

  return {
    messages: viewMessages,
    toolLog: toolLog.reverse(),
    pendingPermissions: [],
    contextUsage,
    effectiveModel,
    events,
  }
}

function addMessage(
  sessionId: string,
  messages: DesktopSessionMessage[],
  events: DesktopSessionEvent[],
  message: DesktopSessionMessage,
): void {
  messages.push(message)
  events.push({
    id: randomId(),
    sessionId,
    type: 'message',
    role: message.role,
    content: message.text,
    createdAt: message.createdAt,
  })
}

function collectToolUses(
  sessionId: string,
  content: unknown,
  toolLog: DesktopToolLogEntry[],
  events: DesktopSessionEvent[],
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
    const summary = summarizeToolInput(toolName, item.input)
    const createdAt = timestamp ?? new Date().toISOString()
    toolLog.push(
      createToolLogEntry({
        toolName,
        summary,
        kind: 'start',
        timestamp,
      }),
    )
    events.push({
      id: randomId(),
      sessionId,
      type: 'tool_call',
      content: summary,
      createdAt,
      metadata: { toolName },
    })
  }
}

function collectToolResults(
  sessionId: string,
  content: unknown,
  toolLog: DesktopToolLogEntry[],
  events: DesktopSessionEvent[],
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
    const summary = summarizeToolInput(toolName, item.content)
    const isError = item.is_error === true
    const createdAt = timestamp ?? new Date().toISOString()
    toolLog.push(
      createToolLogEntry({
        toolName,
        summary,
        kind: 'result',
        isError,
        timestamp,
      }),
    )
    events.push({
      id: randomId(),
      sessionId,
      type: 'tool_result',
      content: summary,
      createdAt,
      metadata: { toolName, isError },
    })
  }
}

function normalizeSessionItem(
  item: Partial<DesktopSessionListItem>,
): DesktopSessionListItem {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    sessionName:
      typeof item.sessionName === 'string' ? item.sessionName : null,
    aiTitle: typeof item.aiTitle === 'string' ? item.aiTitle : null,
    customTitle: nullableString(item.customTitle),
    tag: nullableString(item.tag),
    summary: nullableString(item.summary),
    gitBranch: nullableString(item.gitBranch),
    firstPrompt: nullableString(item.firstPrompt),
    prNumber: typeof item.prNumber === 'number' ? item.prNumber : null,
    prUrl: nullableString(item.prUrl),
    prRepository: nullableString(item.prRepository),
    transcriptPath: nullableString(item.transcriptPath),
    fileSize: typeof item.fileSize === 'number' ? item.fileSize : null,
    workspaceName:
      typeof item.workspaceName === 'string' ? item.workspaceName : '',
    workspacePath:
      typeof item.workspacePath === 'string' ? item.workspacePath : '',
    standalone: item.standalone === true,
    pinnedAt: nullableString(item.pinnedAt),
    archivedAt: nullableString(item.archivedAt),
    permissionProfile: normalizeDesktopPermissionProfile(
      item.permissionProfile,
    ),
    approvalPolicy: normalizeDesktopApprovalPolicy(item.approvalPolicy),
    approvalsReviewer: normalizeDesktopApprovalsReviewer(
      item.approvalsReviewer,
    ),
    permissionMode: normalizeDesktopPermissionMode(item.permissionMode),
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

function normalizeWorkspace(value: unknown): DesktopWorkspace | null {
  if (!value || typeof value !== 'object') return null
  const workspace = value as Partial<DesktopWorkspace>
  if (typeof workspace.path !== 'string') return null
  if (typeof workspace.name !== 'string') return null
  return {
    name: workspace.name,
    path: workspace.path,
    branchName:
      typeof workspace.branchName === 'string' ? workspace.branchName : null,
    branches: Array.isArray(workspace.branches)
      ? workspace.branches.filter(
          (branch): branch is string => typeof branch === 'string',
        )
      : undefined,
    isGitRepo:
      typeof workspace.isGitRepo === 'boolean'
        ? workspace.isGitRepo
        : undefined,
    isStandalone: workspace.isStandalone === true,
  }
}

function normalizeSettingsSnapshot(
  value: unknown,
): DesktopSessionSettingsSnapshot {
  const settings =
    value && typeof value === 'object'
      ? (value as Partial<DesktopSessionSettingsSnapshot>)
      : {}
  return {
    permissionProfile: normalizeDesktopPermissionProfile(
      settings.permissionProfile,
    ),
    approvalPolicy: normalizeDesktopApprovalPolicy(settings.approvalPolicy),
    approvalsReviewer: normalizeDesktopApprovalsReviewer(
      settings.approvalsReviewer,
    ),
    permissionMode: normalizeDesktopPermissionMode(settings.permissionMode),
    model: stringOrUndefined(settings.model),
    fallbackModel: stringOrUndefined(settings.fallbackModel),
    smallFastModel: stringOrUndefined(settings.smallFastModel),
    fastModel: stringOrUndefined(settings.fastModel),
    defaultModel: stringOrUndefined(settings.defaultModel),
    deepModel: stringOrUndefined(settings.deepModel),
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
    askUserQuestionMaxQuestions: normalizeAskUserQuestionMaxQuestions(
      settings.askUserQuestionMaxQuestions,
    ),
  }
}

function defaultSettingsSnapshot(): DesktopSessionSettingsSnapshot {
  return {
    permissionProfile: ':workspace',
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    permissionMode: 'default',
    thinkingMode: 'default',
    additionalDirectories: [],
    askUserQuestionMaxQuestions: 1,
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
    contextUsage: normalizeContextUsage(view.contextUsage),
  }
}

function normalizeContextUsage(value: unknown): DesktopContextUsage | null {
  if (!value || typeof value !== 'object') return null
  const usage = value as Partial<DesktopContextUsage>
  if (typeof usage.model !== 'string') return null
  if (typeof usage.contextWindow !== 'number') return null
  if (typeof usage.usedTokens !== 'number') return null
  if (typeof usage.remainingTokens !== 'number') return null
  if (typeof usage.usedPercent !== 'number') return null
  if (typeof usage.remainingPercent !== 'number') return null
  return {
    model: usage.model,
    provider: typeof usage.provider === 'string' ? usage.provider : undefined,
    contextWindow: usage.contextWindow,
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
    cacheCreationInputTokens: numberOrZero(usage.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrZero(usage.cacheReadInputTokens),
    reasoningTokens: numberOrZero(usage.reasoningTokens),
    promptCacheHitTokens: numberOrZero(usage.promptCacheHitTokens),
    promptCacheMissTokens: numberOrZero(usage.promptCacheMissTokens),
    usedTokens: usage.usedTokens,
    remainingTokens: usage.remainingTokens,
    usedPercent: usage.usedPercent,
    remainingPercent: usage.remainingPercent,
  }
}

function normalizeMessage(value: unknown): DesktopSessionMessage[] {
  if (!value || typeof value !== 'object') return []
  const message = value as Partial<DesktopSessionMessage>
  if (
    message.role !== 'user' &&
    message.role !== 'assistant' &&
    message.role !== 'system'
  ) {
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

function normalizeSessionEvent(value: unknown): DesktopSessionEvent[] {
  if (!value || typeof value !== 'object') return []
  const event = value as Partial<DesktopSessionEvent>
  if (typeof event.id !== 'string') return []
  if (typeof event.sessionId !== 'string') return []
  if (!isSessionEventType(event.type)) return []
  const createdAt = normalizeTimestampString(event.createdAt)
  if (!createdAt) return []
  const metadata =
    event.metadata && typeof event.metadata === 'object'
      ? (event.metadata as Record<string, unknown>)
      : undefined
  return [
    {
      id: event.id,
      sessionId: event.sessionId,
      type: event.type,
      role:
        event.role === 'user' ||
        event.role === 'assistant' ||
        event.role === 'system'
          ? event.role
          : undefined,
      content: typeof event.content === 'string' ? event.content : undefined,
      metadata,
      createdAt,
      sourceThreadId:
        typeof event.sourceThreadId === 'string'
          ? event.sourceThreadId
          : undefined,
      sourceLabel:
        typeof event.sourceLabel === 'string' ? event.sourceLabel : undefined,
    },
  ]
}

function normalizeReviewComment(value: unknown): DesktopReviewComment[] {
  if (!value || typeof value !== 'object') return []
  const comment = value as Partial<DesktopReviewComment>
  const createdAt = normalizeTimestampString(comment.createdAt)
  const updatedAt = normalizeTimestampString(comment.updatedAt)
  if (
    typeof comment.id !== 'string' ||
    !comment.id.trim() ||
    typeof comment.sessionId !== 'string' ||
    !comment.sessionId.trim() ||
    typeof comment.filePath !== 'string' ||
    !comment.filePath.trim() ||
    (comment.side !== 'left' && comment.side !== 'right') ||
    typeof comment.lineNumber !== 'number' ||
    !Number.isInteger(comment.lineNumber) ||
    comment.lineNumber < 1 ||
    typeof comment.lineContent !== 'string' ||
    typeof comment.body !== 'string' ||
    !comment.body.trim() ||
    (comment.status !== 'open' && comment.status !== 'resolved') ||
    !createdAt ||
    !updatedAt
  ) {
    return []
  }
  return [
    {
      id: comment.id,
      sessionId: comment.sessionId,
      filePath: comment.filePath,
      side: comment.side,
      lineNumber: comment.lineNumber,
      lineContent: comment.lineContent,
      body: comment.body,
      status: comment.status,
      createdAt,
      updatedAt,
    },
  ]
}

function normalizeWorkflowEvent(value: unknown): DesktopWorkflowEvent[] {
  if (!value || typeof value !== 'object') return []
  const event = value as Partial<DesktopWorkflowEvent>
  if (!isWorkflowEventType(event.type)) return []
  if (typeof event.threadId !== 'string') return []
  const createdAt = normalizeTimestampString(event.createdAt)
  if (!createdAt) return []
  if (event.type === 'thread.started') {
    return [normalizeThreadEvent({ ...event, createdAt } as DesktopWorkflowEvent)]
  }
  if (typeof event.turnId !== 'string') return []
  if (
    event.type === 'item.started' ||
    event.type === 'item.updated' ||
    event.type === 'item.completed'
  ) {
    if (!event.item || typeof event.item !== 'object') return []
    return [normalizeThreadEvent({ ...event, createdAt } as DesktopWorkflowEvent)]
  }
  return [normalizeThreadEvent({ ...event, createdAt } as DesktopWorkflowEvent)]
}

function workflowEventKey(event: DesktopWorkflowEvent): string {
  if (event.eventId) return `eventId:${event.eventId}`
  const turnId = 'turnId' in event ? event.turnId : ''
  const itemId = 'item' in event ? event.item.id : ''
  return [
    event.type,
    event.threadId,
    turnId,
    itemId,
    event.createdAt,
  ].join(':')
}

function isWorkflowEventType(
  value: unknown,
): value is DesktopWorkflowEvent['type'] {
  return (
    value === 'thread.started' ||
    value === 'turn.started' ||
    value === 'item.started' ||
    value === 'item.updated' ||
    value === 'item.completed' ||
    value === 'turn.completed' ||
    value === 'turn.failed' ||
    value === 'turn.interrupted'
  )
}

function isSessionEventType(
  value: unknown,
): value is DesktopSessionEvent['type'] {
  return (
    value === 'message' ||
    value === 'assistant_delta' ||
    value === 'tool_call' ||
    value === 'tool_result' ||
    value === 'status' ||
    value === 'permission_request' ||
    value === 'context_usage' ||
    value === 'file_patch' ||
    value === 'error' ||
    value === 'checkpoint'
  )
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
      profile: isAgentPermissionProfile(request.profile)
        ? request.profile
        : undefined,
      approvalMode: isAgentApprovalMode(request.approvalMode)
        ? request.approvalMode
        : undefined,
    },
  ]
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
    contextUsage: null,
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
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

function transcriptPathForSnapshot(snapshot: DesktopSessionSnapshot): string {
  return (
    snapshot.item.transcriptPath ??
    getTranscriptPath(snapshot.workspace.path, snapshot.item.id)
  )
}

function getTranscriptPath(workspacePath: string, sessionId: string): string {
  return join(getProjectDir(workspacePath), `${sessionId}.jsonl`)
}

function compareSnapshotsByRecency(
  left: DesktopSessionSnapshot,
  right: DesktopSessionSnapshot,
): number {
  return (
    timestampMs(right.item.lastMessageAt ?? right.updatedAt) -
    timestampMs(left.item.lastMessageAt ?? left.updatedAt)
  )
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

function latestMessageTimestamp(
  messages: DesktopSessionMessage[],
): string | null {
  const latest = messages.at(-1)?.createdAt
  return normalizeTimestampString(latest)
}

function dateFromString(value: unknown): Date {
  if (typeof value === 'string') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date
  }
  return new Date()
}

function timestampMs(value: unknown): number {
  return dateFromString(value).getTime()
}

function normalizeStatus(status: unknown): DesktopSessionStatus {
  return status === 'running' ||
    status === 'waiting' ||
    status === 'done' ||
    status === 'error'
    ? status
    : 'idle'
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function validModelName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed !== 'unknown' ? trimmed : undefined
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}
