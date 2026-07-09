import { EventEmitter } from 'node:events'
import { request as httpRequest } from 'node:http'
import { describe, expect, test } from 'bun:test'
import type { DesktopApiHandlers } from './ipc.js'
import { createDesktopBrowserDebugBridge } from './desktopBrowserDebugBridge.js'

describe('desktop browser debug bridge', () => {
  test('forwards validated DesktopApi calls over loopback HTTP', async () => {
    const bridge = createDesktopBrowserDebugBridge({
      handlers: {
        getRuntimeStatus: async () => ({
          runtimeKind: "rust-sidecar",
          runtimePreference: 'auto',
          runtimeSelectionSource: 'default',
          agentExecutablePath: '',
          agentExecutableExists: false,
          
          configDirectoryPath: '',
          toolchainEnabled: true,
          toolchainRoot: null,
          managedToolchainRoot: '',
          packagedToolchainRoot: '',
          toolchainPathEntries: [],
          toolchainBinaries: [],
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
        runtimeKind: "rust-sidecar",
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

  describe('with token configured', () => {
    const TOKEN = 'test-bridge-token-123'
    const VALID_ORIGIN = 'http://127.0.0.1:5000'

    test('OPTIONS preflight succeeds without bearer token', async () => {
      const bridge = createDesktopBrowserDebugBridge({
        handlers: {} as DesktopApiHandlers,
        events: new EventEmitter(),
        enabled: true,
        port: 0,
        token: TOKEN,
      })

      const server = await bridge.start()
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/desktop-api/getRuntimeStatus`,
          {
            method: 'OPTIONS',
            headers: { origin: VALID_ORIGIN },
          },
        )

        expect(response.status).toBe(204)
        expect(response.headers.get('access-control-allow-origin')).toBe(VALID_ORIGIN)
        expect(response.headers.get('vary')).toContain('origin')
      } finally {
        await server.close()
      }
    })

    test('rejects API request without token and includes CORS headers', async () => {
      const bridge = createDesktopBrowserDebugBridge({
        handlers: {} as DesktopApiHandlers,
        events: new EventEmitter(),
        enabled: true,
        port: 0,
        token: TOKEN,
      })

      const server = await bridge.start()
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/desktop-api/getRuntimeStatus`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              origin: VALID_ORIGIN,
            },
            body: JSON.stringify({ args: [] }),
          },
        )

        expect(response.status).toBe(401)
        // Browser must be able to read the status via CORS headers.
        expect(response.headers.get('access-control-allow-origin')).toBe(VALID_ORIGIN)
        expect(await response.text()).toBe('Unauthorized')
      } finally {
        await server.close()
      }
    })

    test('accepts API request with valid bearer token', async () => {
      const bridge = createDesktopBrowserDebugBridge({
        handlers: {
          getRuntimeStatus: async () => ({
            runtimeKind: "rust-sidecar",
            runtimePreference: 'auto',
            runtimeSelectionSource: 'default',
            agentExecutablePath: '',
            agentExecutableExists: false,
            
            configDirectoryPath: '',
            toolchainEnabled: true,
            toolchainRoot: null,
            managedToolchainRoot: '',
            packagedToolchainRoot: '',
            toolchainPathEntries: [],
            toolchainBinaries: [],
          }),
        } as DesktopApiHandlers,
        events: new EventEmitter(),
        enabled: true,
        port: 0,
        token: TOKEN,
      })

      const server = await bridge.start()
      try {
        const response = await fetch(
          `http://127.0.0.1:${server.port}/desktop-api/getRuntimeStatus`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${TOKEN}`,
              origin: VALID_ORIGIN,
            },
            body: JSON.stringify({ args: [] }),
          },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          runtimeKind: "rust-sidecar",
        })
      } finally {
        await server.close()
      }
    })

    test('accepts SSE connection with query token', async () => {
      const events = new EventEmitter()
      const bridge = createDesktopBrowserDebugBridge({
        handlers: {} as DesktopApiHandlers,
        events,
        enabled: true,
        port: 0,
        token: TOKEN,
      })

      const server = await bridge.start()
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path: `/desktop-events?token=${TOKEN}`,
            method: 'GET',
            headers: { origin: VALID_ORIGIN },
          },
          res => {
            expect(res.statusCode).toBe(200)
            expect(res.headers['content-type']).toContain('text/event-stream')
            // Destroy the request to close the connection cleanly.
            req.destroy()
            resolve()
          },
        )
        req.on('error', err => {
          // destroy() may cause an error; ignore it if the test already resolved.
          if (!req.destroyed) reject(err)
        })
        req.end()
      })
      await server.close()
    })

    test('rejects SSE connection without token', async () => {
      const events = new EventEmitter()
      const bridge = createDesktopBrowserDebugBridge({
        handlers: {} as DesktopApiHandlers,
        events,
        enabled: true,
        port: 0,
        token: TOKEN,
      })

      const server = await bridge.start()
      await new Promise<void>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port: server.port,
            path: '/desktop-events',
            method: 'GET',
            headers: { origin: VALID_ORIGIN },
          },
          res => {
            let body = ''
            res.on('data', chunk => {
              body += chunk
            })
            res.on('end', () => {
              expect(res.statusCode).toBe(401)
              expect(res.headers['access-control-allow-origin']).toBe(VALID_ORIGIN)
              expect(body).toBe('Unauthorized')
              resolve()
            })
          },
        )
        req.on('error', reject)
        req.end()
      })
      await server.close()
    })
  })
})
