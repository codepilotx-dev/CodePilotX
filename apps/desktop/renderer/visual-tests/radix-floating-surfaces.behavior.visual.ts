import { expect, test, type Locator } from '@playwright/test'

import {
  COMPACT_VIEWPORT,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

test('Radix dropdown stays anchored and uses a solid surface', async ({
  page,
}) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=rich#/threads/visual-rich')

  const trigger = page.getByRole('button', {
    name: /切换工作模式，当前为/,
  })
  await waitForVisualPage(page, 'dark', trigger)
  const triggerBox = await trigger.boundingBox()
  expect(triggerBox).not.toBeNull()
  await trigger.click()

  const content = page.locator('.popover[data-side]').first()
  await expect(content).toBeVisible()
  await expect(content).toHaveAttribute('data-side', 'bottom')
  await expectSolidSurface(content)

  const contentBox = await content.boundingBox()
  expect(contentBox).not.toBeNull()
  expect(contentBox!.y).toBeGreaterThanOrEqual(
    triggerBox!.y + triggerBox!.height - 2,
  )
})

test('Radix popover stays in the viewport and respects reduced motion', async ({
  page,
}) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/settings/appearance')

  const colorTrigger = page.getByRole('button', {
    name: '深色强调色颜色选择器',
  })
  await waitForVisualPage(page, 'dark', colorTrigger)
  await colorTrigger.click()

  const colorPopover = page.locator('.appearance-color-popover[data-side]')
  await expect(colorPopover).toBeVisible()
  await expectSolidSurface(colorPopover)

  await page.keyboard.press('Escape')
  await page.locator('html').evaluate(root => {
    root.dataset.reduceMotion = 'on'
  })
  await colorTrigger.click()
  await expect(colorPopover).toBeVisible()
  await expect(colorPopover).toHaveCSS('animation-name', 'none')
})

test('Radix context menu follows the pointer and stays in the viewport', async ({
  page,
}) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=rich#/threads/visual-rich')

  const selectionTarget = page.getByText('已完成工作台结构梳理。', {
    exact: true,
  })
  await waitForVisualPage(page, 'dark', selectionTarget)
  await selectionTarget.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent?.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP
      },
    })
    const text = walker.nextNode()
    if (!text) {
      throw new Error('The visual conversation has no selectable text.')
    }
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })

  const targetBox = await selectionTarget.boundingBox()
  expect(targetBox).not.toBeNull()
  const pointer = {
    x: targetBox!.x + 10,
    y: targetBox!.y + targetBox!.height / 2,
  }
  await page.evaluate(() => {
    document.addEventListener(
      'mousedown',
      event => {
        if (event.button === 2) event.preventDefault()
      },
      { capture: true, once: true },
    )
  })
  await page.mouse.click(pointer.x, pointer.y, { button: 'right' })

  const content = page.locator('.sidebar-context-menu-content[data-side]')
  await expect(content).toBeVisible()
  await expectSolidSurface(content)

  const contentBox = await content.boundingBox()
  expect(contentBox).not.toBeNull()
  expect(Math.abs(contentBox!.x - pointer.x)).toBeLessThan(300)
  expect(Math.abs(contentBox!.y - pointer.y)).toBeLessThan(300)
})

async function expectSolidSurface(content: Locator): Promise<void> {
  const [contentBox, styles] = await Promise.all([
    content.boundingBox(),
    content.evaluate(element => {
      const computed = getComputedStyle(element)
      return {
        animationName: computed.animationName,
        backdropFilter: computed.backdropFilter,
        backgroundColor: computed.backgroundColor,
        position: computed.position,
      }
    }),
  ])

  expect(contentBox).not.toBeNull()
  expect(contentBox!.x).toBeGreaterThanOrEqual(0)
  expect(contentBox!.y).toBeGreaterThanOrEqual(0)
  expect(contentBox!.x + contentBox!.width).toBeLessThanOrEqual(
    COMPACT_VIEWPORT.width + 1,
  )
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(
    COMPACT_VIEWPORT.height + 1,
  )
  expect(styles.position).not.toBe('absolute')
  expect(styles.backdropFilter).toBe('none')
  expect(styles.backgroundColor).not.toMatch(/rgba\([^)]*,\s*0(?:\.0+)?\)$/)
  expect(styles.animationName).not.toBe('none')
}
