import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AskUserQuestionApproval,
  answerForSelectedOption,
  firstUnansweredQuestionIndex,
  initialQuestionState,
  nextOptionLabel,
  nextQuestionIndex,
} from './AskUserQuestionApproval.js'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

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

test('AskUserQuestionApproval marks the first option as recommended by default', () => {
  const html = renderToStaticMarkup(
    <AskUserQuestionApproval
      request={requestWithQuestions(1)}
      onReject={() => {}}
      onSubmit={() => {}}
    />,
  )

  expect(html).toContain('aria-checked="true"')
  expect(html).toContain('inline-approval-option-hint"> （推荐）')
  expect(html).toContain('inline-approval-option-trailing')
  expect(html).toContain('Choose A')
  expect(html.indexOf('inline-approval-option-info')).toBeLessThan(
    html.indexOf('inline-approval-option-hint'),
  )
})

test('AskUserQuestionApproval strips model supplied recommended suffix from labels', () => {
  const request = requestWithQuestions(1)
  const questions = request.input.questions as Array<{
    options: Array<{ label: string; description: string }>
  }>
  questions[0]!.options[0]!.label = 'A (Recommended)'

  const html = renderToStaticMarkup(
    <AskUserQuestionApproval
      request={request}
      onReject={() => {}}
      onSubmit={() => {}}
    />,
  )

  expect(html).toContain('>A<span')
  expect(html).toContain('inline-approval-option-hint"> （推荐）')
  expect(html).not.toContain('A (Recommended)')
})

test('answerForSelectedOption returns the clicked option as the submitted answer', () => {
  const [question] = parseRequestQuestions(1)

  expect(answerForSelectedOption(question, 'B')).toEqual({
    'First choice?': 'B',
  })
})

test('initialQuestionState selects the first option', () => {
  const [question] = parseRequestQuestions(1)

  expect(initialQuestionState(question)).toEqual({
    selected: ['A'],
    custom: '',
  })
})

test('nextOptionLabel clamps keyboard option navigation', () => {
  const [question] = parseRequestQuestions(1)

  expect(nextOptionLabel(question, 'A', 1)).toBe('B')
  expect(nextOptionLabel(question, 'B', 1)).toBe('B')
  expect(nextOptionLabel(question, 'B', -1)).toBe('A')
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

function parseRequestQuestions(count: number) {
  const input = requestWithQuestions(count).input
  const questions = (input.questions as Array<{
    question: string
    header: string
    options: Array<{ label: string; description: string }>
  }>).map(question => ({
    ...question,
    multiSelect: false,
  }))
  return questions
}
