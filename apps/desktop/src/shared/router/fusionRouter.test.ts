import { expect, test } from 'bun:test'
import {
  selectFusionPanel,
  fusionBypass,
  type FusionPanelCandidate,
} from './fusionRouter.js'

function makeCandidate(
  overrides: Partial<FusionPanelCandidate> = {},
): FusionPanelCandidate {
  return {
    providerID: 'minimax',
    model: 'panel-model',
    score: 50,
    ...overrides,
  }
}

test('fusion selects top 3 panel models by score', () => {
  const result = selectFusionPanel({
    message: 'review this code',
    panelCandidates: [
      makeCandidate({ model: 'a', score: 90 }),
      makeCandidate({ model: 'b', score: 80 }),
      makeCandidate({ model: 'c', score: 70 }),
      makeCandidate({ model: 'd', score: 60 }),
    ],
  })
  expect(result.panelModels).toHaveLength(3)
  expect(result.panelModels[0]!.model).toBe('a')
  expect(result.panelModels[1]!.model).toBe('b')
  expect(result.panelModels[2]!.model).toBe('c')
})

test('fusion uses judge model when provided', () => {
  const result = selectFusionPanel({
    message: 'review this code',
    panelCandidates: [
      makeCandidate({ model: 'a', score: 90 }),
      makeCandidate({ model: 'b', score: 80 }),
    ],
    judgeProviderID: 'anthropic',
    judgeModel: 'claude-sonnet-4-20250514',
  })
  expect(result.judgeModel.model).toBe('claude-sonnet-4-20250514')
  expect(result.judgeModel.providerID).toBe('anthropic')
})

test('fusion falls back to top panel model as judge', () => {
  const result = selectFusionPanel({
    message: 'review this code',
    panelCandidates: [
      makeCandidate({ model: 'top-panel', score: 90 }),
    ],
  })
  expect(result.judgeModel.model).toBe('top-panel')
})

test('fusion bypass returns panel when bypass is true', () => {
  const result = selectFusionPanel({
    message: 'test',
    panelCandidates: [makeCandidate({ model: 'a', score: 90 })],
    bypass: true,
  })
  expect(result.bypass).toBe(true)
  expect(result.panelModels).toHaveLength(0)
})

test('fusion returns unconfigured judge when no model is available', () => {
  const result = selectFusionPanel({
    message: 'test',
    panelCandidates: [],
  })
  expect(result.judgeModel).toEqual({ providerID: '', model: '' })
})

test('fusionBypass detects non-off router modes', () => {
  expect(fusionBypass('off')).toBe(false)
  expect(fusionBypass('pareto-code')).toBe(true)
  expect(fusionBypass('fusion')).toBe(true)
})
