// Run from apps/desktop/renderer: node --experimental-strip-types test/sidebar-origin-layout.browser.ts
import { chromium } from '@playwright/test'
import { compile } from 'sass'
import { strict as assert } from 'node:assert'
const css = ['src/styles/design-system/tokens.scss', 'src/styles/components/button.scss', 'src/styles/features/layout-sidebar.scss'].map(path => compile(path, { silenceDeprecations: ['legacy-js-api'] }).css).join('\n')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
 const page = await browser.newPage()
 await page.setContent(`<style>${css}
 * {box-sizing:border-box} .desktop-sidebar {--sidebar-current-width:280px; --button-icon-size-xs:14px;} .sidebar-session-meta{display:flex;align-items:center;justify-content:flex-end} .row{height:32px;padding:4px 8px;display:flex;justify-content:flex-end}
 </style><aside class="desktop-sidebar">
 <div class="row"><div class="sidebar-session-meta"><span class="sidebar-session-indicator"><svg id="clock"></svg></span><span class="sidebar-session-indicator"><span id="dot" class="sidebar-session-unread-dot"></span></span></div></div>
 <div class="row"><div class="sidebar-session-meta"><div class="sidebar-session-actions"><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg id="pin"></svg></button><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg id="archive"></svg></button></div></div></div>
 <div class="row"><div class="sidebar-session-meta"><span class="sidebar-session-indicator"><svg id="idle-clock"></svg></span><span class="sidebar-session-indicator"></span></div></div>
 </aside>`)
 for (const width of [240,280,360]) {
  await page.locator('aside').evaluate((el, width) => (el as HTMLElement).style.setProperty('--sidebar-current-width',`${width}px`), width)
  const centers = await page.evaluate(() => Object.fromEntries(['clock','dot','pin','archive','idle-clock'].map(id=>{const b=document.getElementById(id)!.getBoundingClientRect();return [id,b.x+b.width/2]})))
  assert.equal(centers.clock,centers.pin)
  assert.equal(centers.dot,centers.archive)
  assert.equal(centers['idle-clock'],centers.pin)
  console.log(JSON.stringify({width,centers}))
 }
} finally {await browser.close()}
