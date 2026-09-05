// Run from apps/desktop/renderer: node --experimental-strip-types test/sidebar-origin-layout.browser.ts
import { chromium } from '@playwright/test'
import { compile } from 'sass'
import { strict as assert } from 'node:assert'
const css = ['src/styles/design-system/tokens.scss', 'src/styles/components/button.scss', 'src/styles/features/layout-sidebar.scss'].map(path => compile(path, { silenceDeprecations: ['legacy-js-api'] }).css).join('\n')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
 const page = await browser.newPage()
 await page.setContent(`<style>${css}
 * {box-sizing:border-box} .desktop-sidebar {--sidebar-current-width:280px;--cpx-sys-motion-micro:0ms; --button-icon-size-xs:14px;} .sidebar-session-meta{display:flex;align-items:center;justify-content:flex-end} .row{height:32px;padding:4px 8px;display:flex;justify-content:flex-end}
 </style><aside class="desktop-sidebar">
 <div class="row"><div class="sidebar-session-meta"><span class="sidebar-indicator"><svg id="clock"></svg></span><span class="sidebar-indicator"><span id="dot" class="sidebar-unread-dot"></span></span></div></div>
 <div class="row"><div class="sidebar-session-meta"><div class="sidebar-session-actions"><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg id="pin"></svg></button><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg id="archive"></svg></button></div></div></div>
 <div class="row"><div class="sidebar-session-meta"><span class="sidebar-indicator"><svg id="idle-clock"></svg></span><span class="sidebar-indicator"></span></div></div>
 <div class="row sidebar-project-header"><span class="sidebar-row-trailing"><div class="sidebar-project-actions"><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg></svg></button><button id="project-action" class="ui-button icon-button" data-size="iconMd" data-uniform><svg></svg></button></div><span class="sidebar-project-unread sidebar-indicator"><span id="project-dot" class="sidebar-unread-dot"></span></span></span></div>
 <div class="row sidebar-section-header"><button id="section-title">项目</button><div class="sidebar-section-actions"><button id="section-menu" data-state="closed">更多</button><button>添加项目</button></div></div>
 </aside>`)
 for (const width of [240,280,360]) {
  await page.locator('aside').evaluate((el, width) => (el as HTMLElement).style.setProperty('--sidebar-current-width',`${width}px`), width)
  const centers = await page.evaluate(() => Object.fromEntries(['clock','dot','pin','archive','idle-clock'].map(id=>{const b=document.getElementById(id)!.getBoundingClientRect();return [id,b.x+b.width/2]})))
  assert.equal(centers.clock,centers.pin)
  assert.equal(centers.dot,centers.archive)
  assert.equal(centers['idle-clock'],centers.pin)
  const projectDot = page.locator('#project-dot')
  const projectAction = page.locator('#project-action')
  const dotBox = await projectDot.boundingBox()
  assert.ok(dotBox)
  assert.equal(dotBox.x + dotBox.width / 2, centers.dot)
  await page.locator('.sidebar-project-header').hover()
  assert.equal(await projectDot.isVisible(), false)
  const actionBox = await projectAction.boundingBox()
  assert.ok(actionBox)
  assert.equal(actionBox.x + actionBox.width / 2, centers.dot)
  await projectAction.click()
  await page.mouse.move(700, 500)
  assert.equal(await projectAction.evaluate(el => el === document.activeElement), true)
  assert.equal(await projectDot.isVisible(), true)
  await page.keyboard.press('Shift+Tab')
  assert.equal(await projectDot.isVisible(), false)
  await page.mouse.click(700, 500)
  assert.equal(await projectDot.isVisible(), true)
  console.log(JSON.stringify({width,centers}))
 }
 const title = page.locator('#section-title')
 const actions = page.locator('.sidebar-section-actions')
 const opacity = () => actions.evaluate(el => getComputedStyle(el).opacity)
 await title.click()
 await page.mouse.move(700, 500)
 assert.equal(await title.evaluate(el => el === document.activeElement), true)
 assert.equal(await opacity(), '0')
 await page.keyboard.press('Shift+Tab')
 await page.keyboard.press('Tab')
 assert.equal(await title.evaluate(el => el.matches(':focus-visible')), true)
 assert.equal(await opacity(), '1')
 await page.locator('#section-menu').evaluate(el => el.setAttribute('data-state', 'open'))
 await page.mouse.click(700, 500)
 assert.equal(await opacity(), '1')
 await page.locator('#section-menu').evaluate(el => el.setAttribute('data-state', 'closed'))
 assert.equal(await opacity(), '0')
 console.log('Pointer focus hides actions; keyboard focus and open menus reveal them.')
} finally {await browser.close()}
