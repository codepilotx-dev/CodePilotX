import type { RpcResult } from '@codepilotx/agent-protocol'
import type { DesktopPermissionDecision } from '../../../shared/types.js'

type QuestionInteraction = Extract<RpcResult<'interaction/listPending'>['interactions'][number], { kind: 'question' }>

export function questionInteractionResponse(interaction: QuestionInteraction, decision: DesktopPermissionDecision): RpcResult<'interaction/respond'>['response'] {
  if (decision.behavior === 'deny') return { kind: 'question', status: 'ignored' }
  const skippedIds = decision.updatedInput?.skippedQuestionIds ?? []
  if (!Array.isArray(skippedIds) || skippedIds.some(id => typeof id !== 'string' || !interaction.questions.some(question => question.id === id)) || new Set(skippedIds).size !== skippedIds.length) {
    throw new Error('跳过的问题 ID 无效，请重新打开会话后重试。')
  }
  const answer = questionAnswerFromDecision(decision)
  const rawAnswers = parseQuestionAnswerMap(answer)
  return {
    kind: 'question', status: 'answered', resolution: 'user',
    answers: interaction.questions.map(question => {
      if (skippedIds.includes(question.id)) return { questionId: question.id, choiceIds: [], skipped: true as const }
      const value = rawAnswers[question.id] ?? (interaction.questions.length === 1 ? answer : '')
      const choice = question.choices.find(candidate => candidate.id === value || candidate.label === value || candidate.label.replace(/\s+\(Recommended\)$/u, '') === value)
      return { questionId: question.id, choiceIds: choice ? [choice.id] : [], ...(!choice && value ? { text: value } : {}) }
    }),
  }
}

function questionAnswerFromDecision(decision: DesktopPermissionDecision): string {
  const input = decision.updatedInput
  const answers = input?.answers
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    const values = Object.values(answers).filter((value): value is string => typeof value === 'string')
    if (values.length > 0) return JSON.stringify(answers)
  }
  if (typeof input?.answer === 'string') return input.answer
  return decision.message ?? ''
}

function parseQuestionAnswerMap(answer: string | null): Record<string, string> {
  if (!answer?.trim().startsWith('{')) return {}
  try {
    const parsed = JSON.parse(answer) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}
