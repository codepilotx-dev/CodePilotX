import { describe, expect, test } from 'bun:test'
import {
  extractLatestProposedPlanText,
  parseProposedPlanText,
  stripProposedPlanBlocks,
} from './proposedPlan.js'

describe('proposed plan parser', () => {
  test('extracts the latest complete proposed plan', () => {
    const text = [
      'first',
      '<proposed_plan>',
      'old plan',
      '</proposed_plan>',
      'middle',
      '<proposed_plan>',
      '# New plan',
      '',
      '- Do it',
      '</proposed_plan>',
      'tail',
    ].join('\n')

    expect(extractLatestProposedPlanText(text)).toBe('# New plan\n\n- Do it')
  })

  test('strips complete proposed plan blocks from visible text', () => {
    const text = [
      'visible before',
      '<proposed_plan>',
      '# Hidden',
      '</proposed_plan>',
      'visible after',
    ].join('\n')

    expect(stripProposedPlanBlocks(text)).toBe('visible before\nvisible after')
  })

  test('does not treat an unclosed block as complete', () => {
    const text = 'thinking\n<proposed_plan>\n# Draft'

    expect(extractLatestProposedPlanText(text)).toBeNull()
    expect(parseProposedPlanText(text)).toMatchObject({
      visibleText: 'thinking',
      planText: '# Draft',
      hasOpenPlan: true,
      isComplete: false,
    })
  })
})
