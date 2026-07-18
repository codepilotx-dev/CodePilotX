import { describe, expect, test } from 'bun:test'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
  type WorkbenchTabDescriptor,
} from '../src/features/layout/rightDockState.js'
import { getWorkbenchTabDefinition } from '../src/features/layout/workbenchTabRegistry.js'
import { validateConversationUiState } from '../src/features/layout/conversationUiState.js'

const review = { id: 'review', kind: 'review' } as const
const browser = { id: 'browser', kind: 'browser' } as const

function open(
  state: ReturnType<typeof createDefaultWorkbenchTabsState>,
  tab: WorkbenchTabDescriptor,
  target: 'right' | 'bottom' = 'right',
) {
  return applyWorkbenchPanelAction(state, {
    type: 'openTab',
    target,
    tab,
  })
}

describe('workbench dynamic tab state', () => {
  test('labels the file browser placeholder as open file', () => {
    const tab = { id: 'file-browser', kind: 'file-browser' } as const
    const definition = getWorkbenchTabDefinition(tab)

    expect(definition.label).toBe('打开文件')
    expect(definition.getTitle(tab)).toBe('打开文件')
  })

  test('opening an empty bottom panel does not invent a Terminal tab', () => {
    const state = applyWorkbenchPanelAction(
      createDefaultWorkbenchTabsState(),
      { type: 'togglePanel', target: 'bottom' },
    )

    expect(state.bottom).toEqual({
      open: true,
      activeTabId: null,
      tabIds: [],
    })
    expect(state.tabsById).toEqual({})
    expect(state.focusArea).toBe('bottom-panel')
  })

  test('reopening a singleton activates its existing host', () => {
    let state = open(createDefaultWorkbenchTabsState(), review, 'bottom')
    state = open(state, review, 'right')

    expect(state.bottom.tabIds).toEqual(['review'])
    expect(state.bottom.activeTabId).toBe('review')
    expect(state.right.tabIds).toEqual([])
    expect(state.focusArea).toBe('bottom-panel')
  })

  test('closing a panel preserves tabs for the next open', () => {
    const opened = open(createDefaultWorkbenchTabsState(), review)
    const closed = applyWorkbenchPanelAction(opened, {
      type: 'closePanel',
      target: 'right',
    })
    const reopened = applyWorkbenchPanelAction(closed, {
      type: 'togglePanel',
      target: 'right',
    })

    expect(closed.right.open).toBe(false)
    expect(closed.right.tabIds).toEqual(['review'])
    expect(reopened.right).toEqual(opened.right)
  })

  test('supports multiple plans and side tasks', () => {
    let state = createDefaultWorkbenchTabsState()
    state = open(state, {
      id: 'plan:event-1',
      kind: 'plan',
      eventId: 'event-1',
      title: '计划 1',
    })
    state = open(state, {
      id: 'plan:event-2',
      kind: 'plan',
      eventId: 'event-2',
      title: '计划 2',
    })
    state = open(state, {
      id: 'side-task:task-1',
      kind: 'side-task',
      taskId: 'task-1',
      childThreadId: 'thread-1',
    })

    expect(state.right.tabIds).toEqual([
      'plan:event-1',
      'plan:event-2',
      'side-task:task-1',
    ])
  })

  test('replaces an unpinned file preview and preserves a pinned one', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file:src/a.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/a.ts',
      preview: true,
    })
    state = open(state, {
      id: 'file:src/b.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/b.ts',
      preview: true,
    })

    expect(state.right.tabIds).toEqual(['file:src/b.ts'])
    expect(state.tabsById['file:src/a.ts']).toBeUndefined()

    state = applyWorkbenchPanelAction(state, {
      type: 'pinTab',
      tabId: 'file:src/b.ts',
    })
    state = open(state, {
      id: 'file:src/c.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/c.ts',
      preview: true,
    })
    state = open(state, {
      id: 'file:src/b.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/b.ts',
      preview: true,
    })

    expect(state.right.tabIds).toEqual(['file:src/b.ts', 'file:src/c.ts'])
    expect(state.tabsById['file:src/b.ts']).toMatchObject({ preview: false })
  })

  test('replaces the open-file placeholder with a pinned file after selection', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file-browser',
      kind: 'file-browser',
    })
    state = open(state, {
      id: 'file:src/app.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/app.ts',
      preview: false,
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'file-browser',
    })

    expect(state.right.tabIds).toEqual(['file:src/app.ts'])
    expect(state.right.activeTabId).toBe('file:src/app.ts')
    expect(state.tabsById['file-browser']).toBeUndefined()
    expect(state.tabsById['file:src/app.ts']).toMatchObject({
      kind: 'file-preview',
      preview: false,
    })
  })

  test('reuses a file tab while updating its target line', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file:src/a.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/a.ts',
      line: 10,
      preview: true,
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'pinTab',
      tabId: 'file:src/a.ts',
    })
    state = open(state, {
      id: 'file:src/a.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/a.ts',
      line: 42,
      endLine: 48,
      preview: true,
    })

    expect(state.right.tabIds).toEqual(['file:src/a.ts'])
    expect(state.tabsById['file:src/a.ts']).toMatchObject({
      line: 42,
      endLine: 48,
      preview: false,
    })
  })

  test('persists a Markdown view mode when the same file is reopened', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file:README.md',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'README.md',
      preview: false,
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'setFileMarkdownViewMode',
      tabId: 'file:README.md',
      mode: 'source',
    })
    state = open(state, {
      id: 'file:README.md',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'README.md',
      line: 12,
      preview: true,
    })

    expect(state.tabsById['file:README.md']).toMatchObject({
      markdownViewMode: 'source',
      line: 12,
      preview: false,
    })
  })

  test('move and reorder preserve one instance across both panels', () => {
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = open(state, browser)
    state = applyWorkbenchPanelAction(state, {
      type: 'moveTab',
      source: 'right',
      target: 'bottom',
      tabId: 'review',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'reorderTab',
      target: 'right',
      tabId: 'browser',
      index: 0,
    })

    expect(state.right.tabIds).toEqual(['browser'])
    expect(state.bottom.tabIds).toEqual(['review'])
    expect(
      [...state.right.tabIds, ...state.bottom.tabIds].filter(
        id => id === 'review',
      ),
    ).toHaveLength(1)
  })

  test('close uses the right neighbor, then the left neighbor', () => {
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = open(state, browser)
    state = open(state, { id: 'file-browser', kind: 'file-browser' })
    state = applyWorkbenchPanelAction(state, {
      type: 'selectTab',
      target: 'right',
      tabId: 'browser',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'browser',
    })
    expect(state.right.activeTabId).toBe('file-browser')

    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'file-browser',
    })
    expect(state.right.activeTabId).toBe('review')
  })

  test('closes other tabs and tabs to the right', () => {
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = open(state, browser)
    state = open(state, { id: 'file-browser', kind: 'file-browser' })
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTabsToRight',
      target: 'right',
      tabId: 'browser',
    })
    expect(state.right.tabIds).toEqual(['review', 'browser'])
    expect(state.tabsById['file-browser']).toBeUndefined()

    state = applyWorkbenchPanelAction(state, {
      type: 'closeOtherTabs',
      target: 'right',
      tabId: 'browser',
    })
    expect(state.right.tabIds).toEqual(['browser'])
    expect(state.tabsById.review).toBeUndefined()
  })

  test('closing a full-width right panel restores full width on reopen', () => {
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = applyWorkbenchPanelAction(state, {
      type: 'toggleRightFullWidth',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closePanel',
      target: 'right',
    })

    expect(state.rightFullWidth).toBe(false)
    expect(state.restoreRightFullWidthOnNextOpen).toBe(true)

    state = applyWorkbenchPanelAction(state, {
      type: 'togglePanel',
      target: 'right',
    })
    expect(state.rightFullWidth).toBe(true)
    expect(state.restoreRightFullWidthOnNextOpen).toBe(false)
  })

  test('migrates legacy tools and plan while dropping Terminal', () => {
    const state = validateConversationUiState(
      {
        rightDock: {
          open: true,
          activeTool: 'terminal',
          openTools: ['review', 'terminal', 'plan'],
        },
        plan: { title: '旧计划', content: '旧正文' },
        mainScrollTop: 42,
        sideChatInput: '',
        sideChatAttachments: [],
      },
      {},
    )

    expect(state.schemaVersion).toBe(2)
    expect(state.workbench.right.tabIds).toEqual(['review', 'plan:legacy'])
    expect(state.workbench.right.activeTabId).toBe('plan:legacy')
    expect(state.workbench.tabsById['plan:legacy']).toMatchObject({
      kind: 'plan',
      legacyContent: '旧正文',
    })
    expect(Object.keys(state.workbench.tabsById)).not.toContain('terminal')
    expect(state.workbench.bottom.tabIds).toEqual([])
  })

  test('validates v2 descriptors, duplicate ownership, and debug gating', () => {
    const state = validateConversationUiState(
      {
        schemaVersion: 2,
        workbench: {
          schemaVersion: 2,
          tabsById: {
            review,
            browser,
            'tool-probe': { id: 'tool-probe', kind: 'tool-probe' },
            missing: { id: 'terminal', kind: 'terminal' },
          },
          right: {
            open: true,
            activeTabId: 'review',
            tabIds: ['review', 'browser'],
          },
          bottom: {
            open: true,
            activeTabId: 'browser',
            tabIds: ['browser', 'tool-probe'],
          },
          rightFullWidth: false,
          restoreRightFullWidthOnNextOpen: false,
          focusArea: 'bottom-panel',
        },
        mainScrollTop: 0,
        sideChatInput: '',
        sideChatAttachments: [],
      },
      { debugMode: false },
    )

    expect(state.workbench.right.tabIds).toEqual(['review'])
    expect(state.workbench.bottom.tabIds).toEqual(['browser'])
    expect(state.workbench.tabsById['tool-probe']).toBeUndefined()
    expect(state.workbench.focusArea).toBe('bottom-panel')
  })

  test('restores only valid Markdown view modes from session UI state', () => {
    const state = validateConversationUiState({
      schemaVersion: 2,
      workbench: {
        schemaVersion: 2,
        tabsById: {
          'file:README.md': {
            id: 'file:README.md',
            kind: 'file-preview',
            workspacePath: 'F:\\project',
            relativePath: 'README.md',
            preview: false,
            markdownViewMode: 'source',
          },
          'file:docs/guide.md': {
            id: 'file:docs/guide.md',
            kind: 'file-preview',
            workspacePath: 'F:\\project',
            relativePath: 'docs/guide.md',
            preview: false,
            markdownViewMode: 'invalid',
          },
        },
        right: {
          open: true,
          activeTabId: 'file:README.md',
          tabIds: ['file:README.md', 'file:docs/guide.md'],
        },
        bottom: { open: false, activeTabId: null, tabIds: [] },
        rightFullWidth: false,
        restoreRightFullWidthOnNextOpen: false,
        focusArea: 'right-panel',
      },
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
    })

    expect(state.workbench.tabsById['file:README.md']).toMatchObject({
      markdownViewMode: 'source',
    })
    expect(
      state.workbench.tabsById['file:docs/guide.md'],
    ).not.toHaveProperty('markdownViewMode')
  })
})
