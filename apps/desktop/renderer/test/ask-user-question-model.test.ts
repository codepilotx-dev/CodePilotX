import { describe, expect, test } from 'bun:test'
import {
  buildAskUserQuestionAnswers,
  buildAskUserQuestionUpdatedInput,
  hasQuestionAnswer,
  parseAskUserQuestions,
  selectQuestionOption,
  type QuestionState,
} from '../src/features/session/approvals/askUserQuestionModel'

const input = {
  questions: [
    {
      id: 'editor',
      header: '编辑器',
      question: '选择编辑器',
      options: [
        { label: 'VS Code (Recommended)', description: '使用 VS Code' },
        { label: 'Zed', description: '使用 Zed' },
      ],
      multiSelect: false,
    },
    {
      id: 'features',
      header: '功能',
      question: '选择功能',
      options: [
        { label: '格式化', description: '自动格式化' },
        { label: '检查', description: '运行类型检查' },
      ],
      multiSelect: true,
    },
  ],
}

describe('AskUserQuestion pure model', () => {
  test('parses single and multi questions while normalizing recommended labels', () => {
    expect(parseAskUserQuestions(input)).toEqual([
      {
        id: 'editor',
        header: '编辑器',
        question: '选择编辑器',
        options: [
          { label: 'VS Code', description: '使用 VS Code' },
          { label: 'Zed', description: '使用 Zed' },
        ],
        multiSelect: false,
      },
      {
        id: 'features',
        header: '功能',
        question: '选择功能',
        options: [
          { label: '格式化', description: '自动格式化' },
          { label: '检查', description: '运行类型检查' },
        ],
        multiSelect: true,
      },
    ])
    expect(parseAskUserQuestions({ questions: [] })).toBeNull()
    expect(parseAskUserQuestions({
      questions: [{ question: '无效', options: [{ label: 'A' }] }],
    })).toBeNull()
  })

  test('builds stable answer maps for multiple questions and custom text', () => {
    const questions = parseAskUserQuestions(input)!
    const states: Record<string, QuestionState> = {
      '选择编辑器': {
        selected: ['Zed'],
        custom: '',
        answered: true,
      },
      '选择功能': {
        selected: ['格式化', '检查'],
        custom: '生成报告',
        answered: true,
      },
    }
    expect(buildAskUserQuestionAnswers(questions, states)).toEqual({
      editor: 'Zed',
      features: '格式化, 检查, 生成报告',
    })
    expect(buildAskUserQuestionUpdatedInput(input, questions, states)).toEqual({
      ...input,
      answers: {
        editor: 'Zed',
        features: '格式化, 检查, 生成报告',
      },
    })
  })

  test('keeps option selection semantics shared by main session and pet reply', () => {
    const initial: QuestionState = {
      selected: ['格式化'],
      custom: '',
      answered: false,
    }
    const selected = selectQuestionOption(initial, '检查', true, 'toggle')
    expect(selected).toMatchObject({
      selected: ['格式化', '检查'],
      answered: true,
    })
    const custom = selectQuestionOption(selected, '__custom', true, 'focus')
    expect(custom.selected).toEqual(['格式化', '检查'])
    expect(hasQuestionAnswer({ ...custom, custom: '生成报告', answered: true })).toBe(true)
  })

  test('adds the legacy single answer field for one-question submissions', () => {
    const questions = parseAskUserQuestions({
      questions: [input.questions[0]],
    })!
    const states = {
      '选择编辑器': {
        selected: ['VS Code'],
        custom: '',
        answered: true,
      },
    }
    expect(buildAskUserQuestionUpdatedInput(
      { questions: [input.questions[0]] },
      questions,
      states,
    )).toMatchObject({
      answer: 'VS Code',
      answers: { editor: 'VS Code' },
    })
  })
})
