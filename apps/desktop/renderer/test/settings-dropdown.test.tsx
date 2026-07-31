import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsDropdown } from '../src/features/settings/SettingsDropdown.js'

describe('settings dropdown trigger contract', () => {
  test('renders a focusable Radix Select trigger with its selected label', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="示例选择"
        options={[
          { value: 'first', label: '第一项' },
          { value: 'second', label: '第二项' },
        ]}
        value="second"
        width={200}
        onChange={() => {}}
      />,
    )

    const trigger = html.match(
      /<button\b[^>]*aria-label="示例选择"[^>]*>/,
    )?.[0]

    expect(html).toContain('aria-label="示例选择"')
    expect(html).toContain('第二项')
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain('tabindex="-1"')
  })

  test('keeps the searchable trigger in the default tab order', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="搜索选择"
        options={[{ value: 'item', label: '可搜索项' }]}
        searchable
        value="item"
        width={240}
        onChange={() => {}}
      />,
    )

    const trigger = html.match(
      /<button\b[^>]*aria-label="搜索选择"[^>]*>/,
    )?.[0]

    expect(html).toContain('aria-label="搜索选择"')
    expect(html).toContain('可搜索项')
    expect(trigger).toBeDefined()
    expect(trigger).not.toContain('tabindex="-1"')
  })

  test('renders an empty-value option without exposing the internal sentinel', () => {
    const html = renderToStaticMarkup(
      <SettingsDropdown
        ariaLabel="空值选择"
        options={[{ value: '', label: '继承默认值' }]}
        value=""
        width={200}
        onChange={() => {}}
      />,
    )

    expect(html).toContain('继承默认值')
    expect(html).not.toContain('__radix_empty_value__')
  })
})
