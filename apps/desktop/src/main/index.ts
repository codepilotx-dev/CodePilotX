import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { enableConfigs } from '@codepilotx/core/utils/config.js'
import {
  formatDescriptionWithSource,
  getCommandName,
  getCommands,
} from '@codepilotx/tui/commands.js'
import { initBuiltinPlugins } from '@codepilotx/tui/plugins/bundled/index.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from '@codepilotx/tui/utils/model/model.js'
import {
  CODEPILOTX_CONFIG_DIR_ENV,
  LEGACY_CLAUDE_CONFIG_DIR_ENV,
} from '@codepilotx/core/config/env.js'
import {
  getSettings_DEPRECATED,
  updateSettingsForSource,
} from '@codepilotx/tui/utils/settings/settings.js'
import { clearAllCaches } from '@codepilotx/tui/utils/plugins/cacheUtils.js'
import { generateSessionTitle } from '@codepilotx/tui/utils/sessionTitle.js'
import { saveAiGeneratedTitle } from '@codepilotx/tui/utils/sessionStorage.js'
import {
  createDesktopAgentSession,
  type DesktopAgentSession,
} from './agentSession.js'
import type { DesktopAgentRuntimePreference } from './agentRuntime.js'
import { buildDesktopApiHandlers } from './desktopApiHandlers.js'
import { applyDesktopAgentRuntimeEnvDefaults } from './desktopRuntimeEnv.js'
import { createDesktopJsonRpcAppServerBridge } from './desktopJsonRpcAppServerBridge.js'
import { registerDesktopIpcHandlers } from './ipc.js'
import { createDesktopWindowService } from './windowService.js'
import { createDesktopBrowserService } from './browserService.js'
import { createDesktopAutoUpdater } from './autoUpdater.js'
import { DESKTOP_UPDATE_STATUS_CHANNEL } from '../shared/ipcChannels.js'
import {
  assertAllowedWorkspace,
  configureWorkspaceService,
  getStandaloneWorkspace,
  getWorkspaceDiff,
  normalizeWorkspacePath,
  registerAllowedWorkspace,
  workspaceFromPath,
} from './workspaceService.js'
import { configureGithubService } from './githubService.js'
import { getOpenAgentConfigHomeDir } from './desktopSettings.js'
import { desktopDebug } from './desktopDebug.js'
import { getModelProviderState } from './modelProviderService.js'
import {
  applyDesktopAgentEventToSnapshot,
  applyDesktopWorkflowEventsToSnapshot,
  createDesktopSessionSnapshot,
  desktopSessionTranscriptExists,
  hydrateDesktopSessionSnapshot,
  loadDesktopSessionStore,
  removePendingPermissionFromSnapshot,
  saveDesktopSessionStore,
} from './sessionPersistence.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopAgentEvent,
  DesktopBuiltinPlugin,
  DesktopApprovalPolicy,
  DesktopPermissionDecision,
  DesktopReviewComment,
  DesktopSlashCommandSuggestion,
  DesktopSessionMetadataPatch,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopThinkingMode,
  DesktopUserMessageContent,
  DesktopUserMessageInput,
  DesktopWorkspace,
  SaveSessionReviewCommentInput,
  SessionReviewCommentInput,
} from '../shared/types.js'
import {
  buildDesktopUserMessageContent,
  desktopUserMessageInputToPreviewText,
  hasBlockingComposerAttachmentErrors,
} from '../shared/desktopUserMessage.js'
import {
  normalizeDesktopApprovalPolicy,
  normalizeDesktopApprovalsReviewer,
  normalizeAskUserQuestionMaxQuestions,
  normalizeDesktopPermissionProfile,
} from '../shared/settingsSchema.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const DESKTOP_APP_ID = 'local.codepilotx.desktop'
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

const desktopConfigHomeDir = getOpenAgentConfigHomeDir()
process.env[CODEPILOTX_CONFIG_DIR_ENV] = desktopConfigHomeDir
process.env[LEGACY_CLAUDE_CONFIG_DIR_ENV] = desktopConfigHomeDir

const sessions = new Map<string, DesktopSessionRecord>()
const titleGenerationStartedSessionIds = new Set<string>()
let activeSessionId: string | null = null
let sessionStoreLoadPromise: Promise<void> | null = null
const DESKTOP_BUILTIN_PLUGIN_IDS = ['minimax@builtin'] as const
const DESKTOP_PRIMARY_SLASH_COMMANDS = [
  'effort',
  'model',
  'branch',
  'status',
  'goal',
  'plan',
  'remember',
] as const
const DESKTOP_PRIMARY_SLASH_COMMAND_SET = new Set<string>(
  DESKTOP_PRIMARY_SLASH_COMMANDS,
)
const DESKTOP_SLASH_COMMAND_TITLE_OVERRIDES: Record<string, string> = {
  effort: '推理模式',
  model: '模型',
  branch: '派生',
  status: '状态',
  goal: '目标',
  plan: '计划模式',
  remember: '记忆',
}

initBuiltinPlugins()

function rendererUrl(): string {
  const devRendererUrl =
    process.env.CODEPILOTX_DESKTOP_RENDERER_URL ??
    process.env.CLAUDE_CODE_DESKTOP_RENDERER_URL
  if (!app.isPackaged && devRendererUrl) {
    return devRendererUrl
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

function desktopIconPath(): string | undefined {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '..', '..', '..', 'apps', 'desktop', 'build', 'icon.ico')
  return existsSync(iconPath) ? iconPath : undefined
}

const windowService = createDesktopWindowService({
  iconPath: desktopIconPath,
  rendererUrl,
  preloadPath: () => join(__dirname, '../preload/index.js'),
})
const browserService = createDesktopBrowserService({
  getWindow: windowService.getWindow,
})
const jsonRpcAppServerThreadIds = new Set<string>()
const jsonRpcAppServerBridge = createDesktopJsonRpcAppServerBridge({
  onWorkflowEvent: event => {
    const emittedEvent = windowService.emitWorkflowEvent(event)
    const record = sessions.get(emittedEvent.threadId)
    if (record) {
      record.snapshot = applyDesktopWorkflowEventsToSnapshot(record.snapshot, [
        emittedEvent,
      ])
      persistSessionStore()
    }
  },
})
configureWorkspaceService({ getWindow: windowService.getWindow })
configureGithubService({ getWindow: windowService.getWindow })

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
      'codepilotx-local.exe',
    )
  }
  return join(__dirname, '..', '..', 'desktop-agent', 'codepilotx-local.exe')
}

function getDesktopRuntimeSelection(): {
  preference: DesktopAgentRuntimePreference
  source: 'default' | 'env'
} {
  const value = (
    process.env.CODEPILOTX_DESKTOP_RUNTIME ??
    process.env.CLAUDE_CODE_DESKTOP_RUNTIME
  )?.trim()
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
    `Ignoring unsupported CODEPILOTX_DESKTOP_RUNTIME value: ${value}`,
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
    currentRecord.snapshot = applyDesktopWorkflowEventsToSnapshot(
      currentRecord.snapshot,
      windowService.emitAgentEvent(timestampedEvent),
    )
    persistSessionStore()
    if (
      !currentRecord.snapshot.item.standalone &&
      (timestampedEvent.type === 'done' || timestampedEvent.type === 'error')
    ) {
      void getWorkspaceDiff(session.workspacePath).then(diff => {
        const latestRecord = sessions.get(session.sessionId)
        if (!latestRecord || latestRecord.session !== session) {
          return
        }
        const diffEvent: DesktopAgentEvent = {
          type: 'diff',
          sessionId: session.sessionId,
          filePath: session.workspacePath,
          patch: diff.patch,
        }
        latestRecord.snapshot = applyDesktopAgentEventToSnapshot(
          latestRecord.snapshot,
          diffEvent,
        )
        latestRecord.snapshot = applyDesktopWorkflowEventsToSnapshot(
          latestRecord.snapshot,
          windowService.emitAgentEvent(diffEvent),
        )
        persistSessionStore()
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

async function getSession(sessionId: string): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(sessionId)
  if (
    record.snapshot.item.status !== 'running' &&
    record.snapshot.item.status !== 'waiting'
  ) {
    record.snapshot = await hydrateDesktopSessionSnapshot(record.snapshot)
    persistSessionStore()
  }
  return record.snapshot
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

async function saveSessionReviewComment(
  input: SaveSessionReviewCommentInput,
): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(input.sessionId)
  const comment = normalizeReviewCommentInput(input, record.snapshot.item.id)
  const comments = record.snapshot.reviewComments ?? []
  const existingIndex = comments.findIndex(item => item.id === comment.id)
  const nextComments =
    existingIndex >= 0
      ? comments.map(item => (item.id === comment.id ? comment : item))
      : [...comments, comment]
  record.snapshot = {
    ...record.snapshot,
    reviewComments: nextComments,
    updatedAt: new Date().toISOString(),
  }
  persistSessionStore()
  return record.snapshot
}

async function resolveSessionReviewComment(
  input: SessionReviewCommentInput,
): Promise<DesktopSessionSnapshot> {
  return updateSessionReviewCommentStatus(input, 'resolved')
}

async function deleteSessionReviewComment(
  input: SessionReviewCommentInput,
): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(input.sessionId)
  record.snapshot = {
    ...record.snapshot,
    reviewComments: (record.snapshot.reviewComments ?? []).filter(
      comment => comment.id !== input.commentId,
    ),
    updatedAt: new Date().toISOString(),
  }
  persistSessionStore()
  return record.snapshot
}

async function updateSessionReviewCommentStatus(
  input: SessionReviewCommentInput,
  status: DesktopReviewComment['status'],
): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(input.sessionId)
  const now = new Date().toISOString()
  let found = false
  const reviewComments = (record.snapshot.reviewComments ?? []).map(comment => {
    if (comment.id !== input.commentId) return comment
    found = true
    return { ...comment, status, updatedAt: now }
  })
  if (!found) {
    throw new Error('Review comment was not found.')
  }
  record.snapshot = {
    ...record.snapshot,
    reviewComments,
    updatedAt: now,
  }
  persistSessionStore()
  return record.snapshot
}

function normalizeReviewCommentInput(
  input: SaveSessionReviewCommentInput,
  sessionId: string,
): DesktopReviewComment {
  const raw = input.comment
  const now = new Date().toISOString()
  const id =
    'id' in raw && typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `review-comment-${randomUUID()}`
  const filePath = requireNonEmptyString(raw.filePath, 'Review comment file path')
  const lineContent =
    typeof raw.lineContent === 'string' ? raw.lineContent : ''
  const body = requireNonEmptyString(raw.body, 'Review comment body')
  if (raw.side !== 'left' && raw.side !== 'right') {
    throw new Error('Review comment side must be left or right.')
  }
  if (
    typeof raw.lineNumber !== 'number' ||
    !Number.isInteger(raw.lineNumber) ||
    raw.lineNumber < 1
  ) {
    throw new Error('Review comment line number must be a positive integer.')
  }
  return {
    id,
    sessionId,
    filePath,
    side: raw.side,
    lineNumber: raw.lineNumber,
    lineContent,
    body,
    status:
      'status' in raw && raw.status === 'resolved' ? 'resolved' : 'open',
    createdAt:
      'createdAt' in raw &&
      typeof raw.createdAt === 'string' &&
      raw.createdAt.trim()
        ? raw.createdAt
        : now,
    updatedAt: now,
  }
}

async function setSessionPermissionProfile(
  sessionId: string,
  profile: string,
  approvalPolicy?: DesktopApprovalPolicy,
): Promise<DesktopSessionSnapshot> {
  const record = await getSessionRecord(sessionId)
  const nextProfile = normalizeDesktopPermissionProfile(profile)
  const nextApprovalPolicy = normalizeDesktopApprovalPolicy(
    approvalPolicy,
    record.snapshot.settings.approvalPolicy,
  )
  createRuntimeForRecord(record).setPermissionProfile(
    nextProfile,
    nextApprovalPolicy,
  )
  const nextItem = {
    ...record.snapshot.item,
    permissionProfile: nextProfile,
    approvalPolicy: nextApprovalPolicy,
  }
  const nextSettings = {
    ...record.snapshot.settings,
    permissionProfile: nextProfile,
    approvalPolicy: nextApprovalPolicy,
  }
  record.snapshot = {
    ...record.snapshot,
    item: nextItem,
    settings: nextSettings,
    updatedAt: new Date().toISOString(),
  }
  persistSessionStore()
  return record.snapshot
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
  const permissionProfile = normalizeDesktopPermissionProfile(
    options.permissionProfile,
  )
  const approvalPolicy = normalizeDesktopApprovalPolicy(options.approvalPolicy)
  const approvalsReviewer = normalizeDesktopApprovalsReviewer(
    options.approvalsReviewer,
  )
  const model = normalizeOptionalText(options.model)
  await assertCurrentProviderUsable(model)
  const smallFastModel = normalizeOptionalText(options.smallFastModel)
  const fastModel = normalizeOptionalText(options.fastModel)
  const defaultModel = normalizeOptionalText(options.defaultModel)
  const deepModel = normalizeOptionalText(options.deepModel)
  const sessionName = normalizeOptionalText(options.sessionName)
  const thinkingMode = normalizeThinkingMode(options.thinkingMode)
  const systemPrompt = normalizeOptionalText(options.systemPrompt)
  const appendSystemPrompt = normalizeOptionalText(options.appendSystemPrompt)
  const askUserQuestionMaxQuestions = normalizeAskUserQuestionMaxQuestions(
    options.askUserQuestionMaxQuestions,
  )
  const additionalDirectories = await normalizeAdditionalDirectories(
    options.additionalDirectories,
    workspacePath,
  )
  const standalone = workspace.isStandalone === true
  const settings = createSessionSettingsSnapshot({
    permissionProfile,
    approvalPolicy,
    approvalsReviewer,
    model,
    smallFastModel,
    fastModel,
    defaultModel,
    deepModel,
    sessionName,
    thinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    askUserQuestionMaxQuestions,
  })
  const session = createDesktopAgentSession(
    {
      workspacePath,
      permissionProfile,
      approvalPolicy,
      approvalsReviewer,
      model,
      smallFastModel,
      fastModel,
      defaultModel,
      deepModel,
      sessionName,
      thinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      askUserQuestionMaxQuestions,
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
  startJsonRpcAppServerThread(session.sessionId)
  persistSessionStore()
  return { sessionId: session.sessionId, workspace, standalone }
}

function createSessionSettingsSnapshot(params: {
  permissionProfile: string
  approvalPolicy: DesktopApprovalPolicy
  approvalsReviewer: DesktopSessionSettingsSnapshot['approvalsReviewer']
  model?: string
  smallFastModel?: string
  fastModel?: string
  defaultModel?: string
  deepModel?: string
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
  askUserQuestionMaxQuestions: DesktopSessionSettingsSnapshot['askUserQuestionMaxQuestions']
}): DesktopSessionSettingsSnapshot {
  const settings: DesktopSessionSettingsSnapshot = {
    permissionProfile: params.permissionProfile,
    approvalPolicy: params.approvalPolicy,
    approvalsReviewer: params.approvalsReviewer,
    permissionMode: 'default',
    thinkingMode: params.thinkingMode,
    additionalDirectories: params.additionalDirectories,
    askUserQuestionMaxQuestions: params.askUserQuestionMaxQuestions,
  }
  if (params.model) settings.model = params.model
  if (params.smallFastModel) settings.smallFastModel = params.smallFastModel
  if (params.fastModel) settings.fastModel = params.fastModel
  if (params.defaultModel) settings.defaultModel = params.defaultModel
  if (params.deepModel) settings.deepModel = params.deepModel
  if (params.sessionName) settings.sessionName = params.sessionName
  if (params.systemPrompt) settings.systemPrompt = params.systemPrompt
  if (params.appendSystemPrompt) {
    settings.appendSystemPrompt = params.appendSystemPrompt
  }
  return settings
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
  input: DesktopUserMessageInput,
  model?: string,
): Promise<void> {
  const startedAt = Date.now()
  const trimmedContent = requireNonEmptyString(
    desktopUserMessageInputToPreviewText(input),
    'Desktop user message',
  )
  if (hasBlockingComposerAttachmentErrors(input.attachments)) {
    throw new Error('Desktop user message contains attachment errors.')
  }
  const runtimeContent = buildDesktopUserMessageContent(input)
  desktopDebug('send_user_message_start', {
    sessionId,
    textLength: trimmedContent.length,
    modelProvided: model !== undefined,
  })
  const record = await getSessionRecord(sessionId)
  const nextModel = normalizeOptionalText(model)
  const effectiveModel =
    model !== undefined ? nextModel : record.snapshot.settings.model
  await assertCurrentProviderUsable(effectiveModel)
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
  await startJsonRpcAppServerThread(sessionId)
  await startJsonRpcAppServerTurn(sessionId, runtimeContent)
  try {
    await session.sendUserMessage(runtimeContent, trimmedContent)
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

async function assertCurrentProviderUsable(
  model: string | undefined,
): Promise<void> {
  if (!model?.trim()) {
    throw new Error('未配置模型，请先在设置中配置模型。')
  }
  const providerState = await getModelProviderState()
  if (!providerState.apiKeyConfigured) {
    throw new Error(
      providerState.configurationMessage ??
        '未配置模型，请先在设置中配置模型。',
    )
  }
  if (providerState.provider.requiresBaseURL && !providerState.baseURL?.trim()) {
    throw new Error(
      providerState.configurationMessage ??
        '未配置模型，请先在设置中配置 Base URL。',
    )
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
    try {
      saveAiGeneratedTitle(
        sessionId as `${string}-${string}-${string}-${string}-${string}`,
        title,
      )
    } catch {
      // Best-effort: the desktop overlay still keeps the generated title.
    }
    latestRecord.snapshot = applyDesktopAgentEventToSnapshot(
      latestRecord.snapshot,
      event,
    )
    latestRecord.snapshot = applyDesktopWorkflowEventsToSnapshot(
      latestRecord.snapshot,
      windowService.emitAgentEvent(event),
    )
    persistSessionStore()
  })
}

async function startJsonRpcAppServerThread(sessionId: string): Promise<void> {
  if (!jsonRpcAppServerBridge || jsonRpcAppServerThreadIds.has(sessionId)) {
    return
  }
  jsonRpcAppServerThreadIds.add(sessionId)
  try {
    await jsonRpcAppServerBridge.startThread(sessionId)
  } catch (error) {
    jsonRpcAppServerThreadIds.delete(sessionId)
    desktopDebug('json_rpc_app_server_thread_start_failed', {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function startJsonRpcAppServerTurn(
  sessionId: string,
  content: DesktopUserMessageContent,
): Promise<void> {
  if (!jsonRpcAppServerBridge) {
    return
  }
  try {
    await jsonRpcAppServerBridge.startTurn(sessionId, content)
  } catch (error) {
    desktopDebug('json_rpc_app_server_turn_start_failed', {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
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
  const pendingRequest = record.snapshot.view.pendingPermissions.find(
    request => request.requestId === normalizedRequestId,
  )
  record.snapshot = removePendingPermissionFromSnapshot(
    record.snapshot,
    normalizedRequestId,
  )
  if (pendingRequest) {
    record.snapshot = applyDesktopWorkflowEventsToSnapshot(
      record.snapshot,
      windowService.emitPermissionDecision(sessionId, pendingRequest, decision),
    )
  }
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

async function listBuiltinPlugins(): Promise<DesktopBuiltinPlugin[]> {
  const enabledPlugins = getSettings_DEPRECATED().enabledPlugins ?? {}
  return DESKTOP_BUILTIN_PLUGIN_IDS.map(id => ({
    id,
    enabled: enabledPlugins[id] === true,
  }))
}

async function listSlashCommands(
  workspacePath?: string,
): Promise<DesktopSlashCommandSuggestion[]> {
  const cwd = workspacePath
    ? normalizeWorkspacePath(workspacePath)
    : (await getStandaloneWorkspace()).path
  const commands = await getCommands(cwd)
  const suggestions = commands
    .filter(command => command.userInvocable !== false)
    .filter(command => !command.isHidden)
    .filter(command => command.isEnabled?.() ?? true)
    .filter(command => {
      const name = getCommandName(command)
      return (
        DESKTOP_PRIMARY_SLASH_COMMAND_SET.has(name) ||
        (command.type === 'prompt' && command.source !== 'builtin')
      )
    })
    .map(command => {
      const name = getCommandName(command)
      const isSkill = command.type === 'prompt'
      return {
        name,
        title: DESKTOP_SLASH_COMMAND_TITLE_OVERRIDES[name] ?? name,
        description: formatDescriptionWithSource(command),
        category: isSkill ? 'skill' : 'command',
        ...(isSkill && { scope: '个人' }),
      } satisfies DesktopSlashCommandSuggestion
    })

  return suggestions.sort((a, b) => {
    const aPrimary = DESKTOP_PRIMARY_SLASH_COMMANDS.indexOf(
      a.name as (typeof DESKTOP_PRIMARY_SLASH_COMMANDS)[number],
    )
    const bPrimary = DESKTOP_PRIMARY_SLASH_COMMANDS.indexOf(
      b.name as (typeof DESKTOP_PRIMARY_SLASH_COMMANDS)[number],
    )
    if (aPrimary !== -1 || bPrimary !== -1) {
      if (aPrimary === -1) return 1
      if (bPrimary === -1) return -1
      return aPrimary - bPrimary
    }
    if (a.category !== b.category) {
      return a.category === 'command' ? -1 : 1
    }
    return a.title.localeCompare(b.title)
  })
}

async function setBuiltinPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<DesktopBuiltinPlugin> {
  if (
    !DESKTOP_BUILTIN_PLUGIN_IDS.includes(
      pluginId as (typeof DESKTOP_BUILTIN_PLUGIN_IDS)[number],
    )
  ) {
    throw new Error(`Unknown built-in plugin: ${pluginId}`)
  }

  const { error } = updateSettingsForSource('userSettings', {
    enabledPlugins: {
      [pluginId]: enabled,
    },
  })
  if (error) {
    throw error
  }
  clearAllCaches()
  return { id: pluginId, enabled }
}

function registerIpc(): void {
  const handlers = buildDesktopApiHandlers({
    windowService,
    browserService,
    getRuntimeOptions: () => {
      const runtimeSelection = getDesktopRuntimeSelection()
      return {
        agentExecutablePath: getAgentExecutablePath(),
        configDirectoryPath: getOpenAgentConfigHomeDir(),
        runtimePreference: runtimeSelection.preference,
        runtimeSelectionSource: runtimeSelection.source,
      }
    },
    listBuiltinPlugins,
    setBuiltinPluginEnabled,
    listSlashCommands,
    createSession,
    listSessions,
    getSession,
    getActiveSessionId,
    setActiveSession,
    updateSessionMetadata,
    saveSessionReviewComment,
    resolveSessionReviewComment,
    deleteSessionReviewComment,
    setSessionPermissionMode: setSessionPermissionProfile,
    sendUserMessage,
    respondToPermission,
    interruptSession,
    disposeSession,
  })

  registerDesktopIpcHandlers(handlers, assertTrustedIpcSender)
}

applyDesktopAgentRuntimeEnvDefaults()
enableConfigs()
app.setAppUserModelId(DESKTOP_APP_ID)
registerIpc()

createDesktopAutoUpdater({
  onStatusChange: (status) => {
    const window = windowService.getWindow()
    window?.webContents.send(DESKTOP_UPDATE_STATUS_CHANNEL, status)
  },
})

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
