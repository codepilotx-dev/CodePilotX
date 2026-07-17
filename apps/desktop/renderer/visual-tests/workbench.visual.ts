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

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    test(`${viewport.id} ${mode} appearance page`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/?visualCase=empty#/settings?tab=appearance')
      await closeTransientErrorToast(page)
      await page
        .getByRole('radiogroup', { name: '外观模式' })
        .getByRole('radio', { name: mode === 'light' ? '浅色' : '深色' })
        .click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
      await expect(page.getByRole('heading', { name: '外观' })).toBeVisible()
      await closeTransientErrorToast(page, 1_500)
      await expect(page.locator('body')).toHaveScreenshot(
        `${viewport.id}-${mode}-appearance.png`,
        {
          animations: 'disabled',
          caret: 'hide',
          fullPage: true,
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
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
  await closeTransientErrorToast(page)
  const picker = page.getByRole('combobox', { name: '浅色代码主题' })
  await picker.click()
  await expect(
    page.getByRole('textbox', { name: '搜索代码主题…' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toBeFocused()
})

test('appearance modes support radio keys, variant editors, and reload persistence', async ({
  page,
}) => {
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
  await closeTransientErrorToast(page)

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  const lightMode = modeGroup.getByRole('radio', { name: '浅色' })
  const darkMode = modeGroup.getByRole('radio', { name: '深色' })
  const systemMode = modeGroup.getByRole('radio', { name: '系统' })

  await expect(systemMode).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeVisible()

  await lightMode.click()
  await expect(lightMode).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeHidden()

  await lightMode.press('ArrowRight')
  await expect(darkMode).toBeFocused()
  await expect(darkMode).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(
    page.getByRole('radiogroup', { name: '外观模式' }).getByRole('radio', {
      name: '深色',
    }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('Dracula code theme applies the recovered Codex runtime hierarchy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
  await closeTransientErrorToast(page)
  await page
    .getByRole('radiogroup', { name: '外观模式' })
    .getByRole('radio', { name: '深色' })
    .click()

  await page.getByRole('combobox', { name: '深色代码主题' }).click()
  await page.getByRole('textbox', { name: '搜索代码主题…' }).fill('dracula')
  await page.getByRole('option', { name: /^Dracula/ }).click()

  await expect(page.locator('html')).toHaveAttribute(
    'data-code-theme-id',
    'dracula',
  )
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return {
          canvas: root.getPropertyValue('--surface-canvas').trim(),
          chrome: root.getPropertyValue('--surface-chrome').trim(),
          panel: root.getPropertyValue('--surface-panel').trim(),
          composer: root.getPropertyValue('--surface-composer').trim(),
        }
      }),
    )
    .toEqual({
      canvas: '#282a36',
      chrome: '#22232d',
      panel: '#32343f',
      composer: '#373843',
    })

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute(
    'data-code-theme-id',
    'dracula',
  )
  await page.goto('/?visualCase=rich#/sessions/visual-rich')
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()
  await closeTransientErrorToast(page, 1_500)
  await expect(page.locator('body')).toHaveScreenshot(
    'desktop-dark-dracula-runtime.png',
    {
      animations: 'disabled',
      caret: 'hide',
      mask: [page.locator('.thread-summary-panel')],
      scale: 'css',
    },
  )
})

async function closeTransientErrorToast(
  page: Page,
  waitForMilliseconds = 0,
): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭错误提示' })
  const deadline = Date.now() + waitForMilliseconds
  do {
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click()
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(100)
  } while (true)
}
