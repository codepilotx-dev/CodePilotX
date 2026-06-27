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

test('AskUserQuestion defaults to four questions outside desktop override', () => {
  delete process.env[ENV_NAME]

  expect(getAskUserQuestionMaxQuestions()).toBe(4)
  expect(AskUserQuestionTool.inputSchema.safeParse(inputWithQuestions(4)).success).toBe(
    true,
  )
  expect(AskUserQuestionTool.inputSchema.safeParse(inputWithQuestions(5)).success).toBe(
    false,
  )
})

test('AskUserQuestion honors desktop max questions override', () => {
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
