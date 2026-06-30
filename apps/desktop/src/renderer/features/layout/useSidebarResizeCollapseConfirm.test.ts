import { expect, test } from 'bun:test'
import {
  computeSidebarResizeCollapseConfirm,
  shouldRestartSidebarCollapseHold,
} from './useSidebarResizeCollapseConfirm.js'

test('computeSidebarResizeCollapseConfirm arms collapse confirmation below minimum width', () => {
  expect(
    computeSidebarResizeCollapseConfirm({
      rawWidth: 248,
      minWidth: 260,
      pointerX: 120,
      pointerY: 40,
      previousTarget: null,
      jitterTolerance: 6,
    }),
  ).toEqual({
    width: 260,
    armed: true,
    restartHold: true,
    target: { x: 120, y: 40 },
  })
})

test('computeSidebarResizeCollapseConfirm cancels confirmation when dragging wider again', () => {
  expect(
    computeSidebarResizeCollapseConfirm({
      rawWidth: 272,
      minWidth: 260,
      pointerX: 120,
      pointerY: 40,
      previousTarget: { x: 118, y: 42 },
      jitterTolerance: 6,
    }),
  ).toEqual({
    width: 272,
    armed: false,
    restartHold: false,
    target: null,
  })
})

test('shouldRestartSidebarCollapseHold only restarts after meaningful pointer movement', () => {
  expect(
    shouldRestartSidebarCollapseHold({
      previousTarget: { x: 100, y: 100 },
      pointerX: 103,
      pointerY: 104,
      jitterTolerance: 6,
    }),
  ).toBe(false)

  expect(
    shouldRestartSidebarCollapseHold({
      previousTarget: { x: 100, y: 100 },
      pointerX: 108,
      pointerY: 100,
      jitterTolerance: 6,
    }),
  ).toBe(true)
})
