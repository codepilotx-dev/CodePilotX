import { afterEach, expect, test } from 'bun:test'
import {
  AskUserQuestionTool,
  getAskUserQuestionMaxQuestions,
} from './AskUserQuestionTool.js'

const ENV_NAME = 'CODEPILOTX_ASK_USER_QUESTION_MAX_QUESTIONS'
const originalValue = process.env[ENV_NAME]

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_NAME]
  } else {
    process.env[ENV_NAME] = originalValue
  }
})

test('AskUserQuestion has no default question count limit', () => {
  delete process.env[ENV_NAME]

  expect(getAskUserQuestionMaxQuestions()).toBe(null)
  expect(AskUserQuestionTool.inputSchema.safeParse(inputWithQuestions(5)).success).toBe(
    true,
  )
})

test('AskUserQuestion honors explicit max questions override', () => {
  process.env[ENV_NAME] = '1'

  expect(getAskUserQuestionMaxQuestions()).toBe(1)
  expect(AskUserQuestionTool.inputSchema.safeParse(inputWithQuestions(1)).success).toBe(
    true,
  )
  expect(AskUserQuestionTool.inputSchema.safeParse(inputWithQuestions(2)).success).toBe(
    false,
  )
})

function inputWithQuestions(count: number): Record<string, unknown> {
  return {
    questions: Array.from({ length: count }, (_, index) => ({
      question: `Question ${index + 1}?`,
      header: `Q${index + 1}`,
      options: [
        { label: 'Yes', description: 'Choose yes' },
        { label: 'No', description: 'Choose no' },
      ],
    })),
  }
}
