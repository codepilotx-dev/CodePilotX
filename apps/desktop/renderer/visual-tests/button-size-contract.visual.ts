import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

type Metrics = {
  background: string
  border: string
  color: string
  fontSize: string
  height: number
  iconSize: number | null
  lineHeight: string
  width: number
}

async function metrics(locator: Locator): Promise<Metrics> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    const icon = element.querySelector(':scope > svg')?.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      color: style.color,
      fontSize: style.fontSize,
      height: box.height,
      iconSize: icon?.width ?? null,
      lineHeight: style.lineHeight,
      width: box.width,
    }
  })
}

async function installPrimitiveFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = document.createElement('div')
    fixture.id = 'button-contract-fixture'
    fixture.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:4px'
    const sizes = [
      'default',
      'compact',
      'medium',
      'toolbar',
      'toolbarLabel',
      'composer',
      'icon',
      'iconMd',
      'iconSm',
      'tabStripAction',
    ]
    for (const size of sizes) {
      const button = document.createElement('button')
      button.className = 'ui-button icon-button'
      button.dataset.color = 'secondary'
      button.dataset.contentLayout = 'default'
      button.dataset.radius = 'default'
      button.dataset.size = size
      if (size.startsWith('icon') || size === 'tabStripAction') {
        button.dataset.uniform = 'true'
      }
      button.textContent = size
      if (size.startsWith('icon') || size === 'tabStripAction') {
        button.textContent = ''
        button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12h16" /></svg>'
      }
      fixture.append(button)
    }
    for (const color of ['primary', 'secondary', 'outline', 'ghost', 'danger', 'dangerSolid']) {
      const button = document.createElement('button')
      button.className = 'ui-button'
      button.dataset.color = color
      button.dataset.contractColor = color
      button.dataset.contentLayout = 'default'
      button.dataset.radius = 'default'
      button.dataset.size = 'toolbar'
      button.textContent = color
      fixture.append(button)
    }
    const returnButton = document.createElement('button')
    returnButton.className = 'composer-change-summary__return'
    returnButton.dataset.contract = 'return-to-bottom'
    fixture.append(returnButton)
    document.body.append(fixture)
  })
}

async function expectBox(locator: Locator, width: number, height = width): Promise<void> {
  const value = await metrics(locator)
  expect(value.width).toBe(width)
  expect(value.height).toBe(height)
}

for (const uiFontSize of [11, 16]) {
  test(`Codex button and chrome contracts stay fixed at UI ${uiFontSize}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await prepareVisualTheme(page, 'dark', { uiFontSize })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForVisualPage(
      page,
      'dark',
      page.locator('[data-canonical-thread-id="visual-rich"]'),
    )
    await installPrimitiveFixture(page)

    const fixture = page.locator('#button-contract-fixture')
    const bySize = (size: string) => fixture.locator(`[data-size="${size}"]`).first()
    await expectBox(bySize('default'), await bySize('default').evaluate(element => element.getBoundingClientRect().width), 24)
    await expectBox(bySize('compact'), await bySize('compact').evaluate(element => element.getBoundingClientRect().width), 24)
    await expectBox(bySize('medium'), await bySize('medium').evaluate(element => element.getBoundingClientRect().width), 32)
    await expectBox(bySize('toolbar'), await bySize('toolbar').evaluate(element => element.getBoundingClientRect().width), 28)
    await expectBox(bySize('toolbarLabel'), await bySize('toolbarLabel').evaluate(element => element.getBoundingClientRect().width), 28)
    await expectBox(bySize('composer'), await bySize('composer').evaluate(element => element.getBoundingClientRect().width), 28)
    await expectBox(bySize('icon'), 28)
    await expectBox(bySize('iconMd'), 20)
    await expectBox(bySize('iconSm'), 16)
    await expectBox(bySize('tabStripAction'), 34)

    expect(await metrics(bySize('compact'))).toMatchObject({ fontSize: '11px', lineHeight: '16px' })
    expect(await metrics(bySize('toolbar'))).toMatchObject({ fontSize: '14px', lineHeight: '18px' })
    expect(await metrics(bySize('toolbarLabel'))).toMatchObject({ fontSize: '12px', lineHeight: '18px' })
    expect(await metrics(bySize('composer'))).toMatchObject({ fontSize: '12px', lineHeight: '18px' })
    expect(await metrics(bySize('icon'))).toMatchObject({ iconSize: 18 })
    expect(await metrics(bySize('iconMd'))).toMatchObject({ iconSize: 14 })
    expect(await metrics(bySize('iconSm'))).toMatchObject({ iconSize: 14 })
    expect(await metrics(bySize('tabStripAction'))).toMatchObject({ iconSize: 16 })

    await expect(page.locator('.app-menubar')).toHaveCSS('height', '36px')
    await expect(page.locator('.desktop-workspace-header')).toHaveCSS('height', '46px')
    await expect(page.locator('.sidebar-product-mode-trigger')).toHaveCSS('height', '32px')
    await expectBox(page.getByRole('button', { name: '搜索任务' }), 28)
    await expectBox(page.locator('.sidebar-timeline-toggle-button'), 28)
    await expectBox(page.getByRole('button', { name: '帮助' }), 28)
    await expectBox(page.getByRole('button', { name: /集成终端/u }), 28)
    await expectBox(page.getByRole('button', { name: /右侧面板/u }), 28)
    await expectBox(fixture.locator('[data-contract="return-to-bottom"]'), 32)

    await page.getByRole('button', { name: '显示右侧面板' }).click()
    await expect(page.locator('.right-dock-header')).toHaveCSS('height', '40px')
    const tabStripAction = page.locator('.right-dock-header .ui-button[data-size="tabStripAction"]').first()
    await expect(tabStripAction).toBeVisible()
    await expectBox(tabStripAction, 34)

    const primary = await metrics(fixture.locator('[data-contract-color="primary"]'))
    const secondary = await metrics(fixture.locator('[data-contract-color="secondary"]'))
    const outline = await metrics(fixture.locator('[data-contract-color="outline"]'))
    const ghost = await metrics(fixture.locator('[data-contract-color="ghost"]'))
    const danger = await metrics(fixture.locator('[data-contract-color="danger"]'))
    const dangerSolid = await metrics(fixture.locator('[data-contract-color="dangerSolid"]'))
    expect(primary.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(primary.background).not.toBe(secondary.background)
    expect(secondary.border).toBe('rgba(0, 0, 0, 0)')
    expect(outline.border).not.toBe('rgba(0, 0, 0, 0)')
    expect(ghost.background).toBe('rgba(0, 0, 0, 0)')
    expect(ghost.border).toBe('rgba(0, 0, 0, 0)')
    expect(danger.background).not.toBe(dangerSolid.background)
    expect(danger.color).not.toBe(dangerSolid.color)
  })
}
