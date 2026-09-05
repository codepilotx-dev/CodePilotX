// Run from apps/desktop/renderer (Node owns Playwright pipes on Windows):
// bun build ./test/icon-size.browser.ts --target=node --external=@playwright/test --external=sass --outfile=./node_modules/.cache/icon-size.browser.mjs
// node node_modules/.cache/icon-size.browser.mjs
import { strict as assert } from 'node:assert'
import { chromium } from '@playwright/test'
import { compile } from 'sass'
import { createElement as h } from 'react'
import { renderToReadableStream, renderToString } from 'react-dom/server'
import { CalendarClock, Plus } from 'lucide-react'
import { Button, type ButtonSize } from '../src/components/ui/Button.js'
import { Spinner } from '../src/components/ui/Spinner.js'
import { APP_ICON_SIZE } from '../src/components/ui/iconTokens.js'
import { FileTypeIcon, FolderTypeIcon } from '../src/features/layout/FileTypeIcon.js'

const css = compile('src/styles/index.scss').css
const lazyCss = ['marketplace', 'model-center', 'settings']
  .map(name => compile(`src/styles/lazy/${name}.scss`).css).join('\n')
const sizes: [ButtonSize, number][] = [
  ['compact', 24], ['composer', 28], ['composerSm', 28], ['composerUtility', 28],
  ['default', 24], ['icon', 28], ['iconLarge', 36], ['iconMd', 20], ['iconSm', 16],
  ['large', 36], ['medium', 32], ['tabStripAction', 36], ['toolbar', 28], ['toolbarLabel', 28],
]
const buttons = sizes.map(([size]) => renderToString(h(Button, {
  id: `button-${size}`, size, children: h(Plus),
}))).join('')
const states = renderToString(h('div', null,
  h(Button, { id: 'disabled', disabled: true, children: h(Plus) }),
  h(Button, { id: 'loading', loading: true, children: '加载中' }),
  ...(['small', 'medium', 'large'] as const).map(size => h(Spinner, { key: size, size })),
))
const files = h('div', null, h(FileTypeIcon, { path: 'example.ts' }), h(FolderTypeIcon, { path: 'src' }))
// Synchronous SSR renders the actual Suspense fallback; allReady resolves the wrapper's lazy module.
const fallback = renderToString(files)
const stream = await renderToReadableStream(files)
await stream.allReady
const resolvedFiles = await new Response(stream).text()
assert.match(fallback, /lucide-file/)
assert.doesNotMatch(resolvedFiles, /lucide-file/)
const icon = renderToString(h(Plus))
const empty = renderToString(h('div', { className: 'automation-empty-state' },
  h(CalendarClock, { size: APP_ICON_SIZE }), h('h2', null, '暂无已安排任务')))
const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>')}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.setContent(`<html data-reduce-motion="on"><head><style>${css}</style></head><body>
    <section id="buttons">${buttons}${states}</section>
    <div style="position:relative;height:32px;width:280px"><aside class="desktop-sidebar" style="--sidebar-current-width:280px"><span class="sidebar-indicator">${icon}</span></aside></div>
    <div class="popover-menu popover-menu--grid">
      ${['', 'rich'].map(kind => `<div class="popover-item ${kind}"><span class="popover-item-leading"><span class="popover-item-icon">${icon}</span></span><span class="popover-item-label">菜单</span><span class="popover-item-trailing"></span></div>`).join('')}
    </div>
    <div id="fallback">${fallback}</div><div id="resolved">${resolvedFiles}</div>
    ${empty}
    <div id="lazy"></div>
    <svg id="content-graphic" width="120" height="70"><rect width="120" height="70"/></svg>
  </body></html>`)
  const checkIcons = async () => {
    const dimensions = await page.locator('svg:not(#content-graphic), .ui-spinner, .plugin-logo__image:visible').evaluateAll(elements =>
      elements.map(element => {
        const { width, height } = element.getBoundingClientRect()
        return { name: `${element.parentElement?.outerHTML.slice(0, 120)} / ${element.tagName}`, width, height }
      }))
    assert.ok(dimensions.length > 20)
    for (const { name, width, height } of dimensions) {
      assert.equal(width, 14, `${name}: width`)
      assert.equal(height, 14, `${name}: height`)
    }
    for (const [size, height] of sizes) {
      assert.equal(await page.locator(`#button-${size}`).evaluate(element => element.getBoundingClientRect().height), height, `${size}: click target height`)
    }
    assert.deepEqual(await page.locator('#content-graphic').evaluate(element => {
      const { width, height } = element.getBoundingClientRect()
      return [width, height]
    }), [120, 70])
  }
  await checkIcons()
  await page.locator('#button-default').hover()
  await checkIcons()
  await page.locator('#button-default').focus()
  assert.equal(await page.locator('#button-default').evaluate(element => element.matches(':focus-visible')), true)
  // Load the actual feature entries after initial paint, preserving their production cascade layers.
  await page.addStyleTag({ content: lazyCss })
  await page.locator('#lazy').evaluate((element, source) => {
    element.innerHTML = `<span class="plugin-catalog-card__icon"><span class="plugin-logo plugin-logo--themed"><img alt="" class="plugin-logo__image plugin-logo__image--light" src="${source}"><img alt="" class="plugin-logo__image plugin-logo__image--dark" src="${source}"></span></span>`
  }, logo)
  for (const theme of ['', 'dark-theme']) {
    await page.locator('html').evaluate((element, theme) => { element.className = theme }, theme)
    await checkIcons()
    assert.equal(await page.locator('.plugin-logo__image--dark').isVisible(), theme === 'dark-theme')
    assert.equal(await page.locator('.plugin-logo__image:visible').evaluate(element => getComputedStyle(element).objectFit), 'contain')
  }
  console.log('14×14 rendered icons verified: button variants/states, sidebar, menus, file fallback/lazy wrapper, empty state and themed logo; click target heights and content SVG retained.')
} finally {
  await browser.close()
}
