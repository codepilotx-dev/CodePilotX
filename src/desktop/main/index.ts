import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
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
  DesktopPermissionDecision,
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

function rendererUrl(): string {
  return `file://${join(__dirname, '../renderer/index.html').replace(/\\/g, '/')}`
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
  return {
    path: selected,
    name: basename(selected),
  }
}

async function listWorkspaceFiles(
  workspacePath: string,
): Promise<DesktopFileEntry[]> {
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

  await walk(workspacePath, 0)
  return entries
}

async function getWorkspaceDiff(
  workspacePath: string,
): Promise<DesktopDiffSummary> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', workspacePath, 'diff', '--'])
    return { patch: stdout || 'No file changes.' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { patch: `Unable to read git diff: ${message}` }
  }
}

async function createSession(
  options: CreateDesktopSessionOptions,
): Promise<CreateDesktopSessionResult> {
  const session = createDesktopAgentSession(options)
  sessions.set(session.sessionId, session)
  session.on('event', emitAgentEvent)
  return { sessionId: session.sessionId }
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
    login,
    chooseWorkspace,
    listWorkspaceFiles,
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
