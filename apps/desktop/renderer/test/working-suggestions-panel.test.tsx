import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkingSuggestionsPanel } from '../src/features/session/WorkingSuggestionsPanel.js'
import { selectWorkingSuggestionCategory } from '../src/features/session/workingSuggestions.js'

describe('WorkingSuggestionsPanel structure', () => {
  test('第一层渲染平面列表，不再使用卡片网格', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={{ kind: 'root' }}
        onSelectCategory={() => {}}
        onSelectTask={() => {}}
        onBack={() => {}}
      />,
    )
    expect(html).not.toContain('new-session-suggestion-card')
    expect(html).not.toContain('new-session-suggestion-grid')
    expect(html).toContain('new-session-suggestion-row')
    expect(html.match(/working-suggestion-row/g)).toHaveLength(3)
  })

  test('第一层三个分类具有正确的可访问名称', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={{ kind: 'root' }}
        onSelectCategory={() => {}}
        onSelectTask={() => {}}
        onBack={() => {}}
      />,
    )
    for (const label of ['规划今天的工作', '拆解复杂工作', '协调多个项目']) {
      expect(html).toContain(`<span>${label}</span>`)
    }
  })

  test('第二层渲染分类标题、返回入口与任务平面列表', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={selectWorkingSuggestionCategory('today', '规划今天的工作')}
        onSelectCategory={() => {}}
        onSelectTask={() => {}}
        onBack={() => {}}
      />,
    )
    expect(html).not.toContain('new-session-suggestion-card')
    expect(html).not.toContain('new-session-suggestion-grid')
    expect(html).not.toContain('new-session-suggestions')
    expect(html).not.toContain('is-follow-up')
    expect(html).toContain('的建议任务')
    expect(html).toContain('返回')
    expect(html).toContain('规划今天的工作')
    for (const label of [
      '安排今天全部任务',
      '安排带固定时间的事项',
      '重新规划剩余时间',
    ]) {
      expect(html).toContain(`<span>${label}</span>`)
    }
  })

  test('hidden 状态不渲染任何内容', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={{ kind: 'hidden', reason: 'prompt-filled' }}
        onSelectCategory={() => {}}
        onSelectTask={() => {}}
        onBack={() => {}}
      />,
    )
    expect(html).toBe('')
  })
})
