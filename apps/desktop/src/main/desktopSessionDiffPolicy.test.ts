import { expect, test } from 'bun:test'
import {
  buildTurnDiffPatch,
  shouldEmitWorkspaceDiffEvent,
} from './desktopSessionDiffPolicy.js'

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

test('turn diff excludes pre-existing dirty files that did not change', () => {
  const beforePatch = [
    'Git status:',
    ' M README.md',
    '',
    'Diff:',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+dirty',
    '',
  ].join('\n')

  const afterPatch = [
    'Git status:',
    ' M README.md',
    ' M src/app.ts',
    '',
    'Diff:',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+dirty',
    'diff --git a/src/app.ts b/src/app.ts',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1 +1 @@',
    '-before',
    '+after',
    '',
  ].join('\n')

  expect(buildTurnDiffPatch({ beforePatch, afterPatch })).toContain('src/app.ts')
  expect(buildTurnDiffPatch({ beforePatch, afterPatch })).not.toContain(
    'README.md',
  )
})

test('turn diff includes pre-existing dirty files that changed again', () => {
  const beforePatch = [
    'Git status:',
    ' M README.md',
    '',
    'Diff:',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+dirty',
    '',
  ].join('\n')
  const afterPatch = beforePatch.replace('+dirty', '+dirty again')

  expect(buildTurnDiffPatch({ beforePatch, afterPatch })).toContain('README.md')
})

test('turn diff includes files restored to clean during the turn', () => {
  const beforePatch = [
    'Git status:',
    ' M README.md',
    '',
    'Diff:',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old',
    '+dirty',
    '',
  ].join('\n')

  expect(
    buildTurnDiffPatch({ beforePatch, afterPatch: 'No file changes.' }),
  ).toContain('README.md')
})
