import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} from 'electron'
import { execFile, spawn } from 'node:child_process'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  getAuthTokenSource,
  getOauthAccountInfo,
  hasAnthropicApiKeyAuth,
} from '@claudecode/core/utils/auth.js'
import { enableConfigs } from '@claudecode/core/utils/config.js'
import { getSettings_DEPRECATED } from '@claudecode/tui/utils/settings/settings.js'
import {
  fetchProviderBalance as fetchTuiProviderBalance,
  fetchProviderModels as fetchTuiProviderModels,
  getCachedProviderModels,
  getProviderConfig,
  getProviderApiKeySource,
  getSelectedProviderConfig,
  getSelectedProviderID,
  isModelProviderID,
  listProviderConfigs,
  saveProviderApiKey as saveTuiProviderApiKey,
  saveSelectedProvider,
} from '@claudecode/tui/utils/model/providerConfig.js'
import {
  getMainLoopModel,
  parseUserSpecifiedModel,
} from '@claudecode/tui/utils/model/model.js'
import { generateSessionTitle } from '@claudecode/tui/utils/sessionTitle.js'
import {
  createDesktopAgentSession,
  type DesktopAgentSession,
} from './agentSession.js'
import {
  getDesktopConfigDirectoryPath,
  getOpenAgentConfigHomeDir,
  readDesktopStoredSettings,
  saveDesktopStoredSettings,
} from './desktopSettings.js'
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
  DesktopApi,
  DesktopAuthStatus,
  DesktopDiffSummary,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopOpenTarget,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopProviderModelListResult,
  DesktopRuntimeStatus,
  DesktopSessionMetadataPatch,
  DesktopSessionSettingsSnapshot,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThinkingMode,
  DesktopUiCommand,
  DesktopWorkspace,
  ModelProviderID,
  SaveDesktopModelProviderOptions,
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
const STANDALONE_WORKSPACE_NAME = '无项目对话'
const STANDALONE_WORKSPACE_DIRECTORY_NAME = 'chat-workspace'
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
const DEFAULT_OPEN_TARGET: DesktopOpenTarget = {
  id: 'default-app',
  label: 'Default app',
  kind: 'default-app',
}
const BUILTIN_OPEN_TARGETS: DesktopOpenTarget[] = [
  DEFAULT_OPEN_TARGET,
  { id: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
  { id: 'terminal', label: 'Terminal', kind: 'terminal' },
]
const JETBRAINS_WINDOWS_PRODUCTS = [
  {
    label: 'IntelliJ IDEA',
    matches: ['intellij'],
    executables: ['idea64.exe', 'idea.exe'],
  },
  {
    label: 'PyCharm',
    matches: ['pycharm'],
    executables: ['pycharm64.exe', 'pycharm.exe'],
  },
  {
    label: 'WebStorm',
    matches: ['webstorm'],
    executables: ['webstorm64.exe', 'webstorm.exe'],
  },
  {
    label: 'PhpStorm',
    matches: ['phpstorm'],
    executables: ['phpstorm64.exe', 'phpstorm.exe'],
  },
  {
    label: 'RubyMine',
    matches: ['rubymine'],
    executables: ['rubymine64.exe', 'rubymine.exe'],
  },
  {
    label: 'CLion',
    matches: ['clion'],
    executables: ['clion64.exe', 'clion.exe'],
  },
  {
    label: 'GoLand',
    matches: ['goland'],
    executables: ['goland64.exe', 'goland.exe'],
  },
  {
    label: 'Rider',
    matches: ['rider'],
    executables: ['rider64.exe', 'rider.exe'],
  },
  {
    label: 'DataGrip',
    matches: ['datagrip'],
    executables: ['datagrip64.exe', 'datagrip.exe'],
  },
  {
    label: 'DataSpell',
    matches: ['dataspell'],
    executables: ['dataspell64.exe', 'dataspell.exe'],
  },
]

type DesktopSessionRecord = {
  session: DesktopAgentSession | null
  snapshot: DesktopSessionSnapshot
  resumeExistingSession: boolean
}

process.env.CLAUDE_CONFIG_DIR = getOpenAgentConfigHomeDir()

let mainWindow: BrowserWindow | null = null
const sessions = new Map<string, DesktopSessionRecord>()
const allowedWorkspacePaths = new Set<string>()
const titleGenerationStartedSessionIds = new Set<string>()
let activeSessionId: string | null = null
let sessionStoreLoadPromise: Promise<void> | null = null

function rendererUrl(): string {
  if (!app.isPackaged && process.env.CLAUDE_CODE_DESKTOP_RENDERER_URL) {
    return process.env.CLAUDE_CODE_DESKTOP_RENDERER_URL
  }
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    frame: false,
    title: 'ClaudeCode Local Desktop',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.setMenuBarVisibility(false)
  mainWindow.setAutoHideMenuBar(true)
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }
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

function minimizeWindow(): void {
  mainWindow?.minimize()
}

function toggleWindowMaximized(): boolean {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
    return false
  }
  mainWindow.maximize()
  return true
}

function closeWindow(): void {
  mainWindow?.close()
}

function isWindowMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false
}

function newWindow(): void {
  createWindow()
}

function openSettings(): void {
  mainWindow?.webContents.send('desktop:ui-command', 'openSettings')
}

function logOut(): void {
  mainWindow?.webContents.send('desktop:ui-command', 'logOut')
}

function exitApp(): void {
  app.quit()
}

function emitAgentEvent(event: DesktopAgentEvent): void {
  mainWindow?.webContents.send('desktop:agent-event', event)
}

function withDesktopMessageTimestamp(event: DesktopAgentEvent): DesktopAgentEvent {
  if (event.type !== 'message' && event.type !== 'partial_message') {
    return event
  }
  return event.createdAt ? event : { ...event, createdAt: new Date().toISOString() }
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
      runtimeKind: 'subprocess',
      agentExecutablePath,
      agentExecutableExists: fileStat.isFile(),
      configDirectoryPath: getOpenAgentConfigHomeDir(),
    }
  } catch {
    return {
      runtimeKind: 'subprocess',
      agentExecutablePath,
      agentExecutableExists: false,
      configDirectoryPath: getOpenAgentConfigHomeDir(),
    }
  }
}

async function listModelProviders(): Promise<DesktopModelProviderSummary[]> {
  const providers = await listProviderConfigs()
  return providers.map(provider => ({
    providerID: provider.providerID as ModelProviderID,
    kind: provider.kind,
    displayName: provider.displayName,
    baseURL: provider.baseURL,
    defaultModels: provider.defaultModels,
    modelMetadata: provider.modelMetadata,
    apiKeyConfigured: Boolean(
      getProviderApiKeySource(provider.providerID as ModelProviderID),
    ),
    envVars: provider.envVars,
    docURL: provider.docURL,
    logoURL: provider.logoURL,
    npmPackage: provider.npmPackage,
    modelsDevSource: provider.modelsDevSource,
    gatewaySource: provider.gatewaySource,
    requiresBaseURL: provider.requiresBaseURL,
  }))
}

async function getModelProviderState(
  providerIDOverride?: ModelProviderID,
): Promise<DesktopModelProviderState> {
  const settings = getSettings_DEPRECATED() || {}
  const selectedProviderID =
    providerIDOverride ?? (getSelectedProviderID() as ModelProviderID)
  const provider = await getProviderConfig(selectedProviderID)
  const savedSelectedProviderID = getSelectedProviderID() as ModelProviderID
  const selectedProvider =
    selectedProviderID === savedSelectedProviderID
      ? getSelectedProviderConfig()
      : provider
  const model = typeof settings.model === 'string' ? settings.model : ''
  const apiKeySource = getProviderApiKeySource(selectedProviderID) ?? null
  return {
    selectedProviderID,
    provider: {
      providerID: provider.providerID as ModelProviderID,
      kind: provider.kind,
      displayName: provider.displayName,
      baseURL: selectedProvider.baseURL ?? provider.baseURL,
      defaultModels: provider.defaultModels,
      modelMetadata: provider.modelMetadata,
      apiKeyConfigured: Boolean(apiKeySource),
      envVars: provider.envVars,
      docURL: provider.docURL,
      logoURL: provider.logoURL,
      npmPackage: provider.npmPackage,
      modelsDevSource: provider.modelsDevSource,
      gatewaySource: provider.gatewaySource,
      requiresBaseURL: provider.requiresBaseURL,
    },
    model,
    baseURL: selectedProvider.baseURL ?? provider.baseURL,
    apiKeyConfigured: Boolean(apiKeySource),
    apiKeySource,
    models: getCachedProviderModels(selectedProviderID) ?? provider.defaultModels,
    modelMetadata: provider.modelMetadata,
  }
}

async function fetchProviderModels(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<DesktopProviderModelListResult> {
  const providerID = normalizeProviderID(options.providerID)
  return fetchTuiProviderModels({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
}

async function fetchProviderBalance(options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}) {
  const providerID = normalizeProviderID(options.providerID)
  return fetchTuiProviderBalance({
    providerID,
    apiKey: normalizeOptionalText(options.apiKey),
    baseURL: normalizeOptionalText(options.baseURL),
  })
}

async function saveModelProvider(
  options: SaveDesktopModelProviderOptions,
): Promise<DesktopModelProviderState> {
  const providerID = normalizeProviderID(options.providerID)
  const modelID =
    typeof options.modelID === 'string' ? options.modelID.trim() : undefined
  const baseURL = normalizeOptionalText(options.baseURL)
  const provider = await getProviderConfig(providerID)
  saveSelectedProvider({
    providerID,
    modelID,
    baseURL,
  })
  const settings = await readDesktopStoredSettings()
  await saveDesktopStoredSettings({
    ...settings,
    providerID,
    providerBaseURL:
      provider.requiresBaseURL || providerID === 'custom' ? baseURL ?? '' : '',
    model: modelID ?? '',
  })
  return await getModelProviderState()
}

async function saveProviderApiKey(
  providerID: ModelProviderID,
  apiKey: string,
): Promise<DesktopModelProviderState> {
  const normalizedProviderID = normalizeProviderID(providerID)
  const normalizedApiKey = requireNonEmptyString(apiKey, 'Provider API key')
  const result = saveTuiProviderApiKey(normalizedProviderID, normalizedApiKey)
  if (!result.success) {
    throw new Error(result.warning ?? 'Failed to save provider API key.')
  }
  return await getModelProviderState(normalizedProviderID)
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

async function listOpenTargets(): Promise<DesktopOpenTarget[]> {
  const detectedTargets =
    process.platform === 'win32' ? await detectWindowsOpenTargets() : []
  const targets = dedupeOpenTargets([
    ...BUILTIN_OPEN_TARGETS,
    ...detectedTargets,
  ])
  return Promise.all(targets.map(target => addOpenTargetIcon(target)))
}

async function openPathWithDefaultTarget(targetPath: string): Promise<void> {
  const requestedPath = requireNonEmptyString(targetPath, 'Target path')
  const resolvedTarget = resolve(requestedPath)
  const targetStat = await stat(resolvedTarget)
  const target = await getSelectedOpenTarget()

  if (target.kind === 'file-explorer') {
    if (targetStat.isFile()) {
      shell.showItemInFolder(resolvedTarget)
      return
    }
    await openShellPath(resolvedTarget)
    return
  }

  if (target.kind === 'terminal') {
    await openTerminalAtPath(resolvedTarget, targetStat.isDirectory())
    return
  }

  if (target.kind === 'editor' && target.executablePath) {
    openPathInEditor(target.executablePath, resolvedTarget)
    return
  }

  await openShellPath(resolvedTarget)
}

async function workspaceFromPath(workspacePath: string): Promise<DesktopWorkspace> {
  const gitInfo = await getWorkspaceGitInfo(workspacePath)
  return {
    path: workspacePath,
    name: basename(workspacePath),
    branchName: gitInfo.branchName,
    branches: gitInfo.branches,
    isGitRepo: gitInfo.isGitRepo,
  }
}

async function getSelectedOpenTarget(): Promise<DesktopOpenTarget> {
  const settings = await readDesktopStoredSettings()
  const targets = await listOpenTargets()
  const selected = targets.find(target => target.id === settings.defaultOpenTargetId)
  if (selected) return selected

  if (settings.defaultOpenTargetId !== 'default-app') {
    await saveDesktopStoredSettings({
      ...settings,
      defaultOpenTargetId: 'default-app',
    })
  }
  return DEFAULT_OPEN_TARGET
}

async function addOpenTargetIcon(
  target: DesktopOpenTarget,
): Promise<DesktopOpenTarget> {
  if (!target.executablePath) return target
  try {
    const icon = await app.getFileIcon(target.executablePath, { size: 'normal' })
    return { ...target, iconDataUrl: icon.toDataURL() }
  } catch {
    return target
  }
}

function dedupeOpenTargets(targets: DesktopOpenTarget[]): DesktopOpenTarget[] {
  const seenIds = new Set<string>()
  const seenLabels = new Set<string>()
  const deduped: DesktopOpenTarget[] = []
  for (const target of targets) {
    const id = target.id.toLocaleLowerCase()
    const label = target.label.toLocaleLowerCase()
    if (seenIds.has(id) || (target.kind === 'editor' && seenLabels.has(label))) {
      continue
    }
    seenIds.add(id)
    seenLabels.add(label)
    deduped.push(target)
  }
  return deduped
}

async function detectWindowsOpenTargets(): Promise<DesktopOpenTarget[]> {
  const candidates: Array<{ label: string; executablePath: string }> = []
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.ProgramFiles
  const programFilesX86 = process.env['ProgramFiles(x86)']

  await appendFirstWhereCandidate(candidates, 'VS Code', ['code'], path =>
    resolveCommandBackedExecutable(path, 'Code.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'VS Code', [
    joinOptional(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    joinOptional(programFiles, 'Microsoft VS Code', 'Code.exe'),
    joinOptional(programFilesX86, 'Microsoft VS Code', 'Code.exe'),
  ])
  await appendFirstWhereCandidate(candidates, 'Cursor', ['cursor'], path =>
    resolveCommandBackedExecutable(path, 'Cursor.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'Cursor', [
    joinOptional(localAppData, 'Programs', 'Cursor', 'Cursor.exe'),
    joinOptional(programFiles, 'Cursor', 'Cursor.exe'),
    joinOptional(programFilesX86, 'Cursor', 'Cursor.exe'),
  ])
  await appendFirstWhereCandidate(candidates, 'Windsurf', ['windsurf'], path =>
    resolveCommandBackedExecutable(path, 'Windsurf.exe'),
  )
  await appendFirstExistingCandidate(candidates, 'Windsurf', [
    joinOptional(localAppData, 'Programs', 'Windsurf', 'Windsurf.exe'),
    joinOptional(programFiles, 'Windsurf', 'Windsurf.exe'),
    joinOptional(programFilesX86, 'Windsurf', 'Windsurf.exe'),
  ])
  await appendFirstExistingCandidate(candidates, 'Android Studio', [
    joinOptional(programFiles, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
    joinOptional(programFilesX86, 'Android', 'Android Studio', 'bin', 'studio64.exe'),
  ])

  candidates.push(...(await detectVisualStudioTargets()))
  candidates.push(...(await detectJetBrainsTargets()))

  return candidates.map(candidate => ({
    id: `app:${candidate.executablePath}`,
    label: candidate.label,
    kind: 'editor',
    executablePath: candidate.executablePath,
  }))
}

async function appendFirstExistingCandidate(
  candidates: Array<{ label: string; executablePath: string }>,
  label: string,
  executablePaths: Array<string | null>,
): Promise<void> {
  if (candidates.some(candidate => candidate.label === label)) {
    return
  }
  for (const executablePath of executablePaths) {
    if (executablePath && (await fileExists(executablePath))) {
      candidates.push({ label, executablePath })
      return
    }
  }
}

async function appendFirstWhereCandidate(
  candidates: Array<{ label: string; executablePath: string }>,
  label: string,
  commands: string[],
  resolveExecutablePath?: (commandPath: string) => string | null,
): Promise<void> {
  if (candidates.some(candidate => candidate.label === label)) {
    return
  }
  for (const command of commands) {
    const commandVariants = command.toLocaleLowerCase().endsWith('.exe')
      ? [command, command.slice(0, -4)]
      : [command]
    for (const commandPath of await findWindowsCommands(commandVariants)) {
      const executablePath = resolveExecutablePath?.(commandPath) ?? commandPath
      if (executablePath && (await fileExists(executablePath))) {
        candidates.push({ label, executablePath })
        return
      }
    }
  }
}

async function detectVisualStudioTargets(): Promise<
  Array<{ label: string; executablePath: string }>
> {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
    .map(root => joinOptional(root, 'Microsoft Visual Studio'))
    .filter((root): root is string => Boolean(root))

  for (const root of roots) {
    const yearEntries = (await readDirectoryEntries(root))
      .filter(entry => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name))
    for (const yearEntry of yearEntries) {
      const yearPath = join(root, yearEntry.name)
      const editionEntries = (await readDirectoryEntries(yearPath)).filter(entry =>
        entry.isDirectory(),
      )
      for (const editionEntry of editionEntries) {
        const executablePath = join(
          yearPath,
          editionEntry.name,
          'Common7',
          'IDE',
          'devenv.exe',
        )
        if (await fileExists(executablePath)) {
          return [{ label: 'Visual Studio', executablePath }]
        }
      }
    }
  }
  return []
}

async function detectJetBrainsTargets(): Promise<
  Array<{ label: string; executablePath: string }>
> {
  const roots = [
    joinOptional(process.env.LOCALAPPDATA, 'Programs', 'JetBrains'),
    joinOptional(process.env.ProgramFiles, 'JetBrains'),
    joinOptional(process.env['ProgramFiles(x86)'], 'JetBrains'),
  ]
    .filter((root): root is string => Boolean(root))
  const targets: Array<{ label: string; executablePath: string }> = []

  for (const product of JETBRAINS_WINDOWS_PRODUCTS) {
    await appendFirstWhereCandidate(
      targets,
      product.label,
      product.executables,
    )
    for (const root of roots) {
      const productEntries = (await readDirectoryEntries(root))
        .filter(entry => entry.isDirectory())
        .sort((left, right) => right.name.localeCompare(left.name))
      for (const productEntry of productEntries) {
        const normalizedName = productEntry.name.toLocaleLowerCase()
        if (!product.matches.some(match => normalizedName.includes(match))) {
          continue
        }
        for (const executable of product.executables) {
          const executablePath = join(root, productEntry.name, 'bin', executable)
          if (await fileExists(executablePath)) {
            targets.push({ label: product.label, executablePath })
            break
          }
        }
        if (targets.some(target => target.label === product.label)) {
          break
        }
      }
      if (targets.some(target => target.label === product.label)) {
        break
      }
    }
  }
  return targets
}

async function findWindowsCommands(commands: string[]): Promise<string[]> {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const command of commands) {
    for (const commandPath of await findWindowsCommand(command)) {
      const key = commandPath.toLocaleLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        paths.push(commandPath)
      }
    }
  }
  return paths
}

async function findWindowsCommand(command: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('where.exe', [command])
    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function resolveCommandBackedExecutable(
  commandPath: string,
  executableName: string,
): string | null {
  const binDirectory = dirname(commandPath)
  const appDirectory = dirname(binDirectory)
  return join(appDirectory, executableName)
}


function joinOptional(
  root: string | undefined,
  ...segments: string[]
): string | null {
  if (!root) return null
  return join(root, ...segments)
}

async function fileExists(path: string | null): Promise<boolean> {
  if (!path) return false
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function readDirectoryEntries(path: string) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

async function openShellPath(targetPath: string): Promise<void> {
  const error = await shell.openPath(targetPath)
  if (error) {
    throw new Error(error)
  }
}

async function openTerminalAtPath(
  targetPath: string,
  targetIsDirectory: boolean,
): Promise<void> {
  const cwd = targetIsDirectory ? targetPath : dirname(targetPath)
  if (process.platform === 'win32') {
    const child = spawn(
      'cmd.exe',
      [
        '/c',
        'start',
        '',
        'powershell.exe',
        '-NoExit',
        '-Command',
        `Set-Location -LiteralPath ${quotePowerShellPath(cwd)}`,
      ],
      { cwd, detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.unref()
    return
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', 'Terminal', cwd])
    return
  }
  const child = spawn('x-terminal-emulator', [], {
    cwd,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function quotePowerShellPath(targetPath: string): string {
  return `'${targetPath.replace(/'/g, "''")}'`
}

function openPathInEditor(executablePath: string, targetPath: string): void {
  const child = spawn(executablePath, [targetPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {})
  child.unref()
}

async function getStandaloneWorkspace(): Promise<DesktopWorkspace> {
  const workspacePath = join(
    getDesktopConfigDirectoryPath(),
    STANDALONE_WORKSPACE_DIRECTORY_NAME,
  )
  await mkdir(workspacePath, { recursive: true })
  return {
    path: workspacePath,
    name: STANDALONE_WORKSPACE_NAME,
    branchName: null,
    isGitRepo: false,
    isStandalone: true,
  }
}

async function getWorkspaceContext(workspacePath: string): Promise<DesktopWorkspace> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  return workspaceFromPath(resolvedWorkspace)
}

async function checkoutWorkspaceBranch(
  workspacePath: string,
  branchName: string,
): Promise<DesktopWorkspace> {
  const resolvedWorkspace = assertAllowedWorkspace(workspacePath)
  const trimmedBranch = branchName.trim()
  if (!trimmedBranch) {
    throw new Error('branchName cannot be empty.')
  }
  await execFileAsync('git', ['-C', resolvedWorkspace, 'checkout', trimmedBranch])
  return getWorkspaceContext(resolvedWorkspace)
}

async function getWorkspaceGitInfo(
  workspacePath: string,
): Promise<{ branchName: string | null; branches: string[]; isGitRepo: boolean }> {
  try {
    const { stdout: gitRoot } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'rev-parse',
      '--show-toplevel',
    ])
    const normalizedRoot = resolve(gitRoot.trim())
    const branches = await listWorkspaceBranches(workspacePath)
    if (normalizedRoot !== resolve(workspacePath)) {
      return {
        branchName: await readGitBranchName(workspacePath),
        branches,
        isGitRepo: true,
      }
    }
    return {
      branchName: await readGitBranchName(workspacePath),
      branches,
      isGitRepo: true,
    }
  } catch {
    return { branchName: null, branches: [], isGitRepo: false }
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

async function listWorkspaceBranches(
  workspacePath: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      workspacePath,
      'branch',
      '--format=%(refname:short)',
      '--sort=-committerdate',
    ])
    return stdout
      .split(/\r?\n/)
      .map(branch => branch.trim())
      .filter(Boolean)
      .filter((branch, index, branches) => branches.indexOf(branch) === index)
  } catch {
    return []
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
    const currentRecord = sessions.get(session.sessionId)
    if (!currentRecord || currentRecord.session !== session) {
      return
    }
    const timestampedEvent = withDesktopMessageTimestamp(event)
    currentRecord.snapshot = applyDesktopAgentEventToSnapshot(
      currentRecord.snapshot,
      timestampedEvent,
    )
    persistSessionStore()
    emitAgentEvent(timestampedEvent)
    if (
      !currentRecord.snapshot.item.standalone &&
      (timestampedEvent.type === 'done' || timestampedEvent.type === 'error')
    ) {
      void getWorkspaceDiff(session.workspacePath).then(diff => {
        const latestRecord = sessions.get(session.sessionId)
        if (!latestRecord || latestRecord.session !== session) {
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
    {
      agentExecutablePath: getAgentExecutablePath(),
      configDirectoryPath: getOpenAgentConfigHomeDir(),
    },
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
    {
      agentExecutablePath: getAgentExecutablePath(),
      configDirectoryPath: getOpenAgentConfigHomeDir(),
    },
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

function normalizeProviderID(providerID: ModelProviderID): ModelProviderID {
  if (!providerID || !isModelProviderID(providerID)) {
    throw new Error(`Unsupported model provider: ${providerID}`)
  }
  return providerID
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
  const trimmedContent = requireNonEmptyString(
    content,
    'Desktop user message',
  )
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
  await session.sendUserMessage(trimmedContent)
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
    emitAgentEvent(event)
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
  const handlers: Omit<DesktopApi, 'onAgentEvent' | 'onUiCommand'> = {
    getAuthStatus: async () => getAuthStatus(),
    getRuntimeStatus,
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
    minimizeWindow: async () => minimizeWindow(),
    toggleWindowMaximized: async () => toggleWindowMaximized(),
    closeWindow: async () => closeWindow(),
    isWindowMaximized: async () => isWindowMaximized(),
    newWindow: async () => newWindow(),
    openSettings: async () => openSettings(),
    logOut: async () => logOut(),
    exitApp: async () => exitApp(),
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
