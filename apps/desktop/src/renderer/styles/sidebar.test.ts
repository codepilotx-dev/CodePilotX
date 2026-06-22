import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const sidebarCss = readFileSync(
  new URL('./sidebar.css', import.meta.url),
  'utf8',
)

function cssBlockFor(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = sidebarCss.match(
    new RegExp(`${escapedSelector}[\\s\\S]*?\\{([^}]*)\\}`),
  )
  return match?.[1] ?? ''
}

test('sidebar title flex items can shrink before applying ellipsis', () => {
  const titleBlock = cssBlockFor('.sidebar-item-label,')
  const buttonBlock = cssBlockFor('.sidebar-project-button,')

  expect(titleBlock).toContain('min-width: 0;')
  expect(buttonBlock).toContain('flex: 1 1 auto;')
  expect(buttonBlock).toContain('min-width: 0;')
})
