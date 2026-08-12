import { expect, test, type Page } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V6_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  closeTransientErrorToast,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

const visualTest = V6_VISUAL_BASELINES_ENABLED ? test : test.skip

const FORMAL_ROUTES = [
  {
    id: 'new',
    route: '/?visualCase=empty#/new?surface=coding',
    ready: '.coding-chat-view',
    surface: 'coding',
  },
  {
    id: 'chat',
    route: '/?visualCase=empty#/new?surface=chat',
    ready: '.chat-home-view',
    surface: 'chat',
  },
  {
    id: 'working',
    route: '/?visualCase=empty#/new?surface=working',
    ready: '.working-chat-view',
    surface: 'working',
  },
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

type NewSessionSurface = 'coding' | 'working' | 'chat'

async function expectNewSessionComposerContract(
  page: Page,
  surface: NewSessionSurface,
): Promise<void> {
  const stack = page.locator(
    `.composer-stack[data-placement="new-session"][data-surface="${surface}"]`,
  ).first()
  await expect(stack).toBeVisible()

  const contract = await stack.evaluate(element => {
    const input = element.querySelector<HTMLElement>('.composer-input-surface')
    const utility = element.querySelector<HTMLElement>('.composer-utility-bar')
    if (!input) {
      throw new Error('Expected the new-session input surface to be present')
    }

    const inputStyle = getComputedStyle(input)
    const stackRect = element.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    const utilityRect = utility?.getBoundingClientRect() ?? null
    return {
      stackWidth: stackRect.width,
      inputBackgroundColor: inputStyle.backgroundColor,
      inputBorderRadius: inputStyle.borderRadius,
      inputBorderWidth: inputStyle.borderWidth,
      inputBoxShadow: inputStyle.boxShadow,
      inputTop: inputRect.top,
      inputBottom: inputRect.bottom,
      utilityTop: utilityRect?.top ?? null,
      utilityBottom: utilityRect?.bottom ?? null,
    }
  })

  expect(contract.stackWidth).toBeLessThanOrEqual(768)
  expect(contract.inputBorderWidth).toBe('0px')
  expect(contract.inputBorderRadius).toBe('20px')
  expect(contract.inputBoxShadow).not.toBe('none')
  expect(contract.inputBackgroundColor).not.toBe('rgba(0, 0, 0, 0)')

  if (surface === 'chat') {
    expect(contract.utilityTop).toBeNull()
  } else if (surface === 'coding') {
    expect(contract.utilityTop).not.toBeNull()
    expect(contract.utilityTop!).toBeLessThan(contract.inputTop)
    expect(contract.utilityBottom!).toBeGreaterThan(contract.inputTop)
  } else {
    expect(contract.utilityTop).not.toBeNull()
    expect(contract.utilityTop!).toBeGreaterThanOrEqual(
      contract.inputBottom - 2,
    )
  }
}

async function expectWorkingContextualSuggestions(page: Page): Promise<void> {
  const suggestions = page.getByRole('region', { name: '工作建议' })
  await expect(suggestions).toBeVisible()
  await expect(suggestions.locator('.working-suggestion-row')).toHaveCount(4)
  await expect(
    suggestions.getByRole('button', { name: '查看工作模板' }),
  ).toBeVisible()
}

for (const mode of VISUAL_MODES) {
  for (const scenario of FORMAL_ROUTES) {
    visualTest(`formal page ${scenario.id} ${mode}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(scenario.route)
      await waitForVisualPage(page, mode, page.locator(scenario.ready))
      if ('surface' in scenario) {
        await expectNewSessionComposerContract(page, scenario.surface)
      }
      if (scenario.id === 'working') {
        await expectWorkingContextualSuggestions(page)
      }
      await closeTransientErrorToast(page, 3_000)
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
    route =>
      route.id === 'new' || route.id === 'working' || route.id === 'thread',
  )) {
    visualTest(`formal page ${scenario.id} ${mode} compact`, async ({ page }) => {
      await page.setViewportSize(COMPACT_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(scenario.route)
      await waitForVisualPage(page, mode, page.locator(scenario.ready))
      if ('surface' in scenario) {
        await expectNewSessionComposerContract(page, scenario.surface)
      }
      if (scenario.id === 'working') {
        await expectWorkingContextualSuggestions(page)
      }
      await closeTransientErrorToast(page, 3_000)
      await expect(page.locator('body')).toHaveScreenshot(
        `formal-${scenario.id}-${mode}-960x640.png`,
        STABLE_SCREENSHOT_OPTIONS,
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}
