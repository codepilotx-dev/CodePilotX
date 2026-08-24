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

  expect(contract.stackWidth).toBeLessThanOrEqual(640)
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

async function expectWorkingHomeContract(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: '我们该处理什么工作？' }),
  ).toBeVisible()
  await expect(
    page.locator('.working-chat-view .working-suggestions'),
  ).toHaveCount(0)
}

async function expectCodingHomeContract(
  page: Page,
  requireFourVisibleCards: boolean,
): Promise<void> {
  const mark = page.locator('.coding-chat-view .quick-chat-mark')
  await expect(mark).toBeVisible()
  await expect(mark).toHaveCSS('width', '56px')
  await expect(mark).toHaveCSS('height', '56px')

  const maskImage = await mark.evaluate(element => {
    const style = getComputedStyle(element)
    return style.maskImage || style.webkitMaskImage
  })
  expect(maskImage).toMatch(/\/whale-icon\.svg/)

  const cards = page.locator('.coding-chat-view .new-session-suggestion-card')
  await expect(cards).toHaveCount(4)
  const visibleCards = await cards.evaluateAll(elements =>
    elements
      .filter(element => {
        const rect = element.getBoundingClientRect()
        return (
          getComputedStyle(element).display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .map(element => getComputedStyle(element).borderTopWidth),
  )
  expect(visibleCards.length).toBeGreaterThanOrEqual(1)
  expect(visibleCards.length).toBeLessThanOrEqual(4)
  if (requireFourVisibleCards) {
    expect(visibleCards).toHaveLength(4)
  }
  expect(visibleCards.every(width => width === '1px')).toBe(true)
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
        await expectWorkingHomeContract(page)
      }
      if (scenario.id === 'new') {
        await expectCodingHomeContract(page, true)
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

visualTest('provider catalog preserves logo slot and three-column spacing', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=rich&visualProviderCatalog=logos#/models')
  await waitForVisualPage(page, 'dark', page.locator('.model-center-shell'))

  const cards = page.locator('.provider-card')
  await expect(cards).toHaveCount(6)
  await expect(page.locator('.model-center-catalog-source')).toHaveCount(0)
  await expect(cards.nth(0).locator('.ui-remote-image')).toHaveAttribute('data-state', 'ready')
  await expect(cards.nth(1).locator('.ui-remote-image')).toHaveAttribute('data-state', 'error')
  await expect(cards.nth(1).locator('.ui-remote-image-fallback')).toBeVisible()

  const contract = await page.locator('.model-center-catalog-list').evaluate(element => {
    const gridStyle = getComputedStyle(element)
    const cardElements = Array.from(element.querySelectorAll<HTMLElement>('.provider-card'))
    return {
      columnCount: gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length,
      cards: cardElements.map(card => {
        const main = card.querySelector<HTMLElement>('.provider-card-main')!
        const logo = card.querySelector<HTMLElement>('.provider-card-logo')!
        const copy = card.querySelector<HTMLElement>('.provider-card-copy')!
        const action = card.querySelector<HTMLElement>('.provider-card-connection-action')!
        const cardStyle = getComputedStyle(card)
        const mainStyle = getComputedStyle(main)
        const cardRect = card.getBoundingClientRect()
        const logoRect = logo.getBoundingClientRect()
        const copyRect = copy.getBoundingClientRect()
        const actionRect = action.getBoundingClientRect()
        return {
          gap: mainStyle.columnGap,
          logoHeight: logoRect.height,
          logoWidth: logoRect.width,
          cardPadding: [
            cardStyle.paddingTop,
            cardStyle.paddingRight,
            cardStyle.paddingBottom,
            cardStyle.paddingLeft,
          ],
          mainPadding: [
            mainStyle.paddingTop,
            mainStyle.paddingRight,
            mainStyle.paddingBottom,
            mainStyle.paddingLeft,
          ],
          copyOffset: copyRect.left - cardRect.left,
          actionRightOffset: cardRect.right - actionRect.right,
        }
      }),
    }
  })

  expect(contract.columnCount).toBe(3)
  for (const card of contract.cards) {
    expect(card.logoWidth).toBe(36)
    expect(card.logoHeight).toBe(36)
    expect(card.gap).toBe('16px')
    expect(card.cardPadding).toEqual(['20px', '20px', '20px', '20px'])
    expect(card.mainPadding).toEqual(['0px', '0px', '0px', '0px'])
    expect(card.copyOffset).toBe(72)
    expect(card.actionRightOffset).toBe(20)
  }
})

for (const mode of VISUAL_MODES) {
  for (const scenario of FORMAL_ROUTES.filter(
    route =>
      route.id === 'new' ||
      route.id === 'chat' ||
      route.id === 'working' ||
      route.id === 'thread',
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
        await expectWorkingHomeContract(page)
      }
      if (scenario.id === 'new') {
        await expectCodingHomeContract(page, false)
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
