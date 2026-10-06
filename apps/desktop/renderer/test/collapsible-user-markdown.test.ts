import { describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  CollapsibleUserMarkdown,
  resolveCollapseState,
  setFocusableElementVisibility,
} from '../src/features/session/conversation/CollapsibleUserMarkdown.js'

describe('collapsible user Markdown', () => {
  test('renders the user message through the shared Markdown renderer', () => {
    const html = renderToStaticMarkup(
      React.createElement(CollapsibleUserMarkdown, {
        text: '# 标题\n\n- **第一项**\n- `第二项`',
      }),
    )

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>第一项</strong>')
    expect(html).toContain('<code>第二项</code>')
  })

  test('uses measured rendered height and resets expansion when text changes', () => {
    expect(resolveCollapseState(null, 'message', null)).toBe('uncollapsible')
    expect(
      resolveCollapseState({ collapsedHeightPx: 400, contentHeightPx: 401 }, 'message', null),
    ).toBe('uncollapsible')
    expect(
      resolveCollapseState({ collapsedHeightPx: 400, contentHeightPx: 402 }, 'message', null),
    ).toBe('collapsed')
    expect(
      resolveCollapseState({ collapsedHeightPx: 400, contentHeightPx: 402 }, 'message', 'message'),
    ).toBe('expanded')
    expect(
      resolveCollapseState(
        { collapsedHeightPx: 400, contentHeightPx: 402 },
        'edited message',
        'message',
      ),
    ).toBe('collapsed')
  })

  test('hides clipped controls and restores their previous aria state', () => {
    const attributes = new Map<string, string>()
    const element = {
      removeAttribute(name: string): void {
        attributes.delete(name)
      },
      setAttribute(name: string, value: string): void {
        attributes.set(name, value)
      },
      toggleAttribute(name: string, force?: boolean): boolean {
        if (force) attributes.set(name, '')
        else attributes.delete(name)
        return attributes.has(name)
      },
    }

    setFocusableElementVisibility(element, false, 'false')
    expect(attributes.has('inert')).toBe(true)
    expect(attributes.get('aria-hidden')).toBe('true')

    setFocusableElementVisibility(element, true, 'false')
    expect(attributes.has('inert')).toBe(false)
    expect(attributes.get('aria-hidden')).toBe('false')

    setFocusableElementVisibility(element, false, null)
    setFocusableElementVisibility(element, true, null)
    expect(attributes.has('aria-hidden')).toBe(false)
  })

  test('does not set margin-block space-3 token on user message markdown p', async () => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const scssPath = path.resolve(
      import.meta.dir,
      '../src/styles/primitives/conversation.css',
    )
    const content = await fs.readFile(scssPath, 'utf-8')

    // 用户消息气泡共享列表与首尾节点节奏；space-3 段落间距只属于
    // process/result 文本项，气泡不参与该段落规则（原 SCSS 嵌套块检查的
    // 等价形式：读取段落规则的 selector 列表）。
    const paragraphMarginSelectors = content.match(
      /([^{}]+)\{\s*p\s*\{[^}]*margin-block:\s*var\(--cpx-sys-space-3\);[^}]*\}/,
    )?.[1]
    expect(paragraphMarginSelectors).toBeDefined()
    expect(paragraphMarginSelectors).toContain('.canonical-text-item--process > .md-body')
    expect(paragraphMarginSelectors).not.toContain('.canonical-user-message__bubble')
  })
})
