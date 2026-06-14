import {
  app,
  shell,
} from 'electron'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { enableConfigs } from '@claudecode/core/utils/config.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from '@claudecode/tui/utils/model/model.js'
import { getAuthStatus, getRuntimeStatus } from './authRuntimeService.js'
import { generateSessionTitle } from '@claudecode/tui/utils/sessionTitle.js'
import {
  createDesktopAgentSession,
  type DesktopAgentSession,
} from './agentSession.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'
import {
  createDesktopApiHandlers,
  registerDesktopIpcHandlers,
} from './ipc.js'
import { createDesktopWindowService } from './windowService.js'
import {
  assertAllowedWorkspace,
  checkoutWorkspaceBranch,
  chooseWorkspace,
  configureWorkspaceService,
  getStandaloneWorkspace,
  getWorkspaceContext,
  getWorkspaceDiff,
  listOpenTargets,
  listWorkspaceFiles,
  normalizeWorkspacePath,
  openWorkspace,
  openPathWithDefaultTarget,
  readWorkspaceFile,
  registerAllowedWorkspace,
  workspaceFromPath,
} from './workspaceService.js'
import {
  fetchProviderBalance,
  fetchProviderModels,
  getModelProviderState,
  listModelProviders,
  saveModelProvider,
  saveProviderApiKey,
} from './modelProviderService.js'
import {
  getOpenAgentConfigHomeDir,
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
import { desktopDebug } from './desktopDebug.js'
import {
  applyDesktopAgentEventToSnapshot,
  createDesktopSessionSnapshot,
  desktopSessionTranscriptExists,
  loadDesktopSessionStore,
  removePendingPermissionFromSnapshot,
  saveDesktopSessionStore,
} from './sessionPersistence.js'
import {
  readDesktopThemeSettings,
  saveDesktopThemeSettings,
} from './themeSettings.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopSessionMetadataPatch,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopWorkspace,
} from '../shared/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DESKTOP_PERMISSION_MODES = new Set<DesktopPermissionMode>([
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
])
const DESKTOP_THINKING_MODES = new Set<DesktopThinkingMode>([
  'default',
  'enabled',
  'adaptive',
  'disabled',
])
type DesktopSessionRecord = {
  session: DesktopAgentSession | null
  snapshot: DesktopSessionSnapshot
  resumeExistingSession: boolean
}

process.env.CLAUDE_CONFIG_DIR = getOpenAgentConfigHomeDir()

const sessions = new Map<string, DesktopSessionRecord>()
const titleGenerationStartedSessionIds = new Set<string>()
let activeSessionId: string | null = null
let sessionStoreLoadPromise: Promise<void> | null = null

function rendererUrl(): string {
  if (!app.isPackaged && process.env.CLAUDE_CODE_DESKTOP_RENDERER_URL) {
    return process.env.CLAUDE_CODE_DESKTOP_RENDERER_URL
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

const windowService = createDesktopWindowService({
  rendererUrl,
  preloadPath: () => join(__dirname, '../preload/index.js'),
})
configureWorkspaceService({ getWindow: windowService.getWindow })

function assertTrustedIpcSender(senderUrl: string | undefined): void {
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error('Rejected desktop IPC call from an untrusted renderer.')
  }
}

function isTrustedRendererUrl(senderUrl: string | undefined): boolean {
  if (!senderUrl) return false

  const trustedRendererUrl = rendererUrl()
  if (senderUrl === trustedRendererUrl) return true

  try {
    const parsedSender = new URL(senderUrl)
    const parsedTrusted = new URL(trustedRendererUrl)
    if (parsedSender.protocol !== parsedTrusted.protocol) return false

    if (parsedSender.protocol === 'file:') {
      const trustedPath = decodeURIComponent(parsedTrusted.pathname)
      const senderPath = decodeURIComponent(parsedSender.pathname)
      const trustedDirectory =
        trustedPath.endsWith('/')
          ? trustedPath
          : trustedPath.replace(/[^/]+$/, '')
      return (
        senderPath === trustedPath ||
        senderPath.startsWith(trustedDirectory)
      )
    }

    if (parsedSender.origin !== parsedTrusted.origin) return false
    return parsedSender.pathname.startsWith(parsedTrusted.pathname)
  } catch {
    return false
  }
}

function getAgentExecutablePath(): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'dist',
      'desktop-agent',
      'claude-local.exe',
    )
  }
  return join(__dirname, '..', '..', 'desktop-agent', 'claude-local.exe')
}

function getDesktopRuntimeSelection(): {
  preference: DesktopAgentRuntimePreference
  source: 'default' | 'env'
} {
  const value = process.env.CLAUDE_CODE_DESKTOP_RUNTIME?.trim()
  if (!value) {
    return { preference: 'auto', source: 'default' }
  }
  if (
    value === 'auto' ||
    value === 'embedded-headless' ||
    value === 'subprocess'
  ) {
    return { preference: value, source: 'env' }
  }
  if (value === 'in-process-headless') {
    return { preference: 'embedded-headless', source: 'env' }
  }
  console.warn(
    `Ignoring unsupported CLAUDE_CODE_DESKTOP_RUNTIME value: ${value}`,
  )
  return { preference: 'auto', source: 'default' }
}

function getDesktopAgentRuntimeOptions() {
  const selection = getDesktopRuntimeSelection()
  return {
    agentExecutablePath: getAgentExecutablePath(),
    configDirectoryPath: getOpenAgentConfigHomeDir(),
    runtimePreference: selection.preference,
  }
}

function withDesktopMessageTimestamp(event: DesktopAgentEvent): DesktopAgentEvent {
  if (event.type !== 'message' && event.type !== 'partial_message') {
    return event
  }
  return event.createdAt ? event : { ...event, createdAt: new Date().toISOString() }
}

async function ensureSessionStoreLoaded(): Promise<void> {
  if (!sessionStoreLoadPromise) {
    sessionStoreLoadPromise = loadDesktopSessionStore().then(store => {
      sessions.clear()
      return Promise.all(
        store.sessions.map(async snapshot => {
          const resumeExistingSession =
            await desktopSessionTranscriptExists(snapshot)
          sessions.set(snapshot.item.id, {
            session: null,
            snapshot,
            resumeExistingSession,
          })
          registerAllowedWorkspace(snapshot.workspace.path)
        }),
      ).then(() => {
        activeSessionId = store.activeSessionId
      })
    })
  }
  await sessionStoreLoadPromise
}

function persistSessionStore(): void {
  void saveDesktopSessionStore({
    activeSessionId,
    sessions: [...sessions.values()].map(record => record.snapshot),
  }).catch(error => {
    console.error('Failed to save desktop sessions.', error)
  })
}

function attachSessionListeners(record: DesktopSessionRecord): void {
  const session = record.session
  if (!session) return
  session.on('event', event => {
    desktopDebug('agent_event', {
      sessionId: event.sessionId,
      type: event.type,
      ...(event.type === 'status' ? { status: event.status } : {}),
      ...(event.type === 'message'
        ? { role: event.role, textLength: event.text.length }
        : {}),
      ...(event.type === 'partial_message'
        ? { textLength: event.text.length }
        : {}),
      ...(event.type === 'error' ? { message: event.message } : {}),
    })
    const currentRecord = sessions.get(session.sessionId)
    if (!currentRecord || currentRecord.session !== session) {
      desktopDebug('agent_event_ignored_stale_session', {
        sessionId: session.sessionId,
        type: event.type,
      })
      return
    }
    const timestampedEvent = withDesktopMessageTimestamp(event)
    currentRecord.snapshot = applyDesktopAgentEventToSnapshot(
      currentRecord.snapshot,
      timestampedEvent,
    )
    persistSessionStore()
    windowService.emitAgentEvent(timestampedEvent)
    if (
      !currentRecord.snapshot.item.standalone &&
      (timestampedEvent.type === 'done' || timestampedEvent.type === 'error')
    ) {
      void getWorkspaceDiff(session.workspacePath).then(diff => {
        const latestRecord = sessions.get(session.sessionId)
        if (!latestRecord || latestRecord.session !== session) {
          return
        }
        windowService.emitAgentEvent({
          type: 'diff',
          sessionId: session.sessionId,
          filePath: session.workspacePath,
          patch: diff.patch,
        })
      })
    }
  })
}

function createRuntimeForRecord(record: DesktopSessionRecord): DesktopAgentSession {
  if (record.session) {
    return record.session
  }
  const session = createDesktopAgentSession(
    {
      ...record.snapshot.settings,
      workspacePath: record.snapshot.workspace.path,
      sessionId: record.snapshot.item.id,
      resumeExistingSession: record.resumeExistingSession,
      suppressStartupMessage: true,
    },
    getDesktopAgentRuntimeOptions(),
  )
  record.session = session
  attachSessionListeners(record)
  return session
}

async function listSessions(): Promise<DesktopSessionSnapshot[]> {
  await ensureSessionStoreLoaded()
  return [...sessions.values()].map(record => record.snapshot)
}

async function getActiveSessionId(): Promise<string | null> {
  await ensureSessionStoreLoaded()
  return activeSessionId
}

async function setActiveSession(sessionId: string | null): Promise<void> {
  await ensureSessionStoreLoaded()
  if (sessionId !== null && !sessions.has(sessionId)) {
    throw new Error(`Unknown desktop session: ${sessionId}`)
  }
  activeSessionId = sessionId
  persistSessionStore()
}

async function updateSessionMetadata(
  sessionId: string,
  patch: DesktopSessionMetadataPatch,
): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(sessionId)
  if (!patch || typeof patch !== 'object') {
    throw new Error('Desktop session metadata patch must be an object.')
  }

  const nextItem = { ...record.snapshot.item }
  if ('pinnedAt' in patch) {
    nextItem.pinnedAt = normalizeNullableTimestamp(patch.pinnedAt)
  }
  if ('archivedAt' in patch) {
    nextItem.archivedAt = normalizeNullableTimestamp(patch.archivedAt)
  }

  record.snapshot = {
    ...record.snapshot,
    item: nextItem,
    updatedAt: new Date().toISOString(),
  }
  if (nextItem.archivedAt && activeSessionId === sessionId) {
    activeSessionId =
      [...sessions.values()].find(
        item =>
          item.snapshot.item.id !== sessionId &&
          !item.snapshot.item.archivedAt,
      )?.snapshot.item.id ?? null
  }
  persistSessionStore()
  return record.snapshot
}

async function openExternalURL(url: string): Promise<void> {
  const parsed = new URL(requireNonEmptyString(url, 'External URL'))
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS external URLs can be opened.')
  }
  await shell.openExternal(parsed.toString())
}

async function createSession(
  options: CreateDesktopSessionOptions,
): Promise<CreateDesktopSessionResult> {
  await ensureSessionStoreLoaded()
  if (!options || typeof options !== 'object') {
    throw new Error('Desktop session options must be an object.')
  }
  const workspace =
    typeof options.workspacePath === 'string' && options.workspacePath.trim()
      ? await workspaceFromPath(assertAllowedWorkspace(options.workspacePath))
      : await getStandaloneWorkspace()
  const workspacePath = workspace.path
  const permissionMode = normalizePermissionMode(options.permissionMode)
  const model = normalizeOptionalText(options.model)
  const fallbackModel = normalizeOptionalText(options.fallbackModel)
  const sessionName = normalizeOptionalText(options.sessionName)
  const thinkingMode = normalizeThinkingMode(options.thinkingMode)
  const systemPrompt = normalizeOptionalText(options.systemPrompt)
  const appendSystemPrompt = normalizeOptionalText(options.appendSystemPrompt)
  const additionalDirectories = await normalizeAdditionalDirectories(
    options.additionalDirectories,
    workspacePath,
  )
  const standalone = workspace.isStandalone === true
  const settings = createSessionSettingsSnapshot({
    permissionMode,
    model,
    fallbackModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
  })
  const session = createDesktopAgentSession(
    {
      workspacePath,
      permissionMode,
      model,
      fallbackModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
    },
    getDesktopAgentRuntimeOptions(),
  )
  const record: DesktopSessionRecord = {
    session,
    resumeExistingSession: false,
    snapshot: createDesktopSessionSnapshot({
      sessionId: session.sessionId,
      workspace,
      standalone,
      settings,
    }),
  }
  sessions.set(session.sessionId, record)
  activeSessionId = session.sessionId
  attachSessionListeners(record)
  persistSessionStore()
  return { sessionId: session.sessionId, workspace, standalone }
}

function createSessionSettingsSnapshot(params: {
  permissionMode: DesktopPermissionMode
  model?: string
  fallbackModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
}): DesktopSessionSettingsSnapshot {
  const settings: DesktopSessionSettingsSnapshot = {
    permissionMode: params.permissionMode,
    thinkingMode: params.thinkingMode,
    additionalDirectories: params.additionalDirectories,
  }
  if (params.model) settings.model = params.model
  if (params.fallbackModel) settings.fallbackModel = params.fallbackModel
  if (params.sessionName) settings.sessionName = params.sessionName
  if (params.systemPrompt) settings.systemPrompt = params.systemPrompt
  if (params.appendSystemPrompt) {
    settings.appendSystemPrompt = params.appendSystemPrompt
  }
  return settings
}

function normalizePermissionMode(
  permissionMode: DesktopPermissionMode | undefined,
): DesktopPermissionMode {
  if (!permissionMode) {
    return 'default'
  }
  if (!DESKTOP_PERMISSION_MODES.has(permissionMode)) {
    throw new Error(`Unsupported desktop permission mode: ${permissionMode}`)
  }
  return permissionMode
}

function normalizeThinkingMode(
  thinkingMode: DesktopThinkingMode | undefined,
): DesktopThinkingMode {
  if (!thinkingMode) {
    return 'default'
  }
  if (!DESKTOP_THINKING_MODES.has(thinkingMode)) {
    throw new Error(`Unsupported desktop thinking mode: ${thinkingMode}`)
  }
  return thinkingMode
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeNullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Session metadata timestamp must be a string or null.')
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function normalizeAdditionalDirectories(
  directories: string[] | undefined,
  workspacePath: string,
): Promise<string[]> {
  if (!Array.isArray(directories) || directories.length === 0) {
    return []
  }

  const normalized = new Map<string, string>()
  for (const directory of directories) {
    const trimmed = directory.trim()
    if (!trimmed) {
      continue
    }
    const resolvedDirectory = isAbsolute(trimmed)
      ? resolve(trimmed)
      : resolve(workspacePath, trimmed)
    const directoryStat = await stat(resolvedDirectory)
    if (!directoryStat.isDirectory()) {
      throw new Error(`Additional directory is not a directory: ${trimmed}`)
    }
    normalized.set(normalizeWorkspacePath(resolvedDirectory), resolvedDirectory)
  }
  return [...normalized.values()]
}

async function sendUserMessage(
  sessionId: string,
  content: string,
  model?: string,
): Promise<void> {
  const startedAt = Date.now()
  const trimmedContent = requireNonEmptyString(
    content,
    'Desktop user message',
  )
  desktopDebug('send_user_message_start', {
    sessionId,
    textLength: trimmedContent.length,
    modelProvided: model !== undefined,
  })
  const record = await getSessionRecord(sessionId)
  const nextModel = normalizeOptionalText(model)
  if (model !== undefined) {
    record.snapshot = {
      ...record.snapshot,
      item: {
        ...record.snapshot.item,
        model: nextModel ?? null,
      },
      settings: {
        ...record.snapshot.settings,
        model: nextModel,
      },
      updatedAt: new Date().toISOString(),
    }
  }
  const shouldGenerateTitle = shouldGenerateAiTitle(record)
  const session = createRuntimeForRecord(record)
  session.setModel(record.snapshot.settings.model)
  activeSessionId = record.snapshot.item.id
  persistSessionStore()
  if (shouldGenerateTitle) {
    scheduleAiTitleGeneration(record, trimmedContent)
  }
  try {
    await session.sendUserMessage(trimmedContent)
    desktopDebug('send_user_message_done', {
      sessionId,
      durationMs: Date.now() - startedAt,
    })
  } catch (error) {
    desktopDebug('send_user_message_error', {
      sessionId,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function shouldGenerateAiTitle(record: DesktopSessionRecord): boolean {
  const { item, view } = record.snapshot
  return (
    !item.sessionName &&
    !item.aiTitle &&
    !titleGenerationStartedSessionIds.has(item.id) &&
    !view.messages.some(message => message.role === 'user')
  )
}

function scheduleAiTitleGeneration(
  record: DesktopSessionRecord,
  description: string,
): void {
  const sessionId = record.snapshot.item.id
  titleGenerationStartedSessionIds.add(sessionId)
  const model = getSessionTitleModel(record)

  void generateSessionTitle(
    description,
    AbortSignal.timeout(30_000),
    model,
  ).then(title => {
    if (!title) return
    const latestRecord = sessions.get(sessionId)
    if (!latestRecord) return
    if (
      latestRecord.snapshot.item.sessionName ||
      latestRecord.snapshot.item.aiTitle
    ) {
      return
    }
    const event: DesktopAgentEvent = {
      type: 'session_title',
      sessionId,
      title,
    }
    latestRecord.snapshot = applyDesktopAgentEventToSnapshot(
      latestRecord.snapshot,
      event,
    )
    persistSessionStore()
    windowService.emitAgentEvent(event)
  })
}

function getSessionTitleModel(record: DesktopSessionRecord): string {
  const model = record.snapshot.settings.model
  return model ? parseUserSpecifiedModel(model) : getMainLoopModel()
}

async function respondToPermission(
  sessionId: string,
  requestId: string,
  decision: DesktopPermissionDecision,
): Promise<void> {
  const normalizedRequestId = requireNonEmptyString(
    requestId,
    'Desktop permission request id',
  )
  if (!decision || typeof decision !== 'object') {
    throw new Error('Desktop permission decision must be an object.')
  }
  if (decision.behavior !== 'allow' && decision.behavior !== 'deny') {
    throw new Error(
      `Unsupported desktop permission decision: ${decision.behavior}`,
    )
  }
  const record = await getSessionRecord(sessionId)
  record.snapshot = removePendingPermissionFromSnapshot(
    record.snapshot,
    normalizedRequestId,
  )
  persistSessionStore()
  if (record.session) {
    await record.session.respondToPermission(normalizedRequestId, decision)
  }
}

async function interruptSession(sessionId: string): Promise<void> {
  const record = await getSessionRecord(sessionId)
  await record.session?.interrupt()
}

async function disposeSession(sessionId: string): Promise<void> {
  const record = await getSessionRecord(sessionId)
  sessions.delete(sessionId)
  if (activeSessionId === sessionId) {
    activeSessionId = [...sessions.keys()][0] ?? null
  }
  persistSessionStore()
  await record.session?.dispose()
}

function disposeAllSessions(): void {
  for (const record of sessions.values()) {
    void record.session?.dispose()
  }
}

async function getSessionRecord(sessionId: string): Promise<DesktopSessionRecord> {
  await ensureSessionStoreLoaded()
  const normalizedSessionId = requireNonEmptyString(
    sessionId,
    'Desktop session id',
  )
  const record = sessions.get(normalizedSessionId)
  if (!record) {
    throw new Error(`Unknown desktop session: ${normalizedSessionId}`)
  }
  return record
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} cannot be empty.`)
  }
  return trimmed
}

function registerIpc(): void {
  const handlers = createDesktopApiHandlers({
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus: async () => {
      const runtimeSelection = getDesktopRuntimeSelection()
      return getRuntimeStatus({
        agentExecutablePath: getAgentExecutablePath(),
        configDirectoryPath: getOpenAgentConfigHomeDir(),
        runtimePreference: runtimeSelection.preference,
        runtimeSelectionSource: runtimeSelection.source,
      })
    },
    getDesktopSettings: readDesktopStoredSettings,
    saveDesktopSettings: async (settings: DesktopStoredSettings) =>
      saveDesktopStoredSettings(settings),
    listOpenTargets,
    openPathWithDefaultTarget,
    listModelProviders: async () => listModelProviders(),
    getModelProviderState: async () => getModelProviderState(),
    fetchProviderModels,
    fetchProviderBalance,
    saveModelProvider,
    saveProviderApiKey,
    chooseWorkspace,
    openWorkspace,
    getWorkspaceContext,
    checkoutWorkspaceBranch,
    listWorkspaceFiles,
    readWorkspaceFile,
    getWorkspaceDiff,
    getThemeSettings: readDesktopThemeSettings,
    saveThemeSettings: saveDesktopThemeSettings,
    createSession,
    listSessions,
    getActiveSessionId,
    setActiveSession,
    updateSessionMetadata,
    openExternalURL,
    sendUserMessage,
    respondToPermission,
    interruptSession,
    disposeSession,
    minimizeWindow: async () => windowService.minimizeWindow(),
    toggleWindowMaximized: async () => windowService.toggleWindowMaximized(),
    closeWindow: async () => windowService.closeWindow(),
    isWindowMaximized: async () => windowService.isWindowMaximized(),
    newWindow: async () => windowService.newWindow(),
    openDevTools: async () => windowService.openDevTools(),
    openSettings: async () => windowService.openSettings(),
    logOut: async () => windowService.logOut(),
    exitApp: async () => windowService.exitApp(),
  })

  registerDesktopIpcHandlers(handlers, assertTrustedIpcSender)
}

enableConfigs()
registerIpc()

app.whenReady().then(() => {
  windowService.createApplicationMenu()
  windowService.createWindow()
  app.on('activate', () => {
    if (!windowService.hasOpenWindows()) {
      windowService.createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  disposeAllSessions()
})
