import { expect, test } from 'bun:test'
import { selectParetoCandidate, type ParetoCandidate } from './paretoCodeRouter.js'

function makeCandidate(overrides: Partial<ParetoCandidate> = {}): ParetoCandidate {
  return {
    providerID: 'minimax',
    model: 'test-model',
    label: 'Test Model',
    score: 50,
    reasoning: false,
    toolCalls: true,
    contextWindow: 128000,
    costPerPromptMillion: 0.5,
    costPerCompletionMillion: 1.5,
    ...overrides,
  }
}

test('pareto code selects the highest scored candidate', () => {
  const result = selectParetoCandidate({
    message: 'implement a React component',
    candidates: [
      makeCandidate({ model: 'cheap', score: 80 }),
      makeCandidate({ model: 'expensive', score: 60 }),
    ],
  })
  expect(result.model).toBe('cheap')
  expect(result.providerID).toBe('minimax')
})

test('pareto code boosts code task candidates with tool calls', () => {
  const withTools = makeCandidate({ model: 'with-tools', toolCalls: true, score: 50 })
  const withoutTools = makeCandidate({ model: 'no-tools', toolCalls: false, score: 50 })
  const result = selectParetoCandidate({
    message: 'write a function that reads files',
    candidates: [withoutTools, withTools],
  })
  expect(result.model).toBe('with-tools')
})

test('pareto code returns fallback when no candidates', () => {
  const result = selectParetoCandidate({
    message: 'hello',
    candidates: [],
    preferredProviderID: 'anthropic',
  })
  expect(result.providerID).toBe('anthropic')
  expect(result.model).toBe('')
  expect(result.reason).toContain('no candidates')
})

test('pareto code prefers lower cost for code tasks', () => {
  const cheap = makeCandidate({ model: 'cheap', costPerPromptMillion: 0.2, score: 50 })
  const expensive = makeCandidate({ model: 'expensive', costPerPromptMillion: 10, score: 50 })
  const result = selectParetoCandidate({
    message: 'build a REST API',
    candidates: [expensive, cheap],
  })
  expect(result.model).toBe('cheap')
})

test('pareto code handles non-code tasks', () => {
  const result = selectParetoCandidate({
    message: 'what is the weather today?',
    candidates: [
      makeCandidate({ model: 'fast', score: 90, contextWindow: 8000, toolCalls: false }),
      makeCandidate({ model: 'slow', score: 70, contextWindow: 200000, toolCalls: false }),
    ],
  })
  expect(result.model).toBe('fast')
})
