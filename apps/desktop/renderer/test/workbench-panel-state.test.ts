import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  applyWorkbenchPanelAction,
  createSkillPreviewTab,
  createDefaultWorkbenchTabsState,
  type WorkbenchTabDescriptor,
} from '../src/features/layout/dock/rightDockState.js'
import {
  getWorkbenchLauncherDefinitions,
  getWorkbenchLauncherPresentation,
  getWorkbenchTabDefinition,
  getWorkbenchTabDisplayTitle,
} from '../src/features/layout/tabs/workbenchTabRegistry.js'
import {
  createDefaultConversationUiState,
  createDefaultReviewTabUiState,
  isReviewDiffExpanded,
  openPatchReviewTabState,
  toggleReviewDiffExpansion,
  validateConversationUiState,
} from '../src/features/layout/tabs/conversationUiState.js'
import {
  BOTTOM_PANEL_DEFAULT_HEIGHT,
  BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY,
  RIGHT_DOCK_DEFAULT_WIDTH,
  RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY,
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
import {
  WORKBENCH_LAYOUT_SCHEMA_VERSION,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  createDefaultWorkbenchLayoutSnapshot,
  readWorkbenchLayoutSnapshot,
  saveWorkbenchLayoutSnapshot,
} from '../src/features/layout/shell/workbenchLayoutStorage.js'
import {
  applyWorkbenchLayoutAction,
  clampAuxiliaryPanelWidth,
  clampBottomPanelHeight,
  createDefaultWorkbenchLayoutState,
  createDefaultVisibility,
  type WorkbenchLayoutSnapshot,
  type WorkbenchLayoutState,
} from '../src/features/layout/shell/workbenchLayoutState.js'
import { resolveIntegratedTerminalToggleAction } from '../src/features/layout/shell/useIntegratedTerminalController.js'
import { WorkbenchTabsHeader } from '../src/features/layout/dock/RightDock.js'
import { WorkbenchDockFrame } from '../src/features/layout/dock/WorkbenchDockFrame.js'
import { WorkbenchPanelLauncher } from '../src/features/layout/panels/WorkbenchPanelStates.js'

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
  test('launcher rows own their native interactive surface', () => {
    const markup = renderToStaticMarkup(createElement(WorkbenchPanelLauncher, {
      actions: [{
        disabled: true,
        icon: createElement('span', null, '图'),
        id: 'review',
        label: '代码审查',
        onSelect: () => undefined,
        reason: '当前不可用',
        shortcut: 'Ctrl+R',
      }],
    }))

    expect(markup).toContain('<button class="right-panel-tabs-empty-state__item" disabled="" title="当前不可用" type="button">')
    expect(markup).toContain('<strong>代码审查</strong>')
    expect(markup).toContain('<kbd>Ctrl+R</kbd>')
    expect(markup).not.toContain('ui-button')
  })

  test('dock frame leaves live geometry to the panel presence owner', () => {
    const markup = renderToStaticMarkup(createElement(
      WorkbenchDockFrame,
      {
        target: 'right',
        open: true,
        fullWidth: false,
        targetWidth: 600,
        visibleWidth: 600,
      },
      'content',
    ))

    expect(markup).toContain('data-app-shell-focus-area="right-panel"')
    expect(markup).toContain('data-workbench-panel-open="true"')
    expect(markup).not.toContain('--workbench-panel-animated-width')
    expect(markup).not.toContain('--workbench-panel-target-width')
  })

  test('始终复用一个用户附件预览标签并替换 descriptor', () => {
    const first = {
      id: 'user-attachment-preview',
      kind: 'attachment-preview',
      attachment: {
        id: 'first',
        kind: 'text',
        name: 'first.txt',
        mediaType: 'text/plain',
        sizeBytes: 5,
      },
      source: { storage: 'thread', attachmentId: 'first' },
    } as const
    const second = {
      ...first,
      attachment: { ...first.attachment, id: 'second', name: 'second.txt' },
      source: { storage: 'thread', attachmentId: 'second' },
    } as const
    const state = open(open(createDefaultWorkbenchTabsState(), first), second)

    expect(state.right.tabIds).toEqual(['user-attachment-preview'])
    expect(state.tabsById['user-attachment-preview']).toEqual(second)
  })

  test('拒绝从持久化状态恢复用户附件预览', () => {
    const base = createDefaultConversationUiState()
    base.workbench.tabsById['user-attachment-preview'] = {
      id: 'user-attachment-preview',
      kind: 'attachment-preview',
      attachment: {
        id: 'draft',
        kind: 'text',
        name: 'draft.txt',
        mediaType: 'text/plain',
        sizeBytes: 5,
      },
      source: { storage: 'draft', encoding: 'utf8', data: 'draft' },
    }
    base.workbench.right = {
      open: true,
      activeTabId: 'user-attachment-preview',
      tabIds: ['user-attachment-preview'],
    }
    const restored = validateConversationUiState(base)

    expect(restored.workbench.tabsById).toEqual({})
    expect(restored.workbench.right.tabIds).toEqual([])
  })

  test('labels the file browser placeholder as open file', () => {
    const tab = { id: 'file-browser', kind: 'file-browser' } as const
    const definition = getWorkbenchTabDefinition(tab)

    expect(definition.label).toBe('打开文件')
    expect(definition.getTitle(tab)).toBe('打开文件')
  })

  test('将非内置 Skill 打开为右侧临时只读预览标签', () => {
    const tab = createSkillPreviewTab({
      name: 'release-check',
      path: 'F:\\skills\\release-check\\SKILL.md',
      workspacePath: 'F:\\workspace',
    })
    const state = open(createDefaultWorkbenchTabsState(), tab)

    expect(tab.id).toMatch(/^skill-preview:[a-z0-9]+-[a-z0-9]+$/)
    expect(tab.id).not.toContain('release-check')
    expect(tab.id).not.toContain('F:')
    expect(state.right).toMatchObject({ open: true, activeTabId: tab.id })
    expect(getWorkbenchTabDefinition(tab).getTitle(tab)).toBe('release-check')
    expect(getWorkbenchTabDefinition(tab).launcher).toBe(false)
  })

  test('不会从会话 UI 状态恢复临时 Skill 预览标签', () => {
    const tab = createSkillPreviewTab({
      name: 'release-check',
      path: 'F:\\skills\\release-check\\SKILL.md',
      workspacePath: 'F:\\workspace',
    })
    const persisted = open(createDefaultWorkbenchTabsState(), tab)
    const restored = validateConversationUiState({
      schemaVersion: 4,
      workbench: persisted,
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
    })

    expect(restored.workbench.tabsById).toEqual({})
    expect(restored.workbench.right.tabIds).toEqual([])
  })

  test('matches the Codex launcher order and presentation without changing tab titles', () => {
    const launchers = getWorkbenchLauncherDefinitions()
    const presentation = launchers.map(definition => ({
      kind: definition.kind,
      ...getWorkbenchLauncherPresentation(definition),
    }))

    expect(presentation.map(item => item.kind)).toEqual([
      'review',
      'terminal',
      'browser',
      'file-browser',
      'side-chat',
    ])
    expect(presentation.map(item => item.label)).toEqual([
      '审阅',
      '终端',
      '浏览器',
      '文件',
      '侧边聊天',
    ])
    expect(presentation.map(item => item.shortcut)).toEqual([
      'Ctrl+Shift+G',
      undefined,
      'Ctrl+T',
      'Ctrl+P',
      'Ctrl+Alt+S',
    ])
    expect(getWorkbenchTabDefinition('file-browser').getTitle({
      id: 'file-browser',
      kind: 'file-browser',
    })).toBe('打开文件')
  })

  test('hides the add button for an empty header and restores the add menu for side-chat tabs', () => {
    const baseProps = {
      target: 'right' as const,
      terminalDisplayPath: null,
      onCloseTab: () => undefined,
      onCloseOtherTabs: () => undefined,
      onCloseTabsToRight: () => undefined,
      onOpenTab: () => undefined,
      onCreateSideChat: () => undefined,
      sideChatAvailable: true,
      onSelectTab: () => undefined,
      onMoveTab: () => undefined,
      onReorderTab: () => undefined,
      onPinTab: () => undefined,
    }
    const emptyMarkup = renderToStaticMarkup(createElement(WorkbenchTabsHeader, {
      ...baseProps,
      state: { open: true, activeTabId: null, tabIds: [] },
      tabsById: {},
    }))
    const sideChat = {
      id: 'side-chat:thread-side-1',
      kind: 'side-chat',
      threadId: 'thread-side-1',
      sourceThreadId: 'thread-main',
      inheritedThroughTurnId: null,
      title: '侧边聊天',
    } as const
    const sideChatMarkup = renderToStaticMarkup(createElement(WorkbenchTabsHeader, {
      ...baseProps,
      state: { open: true, activeTabId: sideChat.id, tabIds: [sideChat.id] },
      tabsById: { [sideChat.id]: sideChat },
    }))

    expect(emptyMarkup).not.toContain('aria-label="添加标签"')
    expect(emptyMarkup).not.toContain('aria-label="新建侧边聊天"')
    expect(sideChatMarkup).toContain('aria-label="添加标签"')
    expect(sideChatMarkup).not.toContain('aria-label="新建侧边聊天"')
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

  test('persists only the canonical terminal descriptor', () => {
    const terminal = { id: 'terminal', kind: 'terminal' } as const
    const opened = open(createDefaultWorkbenchTabsState(), terminal, 'bottom')
    const restored = validateConversationUiState({
      schemaVersion: 4,
      workbench: opened,
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
    })

    expect(getWorkbenchTabDefinition(terminal).label).toBe('终端')
    expect(restored.workbench.tabsById.terminal).toEqual(terminal)
    expect(restored.workbench.bottom.tabIds).toEqual(['terminal'])
  })

  test('terminal title uses the in-memory display path with a stable fallback', () => {
    const terminal = { id: 'terminal', kind: 'terminal' } as const

    expect(getWorkbenchTabDisplayTitle(terminal, 'C:\\repo')).toBe('C:\\repo')
    expect(getWorkbenchTabDisplayTitle(terminal, '')).toBe('终端')
    expect(getWorkbenchTabDisplayTitle(terminal, null)).toBe('终端')
    expect(getWorkbenchTabDisplayTitle(browser, 'C:\\repo')).toBe('浏览器')
  })

  test('bottom header keeps add after tabs, spacer next, and panel close last', () => {
    const markup = renderToStaticMarkup(createElement(WorkbenchTabsHeader, {
      target: 'bottom',
      state: { open: true, activeTabId: 'terminal', tabIds: ['terminal'] },
      tabsById: { terminal: { id: 'terminal', kind: 'terminal' } },
      terminalDisplayPath: 'C:\\repo',
      onClosePanel: () => undefined,
      onCloseTab: () => undefined,
      onCloseOtherTabs: () => undefined,
      onCloseTabsToRight: () => undefined,
      onOpenTab: () => undefined,
      onCreateSideChat: () => undefined,
      sideChatAvailable: true,
      onSelectTab: () => undefined,
      onMoveTab: () => undefined,
      onReorderTab: () => undefined,
      onPinTab: () => undefined,
    }))
    const terminalTab = markup.indexOf('data-panel-tab="terminal"')
    const addButton = markup.indexOf('aria-label="添加标签"')
    const spacer = markup.indexOf('class="right-dock-tab-empty"')
    const closePanel = markup.indexOf('title="关闭底部面板"')

    expect(markup).toContain('title="C:\\repo"')
    expect(markup).toContain('aria-label="关闭 C:\\repo"')
    expect(markup).toContain('aria-label="关闭底部面板"')
    expect(terminalTab).toBeGreaterThanOrEqual(0)
    expect(addButton).toBeGreaterThan(terminalTab)
    expect(spacer).toBeGreaterThan(addButton)
    expect(closePanel).toBeGreaterThan(spacer)
  })

  test('resolves terminal button behavior from its current panel location', () => {
    const initial = createDefaultWorkbenchTabsState()
    const bottom = open(initial, { id: 'terminal', kind: 'terminal' }, 'bottom')
    const right = open(initial, { id: 'terminal', kind: 'terminal' }, 'right')

    expect(resolveIntegratedTerminalToggleAction(null, initial)).toBe('unavailable')
    expect(resolveIntegratedTerminalToggleAction('thread-1', initial)).toBe('open-bottom')
    expect(resolveIntegratedTerminalToggleAction('thread-1', bottom)).toBe('hide-bottom')
    expect(resolveIntegratedTerminalToggleAction('thread-1', right)).toBe('move-to-bottom')
    expect(resolveIntegratedTerminalToggleAction('thread-1', right, false)).toBe('unavailable')
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

  test('closing or moving the last tab closes its empty source panel', () => {
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = applyWorkbenchPanelAction(state, {
      type: 'toggleRightFullWidth',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'review',
    })

    expect(state.right).toEqual({
      open: false,
      activeTabId: null,
      tabIds: [],
    })
    expect(state.rightFullWidth).toBe(false)
    expect(state.focusArea).toBe('main')

    state = open(state, { id: 'terminal', kind: 'terminal' }, 'right')
    state = applyWorkbenchPanelAction(state, {
      type: 'moveTab',
      source: 'right',
      target: 'bottom',
      tabId: 'terminal',
    })
    expect(state.right.open).toBe(false)
    expect(state.bottom.open).toBe(true)
    expect(state.bottom.activeTabId).toBe('terminal')
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

  test('replaces a loading side-chat tab in place', () => {
    const loading = {
      id: 'side-chat:loading:1',
      kind: 'side-chat',
      threadId: 'loading:1',
      sourceThreadId: 'thread-main',
      inheritedThroughTurnId: null,
      title: '侧边聊天',
    } as const
    const ready = {
      ...loading,
      id: 'side-chat:thread-side-1',
      threadId: 'thread-side-1',
      inheritedThroughTurnId: 'turn-boundary',
    } as const
    let state = open(createDefaultWorkbenchTabsState(), review)
    state = open(state, loading)
    state = applyWorkbenchPanelAction(state, {
      type: 'replaceTab',
      previousTabId: loading.id,
      tab: ready,
    })

    expect(state.right.tabIds).toEqual(['review', ready.id])
    expect(state.right.activeTabId).toBe(ready.id)
    expect(state.tabsById[loading.id]).toBeUndefined()
    expect(state.tabsById[ready.id]).toEqual(ready)
  })

  test('back/close from a side task removes its tab, closes the panel, and restores main focus', () => {
    const sideChat = {
      id: 'side-chat:thread-side-1',
      kind: 'side-chat',
      threadId: 'thread-side-1',
      sourceThreadId: 'thread-main',
      inheritedThroughTurnId: null,
      title: '侧边聊天',
    } as const
    let state = open(createDefaultWorkbenchTabsState(), sideChat)
    state = open(state, {
      id: 'side-task:task-1',
      kind: 'side-task',
      taskId: 'task-1',
      childThreadId: 'thread-1',
    })

    // 返回箭头/标签 × 的同一行为：先移除当前 side-task 标签，再关闭所在面板
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'side-task:task-1',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closePanel',
      target: 'right',
    })

    expect(state.right.tabIds).toEqual([sideChat.id])
    expect(state.tabsById['side-task:task-1']).toBeUndefined()
    expect(state.right.open).toBe(false)
    expect(state.focusArea).toBe('main')
    // 普通侧边聊天标签不受影响
    expect(state.tabsById[sideChat.id]).toEqual(sideChat)
    expect(state.bottom.tabIds).toEqual([])
  })

  test('closing a full-width right panel from a side task exits full width', () => {
    let state = open(createDefaultWorkbenchTabsState(), {
      id: 'side-task:task-1',
      kind: 'side-task',
      taskId: 'task-1',
      childThreadId: 'thread-1',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'toggleRightFullWidth',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closeTab',
      target: 'right',
      tabId: 'side-task:task-1',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'closePanel',
      target: 'right',
    })

    expect(state.rightFullWidth).toBe(false)
    expect(state.focusArea).toBe('main')
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
    expect(state.workbench.bottom.tabIds).toEqual([])
    expect(state.workbench.bottom.activeTabId).toBeNull()
    expect(state.workbench.tabsById['tool-probe']).toBeUndefined()
    expect(state.workbench.tabsById).toEqual({
      review,
      [fileTab.id]: fileTab,
      [planTab.id]: planTab,
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

  test('opens a patch file in the current workspace Review source', () => {
    const current = {
      ...createDefaultReviewTabUiState(),
      source: { kind: 'branch', branch: 'main' } as const,
      selectedFile: 'src/old.ts',
      selectedCommentId: 'comment-1',
      scrollTop: 480,
      diffExpansion: { mode: 'none' } as const,
    }

    expect(openPatchReviewTabState(current, 'src/new.ts')).toMatchObject({
      source: { kind: 'unstaged' },
      selectedFile: 'src/new.ts',
      selectedCommentId: null,
      scrollTop: 0,
      diffExpansion: { mode: 'all' },
    })
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

  test('rebinds restored file tabs to the current project folder identity', () => {
    const state = validateConversationUiState({
      schemaVersion: 4,
      workbench: {
        schemaVersion: 2,
        tabsById: {
          'file:README.md': {
            id: 'file:README.md',
            kind: 'file-preview',
            workspacePath: 'F:\\project',
            projectId: 'stale-project',
            folderId: 'stale-folder',
            relativePath: 'README.md',
            preview: false,
          },
        },
        right: {
          open: true,
          activeTabId: 'file:README.md',
          tabIds: ['file:README.md'],
        },
        bottom: { open: false, activeTabId: null, tabIds: [] },
        rightFullWidth: false,
        restoreRightFullWidthOnNextOpen: false,
        focusArea: 'right-panel',
      },
      mainScrollTop: 0,
      sideChatInput: '',
      sideChatAttachments: [],
    }, {
      fileScopes: [{
        projectId: 'current-project',
        folderId: 'current-folder',
        workspacePath: 'F:/project',
      }],
    })

    expect(state.workbench.tabsById['file:README.md']).toMatchObject({
      projectId: 'current-project',
      folderId: 'current-folder',
    })
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
  test('使用 Codex 动态公式计算默认宽度并按可用工作区夹紧', () => {
    expect(RIGHT_DOCK_DEFAULT_WIDTH).toBe(600)
    expect(getResponsiveRightDockDefaultWidth(1_500, 800)).toBe(1_000)
    expect(getResponsiveRightDockDefaultWidth(700, 800)).toBe(348)

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
    const ratio = bottomPanelHeightToRatio(220, 800)

    expect(bottomPanelHeightFromRatio(ratio, 800)).toBe(220)
    expect(bottomPanelHeightFromRatio(ratio, 640)).toBe(176)
    expect(bottomPanelHeightFromRatio(ratio, 380)).toBe(160)
    expect(bottomPanelHeightFromRatio(ratio, 800)).toBe(220)
  })

  test('右栏按整窗 960px 阈值自动收起，恢复保留 24px 回差', () => {
    let state = createRightDockResponsiveState(800)
    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      windowWidth: 959,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      windowWidth: 970,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      windowWidth: 984,
    })
    expect(state).toEqual({ suppressed: false, manualOverride: false })
  })

  test('受限状态手动打开后保持显示，主动关闭后恢复自动抑制', () => {
    let state = createRightDockResponsiveState(660)
    state = reduceRightDockResponsiveState(state, {
      type: 'manualOpen',
      windowWidth: 660,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: true })

    state = reduceRightDockResponsiveState(state, {
      type: 'resize',
      windowWidth: 600,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: true })

    state = reduceRightDockResponsiveState(state, {
      type: 'manualClose',
      windowWidth: 600,
    })
    expect(state).toEqual({ suppressed: true, manualOverride: false })
  })

  test('保留右栏 v2 比例 key，并用底栏 v3 重置旧高度', () => {
    expect(RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY).toEndWith('.v2')
    expect(BOTTOM_PANEL_HEIGHT_RATIO_STORAGE_KEY).toEndWith('.v3')
    expect(BOTTOM_PANEL_DEFAULT_HEIGHT).toBe(220)

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
      resolveInitialBottomPanelHeightRatio('.3', 800),
    ).toBe(0.3)
    expect(
      resolveInitialBottomPanelHeightRatio(null, 800),
    ).toBe(0.275)
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
      800,
    )
    expect(bottomPanelHeightFromRatio(bottomRatio, 800)).toBe(220)
  })
})

describe('workbench layout snapshot v1', () => {
  const baselineInput = {
    workspaceWidth: 1_600,
    workspaceHeight: 900,
    sidebarCollapsed: false,
    sidebarWidth: 300,
    rightDockRatio: 0.4,
    bottomPanelRatio: 0.25,
  } as const

  function makeSnapshot(
    overrides: Partial<WorkbenchLayoutSnapshot> = {},
  ): WorkbenchLayoutSnapshot {
    const base = createDefaultWorkbenchLayoutSnapshot(baselineInput)
    return { ...base, ...overrides }
  }

  function makeMemoryStorage(): Storage {
    const map = new Map<string, string>()
    return {
      get length() {
        return map.size
      },
      clear() {
        map.clear()
      },
      getItem(key) {
        return map.get(key) ?? null
      },
      key(index) {
        return Array.from(map.keys())[index] ?? null
      },
      removeItem(key) {
        map.delete(key)
      },
      setItem(key, value) {
        map.set(key, String(value))
      },
    } as Storage
  }

  test('默认可见态下 mainContent 必须为 true', () => {
    const state = createDefaultWorkbenchLayoutState(1_600, 900)

    expect(state.visibility.mainContent).toBe(true)
    expect(state.visibility.primarySidebar).toBe(true)
    expect(state.auxiliaryMaximized).toBe(false)
    expect(state.beforeAuxiliaryMaximized).toBeNull()
    expect(state.beforeAuxiliaryMaximizedAuxiliaryWidth).toBeNull()
  })

  test('legacy/default 构造以调用方传入的 sidebar 状态覆盖 primarySidebar', () => {
    const visible = createDefaultWorkbenchLayoutSnapshot(baselineInput)
    const collapsed = createDefaultWorkbenchLayoutSnapshot({
      ...baselineInput,
      sidebarCollapsed: true,
      sidebarWidth: 480,
    })

    expect(visible.visibility.primarySidebar).toBe(true)
    expect(visible.primarySidebarWidth).toBe(300)
    expect(visible.auxiliaryPanelWidth).toBe(640)
    expect(visible.bottomPanelHeight).toBe(225)
    expect(visible.visibility.mainContent).toBe(true)

    expect(collapsed.visibility.primarySidebar).toBe(false)
    expect(collapsed.primarySidebarWidth).toBe(480)
  })

  test('合法 v1 解析并返回 clamp 后的快照', () => {
    const storage = makeMemoryStorage()
    const oversized: WorkbenchLayoutSnapshot = makeSnapshot({
      primarySidebarWidth: 9_999,
      auxiliaryPanelWidth: 9_999,
      bottomPanelHeight: 9_999,
    })
    storage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(oversized))

    const result = readWorkbenchLayoutSnapshot(
      { ...baselineInput, sidebarCollapsed: true },
      { storage },
    )

    expect(result.schemaVersion).toBe(WORKBENCH_LAYOUT_SCHEMA_VERSION)
    expect(result.primarySidebarWidth).toBeLessThanOrEqual(520)
    expect(result.primarySidebarWidth).toBeGreaterThanOrEqual(240)
    expect(result.auxiliaryPanelWidth).toBeLessThanOrEqual(
      1_600 - 352,
    )
    expect(result.auxiliaryPanelWidth).toBeGreaterThanOrEqual(320)
    expect(result.bottomPanelHeight).toBeGreaterThanOrEqual(160)
    expect(result.visibility.mainContent).toBe(true)
  })

  test('非法 v1 字符串回退到调用方输入构造的默认快照', () => {
    const storage = makeMemoryStorage()
    storage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, '{"schemaVersion":1')

    const result = readWorkbenchLayoutSnapshot(baselineInput, { storage })

    expect(result.schemaVersion).toBe(WORKBENCH_LAYOUT_SCHEMA_VERSION)
    expect(result.primarySidebarWidth).toBe(300)
    expect(result.auxiliaryPanelWidth).toBe(640)
    expect(result.bottomPanelHeight).toBe(225)
    expect(result.auxiliaryMaximized).toBe(false)
  })

  test('schemaVersion 不匹配时回退到默认快照', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 99,
        visibility: createDefaultVisibility(),
        primarySidebarWidth: 300,
        auxiliaryPanelWidth: 500,
        bottomPanelHeight: 200,
        auxiliaryMaximized: false,
        beforeAuxiliaryMaximized: null,
        beforeAuxiliaryMaximizedAuxiliaryWidth: null,
      }),
    )

    const result = readWorkbenchLayoutSnapshot(baselineInput, { storage })

    expect(result.auxiliaryPanelWidth).toBe(640)
    expect(result.primarySidebarWidth).toBe(300)
  })

  test('缺失关键字段的 v1 回退到默认快照', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        visibility: createDefaultVisibility(),
        auxiliaryMaximized: false,
        beforeAuxiliaryMaximized: null,
        beforeAuxiliaryMaximizedAuxiliaryWidth: null,
      }),
    )

    const result = readWorkbenchLayoutSnapshot(baselineInput, { storage })

    expect(result.auxiliaryPanelWidth).toBe(640)
    expect(result.bottomPanelHeight).toBe(225)
  })

  test('visibility 字段非 boolean 时整体回退默认快照', () => {
    const storage = makeMemoryStorage()
    storage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        visibility: {
          primarySidebar: true,
          mainContent: true,
          auxiliaryPanel: 'yes',
          bottomPanel: false,
        },
        primarySidebarWidth: 300,
        auxiliaryPanelWidth: 500,
        bottomPanelHeight: 200,
        auxiliaryMaximized: false,
        beforeAuxiliaryMaximized: null,
        beforeAuxiliaryMaximizedAuxiliaryWidth: null,
      }),
    )

    const result = readWorkbenchLayoutSnapshot(baselineInput, { storage })

    expect(result.auxiliaryPanelWidth).toBe(640)
    expect(result.bottomPanelHeight).toBe(225)
    expect(result.visibility.auxiliaryPanel).toBe(true)
  })

  test('save helper 只写 v1 key，不破坏其他 key', () => {
    const storage = makeMemoryStorage()
    storage.setItem(RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY, '.5')
    storage.setItem('codepilotx.legacy.otherKey', 'untouched')

    const snapshot = makeSnapshot({ primarySidebarWidth: 305 })
    saveWorkbenchLayoutSnapshot(snapshot, { storage })

    expect(storage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)).not.toBeNull()
    expect(storage.getItem(RIGHT_DOCK_WIDTH_RATIO_STORAGE_KEY)).toBe('.5')
    expect(storage.getItem('codepilotx.legacy.otherKey')).toBe('untouched')
    const written = JSON.parse(
      storage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) as string,
    )
    expect(written.schemaVersion).toBe(WORKBENCH_LAYOUT_SCHEMA_VERSION)
    expect(written.primarySidebarWidth).toBe(305)
  })

  test('尺寸 clamp 在 reducer 中统一应用', () => {
    const state = createDefaultWorkbenchLayoutState(1_600, 900)

    const tooSmall = applyWorkbenchLayoutAction(state, {
      type: 'commitPrimarySidebarSize',
      size: 10,
    })
    const tooLarge = applyWorkbenchLayoutAction(state, {
      type: 'commitAuxiliaryPanelSize',
      size: 9_999,
      workspaceWidth: 1_600,
    })
    const tooTall = applyWorkbenchLayoutAction(state, {
      type: 'commitBottomPanelSize',
      size: 9_999,
      workspaceHeight: 900,
    })

    expect(tooSmall.primarySidebarWidth).toBe(240)
    expect(tooLarge.auxiliaryPanelWidth).toBe(1_248)
    expect(tooTall.bottomPanelHeight).toBeLessThanOrEqual(450)
    expect(tooTall.bottomPanelHeight).toBeGreaterThanOrEqual(160)
  })

  test('辅助栏宽度 clamp helper 与 right dock 范围一致', () => {
    expect(clampAuxiliaryPanelWidth(9_999, 1_600)).toBe(1_248)
    expect(clampAuxiliaryPanelWidth(0, 1_600)).toBe(320)
    expect(clampBottomPanelHeight(9_999, 900)).toBeLessThanOrEqual(450)
    expect(clampBottomPanelHeight(0, 900)).toBe(160)
  })

  test('隐藏 Part 后再显示保持原始尺寸', () => {
    const initial = applyWorkbenchLayoutAction(
      createDefaultWorkbenchLayoutState(1_600, 900),
      { type: 'commitPrimarySidebarSize', size: 320 },
    )

    const hidden = applyWorkbenchLayoutAction(initial, {
      type: 'setVisibility',
      part: 'primary-sidebar',
      visible: false,
    })
    const shown = applyWorkbenchLayoutAction(hidden, {
      type: 'setVisibility',
      part: 'primary-sidebar',
      visible: true,
    })

    expect(shown.visibility.primarySidebar).toBe(true)
    expect(shown.primarySidebarWidth).toBe(initial.primarySidebarWidth)
  })

  test('进入/退出辅助栏最大化完整恢复可见集合与宽度', () => {
    const baseline = createDefaultWorkbenchLayoutState(1_600, 900)
    baseline.auxiliaryPanelWidth = 720
    baseline.visibility.bottomPanel = true

    const entered = applyWorkbenchLayoutAction(baseline, {
      type: 'enterAuxiliaryMaximized',
    })
    expect(entered.auxiliaryMaximized).toBe(true)
    expect(entered.visibility).toEqual({
      primarySidebar: false,
      mainContent: false,
      auxiliaryPanel: true,
      bottomPanel: false,
    })
    expect(entered.beforeAuxiliaryMaximized).toEqual(baseline.visibility)
    expect(entered.beforeAuxiliaryMaximizedAuxiliaryWidth).toBe(720)
    expect(entered.auxiliaryPanelWidth).toBe(720)

    const exited = applyWorkbenchLayoutAction(entered, {
      type: 'exitAuxiliaryMaximized',
    })
    expect(exited.auxiliaryMaximized).toBe(false)
    expect(exited.visibility).toEqual(baseline.visibility)
    expect(exited.auxiliaryPanelWidth).toBe(720)
    expect(exited.beforeAuxiliaryMaximized).toBeNull()
    expect(exited.beforeAuxiliaryMaximizedAuxiliaryWidth).toBeNull()
  })

  test('重复进入或退出最大化是无操作', () => {
    const state = createDefaultWorkbenchLayoutState(1_600, 900)
    const entered = applyWorkbenchLayoutAction(state, {
      type: 'enterAuxiliaryMaximized',
    })
    const enteredAgain = applyWorkbenchLayoutAction(entered, {
      type: 'enterAuxiliaryMaximized',
    })
    expect(enteredAgain).toBe(entered)

    const exited = applyWorkbenchLayoutAction(enteredAgain, {
      type: 'exitAuxiliaryMaximized',
    })
    const exitedAgain = applyWorkbenchLayoutAction(exited, {
      type: 'exitAuxiliaryMaximized',
    })
    expect(exitedAgain).toBe(exited)
  })

  test('普通态下关闭 main-content 是无操作，最大化内部仍由 enter 切换', () => {
    const state = createDefaultWorkbenchLayoutState(1_600, 900)
    const rejected = applyWorkbenchLayoutAction(state, {
      type: 'setVisibility',
      part: 'main-content',
      visible: false,
    })
    expect(rejected).toBe(state)
    expect(rejected.visibility.mainContent).toBe(true)

    const maximized = applyWorkbenchLayoutAction(state, {
      type: 'enterAuxiliaryMaximized',
    })
    expect(maximized.visibility.mainContent).toBe(false)

    const restored = applyWorkbenchLayoutAction(maximized, {
      type: 'exitAuxiliaryMaximized',
    })
    expect(restored.visibility.mainContent).toBe(true)
  })

  test('最大化期间隐藏辅助栏恢复 mainContent 且保留可见集合', () => {
    const baseline = createDefaultWorkbenchLayoutState(1_600, 900)
    baseline.visibility.mainContent = true
    baseline.auxiliaryPanelWidth = 700

    const maximized: WorkbenchLayoutState = applyWorkbenchLayoutAction(
      baseline,
      { type: 'enterAuxiliaryMaximized' },
    )
    const restored: WorkbenchLayoutState = applyWorkbenchLayoutAction(
      maximized,
      { type: 'setVisibility', part: 'auxiliary-panel', visible: false },
    )

    expect(restored.auxiliaryMaximized).toBe(false)
    expect(restored.visibility.auxiliaryPanel).toBe(false)
    expect(restored.visibility.mainContent).toBe(true)
    expect(restored.visibility.primarySidebar).toBe(
      maximized.beforeAuxiliaryMaximized?.primarySidebar,
    )
    expect(restored.visibility.bottomPanel).toBe(
      maximized.beforeAuxiliaryMaximized?.bottomPanel,
    )
    expect(restored.auxiliaryPanelWidth).toBe(700)
    expect(restored.beforeAuxiliaryMaximized).toBeNull()
    expect(restored.beforeAuxiliaryMaximizedAuxiliaryWidth).toBeNull()
  })

  test('持久化时最大化快照保持 beforeAuxiliaryMaximized 字段以便恢复', () => {
    const storage = makeMemoryStorage()
    const baseline: WorkbenchLayoutState =
      createDefaultWorkbenchLayoutState(1_600, 900)
    baseline.visibility.bottomPanel = true
    baseline.auxiliaryPanelWidth = 660

    const snapshot: WorkbenchLayoutSnapshot = {
      ...applyWorkbenchLayoutAction(baseline, {
        type: 'enterAuxiliaryMaximized',
      }),
      schemaVersion: WORKBENCH_LAYOUT_SCHEMA_VERSION,
    }
    saveWorkbenchLayoutSnapshot(snapshot, { storage })

    const restored = readWorkbenchLayoutSnapshot(baselineInput, { storage })

    expect(restored.auxiliaryMaximized).toBe(true)
    expect(restored.beforeAuxiliaryMaximized).not.toBeNull()
    expect(restored.beforeAuxiliaryMaximizedAuxiliaryWidth).toBe(660)

    const exited: WorkbenchLayoutState = applyWorkbenchLayoutAction(
      restored as WorkbenchLayoutState,
      { type: 'exitAuxiliaryMaximized' },
    )
    expect(exited.visibility).toEqual(baseline.visibility)
    expect(exited.auxiliaryPanelWidth).toBe(660)
  })
})
