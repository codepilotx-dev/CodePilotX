import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import type { Display, Rectangle } from 'electron'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { normalizeThreadEvent } from '@codepilotx/core/agent/workflow.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionDecision,
  DesktopPermissionRequest,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopUiCommand,
  DesktopWorkflowEvent,
} from '../shared/types.js'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
} from '../shared/ipcChannels.js'
import { getDesktopConfigDirectoryPath } from './desktopSettings.js'
import { isDevToolsShortcut } from './desktopDevToolsShortcut.js'
import { DesktopWorkflowProjector } from './workflowProjection.js'
import { createWindowRegistry } from './windowRegistry.js'

const DEFAULT_WINDOW_WIDTH = 1440
const DEFAULT_WINDOW_HEIGHT = 920
const MIN_WINDOW_WIDTH = 1080
const MIN_WINDOW_HEIGHT = 720
const WINDOW_STATE_FILE_NAME = 'window-state.json'
const WINDOW_STATE_SAVE_DELAY_MS = 250

type DesktopWindowState = {
  bounds: Rectangle
  displayId: number
  maximized: boolean
}

type RestoredWindowState = {
  bounds: Partial<Rectangle> & Pick<Rectangle, 'width' | 'height'>
  maximized: boolean
}

export type DesktopWindowService = {
  createWindow(): void
  createApplicationMenu(): void
  getWindow(): BrowserWindow | null
  hasOpenWindows(): boolean
  emitAgentEvent(event: DesktopAgentEvent): DesktopWorkflowEvent[]
  emitWorkflowEvent(event: DesktopWorkflowEvent): DesktopWorkflowEvent
  emitSessionStoreChange(change: DesktopSessionStoreChange): void
  emitSettingsChange(change: DesktopSettingsChange): void
  emitPermissionDecision(
    sessionId: string,
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): DesktopWorkflowEvent[]
  readWorkflowEventLog(): Promise<DesktopWorkflowEvent[]>
  sendUiCommand(command: DesktopUiCommand): void
  minimizeWindow(): void
  toggleWindowMaximized(): boolean
  closeWindow(): void
  isWindowMaximized(): boolean
  newWindow(): void
  openDevTools(): void
  closeDevTools(): void
  openSettings(): void
  logOut(): void
  exitApp(): void
}

	export function createDesktopWindowService(options: {
	  iconPath: () => string | undefined
	  rendererUrl: () => string
	  preloadPath: () => string
	  emitDesktopEvent?: (channel: string, payload: unknown) => void
	  appName?: string
	  debugEnabled?: boolean
	}): DesktopWindowService {
  const windows = createWindowRegistry<BrowserWindow>()
  let lastFocusedWindow: BrowserWindow | null = null
  let windowStateSaveTimer: ReturnType<typeof setTimeout> | null = null
  const workflowProjector = new DesktopWorkflowProjector()

  function createWindow(): void {
    const restoredWindowState = getRestoredWindowState()
    const icon = options.iconPath()
	    const window = new BrowserWindow({
	      ...restoredWindowState.bounds,
	      minWidth: MIN_WINDOW_WIDTH,
	      minHeight: MIN_WINDOW_HEIGHT,
	      frame: false,
	      show: false,
	      backgroundColor: '#ffffff',
	      title: options.appName ?? 'CodePilotX Dev',
	      ...(icon ? { icon } : {}),
      webPreferences: {
        preload: options.preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })

    if (restoredWindowState.maximized) {
      window.maximize()
    }
    windows.add(window)
    lastFocusedWindow = window
    window.setMenuBarVisibility(false)
    window.setAutoHideMenuBar(true)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== options.rendererUrl()) {
        event.preventDefault()
      }
    })
	    window.webContents.on('before-input-event', (event, input) => {
	      if (!isDevToolsShortcut(input)) return
	      event.preventDefault()
	      if (options.debugEnabled !== false) {
	        openDevTools()
	      }
	    })
    window.on('focus', () => {
      lastFocusedWindow = window
    })

    let rendererReady = false
    let rendererLoaded = false
    const showWhenReady = (): void => {
      if (rendererReady && rendererLoaded && !window.isDestroyed()) {
        window.show()
      }
    }
    window.once('ready-to-show', () => {
      rendererReady = true
      showWhenReady()
    })
    void window.loadURL(options.rendererUrl()).then(() => {
      rendererLoaded = true
      showWhenReady()
    }).catch(error => {
      console.error('Failed to load desktop renderer.', error)
    })
    registerWindowStatePersistence(window)
    window.on('closed', () => {
      windows.delete(window)
      if (lastFocusedWindow === window) {
        lastFocusedWindow = windows.all().at(-1) ?? null
      }
    })
  }

  function sendUiCommand(command: DesktopUiCommand): void {
    getTargetWindow()?.webContents.send(DESKTOP_UI_COMMAND_CHANNEL, command)
    options.emitDesktopEvent?.(DESKTOP_UI_COMMAND_CHANNEL, command)
  }

	  function createApplicationMenu(): void {
	    const appName = options.appName ?? 'CodePilotX Dev'
	    const debugEnabled = options.debugEnabled !== false
	    const windowSubmenu: Electron.MenuItemConstructorOptions[] = [
	      { role: 'minimize' as const, label: 'Minimize' },
	      { role: 'zoom' as const, label: 'Zoom' },
	      { role: 'front' as const, label: 'Bring All to Front' },
	    ]
	    if (debugEnabled) {
	      windowSubmenu.push(
	        { type: 'separator' as const },
	        { label: '调试...', click: () => openDevTools() },
	      )
	    }
	    const template: Electron.MenuItemConstructorOptions[] = [
	      {
	        label: 'File',
	        submenu: [
	          {
	            label: 'New Conversation',
	            accelerator: 'CmdOrCtrl+N',
	            click: () => sendUiCommand('newConversation'),
	          },
	          {
	            label: 'Choose Workspace',
	            accelerator: 'CmdOrCtrl+O',
	            click: () => sendUiCommand('chooseWorkspace'),
	          },
	          {
	            label: 'Refresh Workspace',
	            accelerator: 'CmdOrCtrl+R',
	            click: () => sendUiCommand('refreshWorkspace'),
	          },
	          { type: 'separator' as const },
	          { role: 'close' as const, label: 'Close Window' },
	        ],
	      },
	      {
	        label: 'Edit',
	        submenu: [
	          { role: 'undo' as const, label: 'Undo' },
	          { role: 'redo' as const, label: 'Redo' },
	          { type: 'separator' as const },
	          { role: 'cut' as const, label: 'Cut' },
	          { role: 'copy' as const, label: 'Copy' },
	          { role: 'paste' as const, label: 'Paste' },
	          { role: 'selectAll' as const, label: 'Select All' },
	        ],
	      },
	      {
	        label: 'View',
	        submenu: [
	          { role: 'reload' as const, label: 'Reload' },
	          { role: 'forceReload' as const, label: 'Force Reload' },
	          { role: 'resetZoom' as const, label: 'Actual Size' },
	          { role: 'zoomIn' as const, label: 'Zoom In' },
	          { role: 'zoomOut' as const, label: 'Zoom Out' },
	          { type: 'separator' as const },
	          { role: 'togglefullscreen' as const, label: 'Toggle Full Screen' },
	        ],
	      },
	      {
	        label: 'Window',
	        submenu: windowSubmenu,
	      },
	      {
	        label: 'Help',
	        submenu: [
	          {
	            label: appName,
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
    getTargetWindow()?.minimize()
  }

  function toggleWindowMaximized(): boolean {
    const window = getTargetWindow()
    if (!window) return false
    if (window.isMaximized()) {
      window.unmaximize()
      return false
    }
    window.maximize()
    return true
  }

  function closeWindow(): void {
    getTargetWindow()?.close()
  }

  function isWindowMaximized(): boolean {
    return getTargetWindow()?.isMaximized() ?? false
  }

  function newWindow(): void {
    createWindow()
  }

	  function openDevTools(): void {
	    if (options.debugEnabled === false) return
	    getTargetWindow()?.webContents.openDevTools()
	  }

	  function closeDevTools(): void {
	    if (options.debugEnabled === false) return
	    getTargetWindow()?.webContents.closeDevTools()
	  }

  function openSettings(): void {
    sendUiCommand('openSettings')
  }

  function logOut(): void {
    sendUiCommand('logOut')
  }

  function exitApp(): void {
    app.quit()
  }

  function emitAgentEvent(event: DesktopAgentEvent): DesktopWorkflowEvent[] {
    windows.broadcast(DESKTOP_AGENT_EVENT_CHANNEL, event)
    options.emitDesktopEvent?.(DESKTOP_AGENT_EVENT_CHANNEL, event)
    return workflowProjector.project(event).map(emitWorkflowEvent)
  }

  function emitWorkflowEvent(event: DesktopWorkflowEvent): DesktopWorkflowEvent {
    windows.broadcast(DESKTOP_WORKFLOW_EVENT_CHANNEL, event)
    options.emitDesktopEvent?.(DESKTOP_WORKFLOW_EVENT_CHANNEL, event)
    appendWorkflowEventLog(event)
    return event
  }

  function emitSessionStoreChange(change: DesktopSessionStoreChange): void {
    windows.broadcast(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, change)
    options.emitDesktopEvent?.(DESKTOP_SESSION_STORE_CHANGE_CHANNEL, change)
  }

  function emitSettingsChange(change: DesktopSettingsChange): void {
    windows.broadcast(DESKTOP_SETTINGS_CHANGE_CHANNEL, change)
    options.emitDesktopEvent?.(DESKTOP_SETTINGS_CHANGE_CHANNEL, change)
  }

  function emitPermissionDecision(
    sessionId: string,
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ): DesktopWorkflowEvent[] {
    return workflowProjector
      .projectPermissionDecision(sessionId, request, decision)
      .map(emitWorkflowEvent)
  }

  async function readWorkflowEventLog(): Promise<DesktopWorkflowEvent[]> {
    try {
      const logPath = workflowEventLogPath()
      const raw = readFileSync(logPath, 'utf8')
      return raw
        .split(/\r?\n/)
        .flatMap(line => {
          if (!line.trim()) return []
          try {
            const parsed = JSON.parse(line) as DesktopWorkflowEvent
            return isWorkflowEventLike(parsed)
              ? [normalizeThreadEvent(parsed)]
              : []
          } catch {
            return []
          }
        })
    } catch {
      return []
    }
  }

  function appendWorkflowEventLog(event: DesktopWorkflowEvent): void {
    if (process.env.CODEPILOTX_WORKFLOW_EVENT_LOG !== '1') {
      return
    }
    try {
      const logPath = workflowEventLogPath()
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${JSON.stringify(event)}\n`, 'utf8')
    } catch {
      // Debug logging must not affect the agent event stream.
    }
  }

  function workflowEventLogPath(): string {
    return join(getDesktopConfigDirectoryPath(), 'workflow-events.jsonl')
  }

  function registerWindowStatePersistence(window: BrowserWindow): void {
    const scheduleSave = (): void => scheduleWindowStateSave(window)
    window.on('resize', scheduleSave)
    window.on('move', scheduleSave)
    window.on('maximize', scheduleSave)
    window.on('unmaximize', scheduleSave)
    window.on('close', () => saveWindowStateImmediately(window))
  }

  function scheduleWindowStateSave(window: BrowserWindow): void {
    const state = getCurrentWindowState(window)
    if (!state) return
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer)
    }
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null
      writeDesktopWindowState(state)
    }, WINDOW_STATE_SAVE_DELAY_MS)
  }

  function saveWindowStateImmediately(window: BrowserWindow): void {
    const state = getCurrentWindowState(window)
    if (!state) return
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer)
      windowStateSaveTimer = null
    }
    writeDesktopWindowState(state)
  }

  return {
    createWindow,
    createApplicationMenu,
    getWindow: getTargetWindow,
    hasOpenWindows: () => BrowserWindow.getAllWindows().length > 0,
    emitAgentEvent,
    emitWorkflowEvent,
    emitSessionStoreChange,
    emitSettingsChange,
    emitPermissionDecision,
    readWorkflowEventLog,
    sendUiCommand,
    minimizeWindow,
    toggleWindowMaximized,
    closeWindow,
    isWindowMaximized,
    newWindow,
    openDevTools,
    closeDevTools,
    openSettings,
    logOut,
    exitApp,
  }

  function getTargetWindow(): BrowserWindow | null {
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && !focused.isDestroyed()) {
      lastFocusedWindow = focused
      return focused
    }
    if (lastFocusedWindow && !lastFocusedWindow.isDestroyed()) {
      return lastFocusedWindow
    }
    return windows.all().at(-1) ?? null
  }
}

function getRestoredWindowState(): RestoredWindowState {
  const savedState = readDesktopWindowState()
  if (!savedState) {
    return {
      bounds: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
      },
      maximized: false,
    }
  }

  const targetDisplay = getRestoreTargetDisplay(savedState)
  return {
    bounds: clampBoundsToWorkArea(savedState.bounds, targetDisplay.workArea),
    maximized: savedState.maximized,
  }
}

function getRestoreTargetDisplay(state: DesktopWindowState): Display {
  const savedDisplay = screen
    .getAllDisplays()
    .find(display => display.id === state.displayId)
  if (savedDisplay) return savedDisplay
  if (windowBoundsOverlapAnyDisplay(state.bounds)) {
    return screen.getDisplayMatching(state.bounds)
  }
  return screen.getPrimaryDisplay()
}

function getCurrentWindowState(
  window: BrowserWindow,
): DesktopWindowState | null {
  if (window.isDestroyed()) return null
  const bounds = window.getNormalBounds()
  if (!isValidBounds(bounds)) return null
  return {
    bounds,
    displayId: screen.getDisplayMatching(bounds).id,
    maximized: window.isMaximized(),
  }
}

function readDesktopWindowState(): DesktopWindowState | null {
  try {
    return normalizeDesktopWindowState(
      JSON.parse(readFileSync(getDesktopWindowStatePath(), 'utf8')),
    )
  } catch {
    return null
  }
}

function writeDesktopWindowState(state: DesktopWindowState): void {
  const statePath = getDesktopWindowStatePath()
  try {
    mkdirSync(dirname(statePath), { recursive: true })
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.error('Failed to save desktop window state.', error)
  }
}

function getDesktopWindowStatePath(): string {
  return join(getDesktopConfigDirectoryPath(), WINDOW_STATE_FILE_NAME)
}

function isWorkflowEventLike(value: unknown): value is DesktopWorkflowEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<DesktopWorkflowEvent>
  return (
    typeof event.threadId === 'string' &&
    typeof event.createdAt === 'string' &&
    (event.type === 'thread.started' ||
      event.type === 'turn.started' ||
      event.type === 'item.started' ||
      event.type === 'item.updated' ||
      event.type === 'item.completed' ||
      event.type === 'turn.completed' ||
      event.type === 'turn.failed' ||
      event.type === 'turn.interrupted')
  )
}

function normalizeDesktopWindowState(value: unknown): DesktopWindowState | null {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Partial<DesktopWindowState>
  if (
    typeof parsed.displayId !== 'number' ||
    typeof parsed.maximized !== 'boolean' ||
    !isValidBounds(parsed.bounds)
  ) {
    return null
  }
  return {
    bounds: {
      x: Math.round(parsed.bounds.x),
      y: Math.round(parsed.bounds.y),
      width: Math.round(parsed.bounds.width),
      height: Math.round(parsed.bounds.height),
    },
    displayId: parsed.displayId,
    maximized: parsed.maximized,
  }
}

function isValidBounds(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false
  const bounds = value as Partial<Rectangle>
  return (
    isFiniteNumber(bounds.x) &&
    isFiniteNumber(bounds.y) &&
    isFiniteNumber(bounds.width) &&
    isFiniteNumber(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  )
}

function windowBoundsOverlapAnyDisplay(bounds: Rectangle): boolean {
  return screen
    .getAllDisplays()
    .some(display => rectanglesOverlap(bounds, display.workArea))
}

function rectanglesOverlap(first: Rectangle, second: Rectangle): boolean {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  )
}

function clampBoundsToWorkArea(
  bounds: Rectangle,
  workArea: Rectangle,
): Rectangle {
  const width = clampDimension(
    Math.round(bounds.width),
    MIN_WINDOW_WIDTH,
    workArea.width,
  )
  const height = clampDimension(
    Math.round(bounds.height),
    MIN_WINDOW_HEIGHT,
    workArea.height,
  )
  return {
    x: clampPosition(Math.round(bounds.x), workArea.x, workArea.width, width),
    y: clampPosition(Math.round(bounds.y), workArea.y, workArea.height, height),
    width,
    height,
  }
}

function clampDimension(
  value: number,
  minimum: number,
  available: number,
): number {
  const maximum = Math.max(minimum, available)
  return Math.min(Math.max(value, minimum), maximum)
}

function clampPosition(
  value: number,
  origin: number,
  available: number,
  size: number,
): number {
  return Math.min(
    Math.max(value, origin),
    origin + Math.max(0, available - size),
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
