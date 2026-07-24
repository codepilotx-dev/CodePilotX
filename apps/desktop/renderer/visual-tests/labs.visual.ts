import { expect, test, type Page } from '@playwright/test'
import { LAB_DEMOS } from '../src/features/labs/labRegistry.js'
import {
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V6_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
  type VisualMode,
} from './visual-test-helpers.js'

const visualTest = V6_VISUAL_BASELINES_ENABLED ? test : test.skip

for (const mode of VISUAL_MODES) {
  for (const demo of LAB_DEMOS) {
    visualTest(`labs ${demo.id} ${mode}`, async ({ page }) => {
      await openLab(page, demo.title, mode, DESKTOP_VIEWPORT)
      await expect(page.locator('body')).toHaveScreenshot(
        `labs-${demo.id}-${mode}-1440x920.png`,
        STABLE_SCREENSHOT_OPTIONS,
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

const INTERACTIONS = [
  {
    id: 'avatar-overlay',
    title: 'Avatar Overlay',
    interact: async (page: Page) => {
      await page.getByRole('button', { name: '调整' }).click()
      await expect(page.locator('.lab-avatar')).toHaveAttribute(
        'data-resizing',
        'true',
      )
    },
  },
  {
    id: 'model-picker',
    title: 'Model Picker',
    interact: async (page: Page) => {
      await page.getByRole('slider', { name: '推理强度' }).fill('95')
      await page.getByRole('button', { name: /Fast Mode/ }).click()
      await expect(page.getByText('Ultra 会使用更多额度')).toBeVisible()
      await expect(page.getByRole('button', { name: /Fast Mode/ })).toHaveAttribute(
        'data-selected',
        'false',
      )
    },
  },
  {
    id: 'command-menu',
    title: 'Command & Process Menu',
    interact: async (page: Page) => {
      await page.getByPlaceholder('输入命令…').fill('模型')
      await expect(page.locator('[data-cmdk-item]')).toHaveCount(1)
      await expect(page.locator('[data-cmdk-item]')).toContainText('模型中心')
    },
  },
  {
    id: 'thread-rail',
    title: 'Thread Navigation Rail',
    interact: async (page: Page) => {
      await page.getByRole('slider', { name: '消息位置' }).fill('4')
      await expect(page.getByText('用户消息 5')).toBeVisible()
      await expect(page.locator('.lab-rail-markers [data-current="true"]')).toHaveCount(
        1,
      )
    },
  },
  {
    id: 'form-controls',
    title: 'Form Controls',
    interact: async (page: Page) => {
      await page.getByRole('spinbutton', { name: 'Contrast' }).fill('100')
      await expect(page.getByRole('slider', { name: 'Strength' })).toHaveValue(
        '100',
      )
      await page.getByRole('button', { name: 'Focus target' }).focus()
      await expect(page.locator('[data-side="top"]')).toBeVisible()
    },
  },
] as const

for (const scenario of INTERACTIONS) {
  visualTest(`labs ${scenario.id} interactive state`, async ({ page }) => {
    await openLab(page, scenario.title, 'dark', DESKTOP_VIEWPORT)
    await scenario.interact(page)
    await expect(page.locator('body')).toHaveScreenshot(
      `labs-${scenario.id}-dark-interactive.png`,
      STABLE_SCREENSHOT_OPTIONS,
    )
  })
}

for (const demo of [
  { id: 'presentation', title: 'Presentation' },
  { id: 'layout-surfaces', title: 'Layout Surfaces' },
  { id: 'form-controls', title: 'Form Controls' },
] as const) {
  for (const boundary of [
    { id: 'wide', viewport: { width: 1440, height: 920 } },
    { id: 'narrow', viewport: { width: 960, height: 640 } },
  ] as const) {
    visualTest(`labs ${demo.id} container ${boundary.id}`, async ({ page }) => {
      await openLab(page, demo.title, 'light', boundary.viewport)
      const containerWidth = await page
        .locator('.labs-demo-viewport')
        .evaluate(element => element.getBoundingClientRect().width)
      if (boundary.id === 'wide') {
        expect(containerWidth).toBeGreaterThan(672)
      } else {
        expect(containerWidth).toBeLessThanOrEqual(672)
      }
      await expect(page.locator('body')).toHaveScreenshot(
        `labs-${demo.id}-light-container-${boundary.id}.png`,
        STABLE_SCREENSHOT_OPTIONS,
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

async function openLab(
  page: Page,
  title: string,
  mode: VisualMode,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport)
  await prepareVisualTheme(page, mode)
  await page.goto('/?visualCase=empty#/labs')
  await waitForVisualPage(
    page,
    mode,
    page.getByRole('heading', { name: 'Codex Labs' }),
  )
  await page
    .getByRole('navigation', { name: '实验表面' })
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(title)}`) })
    .click()
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible()
  await expect(page.locator('.labs-demo-viewport .lab-surface')).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
