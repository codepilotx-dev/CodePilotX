import { expect, test, type Page } from '@playwright/test'

type VisualScenario = {
  id: 'empty' | 'rich' | 'permission' | 'review'
  route: string
  readyText: string
  prepare?: (page: Page) => Promise<void>
}

const SCENARIOS: readonly VisualScenario[] = [
  {
    id: 'empty',
    route: '/?visualCase=empty#/quick-chat',
    readyText: '我们该做什么？',
  },
  {
    id: 'rich',
    route: '/?visualCase=rich#/sessions/visual-rich',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'permission',
    route: '/?visualCase=permission#/sessions/visual-permission',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'review',
    route: '/?visualCase=review#/sessions/visual-review',
    readyText: '已完成工作台结构梳理。',
    prepare: async page => {
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      await expect(page.getByLabel('右侧工具栏')).toBeVisible()
    },
  },
] as const

const MODES = ['light', 'dark'] as const
const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 920 },
  { id: 'compact', width: 960, height: 640 },
] as const

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    for (const scenario of SCENARIOS) {
      test(`${viewport.id} ${mode} ${scenario.id}`, async ({ page }) => {
        await page.setViewportSize(viewport)
        await page.emulateMedia({
          colorScheme: mode,
          forcedColors: 'none',
          reducedMotion: 'reduce',
        })
        await page.goto(scenario.route)
        await closeTransientErrorToast(page)
        await expect(page.getByText(scenario.readyText, { exact: true })).toBeVisible()
        await scenario.prepare?.(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
        await expect(page.locator('html')).toHaveAttribute(
          'data-code-theme-id',
          mode === 'light' ? 'codex-light' : 'codex-dark',
        )
        await expect(page.locator('body')).toHaveScreenshot(
          `${viewport.id}-${mode}-${scenario.id}.png`,
          {
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
          },
        )
        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
      })
    }
  }
}

for (const mode of MODES) {
  test(`accessibility ${mode}`, async ({ page }) => {
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/quick-chat')
    await closeTransientErrorToast(page)
    await expect(page.getByText('我们该做什么？', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', 'on')

    const contrastRatio = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      return ratio(
        styles.getPropertyValue('--color-text').trim(),
        styles.getPropertyValue('--surface-canvas').trim(),
      )

      function ratio(foreground: string, background: string): number {
        const [lighter, darker] = [
          luminance(foreground),
          luminance(background),
        ].sort((left, right) => right - left)
        return (lighter! + 0.05) / (darker! + 0.05)
      }

      function luminance(hex: string): number {
        const normalized = hex.replace('#', '')
        const channels = [0, 2, 4].map(offset =>
          Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
        )
        const linear = channels.map(channel =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
      }
    })
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5)

    const sidebarSeparator = page.getByRole('separator', {
      name: '调整侧边栏宽度',
    })
    await sidebarSeparator.focus()
    const before = Number(await sidebarSeparator.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowRight')
    const after = Number(await sidebarSeparator.getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThan(before)

    await page.emulateMedia({ forcedColors: 'active' })
    expect(
      await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
    ).toBe(true)
  })
}

test('Escape closes the theme picker and restores focus', async ({ page }) => {
  await page.goto('/#/settings?tab=appearance')
  await closeTransientErrorToast(page)
  const picker = page.getByRole('combobox', { name: '代码高亮主题' })
  await picker.click()
  await expect(
    page.getByRole('textbox', { name: '搜索 Codex 高亮主题...' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toBeFocused()
})

async function closeTransientErrorToast(page: Page): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭错误提示' })
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click()
  }
}
