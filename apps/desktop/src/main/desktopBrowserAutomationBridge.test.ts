import { describe, expect, test } from 'bun:test'
import { createDesktopBrowserAutomationBridge } from './desktopBrowserAutomationBridge.js'

describe('desktop browser automation bridge', () => {
  test('rejects requests without the session token', async () => {
    const bridge = createDesktopBrowserAutomationBridge({
      token: 'secret',
      handleAction: async () => ({ ok: true }),
    })
    const server = await bridge.start()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/browser/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot' }),
      })

      expect(response.status).toBe(401)
      expect(await response.text()).toContain('Unauthorized')
    } finally {
      await server.close()
    }
  })

  test('forwards authorized whitelisted actions', async () => {
    const calls: unknown[] = []
    const bridge = createDesktopBrowserAutomationBridge({
      token: 'secret',
      handleAction: async input => {
        calls.push(input)
        return { ok: true, action: input.action }
      },
    })
    const server = await bridge.start()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/browser/action`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'snapshot' }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, action: 'snapshot' })
      expect(calls).toEqual([{ action: 'snapshot' }])
    } finally {
      await server.close()
    }
  })

  test('rejects non-whitelisted actions', async () => {
    const bridge = createDesktopBrowserAutomationBridge({
      token: 'secret',
      handleAction: async () => ({ ok: true }),
    })
    const server = await bridge.start()
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/browser/action`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action: 'open_devtools' }),
      })

      expect(response.status).toBe(400)
      expect(await response.text()).toContain('Unsupported browser action')
    } finally {
      await server.close()
    }
  })
})
