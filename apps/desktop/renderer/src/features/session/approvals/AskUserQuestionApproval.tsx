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
import type { DesktopPermissionRequest } from '../../../../shared/types.js'
import { Button } from '../../../components/ui/Button.js'
import {
  CUSTOM_OPTION_ID,
  answerStateForConfirmation,
  buildAskUserQuestionAnswers,
  canSubmitFromCurrentQuestion,
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  footerControls,
  hasQuestionAnswer,
  initialQuestionState,
  nextQuestionIndex,
  nextQuestionOptionId,
  parseAskUserQuestions,
  selectQuestionOption,
  shouldDeferAskUserQuestionShortcutToTextEntry,
  shouldSubmitOptionClick,
  type AskUserQuestion,
  type QuestionState,
} from './askUserQuestionModel.js'

export {
  CUSTOM_OPTION_ID,
  answerForSelectedOption,
  areAllQuestionsAnswered,
  buildAskUserQuestionAnswers,
  buildAskUserQuestionUpdatedInput,
  canSubmitFromCurrentQuestion,
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  footerControls,
  hasQuestionAnswer,
  initialQuestionState,
  nextOptionLabel,
  nextQuestionIndex,
  nextQuestionOptionId,
  parseAskUserQuestions,
  questionOptionIds,
  selectQuestionOption,
  shouldDeferAskUserQuestionShortcutToTextEntry,
  shouldSubmitOptionClick,
  toggleMultiSelectOption,
  type AskUserQuestion,
  type AskUserQuestionOption,
  type EnterQuestionAction,
  type FooterControls,
  type QuestionState,
} from './askUserQuestionModel.js'

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
  const approvalRef = React.useRef<HTMLDivElement | null>(null)
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

  React.useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const frame = window.requestAnimationFrame(() => {
      approvalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [request.requestId])

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
          currentState.focused === CUSTOM_OPTION_ID
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
      <div
        ref={approvalRef}
        className="ask-user-question-approval"
        tabIndex={-1}
      >
        <p className="ask-user-question-error">
          无法解析 AskUserQuestion 的选项，请拒绝后让 CodePilotX 重新提问。
        </p>
        <div className="inline-approval-footer inline-approval-footer-split">
          <span className="inline-approval-footer-spacer" aria-hidden="true" />
          <Button
            tone="danger"
            onClick={onReject}
          >
            拒绝
            <CornerDownLeft size={16} />
          </Button>
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
    const answers = buildAskUserQuestionAnswers(questions, effectiveStates)
    onSubmit({
      ...request.input,
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
    const answers = buildAskUserQuestionAnswers(questions, questionStates, {
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
      const nextLabel = nextQuestionOptionId(question, currentLabel, delta)
      if (nextLabel === undefined) return current
      return selectQuestionOption(current, nextLabel, question.multiSelect, 'focus')
    })
  }

  function toggleFocusedMultiSelectOption(question: AskUserQuestion): void {
    updateQuestion(question.question, current => {
      const label = current.focused ?? current.selected[0] ?? question.options[0]?.label
      if (!label) return current
      return selectQuestionOption(current, label, question.multiSelect, 'toggle')
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
  const questionOptions = [
    ...currentQuestion.options.map((option, index) => ({
      kind: 'choice' as const,
      id: option.label,
      option,
      index,
    })),
    { kind: 'custom' as const, id: CUSTOM_OPTION_ID },
  ]

  return (
    <div
      ref={approvalRef}
      className="ask-user-question-approval"
      tabIndex={-1}
    >
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
          {questionOptions.map(questionOption => {
            if (questionOption.kind === 'custom') {
              const focused = state.focused === questionOption.id
              return (
                <div
                  aria-checked={Boolean(state.custom.trim())}
                  className={[
                    'inline-approval-option custom',
                    focused ? 'focused' : '',
                    state.custom.trim() ? 'filled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={questionOption.id}
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
                    updateQuestion(currentQuestion.question, current =>
                      selectQuestionOption(
                        current,
                        questionOption.id,
                        currentQuestion.multiSelect,
                        'focus',
                      ),
                    )
                  }}
                >
                  <span
                    className="inline-approval-option-custom-icon"
                    aria-hidden="true"
                  >
                    <PenLine size={14} />
                  </span>
                  <textarea
                    ref={customInputRef}
                    className="ask-user-question-custom-input"
                    placeholder="否，请告知 CodePilotX 如何调整"
                    rows={1}
                    value={state.custom}
                    onFocus={() => {
                      updateQuestion(currentQuestion.question, current =>
                        selectQuestionOption(
                          current,
                          questionOption.id,
                          currentQuestion.multiSelect,
                          'focus',
                        ),
                      )
                    }}
                    onChange={event => {
                      const custom = event.target.value
                      updateQuestion(currentQuestion.question, current => ({
                        ...selectQuestionOption(
                          current,
                          questionOption.id,
                          currentQuestion.multiSelect,
                          'focus',
                        ),
                        custom,
                        answered:
                          Boolean(custom.trim()) ||
                          (currentQuestion.multiSelect &&
                            current.selected.length > 0),
                      }))
                    }}
                  />
                </div>
              )
            }

            const { option, index } = questionOption
            const selected = state.selected.includes(option.label)
            const focused = state.focused === questionOption.id
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
                  updateQuestion(currentQuestion.question, current =>
                    selectQuestionOption(
                      current,
                      option.label,
                      currentQuestion.multiSelect,
                      'toggle',
                    ),
                  )
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
          <div className="inline-approval-split ask-user-question-actions">
            <Button
              aria-label="跳过当前问题"
              title="按 Esc 跳过"
              onClick={onReject}
            >
              跳过
            </Button>
            {controls.showPrevious || controls.showNext ? (
              <div className="ask-user-question-navigation">
                {controls.showPrevious ? (
                  <Button
                    onClick={() => goToQuestion(-1)}
                  >
                    <ChevronLeft size={14} />
                    上一题
                  </Button>
                ) : null}
                {controls.showNext ? (
                  <Button
                    onClick={() => goToQuestion(1)}
                  >
                    下一题
                    <ChevronRight size={14} />
                  </Button>
                ) : null}
              </div>
            ) : null}
            {controls.showSubmit ? (
              <Button
                disabled={!canSubmit}
                onClick={() => confirmCurrentQuestionAndAdvance(currentQuestion)}
              >
                提交
                <CornerDownLeft size={16} />
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      {error ? <p className="ask-user-question-error">{error}</p> : null}
    </div>
  )
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
