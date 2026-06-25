import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AskUserQuestionApproval,
  firstUnansweredQuestionIndex,
  nextQuestionIndex,
} from './AskUserQuestionApproval.js'
import type { DesktopPermissionRequest } from '../../shared/types.js'

test('AskUserQuestionApproval renders only the first question initially', () => {
  const html = renderToStaticMarkup(
    <AskUserQuestionApproval
      request={requestWithQuestions(3)}
      onReject={() => {}}
      onSubmit={() => {}}
    />,
  )

  expect(html).toContain('问题 1/3')
  expect(html).toContain('First choice?')
  expect(html).not.toContain('Second choice?')
  expect(html).not.toContain('Third choice?')
})

test('question pagination clamps to available questions', () => {
  expect(nextQuestionIndex(0, 1, 3)).toBe(1)
  expect(nextQuestionIndex(2, 1, 3)).toBe(2)
  expect(nextQuestionIndex(0, -1, 3)).toBe(0)
})

test('firstUnansweredQuestionIndex returns first question without an answer', () => {
  const questions = [
    { question: 'First choice?' },
    { question: 'Second choice?' },
    { question: 'Third choice?' },
  ]

  expect(
    firstUnansweredQuestionIndex(questions, {
      'First choice?': { selected: ['A'], custom: '' },
      'Second choice?': { selected: [], custom: 'custom answer' },
    }),
  ).toBe(2)
  expect(
    firstUnansweredQuestionIndex(questions, {
      'First choice?': { selected: ['A'], custom: '' },
      'Second choice?': { selected: [], custom: 'custom answer' },
      'Third choice?': { selected: ['C'], custom: '' },
    }),
  ).toBe(-1)
})

function requestWithQuestions(count: number): DesktopPermissionRequest {
  const questionTexts = [
    'First choice?',
    'Second choice?',
    'Third choice?',
    'Fourth choice?',
  ]
  return {
    requestId: 'question-request',
    toolName: 'AskUserQuestion',
    description: 'Answer questions?',
    input: {
      questions: questionTexts.slice(0, count).map((question, index) => ({
        question,
        header: `Q${index + 1}`,
        options: [
          { label: 'A', description: 'Choose A' },
          { label: 'B', description: 'Choose B' },
        ],
      })),
    },
  }
}
