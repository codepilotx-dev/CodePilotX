import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'modal.css')

function ruleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(
    `(?:^|})\\s*${escapedSelector}\\s*\\{([^}]*)\\}`,
  ).exec(css)

  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

test('archive toast remains clickable inside the Electron titlebar drag region', async () => {
  const css = (await readFile(cssPath, 'utf8')).replace(/\r\n/g, '\n')

  expect(ruleBody(css, '.archive-session-toast')).toContain(
    '-webkit-app-region: no-drag;',
  )
  expect(
    ruleBody(css, '.archive-session-toast-link,\n.archive-session-toast-close'),
  ).toContain('-webkit-app-region: no-drag;')
})
