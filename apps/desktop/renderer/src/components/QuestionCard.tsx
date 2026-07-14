import { Check, ChevronDown, LoaderCircle, PencilLine } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuestionRow } from '@codepilotx/session-view'

interface QuestionCardProps {
  question: QuestionRow
  onSubmit: (answer: string, ignored?: boolean) => Promise<void>
}

export function QuestionCard({ question, onSubmit }: QuestionCardProps) {
  const recommendedID = useMemo(() => question.choices.find((option) => option.recommended)?.id ?? question.choices[0]?.id ?? '', [question.choices])
  const [selectedId, setSelectedId] = useState(recommendedID)
  const [customAnswer, setCustomAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const pending = question.status === 'pending'
  const selectedOption = question.choices.find((option) => option.id === selectedId)
  const answer = customAnswer.trim() || selectedOption?.label || ''

  useEffect(() => {
    setSelectedId(recommendedID)
    setCustomAnswer('')
    setSubmitting(false)
  }, [question.id, recommendedID])

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) void submit('', true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, submitting])

  const submit = async (nextAnswer: string, ignored = false) => {
    if (!pending || submitting || (!ignored && !nextAnswer)) return
    setSubmitting(true)
    try { await onSubmit(nextAnswer, ignored) }
    finally { setSubmitting(false) }
  }

  const answered = question.status === 'answered'
  return (
    <section className={`question-card question-${question.status}`} aria-label="需要用户回答的问题">
      <h2>{question.prompt}</h2>
      <div className="question-options" role="radiogroup" aria-label={question.prompt}>
        {question.choices.map((option, index) => {
          const selected = answered ? question.answer === option.label : option.id === selectedId && !customAnswer
          return <button className={`question-option ${selected ? 'question-option-selected' : ''}`} key={option.id} role="radio" aria-checked={selected} disabled={!pending || submitting} onClick={() => { setSelectedId(option.id); setCustomAnswer('') }}>
            <span className={`question-number ${selected ? 'question-number-selected' : ''}`}>{selected ? <Check size={14} /> : index + 1}</span>
            <span>{option.label}{option.recommended ? '（推荐）' : ''}</span>
            {option.description ? <span className="question-info-wrap" tabIndex={0}><span className="question-info" aria-label={`${option.label}的详细说明`}>i</span><span className="question-tooltip" role="tooltip">{option.description}</span></span> : null}
          </button>
        })}
        {answered && question.answer && !question.choices.some((option) => option.label === question.answer) ? <span className="question-custom-answer">{question.answer}</span> : null}
      </div>
      {pending ? <div className="question-footer"><PencilLine size={15} /><input value={customAnswer} disabled={submitting} onChange={(event) => setCustomAnswer(event.target.value)} placeholder="输入其他方案" aria-label="补充调整说明" /><button className="question-ignore" disabled={submitting} onClick={() => { void submit('', true) }}>忽略 ESC</button><button className="question-submit" onClick={() => { void submit(answer) }} disabled={!answer || submitting}>{submitting ? <LoaderCircle className="spin" size={14} /> : <>提交 <ChevronDown size={14} /></>}</button></div> : <p className="question-history-status">{answered ? `已选择：${question.answer ?? '未记录答案'}` : question.status === 'ignored' ? '已忽略' : '已取消'}</p>}
    </section>
  )
}
