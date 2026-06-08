import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopAgentEvent,
  DesktopApi,
  DesktopAuthStatus,
  DesktopPermissionDecision,
  DesktopWorkspace,
} from '../shared/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let mainWindow: BrowserWindow | null = null

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
  return {
    authenticated: false,
    method: 'none',
    email: null,
    organizationName: null,
  }
}

async function login(): Promise<DesktopAuthStatus> {
  await shell.openExternal('https://claude.ai/login')
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

async function createSession(
  options: CreateDesktopSessionOptions,
): Promise<CreateDesktopSessionResult> {
  const sessionId = crypto.randomUUID()
  emitAgentEvent({
    type: 'status',
    sessionId,
    status: 'idle',
  })
  emitAgentEvent({
    type: 'message',
    sessionId,
    role: 'system',
    text: `Workspace attached: ${options.workspacePath}`,
  })
  return { sessionId }
}

async function sendUserMessage(sessionId: string, content: string): Promise<void> {
  emitAgentEvent({
    type: 'message',
    sessionId,
    role: 'user',
    text: content,
  })
  emitAgentEvent({
    type: 'status',
    sessionId,
    status: 'running',
  })
  emitAgentEvent({
    type: 'message',
    sessionId,
    role: 'assistant',
    text: 'Desktop agent runtime is not connected yet. The Electron shell is ready for the in-process agent bridge.',
  })
  emitAgentEvent({
    type: 'done',
    sessionId,
  })
}

async function respondToPermission(
  _sessionId: string,
  _requestId: string,
  _decision: DesktopPermissionDecision,
): Promise<void> {}

async function interruptSession(sessionId: string): Promise<void> {
  emitAgentEvent({
    type: 'status',
    sessionId,
    status: 'done',
  })
}

async function disposeSession(sessionId: string): Promise<void> {
  emitAgentEvent({
    type: 'done',
    sessionId,
  })
}

function registerIpc(): void {
  const handlers: Omit<DesktopApi, 'onAgentEvent'> = {
    getAuthStatus: async () => getAuthStatus(),
    login,
    chooseWorkspace,
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
