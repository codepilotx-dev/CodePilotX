import { describe, expect, test } from 'bun:test'
import { isDevToolsShortcut } from './desktopDevToolsShortcut.js'
import { createWindowRegistry } from './windowRegistry.js'

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
