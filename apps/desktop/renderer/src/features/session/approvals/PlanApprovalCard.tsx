import React from 'react'
import type { PlanApproval } from '@codepilotx/shared/thread'
import { QuestionAnswerForm } from './AskUserQuestionApproval.js'
import type { AskUserQuestion, QuestionState } from './askUserQuestionModel.js'

export type PlanApprovalResponse =
  | { action: 'implement' }
  | { action: 'feedback'; feedback: string }
  | { action: 'close' }

export type PlanApprovalCardProps = {
  approval: PlanApproval
  identity?: string
  disabledReason?: string
  onRespond: (response: PlanApprovalResponse) => Promise<void>
}

const PLAN_QUESTION_ID = 'implement-plan'
const IMPLEMENT_LABEL = '是，实施此计划'
const PLAN_QUESTION: AskUserQuestion = {
  id: PLAN_QUESTION_ID,
  header: '计划',
  question: '实施此计划？',
  options: [{ label: IMPLEMENT_LABEL, description: '' }],
  multiSelect: false,
}

export function planResponseFromDraft(state: QuestionState | undefined): PlanApprovalResponse {
  const feedback = state?.custom.trim()
  if (feedback) return { action: 'feedback', feedback }
  if (state?.answered && state.selected.length === 1 && state.selected[0] === IMPLEMENT_LABEL) {
    return { action: 'implement' }
  }
  throw new Error('请选择实施计划或填写修改意见。')
}

export function PlanApprovalCard({ approval, identity, disabledReason, onRespond }: PlanApprovalCardProps): React.ReactNode {
  const close = () => onRespond({ action: 'close' })
  return <QuestionAnswerForm
    requestId={`${approval.id}:${approval.version}`}
    questions={[PLAN_QUESTION]}
    variant="plan"
    identity={identity}
    disabledReason={disabledReason}
    dismissLabel="关闭"
    closeLabel="关闭计划"
    closeError="关闭计划失败，请重试。"
    onInterrupt={close}
    onReject={close}
    onSubmit={(_input, states) => onRespond(planResponseFromDraft(states[PLAN_QUESTION_ID]))}
  />
}
