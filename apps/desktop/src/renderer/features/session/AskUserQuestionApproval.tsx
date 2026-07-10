import React from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Info,
  PenLine,
} from 'lucide-react'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

type AskUserQuestionOption = {
  label: string
  description: string
}

type AskUserQuestion = {
  id?: string
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export type QuestionState = {
  selected: string[]
  custom: string
  answered: boolean
  focused?: string
}

export const CUSTOM_OPTION_FOCUS_VALUE = '__custom'

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
  const customInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const questionCount = questions?.length ?? 0

  React.useEffect(() => {
    setCurrentQuestionIndex(current =>
      questionCount > 0 ? Math.min(current, questionCount - 1) : 0,
    )
  }, [questionCount])

  React.useLayoutEffect(() => {
    const input = customInputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [currentQuestionIndex, questionStates])

  React.useEffect(() => {
    if (!questions || typeof window === 'undefined') return
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onReject()
        return
      }
      if (shouldDeferAskUserQuestionShortcutToTextEntry(
        event.key,
        isTextEntryTarget(event.target),
      )) return
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
        const currentState =
          questionStates[currentQuestion.question] ??
          initialQuestionState(currentQuestion)
        const focusedCustom =
          currentState.focused === CUSTOM_OPTION_FOCUS_VALUE
        if (focusedCustom && !currentState.custom.trim()) {
          event.preventDefault()
          customInputRef.current?.focus()
          return
        }
        if (shouldDeferAskUserQuestionShortcutToTextEntry(
          event.key,
          isTextEntryTarget(event.target),
        )) return
        event.preventDefault()
        confirmCurrentQuestionAndAdvance(currentQuestion)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentQuestionIndex, onReject, questionCount, questionStates, questions])

  if (!questions) {
    return (
      <div className="ask-user-question-approval">
        <p className="ask-user-question-error">
          无法解析 AskUserQuestion 的选项，请拒绝后让 CodePilotX 重新提问。
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
        : { selected: [], custom: '', answered: false }
      return {
        ...current,
        [questionText]: updater(previous),
      }
    })
    setError(null)
  }

  function submitAnswers(
    override?: { question: AskUserQuestion; state: QuestionState },
  ): void {
    if (!questions) return
    const effectiveStates = override
      ? { ...questionStates, [override.question.question]: override.state }
      : questionStates
    const firstUnanswered = firstUnansweredQuestionIndex(questions, effectiveStates)
    if (firstUnanswered !== -1) {
      setCurrentQuestionIndex(firstUnanswered)
      setError('请先确认所有问题后再提交。')
      return
    }
    const answers = buildAnswers(questions, effectiveStates)
    // Legacy single-question answer for old callers
    const legacyAnswer = questions.length === 1
      ? { answer: answers[questions[0]!.id ?? questions[0]!.question] ?? '' }
      : {}
    onSubmit({
      ...request.input,
      answer: legacyAnswer.answer ?? '',
      answers,
    })
  }

  function confirmCurrentSelection(
    question: AskUserQuestion,
    selectedLabel?: string,
  ): void {
    updateQuestion(question.question, current => {
      const selected = selectedLabel ? [selectedLabel] : current.selected
      return {
        ...current,
        selected,
        custom: selectedLabel ? '' : current.custom,
        answered: selected.length > 0 || Boolean(current.custom.trim()),
      }
    })
  }

  function confirmCurrentQuestionAndAdvance(question: AskUserQuestion): void {
    const confirmedState = answerStateForConfirmation(
      questionStates[question.question] ?? initialQuestionState(question),
    )
    confirmCurrentSelection(question)
    if (enterQuestionAction(currentQuestionIndex, questionCount) === 'confirm-and-submit') {
      submitAnswers({ question, state: confirmedState })
      return
    }
    goToQuestion(1)
  }

  function submitCurrentSelection(
    question: AskUserQuestion,
    selectedLabel: string,
  ): void {
    if (!questions) return
    const answers = buildAnswers(questions, questionStates, {
      question,
      state: {
        selected: [selectedLabel],
        custom: '',
        answered: true,
      },
    })
    onSubmit({
      ...request.input,
      answer: answers[question.id ?? question.question] ?? '',
      answers,
    })
  }

  function updateQuestionSelection(
    question: AskUserQuestion,
    delta: -1 | 1,
  ): void {
    updateQuestion(question.question, current => {
      const currentLabel =
        current.focused ?? current.selected[0] ?? question.options[0]?.label
      const nextLabel = nextCustomOptionLabel(question, currentLabel, delta)
      if (nextLabel === undefined) return current
      if (nextLabel === CUSTOM_OPTION_FOCUS_VALUE) {
        const baseState = question.multiSelect
          ? current
          : { ...current, selected: [], custom: '' }
        const next = { ...baseState, focused: CUSTOM_OPTION_FOCUS_VALUE }
        return question.multiSelect ? next : { ...next, answered: false }
      }
      if (question.multiSelect) {
        return { ...current, focused: nextLabel }
      }
      return {
        ...current,
        selected: [nextLabel],
        custom: '',
        answered: false,
      }
    })
  }

  function toggleFocusedMultiSelectOption(question: AskUserQuestion): void {
    updateQuestion(question.question, current => {
      const label = current.focused ?? current.selected[0] ?? question.options[0]?.label
      if (!label) return current
      if (label === CUSTOM_OPTION_FOCUS_VALUE) {
        const hasCustom = Boolean(current.custom.trim())
        return {
          ...current,
          focused: CUSTOM_OPTION_FOCUS_VALUE,
          answered: current.selected.length > 0 || hasCustom,
        }
      }
      return toggleMultiSelectOption(current, label)
    })
  }

  function focusCustomInput(): void {
    customInputRef.current?.focus()
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
    hasQuestionAnswer(questionStates[question.question]),
  ).length
  const canSubmit = canSubmitFromCurrentQuestion(
    questions,
    questionStates,
    currentQuestionIndex,
  )
  const controls = footerControls(currentQuestionIndex, questionCount)

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
                        answered: true,
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
          <div
            aria-checked={Boolean(state.custom.trim())}
            className={[
              'inline-approval-option custom',
              state.focused === CUSTOM_OPTION_FOCUS_VALUE ? 'focused' : '',
              state.custom.trim() ? 'filled' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            role={currentQuestion.multiSelect ? 'checkbox' : 'radio'}
            tabIndex={0}
            onClick={event => {
              if (
                event.target instanceof HTMLElement &&
                (event.target.tagName === 'TEXTAREA' ||
                  event.target.isContentEditable)
              ) {
                return
              }
              focusCustomInput()
              updateQuestion(currentQuestion.question, current => ({
                ...current,
                focused: CUSTOM_OPTION_FOCUS_VALUE,
                selected:
                  !currentQuestion.multiSelect ? [] : current.selected,
                answered:
                  currentQuestion.multiSelect &&
                  (current.selected.length > 0 || Boolean(current.custom.trim())),
              }))
            }}
          >
            <span className="inline-approval-option-custom-icon" aria-hidden="true">
              <PenLine size={14} />
            </span>
            <textarea
              ref={customInputRef}
              className="ask-user-question-custom-input"
              placeholder="否，请告知 CodePilotX 如何调整"
              rows={1}
              value={state.custom}
              onFocus={() => {
                updateQuestion(currentQuestion.question, current => {
                  if (current.focused === CUSTOM_OPTION_FOCUS_VALUE) {
                    return current
                  }
                  return {
                    ...current,
                    focused: CUSTOM_OPTION_FOCUS_VALUE,
                    selected:
                      !currentQuestion.multiSelect ? [] : current.selected,
                  }
                })
              }}
              onChange={event => {
                const custom = event.target.value
                updateQuestion(currentQuestion.question, current => ({
                  ...current,
                  focused: CUSTOM_OPTION_FOCUS_VALUE,
                  custom,
                  answered: Boolean(custom.trim()),
                  selected:
                    !currentQuestion.multiSelect && custom.trim()
                      ? []
                      : current.selected,
                }))
              }}
            />
          </div>
          <div className="inline-approval-split ask-user-question-actions">
          <button
            aria-label="跳过当前问题"
            className="inline-approval-skip"
            title="按 Esc 跳过"
            type="button"
            onClick={onReject}
          >
            跳过
          </button>
          {controls.showPrevious || controls.showNext ? (
            <div className="ask-user-question-navigation">
              {controls.showPrevious ? (
                <button
                  className="ask-user-question-nav-button"
                  type="button"
                  onClick={() => goToQuestion(-1)}
                >
                  <ChevronLeft size={14} />
                  上一题
                </button>
              ) : null}
              {controls.showNext ? (
                <button
                  className="ask-user-question-nav-button"
                  type="button"
                  onClick={() => goToQuestion(1)}
                >
                  下一题
                  <ChevronRight size={14} />
                </button>
              ) : null}
            </div>
          ) : null}
          {controls.showSubmit ? (
            <button
              className="inline-approval-submit"
              disabled={!canSubmit}
              type="button"
              onClick={() => confirmCurrentQuestionAndAdvance(currentQuestion)}
            >
              提交
              <CornerDownLeft size={16} />
            </button>
          ) : null}
          </div>
        </div>
      </section>
      {error ? <p className="ask-user-question-error">{error}</p> : null}
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

export function areAllQuestionsAnswered(
  questions: Array<{ question: string }>,
  questionStates: Record<string, QuestionState>,
): boolean {
  return (
    questions.length > 0 &&
    questions.every(question => hasQuestionAnswer(questionStates[question.question]))
  )
}

export function canSubmitFromCurrentQuestion(
  questions: Array<{ question: string; options: Array<{ label: string }> }>,
  questionStates: Record<string, QuestionState>,
  currentQuestionIndex: number,
): boolean {
  if (questions.length === 0) return false
  return questions.every((question, index) => {
    const state =
      questionStates[question.question] ?? initialQuestionState(question)
    if (index === currentQuestionIndex) {
      return state.selected.length > 0 || Boolean(state.custom.trim())
    }
    return hasQuestionAnswer(questionStates[question.question])
  })
}

export type FooterControls = {
  showPrevious: boolean
  showNext: boolean
  showSubmit: boolean
}

export function footerControls(
  currentQuestionIndex: number,
  questionCount: number,
): FooterControls {
  const isLastQuestion = currentQuestionIndex >= questionCount - 1
  return {
    showPrevious: questionCount > 1 && currentQuestionIndex > 0,
    showNext: questionCount > 1 && !isLastQuestion,
    showSubmit: questionCount > 0 && isLastQuestion,
  }
}

export type EnterQuestionAction = 'confirm-and-next' | 'confirm-and-submit'

export function enterQuestionAction(
  currentQuestionIndex: number,
  questionCount: number,
): EnterQuestionAction {
  return currentQuestionIndex >= questionCount - 1
    ? 'confirm-and-submit'
    : 'confirm-and-next'
}

export function initialQuestionState(question: {
  options: Array<{ label: string }>
}): QuestionState {
  const firstOption = question.options[0]?.label
  return {
    selected: firstOption ? [firstOption] : [],
    custom: '',
    answered: false,
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
    answered: selected.length > 0 || Boolean(current.custom.trim()),
  }
}

function answerStateForConfirmation(state: QuestionState): QuestionState {
  return {
    ...state,
    answered: state.selected.length > 0 || Boolean(state.custom.trim()),
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

export function nextCustomOptionLabel(
  question: { options: Array<{ label: string }> },
  currentLabel: string | undefined,
  delta: -1 | 1,
): string | undefined {
  if (
    currentLabel === CUSTOM_OPTION_FOCUS_VALUE ||
    currentLabel === undefined
  ) {
    if (delta < 0) {
      return question.options[question.options.length - 1]?.label
    }
    return CUSTOM_OPTION_FOCUS_VALUE
  }
  const lastIndex = question.options.length - 1
  const currentIndex = question.options.findIndex(
    option => option.label === currentLabel,
  )
  if (currentIndex < 0) return undefined
  if (currentIndex === lastIndex && delta > 0) {
    return CUSTOM_OPTION_FOCUS_VALUE
  }
  if (currentIndex === 0 && delta < 0) {
    return undefined
  }
  const nextIndex = nextQuestionIndex(currentIndex, delta, question.options.length)
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
    const answerValue = answerParts.join(', ')
    const key = question.id ?? question.question
    answers[key] = answerValue
  }
  return answers
}

function hasQuestionAnswer(state: QuestionState | undefined): boolean {
  if (!state) return false
  return state.answered && (state.selected.length > 0 || Boolean(state.custom.trim()))
}

export function shouldDeferAskUserQuestionShortcutToTextEntry(
  key: string,
  isTextEntry: boolean,
): boolean {
  return isTextEntry && key !== 'Escape'
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
  const rawQuestions = Array.isArray(input.questions) && input.questions.length > 0
    ? input.questions
    : null

  // Legacy single-question: { question, header, options } at top level
  if (!rawQuestions) {
    const question = stringValue(input.question)
    const header = stringValue(input.header)
    const rawOptions = input.options
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
    return [
      {
        id: undefined,
        question,
        header: header ?? '',
        options,
        multiSelect: input.multiSelect === true,
      },
    ]
  }

  const questions: AskUserQuestion[] = []
  for (const rawQuestion of rawQuestions) {
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
      id: typeof rawQuestion.id === 'string' ? rawQuestion.id : undefined,
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
