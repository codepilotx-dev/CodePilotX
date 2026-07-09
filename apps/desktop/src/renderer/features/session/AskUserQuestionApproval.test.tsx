import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AskUserQuestionApproval,
  answerForSelectedOption,
  areAllQuestionsAnswered,
  canSubmitFromCurrentQuestion,
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  footerControls,
  initialQuestionState,
  nextOptionLabel,
  nextQuestionIndex,
  parseAskUserQuestions,
  shouldSubmitOptionClick,
  toggleMultiSelectOption,
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
  expect(html).toContain('0/3 已回答')
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

test('AskUserQuestionApproval enables single-question final submit for the current selection', () => {
  const html = renderToStaticMarkup(
    <AskUserQuestionApproval
      request={requestWithQuestions(1)}
      onReject={() => {}}
      onSubmit={() => {}}
    />,
  )

  expect(html).toContain('0/1 已回答')
  expect(html).toContain('class="inline-approval-submit" type="button"')
  expect(html).not.toContain('class="inline-approval-submit" disabled=""')
})

test('AskUserQuestionApproval hides final submit before the last question', () => {
  const html = renderToStaticMarkup(
    <AskUserQuestionApproval
      request={requestWithQuestions(3)}
      onReject={() => {}}
      onSubmit={() => {}}
    />,
  )

  expect(html).not.toContain('inline-approval-submit')
  expect(html).toContain('下一题')
})

test('footerControls only exposes submit on the last question', () => {
  expect(footerControls(0, 3)).toEqual({
    showPrevious: false,
    showNext: true,
    showSubmit: false,
  })
  expect(footerControls(1, 3)).toEqual({
    showPrevious: true,
    showNext: true,
    showSubmit: false,
  })
  expect(footerControls(2, 3)).toEqual({
    showPrevious: true,
    showNext: false,
    showSubmit: true,
  })
  expect(footerControls(0, 1)).toEqual({
    showPrevious: false,
    showNext: false,
    showSubmit: true,
  })
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
    answered: false,
  })
})

test('nextOptionLabel clamps keyboard option navigation', () => {
  const [question] = parseRequestQuestions(1)

  expect(nextOptionLabel(question, 'A', 1)).toBe('B')
  expect(nextOptionLabel(question, 'B', 1)).toBe('B')
  expect(nextOptionLabel(question, 'B', -1)).toBe('A')
})

test('single-select option clicks submit but multi-select clicks only toggle', () => {
  expect(shouldSubmitOptionClick({ multiSelect: false })).toBe(true)
  expect(shouldSubmitOptionClick({ multiSelect: true })).toBe(false)
})

test('enterQuestionAction advances before the last question and submits on the last', () => {
  expect(enterQuestionAction(0, 3)).toBe('confirm-and-next')
  expect(enterQuestionAction(2, 3)).toBe('confirm-and-submit')
  expect(enterQuestionAction(0, 1)).toBe('confirm-and-submit')
})

test('toggleMultiSelectOption toggles labels without clearing other selected labels', () => {
  expect(
    toggleMultiSelectOption({ selected: ['A'], custom: '', answered: false }, 'B'),
  ).toEqual({
    selected: ['A', 'B'],
    custom: '',
    focused: 'B',
    answered: true,
  })
  expect(
    toggleMultiSelectOption({ selected: ['A', 'B'], custom: '', answered: true }, 'A'),
  ).toEqual({
    selected: ['B'],
    custom: '',
    focused: 'A',
    answered: true,
  })
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
      'First choice?': { selected: ['A'], custom: '', answered: true },
      'Second choice?': { selected: [], custom: 'custom answer', answered: true },
    }),
  ).toBe(2)
  expect(
    firstUnansweredQuestionIndex(questions, {
      'First choice?': { selected: ['A'], custom: '', answered: true },
      'Second choice?': { selected: [], custom: 'custom answer', answered: true },
      'Third choice?': { selected: ['C'], custom: '', answered: true },
    }),
  ).toBe(-1)
})

test('areAllQuestionsAnswered requires every question to be confirmed', () => {
  const questions = [
    { question: 'First choice?' },
    { question: 'Second choice?' },
  ]

  expect(
    areAllQuestionsAnswered(questions, {
      'First choice?': { selected: ['A'], custom: '', answered: true },
    }),
  ).toBe(false)
  expect(
    areAllQuestionsAnswered(questions, {
      'First choice?': { selected: ['A'], custom: '', answered: true },
      'Second choice?': { selected: ['B'], custom: '', answered: true },
    }),
  ).toBe(true)
})

test('canSubmitFromCurrentQuestion treats the current selection as confirmable', () => {
  const questions = parseRequestQuestions(3)

  expect(
    canSubmitFromCurrentQuestion(questions, {
      'First choice?': { selected: ['A'], custom: '', answered: true },
      'Second choice?': { selected: ['B'], custom: '', answered: true },
    }, 2),
  ).toBe(true)
  expect(
    canSubmitFromCurrentQuestion(questions, {
      'First choice?': { selected: ['A'], custom: '', answered: true },
    }, 2),
  ).toBe(false)
})

test('parseAskUserQuestions handles legacy single-question input without questions array', () => {
  const result = parseAskUserQuestions({
    question: 'Legacy question?',
    header: 'Legacy',
    options: [
      { label: 'Option A', description: 'Desc A' },
      { label: 'Option B', description: 'Desc B' },
    ],
  })
  expect(result).not.toBeNull()
  expect(result).toHaveLength(1)
  expect(result![0]!.question).toBe('Legacy question?')
  expect(result![0]!.id).toBeUndefined()
})

test('buildAnswers uses question id as key when available', () => {
  const input = {
    questions: [
      {
        id: 'custom-q1',
        question: 'First?',
        header: 'Q1',
        options: [
          { label: 'A', description: 'Desc A' },
          { label: 'B', description: 'Desc B' },
        ],
      },
    ],
  }
  const questions = parseAskUserQuestions(input)
  expect(questions).not.toBeNull()
  expect(questions![0]!.id).toBe('custom-q1')
})

test('AskUserQuestionApproval includes legacy answer field in single-question submit', () => {
  // Legacy single-question input (no id) should produce answer keyed by question text
  const input = {
    question: 'Single?',
    header: 'S',
    options: [
      { label: 'A', description: 'Desc A' },
      { label: 'B', description: 'Desc B' },
    ],
  }
  const questions = parseAskUserQuestions(input)
  expect(questions).not.toBeNull()
  expect(questions![0]!.id).toBeUndefined()
  expect(questions![0]!.question).toBe('Single?')
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
