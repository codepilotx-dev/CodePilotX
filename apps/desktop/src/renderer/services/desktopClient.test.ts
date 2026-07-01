import { describe, expect, test } from 'bun:test'
import type {
  DesktopApi,
  DesktopRuntimeStatus,
  DesktopSessionStoreChange,
} from '../../shared/types.js'
import {
  DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY,
  createDesktopClient,
  readDesktopBrowserDebugMode,
  writeDesktopBrowserDebugMode,
} from './desktopClient.js'

const runtimeStatus: DesktopRuntimeStatus = {
  runtimeKind: 'embedded-headless',
  runtimePreference: 'auto',
  runtimeSelectionSource: 'default',
  agentExecutablePath: '',
  agentExecutableExists: false,
  subprocessFallbackAvailable: false,
  configDirectoryPath: '',
  toolchainEnabled: true,
  toolchainRoot: null,
  managedToolchainRoot: '',
  packagedToolchainRoot: '',
  toolchainPathEntries: [],
  toolchainBinaries: [],
}

describe('desktopClient environment selection', () => {
  test('uses the Electron preload API when it exists', async () => {
    const electronApi = {
      getRuntimeStatus: async () => runtimeStatus,
    } as DesktopApi

    const client = createDesktopClient({
      window: { desktopApi: electronApi },
      fetch: async () => {
        throw new Error('fetch should not be used for Electron preload')
      },
    })

    expect(client).toBe(electronApi)
    expect(await client.getRuntimeStatus()).toEqual(runtimeStatus)
  })

  test('uses a browser mock by default when preload is missing', async () => {
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage(),
      fetch: async () => {
        throw new Error('fetch should not be used while debug mode is off')
      },
    })

    expect(await client.getRuntimeStatus()).toEqual(runtimeStatus)
    expect(await client.listSessions()).toEqual([])
    expect(await client.getBrowserState()).toMatchObject({
      open: false,
      url: '',
      loading: false,
    })
    expect(client.onAgentEvent(() => {})).toBeFunction()
    expect(client.onSessionStoreChange(() => {})).toBeFunction()
    expect(client.onDesktopSettingsChange(() => {})).toBeFunction()
  })

  test('browser mock emits session store changes to subscribers', async () => {
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage(),
      fetch: async () => {
        throw new Error('fetch should not be used while debug mode is off')
      },
    })
    const changes: DesktopSessionStoreChange[] = []
    const unsubscribe = client.onSessionStoreChange(change => {
      changes.push(change)
    })

    await client.createSession({ workspacePath: undefined })
    unsubscribe()
    await client.createSession({ workspacePath: undefined })

    expect(changes).toHaveLength(1)
    expect(changes[0]?.sessions).toHaveLength(1)
  })

  test('browser mock emits saved settings changes to subscribers', async () => {
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage(),
      fetch: async () => {
        throw new Error('fetch should not be used while debug mode is off')
      },
    })
    const changes: string[] = []
    const unsubscribe = client.onDesktopSettingsChange(change => {
      changes.push(change.settings.model)
    })

    await client.saveDesktopSettings({
      ...(await client.getDesktopSettings()),
      model: 'model-a',
    })
    unsubscribe()
    await client.saveDesktopSettings({
      ...(await client.getDesktopSettings()),
      model: 'model-b',
    })

    expect(changes).toEqual(['model-a'])
  })

  test('uses the browser debug bridge when debug mode is persisted', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const storage = memoryStorage({
      [DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY]: '1',
    })
    const client = createDesktopClient({
      window: {},
      localStorage: storage,
      debugBridgePort: 53271,
      fetch: async (input, init) => {
        calls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        })
        return jsonResponse(runtimeStatus)
      },
    })

    await expect(client.getRuntimeStatus()).resolves.toEqual(runtimeStatus)
    expect(calls).toEqual([
      {
        url: 'http://127.0.0.1:53271/desktop-api/getRuntimeStatus',
        body: { args: [] },
      },
    ])
  })

  test('encodes null optional arguments without dropping the tuple position', async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage({
        [DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY]: '1',
      }),
      fetch: async (_input, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return jsonResponse([])
      },
    })

    await expect(client.listSlashCommands(null as unknown as undefined)).resolves.toEqual([])
    expect(calls).toEqual([
      { body: { args: [{ __desktopBrowserDebugUndefined: true }] } },
    ])
  })

  test('preserves nullable null arguments for bridge validation', async () => {
    const calls: Array<{ body: unknown }> = []
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage({
        [DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY]: '1',
      }),
      fetch: async (_input, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return emptyResponse()
      },
    })

    await expect(client.setActiveSession(null)).resolves.toBeUndefined()
    expect(calls).toEqual([{ body: { args: [null] } }])
  })

  test('reports a clear error when the browser debug bridge is unavailable', async () => {
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage({
        [DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY]: '1',
      }),
      fetch: async () => {
        throw new Error('ECONNREFUSED')
      },
    })

    await expect(client.getRuntimeStatus()).rejects.toThrow(
      '桌面端浏览器调试桥不可用',
    )
  })

  test('resolves void bridge responses without parsing empty JSON', async () => {
    const client = createDesktopClient({
      window: {},
      localStorage: memoryStorage({
        [DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY]: '1',
      }),
      fetch: async () => emptyResponse(),
    })

    await expect(client.openDevTools()).resolves.toBeUndefined()
  })

  test('persists browser debug mode in localStorage', () => {
    const storage = memoryStorage()

    expect(readDesktopBrowserDebugMode(storage)).toBe(false)
    writeDesktopBrowserDebugMode(storage, true)
    expect(storage.getItem(DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY)).toBe('1')
    expect(readDesktopBrowserDebugMode(storage)).toBe(true)
    writeDesktopBrowserDebugMode(storage, false)
    expect(storage.getItem(DESKTOP_BROWSER_DEBUG_MODE_STORAGE_KEY)).toBe('0')
    expect(readDesktopBrowserDebugMode(storage)).toBe(false)
  })
})

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(value),
    json: async () => value,
  } as unknown as Response
}

function emptyResponse(): Response {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    },
  } as unknown as Response
}
