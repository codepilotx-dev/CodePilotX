import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { isDevToolsShortcut } from './desktopDevToolsShortcut.js'
import { createWindowRegistry } from './windowRegistry.js'

// Electron mock for createDesktopWindowService tests.
// Mock functions are exported via a shared object so tests can clear and assert on them.
const electronMocks = {
  openDevTools: mock(() => {}),
  closeDevTools: mock(() => {}),
  buildFromTemplate: mock(<T>(template: T) => template),
  setApplicationMenu: mock(() => {}),
  constructorOptions: [] as Array<Record<string, unknown>>,
  windows: [] as ReturnType<typeof createMockWindow>[],
  loadError: null as Error | null,
  loadPromise: null as Promise<void> | null,
}

function createMockWindow() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    destroyed: false,
    loadURL: mock(async () => {
      if (electronMocks.loadError) throw electronMocks.loadError
      await electronMocks.loadPromise
    }),
    on: mock((event: string, callback: (...args: unknown[]) => void) => { listeners.set(event, callback) }),
    once: mock((event: string, callback: (...args: unknown[]) => void) => { listeners.set(event, callback) }),
    emit: (event: string) => listeners.get(event)?.(),
    show: mock(() => {}),
    webContents: {
      on: () => {},
      openDevTools: electronMocks.openDevTools,
      closeDevTools: electronMocks.closeDevTools,
      setWindowOpenHandler: () => {},
      isDestroyed: () => false,
    },
    setMenuBarVisibility: () => {}, setAutoHideMenuBar: () => {},
    getNormalBounds: () => ({ x: 0, y: 0, width: 1440, height: 920 }),
    isMaximized: () => false, isDestroyed() { return this.destroyed },
    minimize: () => {}, unmaximize: () => {}, maximize: mock(() => {}), close: () => {},
  }
}

mock.module('electron', () => ({
  app: {
    getPath: () => '',
  },
  BrowserWindow: Object.assign(
    mock((options: Record<string, unknown>) => {
      electronMocks.constructorOptions.push(options)
      const window = createMockWindow()
      electronMocks.windows.push(window)
      return window
    }),
    {
      getFocusedWindow: mock(() => null),
      getAllWindows: mock(() => []),
    },
  ),
  Menu: {
    buildFromTemplate: electronMocks.buildFromTemplate,
    setApplicationMenu: electronMocks.setApplicationMenu,
  },
  screen: {
    getPrimaryDisplay: () => ({
      id: 1,
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
    getAllDisplays: () => [],
    getDisplayMatching: () => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  shell: {
    openExternal: () => {},
  },
}))

describe('window service devtools shortcuts', () => {
  test('opens devtools for F12 keydown', () => {
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'F12' })).toBe(true)
    expect(isDevToolsShortcut({ type: 'keyDown', code: 'F12' })).toBe(true)
  })

  test('keeps non-devtools input untouched', () => {
    expect(isDevToolsShortcut({ type: 'keyUp', key: 'F12' })).toBe(false)
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'a' })).toBe(false)
    expect(isDevToolsShortcut({ type: 'keyDown', key: 'F11' })).toBe(false)
  })
})

describe('window registry broadcasts', () => {
  test('sends shared events to every live window and removes closed windows', () => {
    const first = fakeWindow()
    const second = fakeWindow()
    const registry = createWindowRegistry()

    registry.add(first)
    registry.add(second)
    registry.broadcast('desktop:test', { ok: true })

    expect(first.sent).toEqual([['desktop:test', { ok: true }]])
    expect(second.sent).toEqual([['desktop:test', { ok: true }]])

    second.destroyed = true
    registry.broadcast('desktop:test', { ok: false })

    expect(first.sent).toEqual([
      ['desktop:test', { ok: true }],
      ['desktop:test', { ok: false }],
    ])
    expect(second.sent).toEqual([['desktop:test', { ok: true }]])
  })
})

describe('createDesktopWindowService debugEnabled', () => {
  beforeEach(() => {
    electronMocks.openDevTools.mockClear()
    electronMocks.closeDevTools.mockClear()
    electronMocks.buildFromTemplate.mockClear()
    electronMocks.setApplicationMenu.mockClear()
    electronMocks.constructorOptions.length = 0
    electronMocks.windows.length = 0
    electronMocks.loadError = null
    electronMocks.loadPromise = null
  })

  test('shows only after load resolves when ready-to-show happens first', async () => {
    const load = deferred<void>()
    electronMocks.loadPromise = load.promise
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({ iconPath: () => undefined, rendererUrl: () => 'http://localhost/test', preloadPath: () => '/preload.js' })
    service.createWindow()

    expect(electronMocks.constructorOptions.at(-1)).toMatchObject({ show: false, backgroundColor: '#ffffff' })
    const window = electronMocks.windows.at(-1)!
    expect(window.show).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(window.show).not.toHaveBeenCalled()
    load.resolve()
    await flushPromises()
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  test('shows only after ready-to-show when load resolves first', async () => {
    const load = deferred<void>()
    electronMocks.loadPromise = load.promise
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({ iconPath: () => undefined, rendererUrl: () => 'http://localhost/test', preloadPath: () => '/preload.js' })
    service.createWindow()
    const window = electronMocks.windows.at(-1)!
    load.resolve()
    await flushPromises()
    expect(window.show).not.toHaveBeenCalled()
    window.emit('ready-to-show')
    expect(window.show).toHaveBeenCalledTimes(1)
  })

  test('does not show a window destroyed before ready-to-show', async () => {
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({ iconPath: () => undefined, rendererUrl: () => 'http://localhost/test', preloadPath: () => '/preload.js' })
    service.createWindow()
    const window = electronMocks.windows.at(-1)!
    window.destroyed = true
    window.emit('ready-to-show')
    expect(window.show).not.toHaveBeenCalled()
  })

  test('does not show after loadURL fails', async () => {
    electronMocks.loadError = new Error('load failed')
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({ iconPath: () => undefined, rendererUrl: () => 'http://localhost/test', preloadPath: () => '/preload.js' })
    service.createWindow()
    await Promise.resolve()
    const window = electronMocks.windows.at(-1)!
    window.emit('ready-to-show')
    expect(window.show).not.toHaveBeenCalled()
  })

  test('does not show when ready-to-show happens before loadURL rejects', async () => {
    const load = deferred<void>()
    electronMocks.loadPromise = load.promise
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({ iconPath: () => undefined, rendererUrl: () => 'http://localhost/test', preloadPath: () => '/preload.js' })
    service.createWindow()
    const window = electronMocks.windows.at(-1)!
    window.emit('ready-to-show')
    load.reject(new Error('load failed after ready'))
    await Promise.resolve()
    expect(window.show).not.toHaveBeenCalled()
  })

  test('debugEnabled: false — openDevTools does not call webContents.openDevTools', async () => {
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({
      iconPath: () => undefined,
      rendererUrl: () => 'http://localhost/test',
      preloadPath: () => '/preload.js',
      debugEnabled: false,
    })
    service.createWindow()
    service.openDevTools()
    expect(electronMocks.openDevTools).not.toHaveBeenCalled()
  })

  test('debugEnabled: true — openDevTools calls webContents.openDevTools', async () => {
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({
      iconPath: () => undefined,
      rendererUrl: () => 'http://localhost/test',
      preloadPath: () => '/preload.js',
      debugEnabled: true,
    })
    service.createWindow()
    service.openDevTools()
    expect(electronMocks.openDevTools).toHaveBeenCalled()
  })

  test('debugEnabled: false — application menu does not contain "调试..."', async () => {
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({
      iconPath: () => undefined,
      rendererUrl: () => 'http://localhost/test',
      preloadPath: () => '/preload.js',
      debugEnabled: false,
    })
    service.createApplicationMenu()
    expect(electronMocks.setApplicationMenu).toHaveBeenCalled()
    const lastCall =
      electronMocks.buildFromTemplate.mock.calls[
        electronMocks.buildFromTemplate.mock.calls.length - 1
      ]
    const template = lastCall?.[0] as Array<{
      label: string
      submenu?: Array<{ label: string }>
    }>
    const windowMenu = template?.find(m => m.label === 'Window')
    const debugItem = (windowMenu?.submenu ?? []).find(
      item => item.label === '调试...',
    )
    expect(debugItem).toBeUndefined()
  })

  test('debugEnabled: true — application menu contains "调试..."', async () => {
    const { createDesktopWindowService } = await import('./windowService.js')
    const service = createDesktopWindowService({
      iconPath: () => undefined,
      rendererUrl: () => 'http://localhost/test',
      preloadPath: () => '/preload.js',
      debugEnabled: true,
    })
    service.createApplicationMenu()
    expect(electronMocks.setApplicationMenu).toHaveBeenCalled()
    const lastCall =
      electronMocks.buildFromTemplate.mock.calls[
        electronMocks.buildFromTemplate.mock.calls.length - 1
      ]
    const template = lastCall?.[0] as Array<{
      label: string
      submenu?: Array<{ label: string }>
    }>
    const windowMenu = template?.find(m => m.label === 'Window')
    const debugItem = (windowMenu?.submenu ?? []).find(
      item => item.label === '调试...',
    )
    expect(debugItem).toBeDefined()
  })
})

function fakeWindow() {
  const fake = {
    destroyed: false,
    sent: [] as Array<[string, unknown]>,
    isDestroyed() {
      return this.destroyed
    },
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, payload: unknown) => {
        fake.sent.push([channel, payload])
      },
    },
  }
  return fake
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}
