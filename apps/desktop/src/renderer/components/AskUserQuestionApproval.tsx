import React from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Info, Pencil } from 'lucide-react'
import type { DesktopPermissionRequest } from '../../shared/types.js'

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

type QuestionState = {
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
  const [error, setError] = React.useState<string | null>(null)

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

    for (const question of questions) {
      const state = questionStates[question.question] ?? {
        selected: [],
        custom: '',
      }
      const answerParts = [
        ...state.selected,
        ...(state.custom.trim() ? [state.custom.trim()] : []),
      ]
      if (answerParts.length === 0) {
        setError('请回答每个问题后再提交。')
        return
      }
      answers[question.question] = answerParts.join(', ')
    }

    onSubmit({
      ...request.input,
      answers,
    })
  }

  return (
    <div className="ask-user-question-approval">
      {questions.map(question => {
        const state = questionStates[question.question] ?? {
          selected: [],
          custom: '',
        }
        return (
          <section className="ask-user-question-block" key={question.question}>
            <h3 className="ask-user-question-heading">{question.question}</h3>
            <div
              className="inline-approval-options"
              role={question.multiSelect ? 'group' : 'radiogroup'}
            >
              {question.options.map((option, index) => {
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
                    role={question.multiSelect ? 'checkbox' : 'radio'}
                    title={option.description || undefined}
                    type="button"
                    onClick={() => {
                      updateQuestion(question.question, current => {
                        if (!question.multiSelect) {
                          return {
                            ...current,
                            custom: '',
                            selected: [option.label],
                          }
                        }
                        const selectedLabels = current.selected.includes(
                          option.label,
                        )
                          ? current.selected.filter(
                              label => label !== option.label,
                            )
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
                    updateQuestion(question.question, current => ({
                      ...current,
                      custom,
                      selected:
                        !question.multiSelect && custom.trim()
                          ? []
                          : current.selected,
                    }))
                  }}
                />
              </label>
            </div>
          </section>
        )
      })}
      {error ? <p className="ask-user-question-error">{error}</p> : null}
      <div className="inline-approval-footer inline-approval-footer-split">
        <div className="inline-approval-footer-hint">
          <span>忽略</span>
          <kbd className="inline-approval-footer-key">ESC</kbd>
        </div>
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