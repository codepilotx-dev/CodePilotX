import { app, BrowserWindow, Menu, shell } from 'electron'
import type { DesktopAgentEvent, DesktopUiCommand } from '../shared/types.js'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
} from '../shared/ipcChannels.js'

export type DesktopWindowService = {
  createWindow(): void
  createApplicationMenu(): void
  getWindow(): BrowserWindow | null
  hasOpenWindows(): boolean
  emitAgentEvent(event: DesktopAgentEvent): void
  sendUiCommand(command: DesktopUiCommand): void
  minimizeWindow(): void
  toggleWindowMaximized(): boolean
  closeWindow(): void
  isWindowMaximized(): boolean
  newWindow(): void
  openSettings(): void
  logOut(): void
  exitApp(): void
}

export function createDesktopWindowService(options: {
  rendererUrl: () => string
  preloadPath: () => string
}): DesktopWindowService {
  let mainWindow: BrowserWindow | null = null

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 1080,
      minHeight: 720,
      frame: false,
      title: 'ClaudeCode Local Desktop',
      webPreferences: {
        preload: options.preloadPath(),
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
      if (url !== options.rendererUrl()) {
        event.preventDefault()
      }
    })

    void mainWindow.loadURL(options.rendererUrl())
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  function sendUiCommand(command: DesktopUiCommand): void {
    mainWindow?.webContents.send(DESKTOP_UI_COMMAND_CHANNEL, command)
  }

  function createApplicationMenu(): void {
    const template = [
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
          { role: 'toggleDevTools' as const, label: 'Developer Tools' },
          { type: 'separator' as const },
          { role: 'resetZoom' as const, label: 'Actual Size' },
          { role: 'zoomIn' as const, label: 'Zoom In' },
          { role: 'zoomOut' as const, label: 'Zoom Out' },
          { type: 'separator' as const },
          { role: 'togglefullscreen' as const, label: 'Toggle Full Screen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' as const, label: 'Minimize' },
          { role: 'zoom' as const, label: 'Zoom' },
          { role: 'front' as const, label: 'Bring All to Front' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'ClaudeCode Local Development',
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
    sendUiCommand('openSettings')
  }

  function logOut(): void {
    sendUiCommand('logOut')
  }

  function exitApp(): void {
    app.quit()
  }

  function emitAgentEvent(event: DesktopAgentEvent): void {
    mainWindow?.webContents.send(DESKTOP_AGENT_EVENT_CHANNEL, event)
  }

  return {
    createWindow,
    createApplicationMenu,
    getWindow: () => mainWindow,
    hasOpenWindows: () => BrowserWindow.getAllWindows().length > 0,
    emitAgentEvent,
    sendUiCommand,
    minimizeWindow,
    toggleWindowMaximized,
    closeWindow,
    isWindowMaximized,
    newWindow,
    openSettings,
    logOut,
    exitApp,
  }
}
