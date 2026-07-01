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

test('computeSidebarResizeCollapseConfirm arms collapse when right-dock drag reduces width below min', () => {
  // Right-dock: dragging right (clientX increases) reduces rawWidth.
  // start.width=520, start.x=1000, clientX=1120 → rawWidth = 520+1000-1120 = 400
  expect(
    computeSidebarResizeCollapseConfirm({
      rawWidth: 400,
      minWidth: 520,
      pointerX: 1120,
      pointerY: 400,
      previousTarget: null,
      jitterTolerance: 6,
    }),
  ).toEqual({
    width: 520,
    armed: true,
    restartHold: true,
    target: { x: 1120, y: 400 },
  })
})

test('computeSidebarResizeCollapseConfirm cancels when right-dock drag increases width above min', () => {
  // Right-dock: dragging left (clientX decreases) increases rawWidth.
  // start.width=520, start.x=1000, clientX=860 → rawWidth = 520+1000-860 = 660
  expect(
    computeSidebarResizeCollapseConfirm({
      rawWidth: 660,
      minWidth: 520,
      pointerX: 860,
      pointerY: 400,
      previousTarget: { x: 860, y: 400 },
      jitterTolerance: 6,
    }),
  ).toEqual({
    width: 660,
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
