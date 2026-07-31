import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  DESKTOP_VIEWPORT,
  closeTransientErrorToast,
  prepareVisualTheme,
  waitForVisualPage,
} from '../visual-tests/visual-test-helpers.js'

const WCAG_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
] as const

const ROUTES = [
  ['new', '/?visualCase=empty#/new'],
  ['thread-rich', '/?visualCase=rich#/threads/visual-rich'],
  ['thread-permission', '/?visualCase=permission#/threads/visual-permission'],
  ['thread-review', '/?visualCase=review#/threads/visual-review'],
  ['projects', '/?visualCase=empty#/projects'],
  ['models', '/?visualCase=empty#/models'],
  ['plugins', '/?visualCase=empty#/plugins'],
  ['automations', '/?visualCase=empty#/automations'],
  ['pets', '/?visualCase=empty#/pets'],
  ['settings-appearance', '/?visualCase=empty#/settings/appearance'],
  ['settings-general', '/?visualCase=empty#/settings/general'],
  ['settings-plugins', '/?visualCase=empty#/settings/plugins'],
  ['settings-environment', '/?visualCase=empty#/settings/environment/visual-workspace'],
  ['labs', '/?visualCase=empty#/labs'],
  ['not-found', '/?visualCase=empty#/route-that-does-not-exist'],
  ['pet-overlay', '/?visualCase=empty#/pet-overlay'],
] as const

async function preparePage(page: Page, route: string): Promise<void> {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'light')
  await page.goto(route)
  await waitForVisualPage(page, 'light', page.locator('body'))
  await closeTransientErrorToast(page)
}

async function expectNoWcagViolations(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags([...WCAG_TAGS])
    .analyze()

  if (results.incomplete.length > 0) {
    await testInfo.attach('axe-incomplete.json', {
      body: JSON.stringify(results.incomplete, null, 2),
      contentType: 'application/json',
    })
  }

  const violations = results.violations.map(violation => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map(node => ({
      target: node.target,
      summary: node.failureSummary,
    })),
  }))
  expect(violations).toEqual([])
}

for (const [name, route] of ROUTES) {
  test(`WCAG 2.2 AA: ${name}`, async ({ page }, testInfo) => {
    await preparePage(page, route)
    await expectNoWcagViolations(page, testInfo)
  })
}

test('WCAG 2.2 AA: command menu open state', async ({
  page,
}, testInfo) => {
  await preparePage(page, '/?visualCase=empty#/new')
  await page.keyboard.press('Control+K')
  await expect(
    page.getByRole('searchbox', { name: '搜索任务' }),
  ).toBeFocused()
  await expectNoWcagViolations(page, testInfo)
})

test('WCAG 2.2 AA: dropdown and menubar open states', async ({
  page,
}, testInfo) => {
  await preparePage(page, '/?visualCase=rich#/threads/visual-rich')

  const modeTrigger = page.getByRole('button', {
    name: /切换工作模式，当前为/,
  })
  await modeTrigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  const modeOptions = page.getByRole('menuitemradio')
  await expect(modeOptions).toHaveCount(2)
  await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(1)
  await expectNoWcagViolations(page, testInfo)
  await page.keyboard.press('Escape')

  const menubarTrigger = page.getByRole('menuitem', { name: '编辑' })
  await menubarTrigger.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await expectNoWcagViolations(page, testInfo)
})

test('WCAG 2.2 AA: popover open state', async ({ page }, testInfo) => {
  await preparePage(page, '/?visualCase=empty#/settings/appearance')
  await page.getByRole('button', {
    name: '浅色强调色颜色选择器',
  }).click()
  await expect(page.getByRole('dialog', { name: /浅色强调色/ })).toBeVisible()
  await expectNoWcagViolations(page, testInfo)

  const saturation = page.getByRole('slider', { name: '颜色饱和度' })
  await saturation.focus()
  await saturation.press('Home')
  await expect(saturation).toHaveAttribute('aria-valuenow', '0')
  await saturation.press('ArrowRight')
  await expect(saturation).toHaveAttribute('aria-valuenow', '1')

  const brightness = page.getByRole('slider', { name: '颜色亮度' })
  await brightness.focus()
  await brightness.press('End')
  await expect(brightness).toHaveAttribute('aria-valuenow', '100')
})

test('keyboard users can bypass the application chrome', async ({ page }) => {
  await preparePage(page, '/?visualCase=empty#/new')
  await page.evaluate(() => {
    document.body.tabIndex = -1
    document.body.focus()
    document.body.removeAttribute('tabindex')
  })

  await page.keyboard.press('Tab')
  const skipLink = page.getByRole('link', { name: '跳到主要内容' })
  await expect(skipLink).toBeFocused()
  await skipLink.press('Enter')
  await expect(page.locator('#desktop-main-content')).toBeFocused()
  await expect(page).toHaveTitle('新对话 · CodePilotX')
})
