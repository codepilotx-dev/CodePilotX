import { expect, test, type Locator } from '@playwright/test'

import {
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

async function expectOnlySubmenuOpen(
  page: import('@playwright/test').Page,
  submenu: Locator,
): Promise<void> {
  await expect(submenu).toBeVisible()
  await expect(
    page.locator('.rm-intelligence-submenu[data-state="open"]'),
  ).toHaveCount(1)
}

async function hoverMenuItem(
  page: import('@playwright/test').Page,
  item: Locator,
): Promise<void> {
  const box = await item.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + 8
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y, { steps: 6 })
  await page.waitForTimeout(350)
  await page.mouse.move(x + 1, y)
}

async function expectCompactPickerGeometry(
  picker: Locator,
  view: 'simple' | 'advanced',
): Promise<void> {
  const menu = picker.locator('.rm-intelligence-menu')
  await expect(menu).toHaveAttribute('data-transitions-ready', 'true')
  await expect.poll(async () => {
    return menu.evaluate((element, activeView) => {
      const activePanel = element.querySelector<HTMLElement>(
        activeView === 'simple'
          ? '.rm-intelligence-simple-view'
          : '.rm-intelligence-advanced-view',
      )
      const controls = element.querySelector<HTMLElement>(
        '.rm-intelligence-view-controls',
      )
      const inlineHeight = Number.parseFloat(element.style.height)
      if (!activePanel || !controls || !Number.isFinite(inlineHeight)) {
        return Number.POSITIVE_INFINITY
      }
      return Math.abs(
        inlineHeight - (activePanel.offsetHeight + controls.offsetHeight),
      )
    }, view)
  }).toBeLessThanOrEqual(1)

  await expect.poll(async () => {
    return picker.evaluate(element => {
      const menuElement = element.querySelector<HTMLElement>(
        '.rm-intelligence-menu',
      )
      if (!menuElement) return Number.POSITIVE_INFINITY
      return element.getBoundingClientRect().height - menuElement.offsetHeight
    })
  }).toBeLessThanOrEqual(12)
}

test('model picker matches the Codex simple, advanced, and flyout behavior', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto(
    '/?visualCase=permission&visualModelPicker=1#/threads/visual-permission',
  )

  const trigger = page.locator('.composer-model-chip:visible')
  await waitForVisualPage(page, 'dark', trigger)
  const closedTriggerWidth = (await trigger.boundingBox())?.width ?? 0
  expect(closedTriggerWidth).toBeLessThan(224)
  await trigger.click()

  const picker = page.locator('.rm-intelligence-picker[data-state="open"]')
  const menu = picker.locator('.rm-intelligence-menu')
  const simplePanel = picker.locator('.rm-intelligence-simple-view')
  const advancedPanel = picker.locator('.rm-intelligence-advanced-view')
  const toggle = picker.getByRole('menuitem', {
    name: '显示高级模型选项',
  })
  await expect(picker).toHaveAttribute('data-side', 'top')
  await expect(menu).toHaveAttribute('data-view', 'simple')
  await expect(simplePanel).toHaveAttribute('data-active', 'true')
  await expect(advancedPanel).toHaveAttribute('data-active', 'false')
  await expect(advancedPanel).toHaveAttribute('inert', '')
  await expect(picker.locator('.rm-thinking-current-value')).toHaveCount(0)
  await expect.poll(async () => {
    const [triggerBox, pickerBox] = await Promise.all([
      trigger.boundingBox(),
      picker.boundingBox(),
    ])
    if (!triggerBox || !pickerBox) return Number.POSITIVE_INFINITY
    return Math.max(
      Math.abs(triggerBox.width - 224),
      Math.abs(pickerBox.width - 224),
      Math.abs(triggerBox.x - pickerBox.x),
      Math.abs(triggerBox.x + triggerBox.width - (pickerBox.x + pickerBox.width)),
    )
  }).toBeLessThanOrEqual(1)
  await expect.poll(() => trigger.evaluate(element =>
    getComputedStyle(element).justifyContent,
  )).toBe('center')
  await expectCompactPickerGeometry(picker, 'simple')

  const controls = picker.locator('.rm-intelligence-view-controls')
  const slider = picker.getByRole('slider', { name: '调节思考等级' })
  const efficientLabel = picker.getByText('更高效', { exact: true })
  const smartLabel = picker.getByText('更智能', { exact: true })
  const sliderTrack = picker.locator('.rm-thick-slider-track')
  const sliderThumb = picker.locator('.rm-thick-slider-thumb')
  const sliderBounds = await slider.boundingBox()
  expect(sliderBounds).not.toBeNull()
  expect((await sliderTrack.boundingBox())?.height).toBe(24)
  expect((await sliderThumb.boundingBox())?.height).toBe(28)
  expect((await picker.locator('.rm-thinking-level-control').boundingBox())?.height).toBe(32)
  const trackBackground = await sliderTrack.evaluate(element =>
    getComputedStyle(element).backgroundColor,
  )
  expect(trackBackground).not.toBe('rgba(0, 0, 0, 0)')

  await page.mouse.click(
    sliderBounds!.x + sliderBounds!.width * 0.25,
    sliderBounds!.y + sliderBounds!.height / 2,
  )
  await expect(controls).not.toHaveAttribute('data-endpoint-labels-visible', 'true')

  await page.mouse.move(
    sliderBounds!.x + sliderBounds!.width * 0.25,
    sliderBounds!.y + sliderBounds!.height / 2,
  )
  await page.mouse.down()
  await page.waitForTimeout(100)
  await expect(controls).not.toHaveAttribute('data-endpoint-labels-visible', 'true')
  await page.waitForTimeout(75)
  await expect(controls).toHaveAttribute('data-endpoint-labels-visible', 'true')
  await expect(efficientLabel).toBeVisible()
  await expect(smartLabel).toBeVisible()
  await page.mouse.up()
  await expect(controls).not.toHaveAttribute('data-endpoint-labels-visible', 'true')

  await page.mouse.move(
    sliderBounds!.x + sliderBounds!.width * 0.25,
    sliderBounds!.y + sliderBounds!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    sliderBounds!.x + sliderBounds!.width * 0.25 + 5,
    sliderBounds!.y + sliderBounds!.height / 2,
  )
  await expect(controls).toHaveAttribute('data-endpoint-labels-visible', 'true')
  await page.mouse.up()
  await expect(controls).not.toHaveAttribute('data-endpoint-labels-visible', 'true')

  const xForIndex = (index: number): number =>
    sliderBounds!.x + 14 + (sliderBounds!.width - 28) * (index / 3)
  const sliderCenterY = sliderBounds!.y + sliderBounds!.height / 2
  await page.mouse.move(xForIndex(1), sliderCenterY)
  await page.mouse.down()
  await page.mouse.move(xForIndex(2), sliderCenterY)
  await expect(slider).toHaveAttribute('aria-valuenow', '2')
  await expect(trigger.locator('.composer-model-chip-thinking')).toHaveText('高')
  await page.mouse.move(xForIndex(3), sliderCenterY)
  await expect(slider).toHaveAttribute('aria-valuenow', '3')
  await expect(trigger.locator('.composer-model-chip-thinking')).toHaveText('超高')
  await page.mouse.move(xForIndex(3) - 1, sliderCenterY)
  await expect(slider).toHaveAttribute('aria-valuenow', '3')
  await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuenow', '3')
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  await expect(slider).toHaveAttribute('aria-valuenow', '3')

  const [toggleBox, sliderBox] = await Promise.all([
    toggle.boundingBox(),
    picker.locator('.rm-thinking-level-control').boundingBox(),
  ])
  expect(toggleBox).not.toBeNull()
  expect(sliderBox).not.toBeNull()
  expect(toggleBox!.y).toBeLessThan(sliderBox!.y)
  const toggleContentBox = await toggle
    .locator('.rm-intelligence-view-toggle-content')
    .boundingBox()
  const controlsBox = await controls.boundingBox()
  expect(toggleContentBox).not.toBeNull()
  expect(controlsBox).not.toBeNull()
  expect(toggleContentBox!.width).toBeLessThan(controlsBox!.width / 2)
  const toggleBackgroundBeforeHover = await toggle.evaluate(element =>
    getComputedStyle(element).backgroundColor,
  )
  const toggleContentBackgroundBeforeHover = await toggle
    .locator('.rm-intelligence-view-toggle-content')
    .evaluate(element => getComputedStyle(element).backgroundColor)
  await toggle.hover()
  await expect.poll(() => toggle.evaluate(element =>
    getComputedStyle(element).backgroundColor,
  )).toBe(toggleBackgroundBeforeHover)
  await expect.poll(() => toggle
    .locator('.rm-intelligence-view-toggle-content')
    .evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(
    toggleContentBackgroundBeforeHover,
  )

  await toggle.click()
  await expect(menu).toHaveAttribute('data-view', 'advanced')
  await expect(picker).toBeVisible()
  await expect(simplePanel).toHaveAttribute('inert', '')
  await expect(advancedPanel).not.toHaveAttribute('inert', '')
  await expectCompactPickerGeometry(picker, 'advanced')

  const modelTrigger = picker.getByRole('menuitem', { name: /^模型：/u })
  const thinkingTrigger = picker.getByRole('menuitem', {
    name: /^推理强度：/u,
  })
  const providerTrigger = picker.getByRole('menuitem', {
    name: /^提供商：/u,
  })
  const advancedToggle = picker.getByRole('menuitem', {
    name: '显示简洁模型选项',
  })
  const [modelBox, advancedToggleBox] = await Promise.all([
    modelTrigger.boundingBox(),
    advancedToggle.boundingBox(),
  ])
  expect(modelBox).not.toBeNull()
  expect(advancedToggleBox).not.toBeNull()
  expect(modelBox!.y).toBeLessThan(advancedToggleBox!.y)

  await hoverMenuItem(page, modelTrigger)
  const modelSubmenu = page.locator('.rm-model-submenu[data-state="open"]')
  await expectOnlySubmenuOpen(page, modelSubmenu)
  await expect(
    modelSubmenu.getByRole('combobox', { name: '搜索当前提供商模型' }),
  ).toBeVisible()

  await hoverMenuItem(page, thinkingTrigger)
  const thinkingSubmenu = page.locator(
    '.rm-intelligence-submenu[aria-label="选择推理强度"][data-state="open"]',
  )
  await expectOnlySubmenuOpen(page, thinkingSubmenu)
  await expect(thinkingSubmenu.getByRole('combobox')).toHaveCount(0)

  await hoverMenuItem(page, providerTrigger)
  const providerSubmenu = page.locator(
    '.rm-intelligence-submenu[aria-label="选择提供商"][data-state="open"]',
  )
  await expectOnlySubmenuOpen(page, providerSubmenu)
  await expect(providerSubmenu.getByRole('combobox')).toHaveCount(0)

  await providerSubmenu.getByRole('menuitemradio').first().click()
  await expect(providerSubmenu).toHaveCount(0)
  await expect(picker).toBeVisible()

  await page.waitForTimeout(100)
  await modelTrigger.focus()
  await expect(modelTrigger).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expectOnlySubmenuOpen(page, modelSubmenu)
  await page.keyboard.press('Escape')
  await expect(modelSubmenu).toHaveCount(0)
  await expect(page.locator('.rm-model-submenu')).toHaveCount(0)
  await expect(picker).toBeVisible()
  await expect(modelTrigger).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect.poll(async () => (await trigger.boundingBox())?.width ?? 224)
    .toBeLessThan(224)

  await trigger.click()
  await expect(menu).toHaveAttribute('data-view', 'advanced')
  await hoverMenuItem(
    page,
    picker.getByRole('menuitem', { name: /^推理强度：/u }),
  )
  const currentThinkingOption = page
    .locator(
      '.rm-intelligence-submenu[aria-label="选择推理强度"][data-state="open"]',
    )
    .getByRole('menuitemradio', { checked: true })
  await currentThinkingOption.click()
  await expect(picker).toHaveCount(0)
})

test('model picker stays content-sized when collision handling places it below', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 520 })
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto(
    '/?visualCase=permission&visualModelPicker=1#/threads/visual-permission',
  )

  const trigger = page.locator('.composer-model-chip:visible')
  await waitForVisualPage(page, 'light', trigger)
  await trigger.evaluate(element => {
    const composer = element.closest<HTMLElement>('.composer')
    if (!composer) throw new Error('未找到 Composer 浮层定位容器')
    composer.style.setProperty('transform', 'translateY(-400px)', 'important')
  })
  await expect.poll(async () => (await trigger.boundingBox())?.y ?? 520)
    .toBeLessThan(80)
  await trigger.click()

  const picker = page.locator('.rm-intelligence-picker[data-state="open"]')
  await expect(picker).toHaveAttribute('data-side', 'bottom')
  await expectCompactPickerGeometry(picker, 'simple')

  await picker.getByRole('menuitem', { name: '显示高级模型选项' }).click()
  await expectCompactPickerGeometry(picker, 'advanced')
})
