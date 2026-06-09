import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} from 'electron'
import { execFile } from 'node:child_process'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { fetchAndStoreClaudeCodeFirstTokenDate } from '@claudecode/core/services/api/firstTokenDate.js'
import {
  createAndStoreApiKey,
  fetchAndStoreUserRoles,
  shouldUseClaudeAIAuth,
  storeOAuthAccountInfo,
} from '@claudecode/core/services/oauth/client.js'
import { getOauthProfileFromOauthToken } from '@claudecode/core/services/oauth/getOauthProfile.js'
import { OAuthService } from '@claudecode/core/services/oauth/index.js'
import type { OAuthTokens } from '@claudecode/core/services/oauth/types.js'
import {
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
} from '@claudecode/core/utils/auth.js'
import { enableConfigs, saveGlobalConfig } from '@claudecode/core/utils/config.js'
import { getInitialSettings } from '@claudecode/core/utils/settings/settings.js'
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
  DesktopUiCommand,
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

let mainWindow: BrowserWindow | null = null
const sessions = new Map<string, DesktopAgentSession>()
const allowedWorkspacePaths = new Set<string>()

function rendererUrl(): string {
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

function assertTrustedIpcSender(senderUrl: string | undefined): void {
  if (senderUrl !== rendererUrl()) {
    throw new Error('Rejected desktop IPC call from an untrusted renderer.')
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
      sandbox: true,
    },
  })

  mainWindow.setMenuBarVisibility(true)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl()) {
      event.preventDefault()
    }
  })

  void mainWindow.loadURL(rendererUrl())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function sendUiCommand(command: DesktopUiCommand): void {
  mainWindow?.webContents.send('desktop:ui-command', command)
}

function createApplicationMenu(): void {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendUiCommand('newConversation'),
        },
        {
          label: '选择项目',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendUiCommand('chooseWorkspace'),
        },
        {
          label: '刷新项目',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendUiCommand('refreshWorkspace'),
        },
        { type: 'separator' as const },
        { role: 'close' as const, label: '关闭窗口' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' as const, label: '撤销' },
        { role: 'redo' as const, label: '重做' },
        { type: 'separator' as const },
        { role: 'cut' as const, label: '剪切' },
        { role: 'copy' as const, label: '复制' },
        { role: 'paste' as const, label: '粘贴' },
        { role: 'selectAll' as const, label: '全选' },
      ],
    },
    {
      label: '查看',
      submenu: [
        { role: 'reload' as const, label: '重新加载' },
        { role: 'forceReload' as const, label: '强制重新加载' },
        { role: 'toggleDevTools' as const, label: '开发者工具' },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, label: '实际大小' },
        { role: 'zoomIn' as const, label: '放大' },
        { role: 'zoomOut' as const, label: '缩小' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const, label: '切换全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' as const, label: '最小化' },
        { role: 'zoom' as const, label: '缩放' },
        { role: 'front' as const, label: '前置全部窗口' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: 'ClaudeCode 本地开发说明',
          click: () => {
            void shell.openExternal(
              'https://github.com/anthropics/claude-code',
            )
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
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

async function workspaceFromPath(workspacePath: string): Promise<DesktopWorkspace> {
  const gitInfo = await getWorkspaceGitInfo(workspacePath)
  return {
    path: workspacePath,
    name: basename(workspacePath),
    branchName: gitInfo.branchName,
    isGitRepo: gitInfo.isGitRepo,
  }
}

async function getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  return workspaceFromPath(resolvedWorkspace)
}

async function getWorkspaceGitInfo(
  workspacePath: string,
): Promise<{ branchName: string | null; isGitRepo: boolean }> {
  try {
    const { stdout: gitRoot } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'rev-parse',
      '--show-toplevel',
    ])
    const normalizedRoot = resolve(gitRoot.trim())
    if (normalizedRoot !== resolve(workspacePath)) {
      return {
        branchName: await readGitBranchName(workspacePath),
        isGitRepo: true,
      }
    }
    return {
      branchName: await readGitBranchName(workspacePath),
      isGitRepo: true,
    }
  } catch {
    return { branchName: null, isGitRepo: false }
  }
}

async function readGitBranchName(workspacePath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'branch',
      '--show-current',
    ])
    const branchName = stdout.trim()
    return branchName || null
  } catch {
    return null
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

    const children = (await readdir(dir, { withFileTypes: true })).sort(
      (left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1
        }
        return left.name.localeCompare(right.name)
      },
    )
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
  if (!options || typeof options !== 'object') {
    throw new Error('Desktop session options must be an object.')
  }
  const workspacePath = assertAllowedWorkspace(
    requireNonEmptyString(options.workspacePath, 'Desktop workspace path'),
  )
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
    if (sessions.get(session.sessionId) !== session) {
      return
    }
    emitAgentEvent(event)
    if (event.type === 'done' || event.type === 'error') {
      void getWorkspaceDiff(session.workspacePath).then(diff => {
        if (sessions.get(session.sessionId) !== session) {
          return
        }
        emitAgentEvent({
          type: 'diff',
          sessionId: session.sessionId,
          filePath: session.workspacePath,
          patch: diff.patch,
        })
      })
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
  const trimmedContent = requireNonEmptyString(
    content,
    'Desktop user message',
  )
  const session = getSession(sessionId)
  await session.sendUserMessage(trimmedContent)
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
  const session = getSession(sessionId)
  await session.respondToPermission(normalizedRequestId, decision)
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

function disposeAllSessions(): void {
  for (const [sessionId, session] of sessions) {
    sessions.delete(sessionId)
    void session.dispose()
  }
}

function getSession(sessionId: string): DesktopAgentSession {
  const normalizedSessionId = requireNonEmptyString(
    sessionId,
    'Desktop session id',
  )
  const session = sessions.get(normalizedSessionId)
  if (!session) {
    throw new Error(`Unknown desktop session: ${normalizedSessionId}`)
  }
  return session
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
  const handlers: Omit<DesktopApi, 'onAgentEvent' | 'onUiCommand'> = {
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus,
    login,
    chooseWorkspace,
    openWorkspace,
    getWorkspaceContext,
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
    ipcMain.handle(`desktop:${name}`, (event, ...args: unknown[]) => {
      assertTrustedIpcSender(event.senderFrame?.url)
      return (handler as (...handlerArgs: unknown[]) => unknown)(...args)
    })
  }
}

enableConfigs()
registerIpc()

app.whenReady().then(() => {
  createApplicationMenu()
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

app.on('before-quit', () => {
  disposeAllSessions()
})
