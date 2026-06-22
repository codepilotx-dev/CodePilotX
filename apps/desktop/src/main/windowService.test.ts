import { describe, expect, test } from 'bun:test'
import { isDevToolsShortcut } from './desktopDevToolsShortcut.js'

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
