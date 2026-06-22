import { expect, test } from 'bun:test'
import React from 'react'

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    desktopApi: {},
  },
})

const { SettingsPage } = await import('./SettingsPage.js')

test('connections tab renders the model connection settings page', () => {
  const element = SettingsPage({
    activeTab: 'connections',
    onError: () => {},
  })

  expect(React.isValidElement(element)).toBe(true)
  expect(React.isValidElement(element) ? getElementTypeName(element) : null).toBe(
    'ModelConnectionSettings',
  )
})

function getElementTypeName(element: React.ReactElement): string | null {
  if (typeof element.type === 'function') {
    return element.type.name || null
  }
  return typeof element.type === 'string' ? element.type : null
}
