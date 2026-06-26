import { describe, expect, test } from 'bun:test'
import { applyRightDockAction } from './rightDockState.js'

describe('applyRightDockAction', () => {
  test('opens the dock on the requested enabled tool', () => {
    expect(
      applyRightDockAction(
        { open: false, activeTool: 'review' },
        { type: 'openTool', tool: 'browser' },
      ),
    ).toEqual({ open: true, activeTool: 'browser' })
  })

  test('ignores disabled terminal actions', () => {
    expect(
      applyRightDockAction(
        { open: true, activeTool: 'files' },
        { type: 'openTool', tool: 'terminal' },
      ),
    ).toEqual({ open: true, activeTool: 'files' })
  })
})
