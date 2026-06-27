import React from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
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
  focused?: string
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
    if (!questions || typeof window === 'undefined') return
    function handleKeyDown(event: KeyboardEvent): void {
      if (isTextEntryTarget(event.target)) return
      const currentQuestion = questions[currentQuestionIndex] ?? questions[0]
      if (!currentQuestion) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setCurrentQuestionIndex(current =>
          nextQuestionIndex(current, -1, questionCount),
        )
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setCurrentQuestionIndex(current =>
          nextQuestionIndex(current, 1, questionCount),
        )
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        updateQuestionSelection(
          currentQuestion,
          event.key === 'ArrowUp' ? -1 : 1,
        )
      } else if (event.key === ' ') {
        if (currentQuestion.multiSelect) {
          event.preventDefault()
          toggleFocusedMultiSelectOption(currentQuestion)
        }
      } else if (event.key === 'Enter') {
        event.preventDefault()
        submitCurrentSelection(currentQuestion)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentQuestionIndex, questionCount, questionStates, questions])

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
      const question = questions?.find(item => item.question === questionText)
      const previous = question
        ? (current[questionText] ?? initialQuestionState(question))
        : { selected: [], custom: '' }
      return {
        ...current,
        [questionText]: updater(previous),
      }
    })
    setError(null)
  }

  function submitAnswers(): void {
    if (!questions) return
    onSubmit({
      ...request.input,
      answers: buildAnswers(questions, questionStates),
    })
  }

  function submitCurrentSelection(
    question: AskUserQuestion,
    selectedLabel?: string,
  ): void {
    if (!questions) return
    onSubmit({
      ...request.input,
      answers: buildAnswers(
        questions,
        questionStates,
        selectedLabel
          ? {
              question,
              state: {
                selected: [selectedLabel],
                custom: '',
              },
            }
          : undefined,
      ),
    })
  }

  function updateQuestionSelection(
    question: AskUserQuestion,
    delta: -1 | 1,
  ): void {
    updateQuestion(question.question, current => {
      const currentLabel =
        current.focused ?? current.selected[0] ?? question.options[0]?.label
      const nextLabel = nextOptionLabel(question, currentLabel, delta)
      if (question.multiSelect) {
        return nextLabel ? { ...current, focused: nextLabel } : current
      }
      return nextLabel
        ? { selected: [nextLabel], custom: '' }
        : initialQuestionState(question)
    })
  }

  function toggleFocusedMultiSelectOption(question: AskUserQuestion): void {
    updateQuestion(question.question, current => {
      const label = current.focused ?? current.selected[0] ?? question.options[0]?.label
      return label ? toggleMultiSelectOption(current, label) : current
    })
  }

  function goToQuestion(delta: -1 | 1): void {
    setCurrentQuestionIndex(current =>
      nextQuestionIndex(current, delta, questionCount),
    )
    setError(null)
  }

  const currentQuestion = questions[currentQuestionIndex] ?? questions[0]
  const state =
    questionStates[currentQuestion.question] ?? initialQuestionState(currentQuestion)
  const answeredCount = questions.filter(question =>
    hasQuestionAnswer(questionStates[question.question] ?? initialQuestionState(question)),
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
            const focused =
              currentQuestion.multiSelect &&
              (state.focused ?? state.selected[0] ?? currentQuestion.options[0]?.label) ===
                option.label
            return (
              <button
                aria-checked={selected}
                className={
                  [
                    'inline-approval-option',
                    selected ? 'selected' : '',
                    focused ? 'focused' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
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
                    return toggleMultiSelectOption(current, option.label)
                  })
                  if (shouldSubmitOptionClick(currentQuestion)) {
                    submitCurrentSelection(currentQuestion, option.label)
                  }
                }}
              >
                <span className="inline-approval-option-index">
                  {index + 1}
                </span>
                <span className="inline-approval-option-label">
                  {option.label}
                  {option.description ? (
                    <span
                      className="inline-approval-option-info"
                      aria-hidden="true"
                    >
                      <Info size={14} />
                    </span>
                  ) : null}
                  {index === 0 ? (
                    <span className="inline-approval-option-hint">
                      {' '}
                      （推荐）
                    </span>
                  ) : null}
                </span>
                {currentQuestion.multiSelect ? (
                  <span className="inline-approval-option-trailing">
                    <span
                      className={
                        selected
                          ? 'inline-approval-option-checkbox selected'
                          : 'inline-approval-option-checkbox'
                      }
                      aria-hidden="true"
                    >
                      {selected ? <Check size={14} /> : null}
                    </span>
                  </span>
                ) : selected ? (
                  <span className="inline-approval-option-trailing">
                    <span
                      className="inline-approval-option-arrows"
                      aria-hidden="true"
                    >
                      <ArrowUp size={14} />
                      <ArrowDown size={14} />
                    </span>
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

export function initialQuestionState(question: {
  options: Array<{ label: string }>
}): QuestionState {
  const firstOption = question.options[0]?.label
  return {
    selected: firstOption ? [firstOption] : [],
    custom: '',
  }
}

export function shouldSubmitOptionClick(question: {
  multiSelect: boolean
}): boolean {
  return !question.multiSelect
}

export function toggleMultiSelectOption(
  current: QuestionState,
  label: string,
): QuestionState {
  const selected = current.selected.includes(label)
    ? current.selected.filter(item => item !== label)
    : [...current.selected, label]
  return {
    ...current,
    selected,
    focused: label,
  }
}

export function answerForSelectedOption(
  question: { question: string },
  selectedLabel: string,
): Record<string, string> {
  return { [question.question]: selectedLabel }
}

export function nextOptionLabel(
  question: { options: Array<{ label: string }> },
  currentLabel: string | undefined,
  delta: -1 | 1,
): string | undefined {
  const currentIndex = Math.max(
    0,
    question.options.findIndex(option => option.label === currentLabel),
  )
  const nextIndex = nextQuestionIndex(
    currentIndex,
    delta,
    question.options.length,
  )
  return question.options[nextIndex]?.label
}

function buildAnswers(
  questions: AskUserQuestion[],
  questionStates: Record<string, QuestionState>,
  override?: { question: AskUserQuestion; state: QuestionState },
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const question of questions) {
    const state =
      override?.question.question === question.question
        ? override.state
        : (questionStates[question.question] ?? initialQuestionState(question))
    const answerParts = [
      ...state.selected,
      ...(state.custom.trim() ? [state.custom.trim()] : []),
    ]
    answers[question.question] = answerParts.join(', ')
  }
  return answers
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
      const label = normalizeRecommendedOptionLabel(stringValue(rawOption.label))
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

function normalizeRecommendedOptionLabel(value: string | null): string | null {
  if (!value) return value
  return value
    .replace(/\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/iu, '')
    .trim()
}
