import { expect, test } from 'bun:test'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from './settingsSchema.js'

test('desktop settings no longer store AskUserQuestion max questions', () => {
  expect('askUserQuestionMaxQuestions' in defaultDesktopStoredSettings()).toBe(
    false,
  )
})

test('desktop settings default Rust search and diff kernels to disabled', () => {
  expect(defaultDesktopStoredSettings().rustSearchAndDiffKernels).toBe(false)
})

test('desktop settings normalize Rust search and diff kernels as a boolean', () => {
  expect(
    normalizeDesktopStoredSettings({ rustSearchAndDiffKernels: true })
      .rustSearchAndDiffKernels,
  ).toBe(true)
  expect(
    normalizeDesktopStoredSettings({ rustSearchAndDiffKernels: 'true' })
      .rustSearchAndDiffKernels,
  ).toBe(false)
})

test('desktop settings drop legacy AskUserQuestion max questions values', () => {
  expect(
    'askUserQuestionMaxQuestions' in
      normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 4 }),
  ).toBe(false)
})

test('desktop settings normalize plan permission mode to default', () => {
  expect(
    normalizeDesktopStoredSettings({ permissionMode: 'plan' }).permissionMode,
  ).toBe('default')
})
