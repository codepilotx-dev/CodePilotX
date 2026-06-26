import { EventEmitter } from 'node:events'
import { describe, expect, test } from 'bun:test'
import type { DesktopApiHandlers } from './ipc.js'
import { createDesktopBrowserDebugBridge } from './desktopBrowserDebugBridge.js'

describe('desktop browser debug bridge', () => {
  test('forwards validated DesktopApi calls over loopback HTTP', async () => {
    const bridge = createDesktopBrowserDebugBridge({
      handlers: {
        getRuntimeStatus: async () => ({
          runtimeKind: 'embedded-headless',
          runtimePreference: 'auto',
          runtimeSelectionSource: 'default',
          agentExecutablePath: '',
          agentExecutableExists: false,
          subprocessFallbackAvailable: false,
          configDirectoryPath: '',
        }),
      } as DesktopApiHandlers,
      events: new EventEmitter(),
      enabled: true,
      port: 0,
    })

    const server = await bridge.start()
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/desktop-api/getRuntimeStatus`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args: [] }),
        },
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        runtimeKind: 'embedded-headless',
        runtimePreference: 'auto',
      })
    } finally {
      await server.close()
    }
  })

  test('rejects invalid method arguments with a 400 response', async () => {
    const bridge = createDesktopBrowserDebugBridge({
      handlers: {
        openBrowser: async () => ({
          open: true,
          url: '',
          title: '',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          error: null,
          allowedSites: [],
        }),
      } as DesktopApiHandlers,
      events: new EventEmitter(),
      enabled: true,
      port: 0,
    })

    const server = await bridge.start()
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/desktop-api/openBrowser`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ args: [42] }),
        },
      )

      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Invalid DesktopApi arguments')
    } finally {
      await server.close()
    }
  })

  test('decodes encoded undefined arguments before validation', async () => {
    const received: unknown[][] = []
    const bridge = createDesktopBrowserDebugBridge({
      handlers: {
        listSlashCommands: async (...args: unknown[]) => {
          received.push(args)
          return []
        },
      } as DesktopApiHandlers,
      events: new EventEmitter(),
      enabled: true,
      port: 0,
    })

    const server = await bridge.start()
    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/desktop-api/listSlashCommands`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            args: [{ __desktopBrowserDebugUndefined: true }],
          }),
        },
      )

      expect(response.status).toBe(200)
      expect(received).toEqual([[undefined]])
    } finally {
      await server.close()
    }
  })

  test('does not start when disabled', async () => {
    const bridge = createDesktopBrowserDebugBridge({
      handlers: {} as DesktopApiHandlers,
      events: new EventEmitter(),
      enabled: false,
      port: 0,
    })

    expect(await bridge.start()).toBeNull()
  })
})
