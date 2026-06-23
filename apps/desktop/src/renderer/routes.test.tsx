import { expect, test } from 'bun:test'

test('starts packaged file URLs at the app root route', async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const testWindow = {
    location: new URL(
      'file:///D:/VueProject/ClaudeCode/dist/desktop/renderer/index.html',
    ),
    history: {
      replaceState: () => {},
      state: null,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: testWindow,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      defaultView: testWindow,
    },
  })

  try {
    const { router } = await import(`./routes.js?packaged=${Date.now()}`)

    expect(router.state.location.pathname).toBe('/')
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  }
})
