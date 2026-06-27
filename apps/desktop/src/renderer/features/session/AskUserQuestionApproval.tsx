import React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Info,
  Pencil,
} from 'lucide-react'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

type AskUserQuestionOption = {
  label: string
  description: string
}

type AskUserQuestion = {
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type QuestionState = {
  selected: string[]
  custom: string
}

export type AskUserQuestionApprovalProps = {
  request: DesktopPermissionRequest
  onSubmit: (updatedInput: Record<string, unknown>) => void
  onReject: () => void
}

export function AskUserQuestionApproval({
  request,
  onSubmit,
  onReject,
}: AskUserQuestionApprovalProps): React.ReactNode {
  const questions = parseAskUserQuestions(request.input)
  const [questionStates, setQuestionStates] = React.useState<
    Record<string, QuestionState>
  >({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const questionCount = questions?.length ?? 0

  React.useEffect(() => {
    setCurrentQuestionIndex(current =>
      questionCount > 0 ? Math.min(current, questionCount - 1) : 0,
    )
  }, [questionCount])

  React.useEffect(() => {
    if (questionCount <= 1 || typeof window === 'undefined') return
    function handleKeyDown(event: KeyboardEvent): void {
      if (isTextEntryTarget(event.target)) return
      if (event.key === 'ArrowLeft') {
        setCurrentQuestionIndex(current =>
          nextQuestionIndex(current, -1, questionCount),
        )
      } else if (event.key === 'ArrowRight') {
        setCurrentQuestionIndex(current =>
          nextQuestionIndex(current, 1, questionCount),
        )
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [questionCount])

  if (!questions) {
    return (
      <div className="ask-user-question-approval">
        <p className="ask-user-question-error">
          无法解析 AskUserQuestion 的选项，请拒绝后让 Codex 重新提问。
        </p>
        <div className="inline-approval-footer inline-approval-footer-split">
          <span className="inline-approval-footer-spacer" aria-hidden="true" />
          <button
            className="inline-approval-submit"
            type="button"
            onClick={onReject}
          >
            拒绝
            <CornerDownLeft size={16} />
          </button>
        </div>
      </div>
    )
  }

  function updateQuestion(
    questionText: string,
    updater: (current: QuestionState) => QuestionState,
  ): void {
    setQuestionStates(current => {
      const previous = current[questionText] ?? { selected: [], custom: '' }
      return {
        ...current,
        [questionText]: updater(previous),
      }
    })
    setError(null)
  }

  function submitAnswers(): void {
    if (!questions) return
    const answers: Record<string, string> = {}
    const unansweredIndex = firstUnansweredQuestionIndex(
      questions,
      questionStates,
    )

    if (unansweredIndex !== -1) {
      setCurrentQuestionIndex(unansweredIndex)
      setError('请回答每个问题后再提交。')
      return
    }

    for (const question of questions) {
      const state = questionStates[question.question] ?? {
        selected: [],
        custom: '',
      }
      const answerParts = [
        ...state.selected,
        ...(state.custom.trim() ? [state.custom.trim()] : []),
      ]
      answers[question.question] = answerParts.join(', ')
    }

    onSubmit({
      ...request.input,
      answers,
    })
  }

  function goToQuestion(delta: -1 | 1): void {
    setCurrentQuestionIndex(current =>
      nextQuestionIndex(current, delta, questionCount),
    )
    setError(null)
  }

  const currentQuestion = questions[currentQuestionIndex] ?? questions[0]
  const state = questionStates[currentQuestion.question] ?? {
    selected: [],
    custom: '',
  }
  const answeredCount = questions.filter(question =>
    hasQuestionAnswer(questionStates[question.question]),
  ).length

  return (
    <div className="ask-user-question-approval">
      <div className="ask-user-question-progress">
        <span>
          问题 {currentQuestionIndex + 1}/{questionCount}
        </span>
        <span>{answeredCount}/{questionCount} 已回答</span>
      </div>
      <section className="ask-user-question-block" key={currentQuestion.question}>
        <h3 className="ask-user-question-heading">{currentQuestion.question}</h3>
        <div
          className="inline-approval-options"
          role={currentQuestion.multiSelect ? 'group' : 'radiogroup'}
        >
          {currentQuestion.options.map((option, index) => {
            const selected = state.selected.includes(option.label)
            return (
              <button
                aria-checked={selected}
                className={
                  selected
                    ? 'inline-approval-option selected'
                    : 'inline-approval-option'
                }
                key={option.label}
                role={currentQuestion.multiSelect ? 'checkbox' : 'radio'}
                title={option.description || undefined}
                type="button"
                onClick={() => {
                  updateQuestion(currentQuestion.question, current => {
                    if (!currentQuestion.multiSelect) {
                      return {
                        ...current,
                        custom: '',
                        selected: [option.label],
                      }
                    }
                    const selectedLabels = current.selected.includes(
                      option.label,
                    )
                      ? current.selected.filter(label => label !== option.label)
                      : [...current.selected, option.label]
                    return { ...current, selected: selectedLabels }
                  })
                }}
              >
                <span className="inline-approval-option-index">
                  {index + 1}
                </span>
                <span className="inline-approval-option-label">
                  {option.label}
                  {option.description ? (
                    <span className="inline-approval-option-hint">
                      {' '}
                      ({option.description})
                    </span>
                  ) : null}
                </span>
                {(option.description || selected) ? (
                  <span className="inline-approval-option-trailing">
                    {option.description ? (
                      <span
                        className="inline-approval-option-info"
                        aria-hidden="true"
                      >
                        <Info size={14} />
                      </span>
                    ) : null}
                    {selected ? (
                      <span
                        className="inline-approval-option-arrows"
                        aria-hidden="true"
                      >
                        <ArrowUp size={14} />
                        <ArrowDown size={14} />
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            )
          })}
          <label
            className={
              state.custom.trim()
                ? 'inline-approval-option custom filled'
                : 'inline-approval-option custom'
            }
          >
            <span className="inline-approval-option-index">
              <Pencil size={14} />
            </span>
            <input
              className="ask-user-question-custom-input"
              placeholder="否，请告知 Codex 如何调整"
              type="text"
              value={state.custom}
              onChange={event => {
                const custom = event.target.value
                updateQuestion(currentQuestion.question, current => ({
                  ...current,
                  custom,
                  selected:
                    !currentQuestion.multiSelect && custom.trim()
                      ? []
                      : current.selected,
                }))
              }}
            />
          </label>
        </div>
      </section>
      {error ? <p className="ask-user-question-error">{error}</p> : null}
      <div className="inline-approval-footer inline-approval-footer-split">
        <div className="inline-approval-footer-hint">
          <span>忽略</span>
          <kbd className="inline-approval-footer-key">ESC</kbd>
        </div>
        {questionCount > 1 ? (
          <div className="ask-user-question-navigation">
            <button
              className="ask-user-question-nav-button"
              disabled={currentQuestionIndex === 0}
              type="button"
              onClick={() => goToQuestion(-1)}
            >
              <ChevronLeft size={14} />
              上一题
            </button>
            <button
              className="ask-user-question-nav-button"
              disabled={currentQuestionIndex >= questionCount - 1}
              type="button"
              onClick={() => goToQuestion(1)}
            >
              下一题
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
        <button
          className="inline-approval-submit"
          type="button"
          onClick={submitAnswers}
        >
          提交
          <CornerDownLeft size={16} />
        </button>
      </div>
    </div>
  )
}

export function nextQuestionIndex(
  currentIndex: number,
  delta: number,
  questionCount: number,
): number {
  if (questionCount <= 0) return 0
  return Math.max(0, Math.min(questionCount - 1, currentIndex + delta))
}

export function firstUnansweredQuestionIndex(
  questions: Array<{ question: string }>,
  questionStates: Record<string, QuestionState>,
): number {
  return questions.findIndex(
    question => !hasQuestionAnswer(questionStates[question.question]),
  )
}

function hasQuestionAnswer(state: QuestionState | undefined): boolean {
  if (!state) return false
  return state.selected.length > 0 || Boolean(state.custom.trim())
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function parseAskUserQuestions(
  input: Record<string, unknown>,
): AskUserQuestion[] | null {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return null
  }

  const questions: AskUserQuestion[] = []
  for (const rawQuestion of input.questions) {
    if (!isRecord(rawQuestion)) return null
    const question = stringValue(rawQuestion.question)
    const header = stringValue(rawQuestion.header)
    const rawOptions = rawQuestion.options
    if (!question || !Array.isArray(rawOptions) || rawOptions.length < 2) {
      return null
    }

    const options: AskUserQuestionOption[] = []
    for (const rawOption of rawOptions) {
      if (!isRecord(rawOption)) return null
      const label = stringValue(rawOption.label)
      const description = stringValue(rawOption.description)
      if (!label || !description) return null
      options.push({ label, description })
    }

    questions.push({
      question,
      header: header ?? '',
      options,
      multiSelect: rawQuestion.multiSelect === true,
    })
  }

  return questions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
