import { expect, test, type Locator } from '@playwright/test'
import { expectNoHorizontalOverflow } from './visual-test-helpers.js'

// 当前 visual fixture 在 reduce 模式下初始化超时；此用例验证普通动效下的宽度与保存。
test.use({ reducedMotion: 'no-preference' })

async function iconGeometry(button: Locator) {
  return button.evaluate(element => {
    const buttonBox = element.getBoundingClientRect()
    const icon = element.querySelector('svg')!
    const iconBox = icon.getBoundingClientRect()
    return {
      width: buttonBox.width,
      height: buttonBox.height,
      iconHeight: iconBox.height,
      center: iconBox.x + iconBox.width / 2 - (buttonBox.x + buttonBox.width / 2),
      lines: Array.from(icon.querySelectorAll('line'), line => {
        const box = line.getBoundingClientRect()
        return {
          width: box.width,
          y: box.y - iconBox.y,
          center: box.x + box.width / 2 - (iconBox.x + iconBox.width / 2),
          stroke: getComputedStyle(line).strokeWidth,
        }
      }),
    }
  })
}

for (const mode of ['light', 'dark'] as const) {
  test(`聊天宽度自动保存与布局 ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'no-preference' })
    await page.goto('/?visualCase=rich#/settings/appearance', { waitUntil: 'commit' })
    const group = page.locator('.segmented-control[aria-label="聊天宽度"]')
    const option = (label: string) => group.getByRole('radio', { name: label, exact: true })
    await group.waitFor({ state: 'visible', timeout: 15_000 })
    await expect(option('默认')).toHaveAttribute('data-state', 'on')

    for (const [value, label, max] of [
      ['wide', '宽', 1250],
      ['narrow', '窄', 672],
      ['default', '默认', 768],
    ] as const) {
      await option(label).focus()
      await page.keyboard.press('Space')
      await expect(option(label)).toHaveAttribute('data-state', 'on')
      await page.evaluate(() => { window.location.hash = '#/threads/visual-rich' })
      const conversation = page.locator('.conversation-page')
      await expect(conversation).toHaveAttribute('data-conversation-width', value)
      const widthButton = page.getByRole('button', { name: /^聊天宽度：/ })
      const states = {
        default: { next: 'narrow', label: '默认', scale: 1 },
        narrow: { next: 'wide', label: '窄', scale: 0.75 },
        wide: { next: 'default', label: '宽', scale: 1.25 },
      } as const
      let current: keyof typeof states = value
      const initial = await iconGeometry(widthButton)
      expect(initial.lines).toHaveLength(3)
      for (const action of ['click', 'Enter', 'Space'] as const) {
        if (action === 'click') await widthButton.click()
        else await page.keyboard.press(action)
        current = states[current].next
        const state = states[current]
        await expect(conversation).toHaveAttribute('data-conversation-width', current)
        await expect(widthButton).toHaveAccessibleName(`聊天宽度：${state.label}，点击切换为${states[state.next].label}`)
        await expect(widthButton).toBeFocused()
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(widthButton.locator('svg')).toHaveAttribute('data-width', current)
        const geometry = await iconGeometry(widthButton)
        expect(geometry.width).toBe(initial.width)
        expect(geometry.height).toBe(initial.height)
        expect(geometry.iconHeight).toBe(initial.iconHeight)
        expect(geometry.center).toBeCloseTo(0, 1)
        expect(geometry.lines).toHaveLength(3)
        for (const [index, line] of geometry.lines.entries()) {
          expect(line.width / initial.lines[index].width).toBeCloseTo(state.scale / states[value].scale, 2)
          expect(line.width).toBeCloseTo(geometry.lines[0].width, 2)
          expect(line.center).toBeCloseTo(0, 1)
          expect(line.y).toBeCloseTo(initial.lines[index].y, 2)
          expect(line.stroke).toBe(initial.lines[index].stroke)
        }
      }
      await expect(conversation).toHaveAttribute('data-conversation-width', value)
      const turn = page.locator('.canonical-turn').first()
      await expect(turn).toHaveCSS('max-width', `${max}px`)
      await expect(page.locator('.workflow-page__composer-inner')).toHaveCSS('max-width', `${max}px`)
      const body = turn.locator('.canonical-text-item--result > .md-body').first()
      await expect(body).toHaveCSS('max-width', 'none')
      await expect.poll(async () => {
        const bodyBox = await body.boundingBox()
        const outerBox = await turn.boundingBox()
        return Math.abs(bodyBox!.width - outerBox!.width)
      }).toBeLessThan(1)
      const turnBox = await turn.boundingBox()
      const composerBox = await page.locator('.workflow-page__composer-inner').boundingBox()
      expect(turnBox).not.toBeNull()
      expect(composerBox).not.toBeNull()
      expect(Math.abs(turnBox!.width - composerBox!.width)).toBeLessThan(1)
      await expectNoHorizontalOverflow(page)

      if (value === 'wide') {
        await page.getByRole('button', { name: '显示右侧面板', exact: true }).click()
        await page.setViewportSize({ width: 1100, height: 800 })
        await expectNoHorizontalOverflow(page)
        await expect(widthButton).toBeInViewport()
        const available = await conversation.boundingBox()
        const compact = await turn.boundingBox()
        expect(compact!.width).toBeLessThanOrEqual(available!.width)
        await expect.poll(async () => {
          const bodyBox = await body.boundingBox()
          const outerBox = await turn.boundingBox()
          return Math.abs(bodyBox!.width - outerBox!.width)
        }).toBeLessThan(1)
        await page.getByRole('button', { name: '关闭右侧面板', exact: true }).click()
        await page.setViewportSize({ width: 1920, height: 1080 })
      }
      await page.evaluate(() => { window.location.hash = '#/new' })
      await expect(conversation).toHaveCount(0)
      await expect(page.locator('[data-conversation-width]')).toHaveCount(0)
      await expect(widthButton).toHaveCount(0)
      await page.evaluate(() => { window.location.hash = '#/settings/appearance' })
      await expect(option(label)).toHaveAttribute('data-state', 'on')
    }
  })
}
