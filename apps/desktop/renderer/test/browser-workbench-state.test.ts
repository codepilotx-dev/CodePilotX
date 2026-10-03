import { describe, expect, test } from 'bun:test'
import { mergeBrowserWorkbench } from '../src/features/browser/browserWorkbenchState.js'
import {
  createDefaultWorkbenchTabsState,
  applyWorkbenchPanelAction,
} from '../src/features/layout/dock/rightDockState.js'
import type { DesktopBrowserState } from '../shared/types.js'
const record = (tabId: string): DesktopBrowserState => ({
  tabId,
  open: true,
  url: 'https://example.test/',
  title: tabId,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
  allowedSites: [],
  sitePermissions: [],
})
describe('global browser workbench state', () => {
  test('background tabs do not select or open a panel; closing one preserves others', () => {
    const initial = applyWorkbenchPanelAction(createDefaultWorkbenchTabsState(), {
      type: 'openTab',
      target: 'right',
      tab: { id: 'review', kind: 'review' },
    })
    const merged = mergeBrowserWorkbench(initial, [record('one'), record('two')])
    expect(merged.right.activeTabId).toBe('review')
    expect(merged.right.tabIds).toEqual(['review', 'browser:one', 'browser:two'])
    const closed = mergeBrowserWorkbench(merged, [record('two')])
    expect(closed.right.tabIds).toEqual(['review', 'browser:two'])
  })
  test('switching conversation preserves the selected browser and bottom placement', () => {
    const previous = applyWorkbenchPanelAction(createDefaultWorkbenchTabsState(), {
      type: 'openTab',
      target: 'bottom',
      tab: { id: 'browser:one', kind: 'browser', tabId: 'one' },
    })
    const restored = mergeBrowserWorkbench(
      createDefaultWorkbenchTabsState(),
      [record('one')],
      previous,
    )
    expect(restored.bottom).toMatchObject({
      open: true,
      activeTabId: 'browser:one',
      tabIds: ['browser:one'],
    })
    expect(mergeBrowserWorkbench(restored, [record('one')])).toBe(restored)
  })
})
