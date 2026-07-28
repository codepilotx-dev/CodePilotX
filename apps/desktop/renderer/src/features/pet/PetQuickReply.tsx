import React from 'react'
import type {
  DesktopPermissionDecision,
  DesktopPermissionRequest,
} from '../../../shared/types.js'
import {
  CUSTOM_OPTION_ID,
  buildAskUserQuestionUpdatedInput,
  hasQuestionAnswer,
  initialQuestionState,
  parseAskUserQuestions,
  selectQuestionOption,
  type AskUserQuestion,
  type QuestionState,
} from '../session/approvals/askUserQuestionModel.js'

export type PetQuickReplyProps = {
  request: DesktopPermissionRequest
  disabled?: boolean
  onRespond: (
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ) => void | Promise<void>
}

type QuickReplyAction = 'allow' | 'deny'

export function PetQuickReply({
  request,
  disabled = false,
  onRespond,
}: PetQuickReplyProps): React.ReactNode {
  const questions = request.toolName === 'AskUserQuestion'
    ? parseAskUserQuestions(request.input)
    : null
  const [questionStates, setQuestionStates] = React.useState<
    Record<string, QuestionState>
  >({})
  const [questionIndex, setQuestionIndex] = React.useState(0)
  const [action, setAction] = React.useState<QuickReplyAction>('allow')
  const [feedback, setFeedback] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const blocked = disabled || submitting

  React.useEffect(() => {
    setQuestionStates({})
    setQuestionIndex(0)
    setAction('allow')
    setFeedback('')
    setSubmitting(false)
    setError(null)
  }, [request.requestId])

  const respond = async (decision: DesktopPermissionDecision): Promise<void> => {
    if (blocked) return
    setSubmitting(true)
    setError(null)
    try {
      await onRespond(request, decision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  if (request.toolName === 'AskUserQuestion') {
    if (!questions) {
      return (
        <QuickReplyFrame error="无法解析问题，请打开任务后处理。">
          <button
            className={secondaryButtonClass}
            disabled={blocked}
            type="button"
            onClick={() => void respond({ behavior: 'deny' })}
          >
            跳过
          </button>
        </QuickReplyFrame>
      )
    }

    const question = questions[questionIndex] ?? questions[0]
    const canAdvance = hasQuestionAnswer(questionStates[question.question])
    const canSubmit = questions.every(question =>
      hasQuestionAnswer(questionStates[question.question]),
    )
    const lastQuestion = questionIndex === questions.length - 1
    return (
      <QuickReplyFrame error={error}>
        <QuestionReply
          disabled={blocked}
          index={questionIndex}
          key={question.id ?? question.question}
          question={question}
          questionCount={questions.length}
          state={
            questionStates[question.question]
            ?? emptyQuestionState(question)
          }
          onChange={state => {
            setQuestionStates(current => ({
              ...current,
              [question.question]: state,
            }))
            setError(null)
          }}
        />
        <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
          <button
            className={secondaryButtonClass}
            disabled={blocked}
            type="button"
            onClick={() => void respond({ behavior: 'deny' })}
          >
            跳过
          </button>
          {questionIndex > 0 ? (
            <button
              className={secondaryButtonClass}
              disabled={blocked}
              type="button"
              onClick={() => setQuestionIndex(current => current - 1)}
            >
              上一题
            </button>
          ) : null}
          {lastQuestion ? (
            <button
              className={primaryButtonClass}
              disabled={blocked || !canSubmit}
              type="button"
              onClick={() => {
                if (!canSubmit) {
                  setError('请先回答所有问题。')
                  return
                }
                void respond({
                  behavior: 'allow',
                  updatedInput: buildAskUserQuestionUpdatedInput(
                    request.input,
                    questions,
                    questionStates,
                  ),
                })
              }}
            >
              {submitting ? '提交中…' : '提交回答'}
            </button>
          ) : (
            <button
              className={primaryButtonClass}
              disabled={blocked || !canAdvance}
              type="button"
              onClick={() => setQuestionIndex(current => current + 1)}
            >
              下一题
            </button>
          )}
        </div>
      </QuickReplyFrame>
    )
  }

  return (
    <QuickReplyFrame error={error}>
      <p className="tw:m-0 tw:text-sm tw:leading-5 tw:text-app-text">
        {request.description || '是否允许这次操作？'}
      </p>
      <div className="tw:grid tw:grid-cols-2 tw:gap-2" role="radiogroup">
        <ActionButton
          checked={action === 'allow'}
          disabled={blocked}
          label="允许一次"
          onClick={() => {
            setAction('allow')
            setError(null)
          }}
        />
        <ActionButton
          checked={action === 'deny'}
          disabled={blocked}
          label="拒绝"
          onClick={() => {
            setAction('deny')
            setError(null)
          }}
        />
      </div>
      {action === 'deny' ? (
        <textarea
          className="tw:min-h-16 tw:w-full tw:resize-y tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:px-2.5 tw:py-2 tw:text-sm tw:text-app-text tw:outline-none tw:focus:border-app-accent"
          disabled={blocked}
          placeholder="可选：说明拒绝原因"
          value={feedback}
          onChange={event => {
            setFeedback(event.target.value)
            setError(null)
          }}
        />
      ) : null}
      <button
        className={primaryButtonClass}
        disabled={blocked}
        type="button"
        onClick={() => {
          const message = feedback.trim()
          void respond({
            behavior: action,
            ...(message ? { message, updatedInput: { feedback: message } } : {}),
          })
        }}
      >
        {submitting ? '提交中…' : '提交'}
      </button>
    </QuickReplyFrame>
  )
}

function QuestionReply({
  question,
  index,
  questionCount,
  state,
  disabled,
  onChange,
}: {
  question: AskUserQuestion
  index: number
  questionCount: number
  state: QuestionState
  disabled: boolean
  onChange: (state: QuestionState) => void
}): React.ReactNode {
  return (
    <fieldset className="tw:m-0 tw:flex tw:min-w-0 tw:flex-col tw:gap-1.5 tw:border-0 tw:p-0">
      <legend className="tw:mb-1 tw:text-sm tw:font-semibold tw:text-app-text">
        {question.header ? `${question.header} · ` : ''}
        {question.question}
        <span className="tw:ml-1 tw:text-xs tw:font-normal tw:text-app-text-soft">
          {index + 1}/{questionCount}
        </span>
      </legend>
      {question.options.map(option => {
        const selected = state.selected.includes(option.label)
        return (
          <button
            aria-pressed={selected}
            className={optionButtonClass(selected)}
            disabled={disabled}
            key={option.label}
            title={option.description}
            type="button"
            onClick={() =>
              onChange(
                selectQuestionOption(
                  state,
                  option.label,
                  question.multiSelect,
                  'toggle',
                ),
              )}
          >
            <span>{selected ? '✓' : '○'}</span>
            <span className="tw:min-w-0 tw:flex-1 tw:text-left">
              <span className="tw:block tw:truncate">{option.label}</span>
              <span className="tw:block tw:truncate tw:text-xs tw:text-app-text-soft">
                {option.description}
              </span>
            </span>
          </button>
        )
      })}
      <textarea
        aria-label={`${question.question}的自定义回答`}
        className="tw:min-h-14 tw:w-full tw:resize-y tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:px-2.5 tw:py-2 tw:text-sm tw:text-app-text tw:outline-none tw:focus:border-app-accent"
        disabled={disabled}
        placeholder="其他回答…"
        value={state.custom}
        onChange={event => {
          const custom = event.target.value
          const next = selectQuestionOption(
            state,
            CUSTOM_OPTION_ID,
            question.multiSelect,
            'focus',
          )
          onChange({
            ...next,
            custom,
            answered:
              Boolean(custom.trim())
              || (question.multiSelect && next.selected.length > 0),
          })
        }}
      />
    </fieldset>
  )
}

function emptyQuestionState(question: AskUserQuestion): QuestionState {
  return {
    ...initialQuestionState(question),
    selected: [],
  }
}

function ActionButton({
  label,
  checked,
  disabled,
  onClick,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      aria-checked={checked}
      className={optionButtonClass(checked)}
      disabled={disabled}
      role="radio"
      type="button"
      onClick={onClick}
    >
      <span>{checked ? '●' : '○'}</span>
      <span>{label}</span>
    </button>
  )
}

function QuickReplyFrame({
  children,
  error,
}: {
  children: React.ReactNode
  error: string | null
}): React.ReactNode {
  return (
    <div className="tw:flex tw:min-w-72 tw:max-w-96 tw:flex-col tw:gap-3">
      {children}
      {error ? (
        <p
          aria-live="polite"
          className="tw:m-0 tw:text-xs tw:leading-4 tw:text-app-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

const primaryButtonClass =
  'tw:inline-flex tw:min-h-8 tw:items-center tw:justify-center tw:rounded-lg tw:border-0 tw:bg-app-primary-action tw:px-3 tw:text-sm tw:font-medium tw:text-app-primary-action-foreground tw:disabled:cursor-not-allowed tw:disabled:opacity-50'

const secondaryButtonClass =
  'tw:inline-flex tw:min-h-8 tw:items-center tw:justify-center tw:rounded-lg tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:text-sm tw:text-app-text tw:disabled:cursor-not-allowed tw:disabled:opacity-50'

const optionButtonClass = (selected: boolean): string =>
  [
    'tw:flex tw:min-h-9 tw:w-full tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:px-2.5 tw:py-1.5 tw:text-sm tw:disabled:cursor-not-allowed tw:disabled:opacity-50',
    selected
      ? 'tw:border-app-accent tw:bg-app-panel tw:text-app-text'
      : 'tw:border-app-border tw:bg-app-canvas tw:text-app-text',
  ].join(' ')
