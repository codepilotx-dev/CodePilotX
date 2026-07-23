import { expect, test } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V5_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
  type VisualMode,
} from './visual-test-helpers.js'

const visualTest = V5_VISUAL_BASELINES_ENABLED ? test : test.skip

const SETTINGS_TABS = [
  { id: 'general', label: '常规' },
  { id: 'profile', label: '个人资料' },
  { id: 'appearance', label: '外观' },
  { id: 'config', label: '配置' },
  { id: 'personalization', label: '个性化' },
  { id: 'memory', label: '记忆' },
  { id: 'shortcuts', label: '键盘快捷键' },
  { id: 'billing', label: '使用情况和计费' },
  { id: 'mcp', label: 'MCP 服务器' },
  { id: 'browser', label: '浏览器' },
  { id: 'git', label: 'Git' },
  { id: 'archived', label: '已归档对话' },
] as const

for (const mode of VISUAL_MODES) {
  for (const tab of SETTINGS_TABS) {
    visualTest(`settings ${tab.id} ${mode}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(`/?visualCase=empty#/settings/${tab.id}`)
      const activeTab = page
        .locator('.settings-nav-item')
        .filter({ hasText: tab.label })
      await waitForVisualPage(page, mode, activeTab)
      await expect(activeTab).toHaveClass(/\bactive\b/)
      await expect(page.locator('.settings-content-scroll-area')).toBeVisible()
      await expect(page.locator('body')).toHaveScreenshot(
        `settings-${tab.id}-${mode}-1440x920.png`,
        {
          ...STABLE_SCREENSHOT_OPTIONS,
          fullPage: true,
        },
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

for (const mode of VISUAL_MODES) {
  visualTest(`settings appearance ${mode} compact`, async ({ page }) => {
    await page.setViewportSize(COMPACT_VIEWPORT)
    await prepareVisualTheme(page, mode)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      mode,
      page.getByRole('heading', { name: '外观' }),
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-${mode}-960x640.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
    await expectNoHorizontalOverflow(page)
  })
}

const CONTRAST_BOUNDARIES = [0, 45, 60, 100] as const

for (const contrast of CONTRAST_BOUNDARIES) {
  visualTest(`appearance contrast ${contrast}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { contrast })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'dark',
      page.getByRole('slider', { name: '深色对比度' }),
    )
    await expect(
      page.getByRole('slider', { name: '深色对比度' }),
    ).toHaveValue(String(contrast))
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-contrast-${contrast}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const preset of [
  { id: 'font-min', uiFontSize: 11, codeFontSize: 8 },
  { id: 'font-max', uiFontSize: 16, codeFontSize: 24 },
] as const) {
  visualTest(`appearance ${preset.id}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'light', preset)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'light',
      page.getByRole('spinbutton', { name: '界面字号' }),
    )
    await expect(page.getByRole('spinbutton', { name: '界面字号' })).toHaveValue(
      String(preset.uiFontSize),
    )
    await expect(page.getByRole('spinbutton', { name: '代码字号' })).toHaveValue(
      String(preset.codeFontSize),
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-light-${preset.id}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const reduceMotion of ['on', 'off'] as const) {
  visualTest(`appearance reduced motion ${reduceMotion}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { reduceMotion })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'dark',
      page.getByRole('group', { name: '减少动态效果选项' }),
    )
    await expect(page.locator('html')).toHaveAttribute(
      'data-reduce-motion',
      reduceMotion,
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-motion-${reduceMotion}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const opaqueWindows of [false, true]) {
  const material = opaqueWindows ? 'opaque' : 'transparent'
  visualTest(`appearance window material ${material}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { opaqueWindows })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(
      page,
      'dark',
      page.getByRole('heading', { name: '外观' }),
    )
    await page.locator('html').evaluate((root, isOpaque) => {
      root.classList.toggle('electron-opaque', isOpaque)
      root.dataset.glassSurfaces = isOpaque ? 'off' : 'on'
    }, opaqueWindows)
    await expect(page.locator('html')).toHaveAttribute(
      'data-glass-surfaces',
      opaqueWindows ? 'off' : 'on',
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-${material}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}
