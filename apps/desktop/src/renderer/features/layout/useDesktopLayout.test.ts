import { afterEach, expect, test } from 'bun:test'
import {
  readStoredSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
} from './useDesktopLayout.js'

const originalWindow = globalThis.window

function installLocalStorage(value: string | null): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) =>
          key === SIDEBAR_COLLAPSED_STORAGE_KEY ? value : null,
      },
    },
  })
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

test('readStoredSidebarCollapsed restores the last global sidebar state', () => {
  installLocalStorage('true')
  expect(readStoredSidebarCollapsed()).toBe(true)

  installLocalStorage('false')
  expect(readStoredSidebarCollapsed()).toBe(false)
})

test('readStoredSidebarCollapsed defaults to expanded when unset', () => {
  installLocalStorage(null)
  expect(readStoredSidebarCollapsed()).toBe(false)
})

