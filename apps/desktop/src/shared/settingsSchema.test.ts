import { expect, test } from 'bun:test'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from './settingsSchema.js'

test('desktop settings default AskUserQuestion max questions to one', () => {
  expect(defaultDesktopStoredSettings().askUserQuestionMaxQuestions).toBe(1)
})

test('desktop settings normalize AskUserQuestion max questions to one through four', () => {
  expect(
    normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 4 })
      .askUserQuestionMaxQuestions,
  ).toBe(4)
  expect(
    normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 2.7 })
      .askUserQuestionMaxQuestions,
  ).toBe(2)
  expect(
    normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 0 })
      .askUserQuestionMaxQuestions,
  ).toBe(1)
  expect(
    normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: 5 })
      .askUserQuestionMaxQuestions,
  ).toBe(4)
  expect(
    normalizeDesktopStoredSettings({ askUserQuestionMaxQuestions: '4' })
      .askUserQuestionMaxQuestions,
  ).toBe(1)
})
