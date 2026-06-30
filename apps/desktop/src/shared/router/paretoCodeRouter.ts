import type { ModelProviderID } from '../types.js'

export type ParetoCandidate = {
  providerID: ModelProviderID
  model: string
  label?: string
  score: number
  reasoning: boolean
  toolCalls: boolean
  contextWindow: number
  costPerPromptMillion: number
  costPerCompletionMillion: number
}

export type ParetoRouterInput = {
  message: string
  candidates: ParetoCandidate[]
  preferredProviderID?: ModelProviderID
}

export type ParetoRouterResult = {
  providerID: ModelProviderID
  model: string
  reason: string
}

const CODE_TASK_PATTERNS = [
  /implement|write|create|build|develop|code|program/gi,
  /refactor|optimize|fix|debug|test/gi,
  /function|class|component|api/gi,
  /typescript|javascript|python|rust|go|java|react/gi,
]

function isLikelyCodeTask(message: string): boolean {
  return CODE_TASK_PATTERNS.some(pattern => pattern.test(message))
}

function scoreCandidate(candidate: ParetoCandidate, isCode: boolean): number {
  let score = candidate.score

  if (isCode) {
    if (candidate.toolCalls) score += 30
    if (candidate.reasoning) score += 10
    score += Math.min(candidate.contextWindow / 10000, 20)
    if (candidate.costPerPromptMillion > 0 && candidate.costPerPromptMillion < 3) {
      score += 15
    }
    if (candidate.costPerCompletionMillion > 0 && candidate.costPerCompletionMillion < 15) {
      score += 10
    }
  } else {
    score += Math.min(candidate.contextWindow / 5000, 10)
  }

  return score
}

export function selectParetoCandidate(
  input: ParetoRouterInput,
): ParetoRouterResult {
  const isCode = isLikelyCodeTask(input.message)
  const scored = input.candidates.map(c => ({
    ...c,
    score: scoreCandidate(c, isCode),
  }))
  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return {
      providerID: input.preferredProviderID ?? '',
      model: '',
      reason: 'no candidates available',
    }
  }

  const best = scored[0]!
  return {
    providerID: best.providerID,
    model: best.model,
    reason: `pareto-code selected ${best.model} (score: ${best.score.toFixed(0)})`,
  }
}
