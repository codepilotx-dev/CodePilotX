import { describe, expect, test } from 'bun:test'
import type {
  DesktopBrowserIpcBridge,
  DesktopBrowserSnapshot,
} from '@codepilotx/shared/desktop-browser-ipc'
import {
  createDesktopBrowserClient,
  WORKBENCH_BROWSER_TAB_ID,
} from '../src/services/desktop-client/desktop-browser-client.js'

const snapshot = (overrides: Partial<DesktopBrowserSnapshot> = {}): DesktopBrowserSnapshot => ({
  tabId: WORKBENCH_BROWSER_TAB_ID,
  open: true,
  url: 'https://example.com/',
  title: 'Example',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  allowedSites: [],
  sitePermissions: [],
  ...overrides,
})

describe('desktop browser client', () => {
  test('delegates the stable workbench tab and forwards state events', async () => {
    const calls: unknown[] = []
    let stateListener: ((state: DesktopBrowserSnapshot) => void) | null = null
    const bridge = {
      getDesktopBrowserState: async input => (calls.push(input), snapshot()),
      createOrRestoreDesktopBrowser: async input => (calls.push(input), snapshot()),
      navigateDesktopBrowser: async input => (calls.push(input), snapshot({ url: input.url })),
      reloadDesktopBrowser: async () => snapshot(),
      stopDesktopBrowser: async () => snapshot({ loading: false }),
      goBackDesktopBrowser: async () => snapshot(),
      goForwardDesktopBrowser: async () => snapshot(),
      setDesktopBrowserBounds: async input => (calls.push(input), snapshot()),
      setDesktopBrowserVisible: async input => (calls.push(input), snapshot()),
      focusDesktopBrowser: async input => { calls.push(input) },
      closeDesktopBrowser: async () => snapshot({ open: false }),
      clearDesktopBrowserAllowedSites: async () => snapshot(),
      onDesktopBrowserStateChange: listener => {
        stateListener = listener
        return () => { stateListener = null }
      },
    } satisfies DesktopBrowserIpcBridge
    const client = createDesktopBrowserClient(bridge)
    const events: string[] = []
    const unsubscribe = client.onBrowserStateChange(state => events.push(state.url))

    expect(client.available).toBe(true)
    await client.openBrowser()
    await client.navigateBrowser('https://openai.com/')
    await client.setBrowserVisible(false)
    await client.focusBrowser()
    stateListener?.(snapshot({ url: 'https://event.example/' }))
    unsubscribe()

    expect(calls).toEqual([
      { tabId: WORKBENCH_BROWSER_TAB_ID },
      { tabId: WORKBENCH_BROWSER_TAB_ID, url: 'https://openai.com/' },
      { tabId: WORKBENCH_BROWSER_TAB_ID, visible: false },
      { tabId: WORKBENCH_BROWSER_TAB_ID },
    ])
    expect(events).toEqual(['https://event.example/'])
  })

  test('reports unavailable instead of succeeding with an Electron mock', async () => {
    const client = createDesktopBrowserClient()
    expect(client.available).toBe(false)
    await expect(client.openBrowser()).rejects.toThrow(
      '仅在 CodePilotX 桌面应用中可用',
    )
  })
})
