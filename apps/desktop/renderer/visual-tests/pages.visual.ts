import { expect, test, type Page } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V6_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

const visualTest = V6_VISUAL_BASELINES_ENABLED ? test : test.skip

const FORMAL_ROUTES = [
  { id: 'new', route: '/?visualCase=empty#/new', ready: 'main' },
  {
    id: 'thread',
    route: '/?visualCase=rich#/threads/visual-rich',
    ready: '.workflow-page',
  },
  { id: 'models', route: '/?visualCase=empty#/models', ready: '.model-center-shell' },
  { id: 'plugins', route: '/?visualCase=empty#/plugins', ready: '.plugins-view' },
  {
    id: 'automations',
    route: '/?visualCase=empty#/automations',
    ready: '.automation-view',
  },
  {
    id: 'not-found',
    route: '/?visualCase=empty#/route-that-does-not-exist',
    ready: '.not-found-page',
  },
] as const

async function expectNewSessionComposerContract(page: Page): Promise<void> {
  const stack = page.locator(
    '.composer-stack[data-placement="new-session"]',
  ).first()
  await expect(stack).toBeVisible()

  const contract = await stack.evaluate(element => {
    const input = element.querySelector<HTMLElement>('.composer-input-surface')
    const utility = element.querySelector<HTMLElement>('.composer-utility-bar')
    if (!input || !utility) {
      throw new Error('Expected the new-session Composer surfaces to be present')
    }

    const stackStyle = getComputedStyle(element)
    const inputStyle = getComputedStyle(input)
    const utilityStyle = getComputedStyle(utility)
    return {
      stackBoxShadow: stackStyle.boxShadow,
      inputBackgroundColor: inputStyle.backgroundColor,
      inputBorderRadius: inputStyle.borderRadius,
      inputBorderWidth: inputStyle.borderWidth,
      utilityBackgroundColor: utilityStyle.backgroundColor,
      utilityBorderTopWidth: utilityStyle.borderTopWidth,
    }
  })

  expect(contract.stackBoxShadow).toBe('none')
  expect(contract.inputBorderWidth).not.toBe('0px')
  expect(contract.inputBorderRadius).toBe('20px')
  expect(contract.inputBackgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(contract.utilityBorderTopWidth).not.toBe('0px')
  expect(contract.utilityBackgroundColor).not.toBe('rgba(0, 0, 0, 0)')
}

for (const mode of VISUAL_MODES) {
  for (const scenario of FORMAL_ROUTES) {
    visualTest(`formal page ${scenario.id} ${mode}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(scenario.route)
      await waitForVisualPage(page, mode, page.locator(scenario.ready))
      if (scenario.id === 'new') {
        await expectNewSessionComposerContract(page)
      }
      await expect(page.locator('body')).toHaveScreenshot(
        `formal-${scenario.id}-${mode}-1440x920.png`,
        STABLE_SCREENSHOT_OPTIONS,
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

for (const mode of VISUAL_MODES) {
  for (const scenario of FORMAL_ROUTES.filter(
    route => route.id === 'new' || route.id === 'thread',
  )) {
    visualTest(`formal page ${scenario.id} ${mode} compact`, async ({ page }) => {
      await page.setViewportSize(COMPACT_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(scenario.route)
      await waitForVisualPage(page, mode, page.locator(scenario.ready))
      if (scenario.id === 'new') {
        await expectNewSessionComposerContract(page)
      }
      await expect(page.locator('body')).toHaveScreenshot(
        `formal-${scenario.id}-${mode}-960x640.png`,
        STABLE_SCREENSHOT_OPTIONS,
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}
