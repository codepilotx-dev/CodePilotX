import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '../../services/api/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '../../services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '../../services/oauth/getOauthProfile.js'
import { OAuthService } from '../../services/oauth/index.js'
import type { OAuthTokens } from '../../services/oauth/types.js'
import {
  clearOAuthTokenCache,
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
  saveOAuthTokensIfNeeded,
  validateForceLoginOrg,
} from '../../utils/auth.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import {
  createDesktopAgentSession,
  type DesktopAgentSession,
} from './agentSession.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopAgentEvent,
  DesktopApi,
  DesktopAuthStatus,
  DesktopDiffSummary,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopRuntimeStatus,
  DesktopThinkingMode,
  DesktopWorkspace,
} from '../shared/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const execFileAsync = promisify(execFile)
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'bun_cache',
  'release',
])
const MAX_FILE_PREVIEW_BYTES = 200_000
const DESKTOP_PERMISSION_MODES = new Set<DesktopPermissionMode>([
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
])
const DESKTOP_THINKING_MODES = new Set<DesktopThinkingMode>([
  'default',
  'enabled',
  'adaptive',
  'disabled',
])

async function installDesktopOAuthTokens(tokens: OAuthTokens): Promise<void> {
  const profile =
    tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))

  if (profile) {
    storeOAuthAccountInfo({
      accountUuid: profile.account.uuid,
      emailAddress: profile.account.email,
      organizationUuid: profile.organization.uuid,
      displayName: profile.account.display_name || undefined,
      hasExtraUsageEnabled:
        profile.organization.has_extra_usage_enabled ?? undefined,
      billingType: profile.organization.billing_type ?? undefined,
      subscriptionCreatedAt:
        profile.organization.subscription_created_at ?? undefined,
      accountCreatedAt: profile.account.created_at,
    })
  } else if (tokens.tokenAccount) {
    storeOAuthAccountInfo({
      accountUuid: tokens.tokenAccount.uuid,
      emailAddress: tokens.tokenAccount.emailAddress,
      organizationUuid: tokens.tokenAccount.organizationUuid,
    })
  }

  saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  await fetchAndStoreUserRoles(tokens.accessToken).catch(() => {})
  if (shouldUseClaudeAIAuth(tokens.scopes)) {
    await fetchAndStoreClaudeCodeFirstTokenDate().catch(() => {})
  } else {
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error('Unable to create API key for console authentication.')
    }
  }
}

let mainWindow: BrowserWindow | null = null
const sessions = new Map<string, DesktopAgentSession>()
const allowedWorkspacePaths = new Set<string>()

function rendererUrl(): string {
  return `file://${join(__dirname, '../renderer/index.html').replace(/\\/g, '/')}`
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'ClaudeCode Local Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  void mainWindow.loadURL(rendererUrl())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function emitAgentEvent(event: DesktopAgentEvent): void {
  mainWindow?.webContents.send('desktop:agent-event', event)
}

function normalizeWorkspacePath(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function registerAllowedWorkspace(workspacePath: string): void {
  allowedWorkspacePaths.add(normalizeWorkspacePath(workspacePath))
}

function assertAllowedWorkspace(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath)
  if (!allowedWorkspacePaths.has(normalizeWorkspacePath(resolvedPath))) {
    throw new Error('Workspace must be selected before it can be used.')
  }
  return resolvedPath
}

function getAuthStatus(): DesktopAuthStatus {
  const tokenSource = getAuthTokenSource()
  const account = getOauthAccountInfo()
  const authenticated = tokenSource.hasToken || hasAnthropicApiKeyAuth()

  return {
    authenticated,
    method: authenticated ? tokenSource.source : 'none',
    email: account?.emailAddress ?? null,
    organizationName: account?.organizationName ?? null,
  }
}

async function getRuntimeStatus(): Promise<DesktopRuntimeStatus> {
  const agentExecutablePath = getAgentExecutablePath()
  try {
    const fileStat = await stat(agentExecutablePath)
    return {
      agentExecutablePath,
      agentExecutableExists: fileStat.isFile(),
    }
  } catch {
    return {
      agentExecutablePath,
      agentExecutableExists: false,
    }
  }
}

async function login(): Promise<DesktopAuthStatus> {
  const settings = getInitialSettings()
  const loginWithClaudeAi = settings.forceLoginMethod
    ? settings.forceLoginMethod === 'claudeai'
    : true
  const oauthService = new OAuthService()

  try {
    const tokens = await oauthService.startOAuthFlow(
      async (manualUrl, automaticUrl) => {
        await shell.openExternal(automaticUrl ?? manualUrl)
      },
      {
        loginWithClaudeAi,
        orgUUID: settings.forceLoginOrgUUID,
        skipBrowserOpen: true,
      },
    )
    await installDesktopOAuthTokens(tokens)

    const orgResult = await validateForceLoginOrg()
    if (!orgResult.valid) {
      throw new Error(orgResult.message)
    }

    saveGlobalConfig(current =>
      current.hasCompletedOnboarding
        ? current
        : { ...current, hasCompletedOnboarding: true },
    )
  } finally {
    oauthService.cleanup()
  }

  return getAuthStatus()
}

async function chooseWorkspace(): Promise<DesktopWorkspace | null> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Choose workspace',
    properties: ['openDirectory'],
  })
  const selected = result.filePaths[0]
  if (result.canceled || !selected) {
    return null
  }
  return openWorkspace(selected)
}

async function openWorkspace(workspacePath: string): Promise<DesktopWorkspace> {
  const resolvedWorkspace = resolve(workspacePath)
  const workspaceStat = await stat(resolvedWorkspace)
  if (!workspaceStat.isDirectory()) {
    throw new Error('Workspace path must be a directory.')
  }
  registerAllowedWorkspace(resolvedWorkspace)
  return workspaceFromPath(resolvedWorkspace)
}

function workspaceFromPath(workspacePath: string): DesktopWorkspace {
  return {
    path: workspacePath,
    name: basename(workspacePath),
  }
}

async function listWorkspaceFiles(
  workspacePath: string,
): Promise<DesktopFileEntry[]> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const entries: DesktopFileEntry[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3 || entries.length >= 300) {
      return
    }

    const children = await readdir(dir, { withFileTypes: true })
    for (const child of children) {
      if (child.isDirectory() && IGNORED_DIRECTORY_NAMES.has(child.name)) {
        continue
      }
      const childPath = join(dir, child.name)
      const entry: DesktopFileEntry = {
        name: child.name,
        path: childPath,
        type: child.isDirectory() ? 'directory' : 'file',
        depth,
      }
      entries.push(entry)
      if (child.isDirectory()) {
        await walk(childPath, depth + 1)
      }
      if (entries.length >= 300) {
        return
      }
    }
  }

  await walk(resolvedWorkspace, 0)
  return entries
}

async function readWorkspaceFile(
  workspacePath: string,
  filePath: string,
): Promise<DesktopFilePreview> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const resolvedFile = resolve(filePath)
  const workspacePrefix = resolvedWorkspace.endsWith(sep)
    ? resolvedWorkspace
    : `${resolvedWorkspace}${sep}`

  if (
    resolvedFile !== resolvedWorkspace &&
    !resolvedFile.startsWith(workspacePrefix)
  ) {
    throw new Error('File is outside the selected workspace.')
  }

  const fileStat = await stat(resolvedFile)
  if (!fileStat.isFile()) {
    throw new Error('Selected entry is not a file.')
  }

  const file = await open(resolvedFile, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(fileStat.size, MAX_FILE_PREVIEW_BYTES))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    const truncated = fileStat.size > MAX_FILE_PREVIEW_BYTES
    return {
      path: resolvedFile,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
      truncated,
    }
  } finally {
    await file.close()
  }
}

async function getWorkspaceDiff(
  workspacePath: string,
): Promise<DesktopDiffSummary> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  try {
    const [{ stdout: diffOutput }, { stdout: statusOutput }] =
      await Promise.all([
        execFileAsync('git', ['-C', resolvedWorkspace, 'diff', '--']),
        execFileAsync('git', [
          '-C',
          resolvedWorkspace,
          'status',
          '--short',
          '--untracked-files=all',
        ]),
      ])
    const status = statusOutput.trim()
    if (!diffOutput && !status) {
      return { patch: 'No file changes.' }
    }
    return {
      patch: [
        status ? `Git status:\n${status}` : null,
        diffOutput ? `Diff:\n${diffOutput}` : 'Diff:\nNo tracked file diff.',
      ]
        .filter(Boolean)
        .join('\n\n'),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { patch: `Unable to read git diff: ${message}` }
  }
}

async function createSession(
  options: CreateDesktopSessionOptions,
): Promise<CreateDesktopSessionResult> {
  const workspacePath = assertAllowedWorkspace(options.workspacePath)
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
    {
      agentExecutablePath: getAgentExecutablePath(),
    },
  )
  sessions.set(session.sessionId, session)
  session.on('event', event => {
    emitAgentEvent(event)
    if (event.type === 'done') {
      void getWorkspaceDiff(session.workspacePath).then(diff =>
        emitAgentEvent({
          type: 'diff',
          sessionId: session.sessionId,
          filePath: session.workspacePath,
          patch: diff.patch,
        }),
      )
    }
  })
  return { sessionId: session.sessionId }
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

async function sendUserMessage(sessionId: string, content: string): Promise<void> {
  const session = getSession(sessionId)
  await session.sendUserMessage(content)
}

async function respondToPermission(
  sessionId: string,
  requestId: string,
  decision: DesktopPermissionDecision,
): Promise<void> {
  const session = getSession(sessionId)
  await session.respondToPermission(requestId, decision)
}

async function interruptSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  await session.interrupt()
}

async function disposeSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId)
  sessions.delete(sessionId)
  await session.dispose()
}

function getSession(sessionId: string): DesktopAgentSession {
  const session = sessions.get(sessionId)
  if (!session) {
    throw new Error(`Unknown desktop session: ${sessionId}`)
  }
  return session
}

function registerIpc(): void {
  const handlers: Omit<DesktopApi, 'onAgentEvent'> = {
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus,
    login,
    chooseWorkspace,
    openWorkspace,
    listWorkspaceFiles,
    readWorkspaceFile,
    getWorkspaceDiff,
    createSession,
    sendUserMessage,
    respondToPermission,
    interruptSession,
    disposeSession,
  }

  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`desktop:${name}`, (_event, ...args: unknown[]) =>
      (handler as (...handlerArgs: unknown[]) => unknown)(...args),
    )
  }
}

registerIpc()

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
