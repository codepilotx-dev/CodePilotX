import { describe, expect, test } from 'bun:test'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
  type WorkbenchTabDescriptor,
} from '../src/features/layout/dock/rightDockState.js'
import { getWorkbenchTabDefinition } from '../src/features/layout/tabs/workbenchTabRegistry.js'
import {
  isReviewDiffExpanded,
  toggleReviewDiffExpansion,
  validateConversationUiState,
} from '../src/features/layout/tabs/conversationUiState.js'
import {
  bottomPanelHeightFromRatio,
  bottomPanelHeightToRatio,
  createRightDockResponsiveState,
  getResponsiveRightDockDefaultWidth,
  reduceRightDockResponsiveState,
  rightDockWidthFromRatio,
  rightDockWidthToRatio,
} from '../src/features/layout/shell/workbenchLayoutSizing.js'
import {
  resolveInitialBottomPanelHeightRatio,
  resolveInitialRightDockWidthRatio,
} from '../src/features/layout/shell/workbenchLayoutStorage.js'

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

  test('resets pre-v4 workbench state instead of migrating legacy tools', () => {
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

    expect(state.schemaVersion).toBe(4)
    expect(state.review).toMatchObject({
      source: { kind: 'unstaged' },
      selectedFile: null,
      viewedRevisions: {},
    })
    expect(state.workbench.right.tabIds).toEqual([])
    expect(state.workbench.right.activeTabId).toBeNull()
    expect(state.workbench.tabsById).toEqual({})
    expect(state.workbench.bottom.tabIds).toEqual([])
  })

  test('drops removed debug tabs from persisted v4 state and preserves regular tabs', () => {
    const fileTab = {
      id: 'file:src/main.ts',
      kind: 'file-preview',
      workspacePath: 'F:\\project',
      relativePath: 'src/main.ts',
      preview: false,
    } as const
    const planTab = {
      id: 'plan:event-1',
      kind: 'plan',
      eventId: 'event-1',
      title: '实现计划',
    } as const
    const sideChat = { id: 'side-chat', kind: 'side-chat' } as const
    const state = validateConversationUiState(
      {
        schemaVersion: 4,
        workbench: {
          schemaVersion: 2,
          tabsById: {
            review,
            [fileTab.id]: fileTab,
            [planTab.id]: planTab,
            [sideChat.id]: sideChat,
            'tool-probe': { id: 'tool-probe', kind: 'tool-probe' },
            'dialog-debug': { id: 'dialog-debug', kind: 'dialog-debug' },
            'performance-diagnostics': {
              id: 'performance-diagnostics',
              kind: 'performance-diagnostics',
            },
          },
          right: {
            open: true,
            activeTabId: planTab.id,
            tabIds: ['review', fileTab.id, planTab.id, 'tool-probe'],
          },
          bottom: {
            open: true,
            activeTabId: 'performance-diagnostics',
            tabIds: [
              sideChat.id,
              'dialog-debug',
              'performance-diagnostics',
            ],
          },
          rightFullWidth: false,
          restoreRightFullWidthOnNextOpen: false,
          focusArea: 'bottom-panel',
        },
        mainScrollTop: 0,
        sideChatInput: '',
        sideChatAttachments: [],
      },
      {
        validPlanEventIds: ['event-1'],
        workspacePath: 'F:\\project',
      },
    )

    expect(state.workbench.right.tabIds).toEqual([
      'review',
      fileTab.id,
      planTab.id,
    ])
    expect(state.workbench.right.activeTabId).toBe(planTab.id)
    expect(state.workbench.bottom.tabIds).toEqual([sideChat.id])
    expect(state.workbench.bottom.activeTabId).toBe(sideChat.id)
    expect(state.workbench.tabsById['tool-probe']).toBeUndefined()
    expect(state.workbench.tabsById).toEqual({
      review,
      [fileTab.id]: fileTab,
      [planTab.id]: planTab,
      [sideChat.id]: sideChat,
    })
    expect(state.workbench.focusArea).toBe('bottom-panel')
    expect(state.schemaVersion).toBe(4)
  })

  test('validates canonical v4 Review expansion state and remaining fields', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
      workbench: createDefaultWorkbenchTabsState(),
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
      review: {
        source: { kind: 'branch', baseBranch: 'origin/main' },
        selectedFile: 'src/main.ts',
        selectedCommentId: 'comment-1',
        scrollTop: 128,
        diffExpansion: {
          mode: 'custom',
          expandedFiles: ['src/main.ts', 'src/main.ts'],
        },
        viewedRevisions: { 'src/main.ts': 'revision-1', bad: 1 },
        fileTreeVisible: false,
        fileTreeWidth: 9_999,
        diffMode: 'split',
        wrapLines: false,
        showWordDiff: false,
        hideWhitespace: true,
        richPreview: false,
      },
    })

    expect(state.review).toEqual({
      source: { kind: 'branch', baseBranch: 'origin/main' },
      selectedFile: 'src/main.ts',
      selectedCommentId: 'comment-1',
      scrollTop: 128,
      diffExpansion: {
        mode: 'custom',
        expandedFiles: ['src/main.ts'],
      },
      viewedRevisions: { 'src/main.ts': 'revision-1' },
      fileTreeVisible: false,
      fileTreeWidth: 520,
      diffMode: 'split',
      wrapLines: false,
      showWordDiff: false,
      hideWhitespace: true,
      richPreview: false,
    })
    expect(state.schemaVersion).toBe(4)
  })

  test('distinguishes all, none, and custom Review diff expansion states', () => {
    const v4None = validateConversationUiState({
      schemaVersion: 4,
      workbench: createDefaultWorkbenchTabsState(),
      review: { diffExpansion: { mode: 'none' } },
    })
    const v4Custom = validateConversationUiState({
      schemaVersion: 4,
      workbench: createDefaultWorkbenchTabsState(),
      review: {
        diffExpansion: {
          mode: 'custom',
          expandedFiles: ['src/a.ts', 'src/a.ts', 'src/b.ts'],
        },
      },
    })

    expect(v4None.review.diffExpansion).toEqual({ mode: 'none' })
    expect(v4Custom.review.diffExpansion).toEqual({
      mode: 'custom',
      expandedFiles: ['src/a.ts', 'src/b.ts'],
    })
  })

  test('toggles one Review diff without confusing all-expanded and all-collapsed', () => {
    const paths = ['src/a.ts', 'src/b.ts']
    const custom = toggleReviewDiffExpansion(
      { mode: 'all' },
      paths,
      'src/a.ts',
    )
    const none = toggleReviewDiffExpansion(custom, paths, 'src/b.ts')
    const one = toggleReviewDiffExpansion(none, paths, 'src/a.ts')
    const all = toggleReviewDiffExpansion(one, paths, 'src/b.ts')

    expect(custom).toEqual({
      mode: 'custom',
      expandedFiles: ['src/b.ts'],
    })
    expect(none).toEqual({ mode: 'none' })
    expect(isReviewDiffExpanded(none, 'src/a.ts')).toBe(false)
    expect(isReviewDiffExpanded(none, 'src/b.ts')).toBe(false)
    expect(one).toEqual({
      mode: 'custom',
      expandedFiles: ['src/a.ts'],
    })
    expect(all).toEqual({ mode: 'all' })
  })

  test('restores only valid Markdown view modes from session UI state', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
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

  test('reopens the file-browser tab with updated directoryPath', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file-browser',
      kind: 'file-browser',
    })

    expect(state.right.tabIds).toEqual(['file-browser'])
    expect(state.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
    })
    expect(state.tabsById['file-browser']).not.toHaveProperty('directoryPath')

    // Reopen with a directory path — should update the existing tab
    state = open(state, {
      id: 'file-browser',
      kind: 'file-browser',
      directoryPath: 'src/components',
      revealToken: 1,
    })

    expect(state.right.tabIds).toEqual(['file-browser'])
    expect(state.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
      directoryPath: 'src/components',
      revealToken: 1,
    })

    // Update again with different directory
    state = open(state, {
      id: 'file-browser',
      kind: 'file-browser',
      directoryPath: 'src/features',
      revealToken: 2,
    })

    expect(state.right.tabIds).toEqual(['file-browser'])
    expect(state.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
      directoryPath: 'src/features',
      revealToken: 2,
    })
  })

  test('reopening file-browser tab preserves its panel location', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'file-browser',
      kind: 'file-browser',
    }, 'bottom')

    expect(state.bottom.tabIds).toEqual(['file-browser'])
    expect(state.right.tabIds).toEqual([])

    // Reopen with directoryPath — should stay in bottom panel
    state = open(state, {
      id: 'file-browser',
      kind: 'file-browser',
      directoryPath: 'src/components',
      revealToken: 42,
    })

    expect(state.bottom.tabIds).toEqual(['file-browser'])
    expect(state.right.tabIds).toEqual([])
    expect(state.tabsById['file-browser']).toMatchObject({
      directoryPath: 'src/components',
      revealToken: 42,
    })
  })

  test('validates valid relative directory paths from persisted file-browser state', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
      workbench: {
        schemaVersion: 2,
        tabsById: {
          'file-browser': {
            id: 'file-browser',
            kind: 'file-browser',
            directoryPath: 'src/components',
          },
        },
        right: {
          open: true,
          activeTabId: 'file-browser',
          tabIds: ['file-browser'],
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

    expect(state.workbench.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
      directoryPath: 'src/components',
    })
  })

  test('rejects absolute directory paths from persisted file-browser state', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
      workbench: {
        schemaVersion: 2,
        tabsById: {
          'file-browser': {
            id: 'file-browser',
            kind: 'file-browser',
            directoryPath: '/absolute/path',
          },
        },
        right: {
          open: true,
          activeTabId: 'file-browser',
          tabIds: ['file-browser'],
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

    expect(state.workbench.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
    })
    expect(
      state.workbench.tabsById['file-browser'],
    ).not.toHaveProperty('directoryPath')
  })

  test('rejects directory paths with parent traversal from persisted file-browser state', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
      workbench: {
        schemaVersion: 2,
        tabsById: {
          'file-browser': {
            id: 'file-browser',
            kind: 'file-browser',
            directoryPath: '../outside',
          },
        },
        right: {
          open: true,
          activeTabId: 'file-browser',
          tabIds: ['file-browser'],
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

    expect(state.workbench.tabsById['file-browser']).toMatchObject({
      kind: 'file-browser',
    })
    expect(
      state.workbench.tabsById['file-browser'],
    ).not.toHaveProperty('directoryPath')
  })
})

describe('workbench right panel sizing', () => {
  test('使用 Codex 响应式默认值并按比例适配窗口宽度', () => {
    expect(getResponsiveRightDockDefaultWidth(1_500, 800)).toBe(1_000)

    const ratio = rightDockWidthToRatio(700, 1_500)
    expect(rightDockWidthFromRatio(ratio, 1_500)).toBe(700)
    expect(rightDockWidthFromRatio(ratio, 1_200)).toBe(560)
  })

  test('临时窄工作区只夹紧右栏有效宽度并保留原始比例', () => {
    const ratio = rightDockWidthToRatio(500, 1_165)

    expect(rightDockWidthFromRatio(ratio, 1_165)).toBe(500)
    expect(rightDockWidthFromRatio(ratio, 685)).toBe(320)
    expect(rightDockWidthFromRatio(ratio, 1_165)).toBe(500)
  })

  test('底栏随工作区等比缩放并保护上下区域的最小高度', () => {
    const ratio = bottomPanelHeightToRatio(280, 800)

    expect(bottomPanelHeightFromRatio(ratio, 800)).toBe(280)
    expect(bottomPanelHeightFromRatio(ratio, 640)).toBe(224)
    expect(bottomPanelHeightFromRatio(ratio, 380)).toBe(160)
    expect(bottomPanelHeightFromRatio(ratio, 800)).toBe(280)
  })

  test('右栏自动隐藏和恢复使用 672/696 回差', () => {
    let state = createRightDockResponsiveState(800)
    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      workspaceWidth: 671,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      workspaceWidth: 680,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      workspaceWidth: 696,
    })
    expect(state).toEqual({ suppressed: false, manualOverride: false })
  })

  test('受限状态手动打开后保持显示，主动关闭后恢复自动抑制', () => {
    let state = createRightDockResponsiveState(660)
    state = reduceRightDockResponsiveState(state, {
      type: 'manualOpen',
      workspaceWidth: 660,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: true })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      workspaceWidth: 600,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: true })

    state = reduceRightDockResponsiveState(state, {
      type: 'manualClose',
      workspaceWidth: 600,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })
  })

  test('优先读取 v2 比例并兼容迁移旧比例和旧像素尺寸', () => {
    expect(
      resolveInitialRightDockWidthRatio('.4', '700', 1_165, 800),
    ).toBe(0.4)

    const migratedLegacyRatio = resolveInitialRightDockWidthRatio(
      null,
      '.5',
      1_165,
      800,
    )
    expect(rightDockWidthFromRatio(migratedLegacyRatio, 1_165)).toBe(567)

    const migratedPixels = resolveInitialRightDockWidthRatio(
      null,
      '500',
      1_165,
      800,
    )
    expect(rightDockWidthFromRatio(migratedPixels, 1_165)).toBe(500)

    expect(
      resolveInitialBottomPanelHeightRatio('.3', '280', 800),
    ).toBe(0.3)
    expect(
      resolveInitialBottomPanelHeightRatio(null, '280', 800),
    ).toBe(0.35)
  })

  test('非法存储值回退到当前工作区默认尺寸', () => {
    const rightRatio = resolveInitialRightDockWidthRatio(
      'invalid',
      '-1',
      1_165,
      800,
    )
    expect(rightDockWidthFromRatio(rightRatio, 1_165)).toBe(
      getResponsiveRightDockDefaultWidth(1_165, 800),
    )

    const bottomRatio = resolveInitialBottomPanelHeightRatio(
      '2',
      'invalid',
      800,
    )
    expect(bottomPanelHeightFromRatio(bottomRatio, 800)).toBe(280)
  })
})
