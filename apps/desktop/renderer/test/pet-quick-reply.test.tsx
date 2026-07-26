import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PetQuickReply } from '../src/features/pet/PetQuickReply'

describe('PetQuickReply', () => {
  test('renders disabled question submission until every answer is confirmed', () => {
    const html = renderToStaticMarkup(
      <PetQuickReply
        request={{
          requestId: 'question-1',
          toolName: 'AskUserQuestion',
          description: '请选择',
          input: {
            questions: [{
              id: 'editor',
              header: '编辑器',
              question: '选择编辑器',
              options: [
                { label: 'VS Code', description: '使用 VS Code' },
                { label: 'Zed', description: '使用 Zed' },
              ],
              multiSelect: false,
            }],
          },
        }}
        onRespond={() => undefined}
      />,
    )
    expect(html).toContain('选择编辑器')
    expect(html).toContain('其他回答')
    expect(html).toMatch(/disabled=""[^>]*>提交回答</)
  })

  test('renders one-shot approval choices', () => {
    const approval = renderToStaticMarkup(
      <PetQuickReply
        request={{
          requestId: 'approval-1',
          toolName: 'PowerShell',
          description: '运行测试',
          input: {},
        }}
        onRespond={() => undefined}
      />,
    )
    expect(approval).toContain('允许一次')
    expect(approval).toContain('拒绝')
  })

  test('offers a safe fallback for malformed question requests', () => {
    const html = renderToStaticMarkup(
      <PetQuickReply
        request={{
          requestId: 'bad-question',
          toolName: 'AskUserQuestion',
          description: '损坏',
          input: {},
        }}
        onRespond={() => undefined}
      />,
    )
    expect(html).toContain('无法解析问题')
    expect(html).toContain('跳过')
  })
})
