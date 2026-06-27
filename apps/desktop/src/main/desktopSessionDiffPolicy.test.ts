import { expect, test } from 'bun:test'
import { shouldEmitWorkspaceDiffEvent } from './desktopSessionDiffPolicy.js'

test('does not emit workspace diff for standalone sessions', () => {
  expect(
    shouldEmitWorkspaceDiffEvent({
      beforePatch: null,
      afterPatch: 'Git status:\nM README.md',
      standalone: true,
    }),
  ).toBe(false)
})

test('does not emit unchanged dirty workspace diff for a turn', () => {
  expect(
    shouldEmitWorkspaceDiffEvent({
      beforePatch: 'Git status:\nM README.md',
      afterPatch: 'Git status:\nM README.md',
      standalone: false,
    }),
  ).toBe(false)
})

test('emits workspace diff when the turn changes the dirty state', () => {
  expect(
    shouldEmitWorkspaceDiffEvent({
      beforePatch: 'No file changes.',
      afterPatch: 'Git status:\nM README.md',
      standalone: false,
    }),
  ).toBe(true)
})
