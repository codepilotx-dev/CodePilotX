import { describe, expect, test } from 'bun:test'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchPanelState,
} from '../src/features/layout/rightDockState.js'
import { validateConversationUiState } from '../src/features/layout/conversationUiState.js'

describe('workbench panel state', () => {
  test('first bottom-panel toggle opens and selects Terminal', () => {
    const state = applyWorkbenchPanelAction(
      createDefaultWorkbenchPanelState(),
      { type: 'togglePanel', target: 'bottom' },
    )

    expect(state.bottom).toEqual({
      open: true,
      activeTool: 'terminal',
      openTools: ['terminal'],
    })
    expect(state.focusArea).toBe('bottom-panel')
  })

  test('first right-panel toggle opens the empty launcher', () => {
    const state = applyWorkbenchPanelAction(
      createDefaultWorkbenchPanelState(),
      { type: 'togglePanel', target: 'right' },
    )

    expect(state.right).toEqual({
      open: true,
      activeTool: null,
      openTools: [],
    })
  })

  test('closing a panel preserves its tabs for the next open', () => {
    const opened = applyWorkbenchPanelAction(
      createDefaultWorkbenchPanelState(),
      { type: 'openTool', target: 'right', tool: 'review' },
    )
    const closed = applyWorkbenchPanelAction(opened, {
      type: 'closePanel',
      target: 'right',
    })
    const reopened = applyWorkbenchPanelAction(closed, {
      type: 'togglePanel',
      target: 'right',
    })

    expect(closed.right.open).toBe(false)
    expect(closed.right.openTools).toEqual(['review'])
    expect(reopened.right).toEqual(opened.right)
  })

  test('moving and reordering tools keeps one instance across both panels', () => {
    let state = createDefaultWorkbenchPanelState()
    state = applyWorkbenchPanelAction(state, {
      type: 'openTool',
      target: 'right',
      tool: 'review',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'openTool',
      target: 'right',
      tool: 'files',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'moveTool',
      source: 'right',
      target: 'bottom',
      tool: 'review',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'openTool',
      target: 'bottom',
      tool: 'terminal',
    })
    state = applyWorkbenchPanelAction(state, {
      type: 'reorderTool',
      target: 'bottom',
      tool: 'terminal',
      index: 0,
    })

    expect(state.right.openTools).toEqual(['files'])
    expect(state.bottom.openTools).toEqual(['terminal', 'review'])
    expect(
      [...state.right.openTools, ...state.bottom.openTools].filter(
        tool => tool === 'review',
      ),
    ).toHaveLength(1)
  })

  test('closing a full-width right panel restores full width on reopen', () => {
    let state = applyWorkbenchPanelAction(
      createDefaultWorkbenchPanelState(),
      { type: 'openTool', target: 'right', tool: 'review' },
    )
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

  test('migrates the legacy rightDock snapshot without inventing bottom tabs', () => {
    const state = validateConversationUiState(
      {
        rightDock: {
          open: true,
          activeTool: 'review',
          openTools: ['review'],
        },
        plan: null,
        mainScrollTop: 42,
        sideChatInput: '',
        sideChatAttachments: [],
      },
      ['review', 'terminal'],
    )

    expect(state.panels.right.openTools).toEqual(['review'])
    expect(state.panels.bottom.openTools).toEqual([])
    expect(state.panels.bottom.open).toBe(false)
  })
})
