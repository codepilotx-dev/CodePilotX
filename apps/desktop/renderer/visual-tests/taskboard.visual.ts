import { expect, test } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  closeTransientErrorToast,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

const TASKS_ROUTE = '/?visualCase=taskboard#/taskboard'
const EMPTY_ROUTE = '/?visualCase=taskboard&taskboardEmpty=1#/taskboard'
const COLUMN_NAMES = ['待整理', '待办', '进行中', '待审核', '已完成'] as const

async function openBoard(
  page: import('@playwright/test').Page,
  mode: 'light' | 'dark',
  route: string,
): Promise<void> {
  await prepareVisualTheme(page, mode)
  await page.goto(route)
  await waitForVisualPage(
    page,
    mode,
    page.locator('.taskboard-column').first(),
  )
  await closeTransientErrorToast(page)
}

test('1440×920 light board shows five lanes with readable cards', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(5)
  for (const name of COLUMN_NAMES) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.locator('.taskboard-card')).toHaveCount(7)
  await expect(
    page.getByRole('button', { name: '打开任务：重构看板五列布局与流程箭头' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /打开任务：为跨项目执行跑道补充一个特别长的任务标题/ }),
  ).toBeVisible()

  const widths = await page.locator('.taskboard-column').evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect().width),
  )
  for (const width of widths) {
    expect(width).toBeGreaterThanOrEqual(296)
    expect(width).toBeLessThanOrEqual(336)
  }

  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-1440-light-board.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('1440×920 dark board keeps the lane rhythm', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'dark', TASKS_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(5)
  await expect(page.locator('.taskboard-card')).toHaveCount(7)
  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-1440-dark-board.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('960×640 keeps fixed column width and scrolls horizontally', async ({
  page,
}) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  const columnWidth = await page
    .locator('.taskboard-column')
    .first()
    .evaluate(node => node.getBoundingClientRect().width)
  expect(columnWidth).toBeGreaterThanOrEqual(296)
  expect(columnWidth).toBeLessThanOrEqual(336)

  const scroll = await page.locator('.taskboard-board').evaluate(node => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)

  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-960-columns.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('empty data still renders the five status columns', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', EMPTY_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(5)
  for (const name of COLUMN_NAMES) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.locator('.taskboard-column__empty')).toHaveCount(5)
  await expect(page.locator('.taskboard-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建任务' })).toBeVisible()
  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-empty-five-columns.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('new task dialog renders as a floating surface with field layout', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  await page.getByRole('button', { name: '新建任务' }).click()
  const dialog = page.getByRole('dialog', { name: '新建任务' })
  await expect(dialog).toBeVisible()

  const surface = await dialog.evaluate(node => {
    const style = getComputedStyle(node)
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: Number.parseFloat(style.borderTopWidth),
      borderRadius: Number.parseFloat(style.borderTopLeftRadius),
      boxShadow: style.boxShadow,
    }
  })
  expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(surface.borderTopWidth).toBeGreaterThan(0)
  expect(surface.borderRadius).toBeGreaterThan(0)
  expect(surface.boxShadow).not.toBe('none')

  await expect(dialog.getByLabel('项目')).toBeVisible()
  await expect(dialog.getByLabel('状态')).toBeVisible()
  await expect(dialog.getByLabel('标题')).toBeFocused()
  await expect(dialog.getByLabel('描述')).toBeVisible()
  await expect(dialog.getByLabel('优先级')).toBeVisible()
  await expect(dialog.locator('select, input[type="date"], input[type="radio"], input[type="checkbox"]')).toHaveCount(0)
  await dialog.getByLabel('开始日期').click()
  await expect(page.getByRole('grid', { name: /开始日期/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('button', { name: '创建任务' })).toBeVisible()
  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-create-dialog.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('details drawer stays inside the route with board context and Escape focus restore', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  const card = page.getByRole('button', {
    name: '打开任务：整理任务看板视觉重构的验收清单',
  })
  await card.click()

  const drawer = page.locator('.taskboard-drawer')
  await expect(drawer).toBeVisible()
  await expect(
    drawer.getByRole('heading', { name: '整理任务看板视觉重构的验收清单' }),
  ).toBeVisible()
  await expect(drawer.getByRole('button', { name: '开始执行' })).toBeVisible()

  // 看板上下文保持可见：五列与任务卡仍在路由区域渲染
  await expect(page.locator('.taskboard-column')).toHaveCount(5)
  await expect(page.locator('.taskboard-card').first()).toBeVisible()
  const drawerWidth = (await drawer.boundingBox())?.width
  expect(drawerWidth).toBeCloseTo(480, 0)

  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-details-drawer.png',
    STABLE_SCREENSHOT_OPTIONS,
  )

  await drawer.getByRole('button', { name: '关闭任务详情' }).focus()
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(card).toBeFocused()
})
