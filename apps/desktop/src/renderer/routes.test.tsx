import { expect, test } from 'bun:test'

test('keeps shell and quick chat eager while lazy routes load their named components', async () => {
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
    value: { defaultView: testWindow },
  })

  try {
    const { router } = await import(`./routes.js?behavior=${Date.now()}`)
    const { DesktopLayout } = await import('./features/layout/DesktopLayout.js')
    const { QuickChatView } = await import('./features/session/QuickChatView.js')
    const root = router.routes[0]
    const children = root?.children ?? []

    expect(router.state.location.pathname).toBe('/')
    expect(root?.element?.type).toBe(DesktopLayout)
    expect(children.find(route => route.path === 'quick-chat')?.element?.type).toBe(
      QuickChatView,
    )

    for (const [path, modulePath, exportName] of [
      ['sessions/:sessionId', './features/session/ConversationPage.js', 'ConversationPage'],
      ['search', './features/search/SearchView.js', 'SearchView'],
      ['plugins', './features/plugins/PluginsView.js', 'PluginsView'],
      ['automation', './features/automation/AutomationView.js', 'AutomationView'],
      ['settings', './features/settings/SettingsLayout.js', 'SettingsLayout'],
    ] as const) {
      const route = children.find(candidate => candidate.path === path)
      expect(route?.element).toBeUndefined()
      expect(typeof route?.lazy).toBe('function')
      const loadedRoute = await (route?.lazy as () => Promise<{
        Component: unknown
      }>)()
      const loadedModule = await import(modulePath)
      expect(loadedRoute.Component).toBe(loadedModule[exportName])
    }
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
