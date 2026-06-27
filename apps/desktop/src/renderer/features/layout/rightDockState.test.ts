import { describe, expect, test } from 'bun:test'
import { applyRightDockAction, type RightDockState } from './rightDockState.js'

const empty: RightDockState = { open: false, activeTool: null, openTools: [] }

describe('applyRightDockAction', () => {
  test('openTool appends a new tool and reveals the dock', () => {
    expect(
      applyRightDockAction(empty, { type: 'openTool', tool: 'review' }),
    ).toEqual({ open: true, activeTool: 'review', openTools: ['review'] })
  })

  test('openTool supports the plan dock tool', () => {
    expect(
      applyRightDockAction(empty, { type: 'openTool', tool: 'plan' }),
    ).toEqual({ open: true, activeTool: 'plan', openTools: ['plan'] })
  })

  test('openTool reuses an already-open tool without duplicating', () => {
    const start: RightDockState = { open: true, activeTool: 'review', openTools: ['review'] }
    expect(
      applyRightDockAction(start, { type: 'openTool', tool: 'review' }),
    ).toEqual(start)
  })

  test('openTool ignores tools disabled by flags', () => {
    expect(
      applyRightDockAction(
        empty,
        { type: 'openTool', tool: 'toolProbe' },
        { debugMode: false },
      ),
    ).toEqual(empty)
  })

  test('openTool allows flags-gated tools when the flag is on', () => {
    expect(
      applyRightDockAction(
        empty,
        { type: 'openTool', tool: 'toolProbe' },
        { debugMode: true },
      ),
    ).toEqual({ open: true, activeTool: 'toolProbe', openTools: ['toolProbe'] })
  })

  test('openTool ignores unknown tool ids', () => {
    expect(
      applyRightDockAction(
        empty,
        // @ts-expect-error testing runtime guard
        { type: 'openTool', tool: 'unknown' },
      ),
    ).toEqual(empty)
  })

  test('selectTool switches active among opened tools without changing the list', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'review',
      openTools: ['review', 'files'],
    }
    expect(
      applyRightDockAction(start, { type: 'selectTool', tool: 'files' }),
    ).toEqual({ open: true, activeTool: 'files', openTools: ['review', 'files'] })
  })

  test('selectTool ignores a tool that has not been opened', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'review',
      openTools: ['review'],
    }
    expect(
      applyRightDockAction(start, { type: 'selectTool', tool: 'files' }),
    ).toEqual(start)
  })

  test('closeTool removes a non-active tool and preserves the active one', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'review',
      openTools: ['review', 'files', 'browser'],
    }
    expect(
      applyRightDockAction(start, { type: 'closeTool', tool: 'files' }),
    ).toEqual({ open: true, activeTool: 'review', openTools: ['review', 'browser'] })
  })

  test('closeTool falls back to the last remaining tool when the active is closed', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'browser',
      openTools: ['review', 'files', 'browser'],
    }
    expect(
      applyRightDockAction(start, { type: 'closeTool', tool: 'browser' }),
    ).toEqual({ open: true, activeTool: 'files', openTools: ['review', 'files'] })
  })

  test('closeTool on the last remaining tool hides the dock and clears active', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'review',
      openTools: ['review'],
    }
    expect(
      applyRightDockAction(start, { type: 'closeTool', tool: 'review' }),
    ).toEqual({ open: false, activeTool: null, openTools: [] })
  })

  test('close hides the dock while preserving the open list', () => {
    const start: RightDockState = {
      open: true,
      activeTool: 'review',
      openTools: ['review', 'files'],
    }
    expect(applyRightDockAction(start, { type: 'close' })).toEqual({
      open: false,
      activeTool: 'review',
      openTools: ['review', 'files'],
    })
  })
})
