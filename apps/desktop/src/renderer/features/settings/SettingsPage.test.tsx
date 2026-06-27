import { expect, test } from 'bun:test'
import React from 'react'
import { defaultDesktopStoredSettings } from '../../../shared/settingsSchema.js'

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    desktopApi: {},
  },
})

const { SettingsPage } = await import('./SettingsPage.js')
const {
  createSettingsSaveShortcutHandler,
  createDesktopSettingsDraft,
  isSettingsSaveShortcut,
} = await import('./useDesktopSettings.js')

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

test('shortcuts tab renders the keyboard shortcuts settings page', () => {
  const element = SettingsPage({
    activeTab: 'shortcuts',
    onError: () => {},
  })

  expect(React.isValidElement(element)).toBe(true)
  expect(React.isValidElement(element) ? getElementTypeName(element) : null).toBe(
    'KeyboardShortcutsSettings',
  )
})

test('desktop settings draft changes do not save until committed', async () => {
  const savedSettings = defaultDesktopStoredSettings()
  const saves: string[] = []
  const draft = createDesktopSettingsDraft(savedSettings, async snapshot => {
    saves.push(snapshot.model)
  })

  draft.setValue('model', 'draft-model')

  expect(draft.values.model).toBe('draft-model')
  expect(savedSettings.model).toBe('')
  expect(saves).toEqual([])

  const committed = await draft.save()

  expect(committed.model).toBe('draft-model')
  expect(saves).toEqual(['draft-model'])
})

test('desktop settings draft save preserves external effective changes', async () => {
  const savedSettings = defaultDesktopStoredSettings()
  const draft = createDesktopSettingsDraft(savedSettings, async snapshot => snapshot)

  draft.setValue('model', 'draft-model')

  const committed = await draft.save({
    ...savedSettings,
    recentWorkspaces: [
      {
        name: 'External',
        path: 'D:\\External',
        branchName: null,
      },
    ],
  })

  expect(committed.model).toBe('draft-model')
  expect(committed.recentWorkspaces).toEqual([
    {
      name: 'External',
      path: 'D:\\External',
      branchName: null,
    },
  ])
})

test('settings save shortcut only matches ctrl or command s', () => {
  expect(isSettingsSaveShortcut({ ctrlKey: true, metaKey: false, key: 's' })).toBe(
    true,
  )
  expect(isSettingsSaveShortcut({ ctrlKey: false, metaKey: true, key: 'S' })).toBe(
    true,
  )
  expect(
    isSettingsSaveShortcut({ ctrlKey: false, metaKey: false, key: 's' }),
  ).toBe(false)
  expect(isSettingsSaveShortcut({ ctrlKey: true, metaKey: false, key: 'x' })).toBe(
    false,
  )
})

test('settings save shortcut handler saves and prevents browser default', async () => {
  const savedSettings = defaultDesktopStoredSettings()
  const saves: string[] = []
  const draft = createDesktopSettingsDraft(savedSettings, async snapshot => {
    saves.push(snapshot.model)
  })
  const handler = createSettingsSaveShortcutHandler(() => draft.save())
  let prevented = false

  draft.setValue('model', 'shortcut-model')

  const handled = await handler({
    ctrlKey: true,
    metaKey: false,
    key: 's',
    preventDefault: () => {
      prevented = true
    },
  })

  expect(handled).toBe(true)
  expect(prevented).toBe(true)
  expect(saves).toEqual(['shortcut-model'])

  const ignored = await handler({
    ctrlKey: false,
    metaKey: false,
    key: 's',
    preventDefault: () => {
      throw new Error('should not prevent default')
    },
  })

  expect(ignored).toBe(false)
  expect(saves).toEqual(['shortcut-model'])
})

function getElementTypeName(element: React.ReactElement): string | null {
  if (typeof element.type === 'function') {
    return element.type.name || null
  }
  return typeof element.type === 'string' ? element.type : null
}
