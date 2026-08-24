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
const COLUMN_NAMES = ['等待认领', '处理中', '等你确认', '待立项', '完成', '取消'] as const

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

test('task cards keep hover feedback on the outer flat surface', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  const firstCard = page.locator('.taskboard-card').first()
  const cardSurfaceBeforeHover = await firstCard.evaluate(card => {
    const open = card.querySelector<HTMLElement>('.taskboard-card__open')!
    const cardStyle = getComputedStyle(card)
    const openStyle = getComputedStyle(open)
    return {
      cardBackground: cardStyle.backgroundColor,
      cardBorder: cardStyle.borderColor,
      cardShadow: cardStyle.boxShadow,
      openBackground: openStyle.backgroundColor,
    }
  })

  await firstCard.hover()

  const cardSurfaceAfterHover = await firstCard.evaluate(card => {
    const open = card.querySelector<HTMLElement>('.taskboard-card__open')!
    const cardStyle = getComputedStyle(card)
    const openStyle = getComputedStyle(open)
    return {
      cardBackground: cardStyle.backgroundColor,
      cardBorder: cardStyle.borderColor,
      cardShadow: cardStyle.boxShadow,
      openBackground: openStyle.backgroundColor,
    }
  })

  expect(cardSurfaceBeforeHover.cardShadow).toBe('none')
  expect(cardSurfaceAfterHover.cardShadow).toBe('none')
  expect(cardSurfaceAfterHover.cardBackground).not.toBe(cardSurfaceBeforeHover.cardBackground)
  expect(cardSurfaceAfterHover.cardBorder).not.toBe(cardSurfaceBeforeHover.cardBorder)
  expect(cardSurfaceAfterHover.openBackground).toBe(cardSurfaceBeforeHover.openBackground)
})

test('1440×920 light board shows the fixed 2×3 workflow matrix', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(6)
  for (const name of COLUMN_NAMES) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.locator('.taskboard-card')).toHaveCount(9)
  await expect(page.getByRole('toolbar', { name: '工作区工具栏' }).getByRole('button', { name: '议题看板' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: '打开任务：重构看板五列布局与流程箭头' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /打开任务：为跨项目执行跑道补充一个特别长的任务标题/ }),
  ).toBeVisible()

  const longCardLayout = await page.locator('[data-taskboard-task-id="visual-task-2"]').evaluate((card) => {
    const open = card.querySelector<HTMLElement>('.taskboard-card__open')!
    const heading = card.querySelector<HTMLElement>('.taskboard-card__heading')!
    const title = card.querySelector<HTMLElement>('.taskboard-card__title')!
    const body = card.querySelector<HTMLElement>('.taskboard-card__body')!
    const titleStyle = getComputedStyle(title)
    return {
      openOverflow: open.scrollWidth - open.clientWidth,
      titleOverflow: title.scrollWidth - title.clientWidth,
      titleLines: title.getBoundingClientRect().height / Number.parseFloat(titleStyle.lineHeight),
      vertical: heading.getBoundingClientRect().bottom <= body.getBoundingClientRect().top,
    }
  })
  expect(longCardLayout.openOverflow).toBeLessThanOrEqual(1)
  expect(longCardLayout.titleOverflow).toBeLessThanOrEqual(1)
  expect(longCardLayout.titleLines).toBeLessThanOrEqual(2.1)
  expect(longCardLayout.vertical).toBe(true)

  const descriptionLayout = await page.locator('[data-taskboard-task-id="visual-task-1"] .taskboard-card__description').evaluate((description) => {
    const element = description as HTMLElement
    const style = getComputedStyle(element)
    return {
      overflow: element.scrollWidth - element.clientWidth,
      lines: element.getBoundingClientRect().height / Number.parseFloat(style.lineHeight),
    }
  })
  expect(descriptionLayout.overflow).toBeLessThanOrEqual(1)
  expect(descriptionLayout.lines).toBeLessThanOrEqual(2.1)

  const widths = await page.locator('.taskboard-column').evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect().width),
  )
  for (const width of widths) {
    expect(width).toBeGreaterThanOrEqual(280)
  }
  const columnTops = await page.locator('.taskboard-column').evaluateAll(nodes =>
    nodes.map(node => Math.round(node.getBoundingClientRect().top)),
  )
  expect(new Set(columnTops).size).toBe(2)
  await expect(page.getByText('遇到阻碍', { exact: true })).toBeVisible()

  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-1440-light-board.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('1440×920 dark board keeps the lane rhythm', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'dark', TASKS_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(6)
  await expect(page.locator('.taskboard-card')).toHaveCount(9)
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
  expect(columnWidth).toBeGreaterThanOrEqual(280)

  const scroll = await page.locator('.taskboard-board-scroll').evaluate(node => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }))
  expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)

  const toolbarLocator = page.locator('.taskboard-toolbar')
  await expect(toolbarLocator.getByLabel('任务层级')).toBeVisible()
  await expect(toolbarLocator.getByLabel('项目', { exact: true })).toBeVisible()
  await expect(toolbarLocator.getByRole('searchbox', { name: '搜索任务' })).toBeVisible()
  await expect(toolbarLocator.getByText('层级', { exact: true })).toHaveCount(0)
  await expect(toolbarLocator.getByText('项目', { exact: true })).toHaveCount(0)
  const header = page.getByRole('toolbar', { name: '工作区工具栏' })
  await expect(header.getByRole('button', { name: '议题看板' })).toBeVisible()
  await expect(header.getByRole('button', { name: '列表视图' })).toBeVisible()
  await expect(header.getByRole('button', { name: '甘特图' })).toBeVisible()
  await expect(header.getByRole('button', { name: '已归档' })).toBeVisible()
  await expect(toolbarLocator.getByRole('button', { name: /议题看板/ })).toHaveCount(0)
  await expect(toolbarLocator.getByRole('button', { name: '筛选' })).toBeVisible()
  await expect(toolbarLocator.getByRole('button', { name: '显示其他任务' })).toHaveCount(0)
  await expect(toolbarLocator.getByRole('button', { name: '打开归档区' })).toHaveCount(0)

  const toolbarBoxes = await page.locator('.taskboard-toolbar__tools > *, .taskboard-toolbar__actions > *').evaluateAll(nodes =>
    nodes
      .filter(node => getComputedStyle(node).display !== 'none')
      .map(node => {
        const box = node.getBoundingClientRect()
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      }),
  )
  for (const box of toolbarBoxes) {
    expect(box.right).toBeGreaterThan(box.left)
    expect(box.bottom).toBeGreaterThan(box.top)
  }
  const toolbar = await toolbarLocator.boundingBox()
  expect(toolbar).not.toBeNull()
  for (const box of toolbarBoxes) {
    expect(box.left).toBeGreaterThanOrEqual(toolbar!.x - 1)
    expect(box.right).toBeLessThanOrEqual(toolbar!.x + toolbar!.width + 1)
  }
  const orderedBoxes = [...toolbarBoxes].sort((left, right) => left.left - right.left)
  for (let index = 1; index < orderedBoxes.length; index += 1) {
    expect(orderedBoxes[index - 1]!.right).toBeLessThanOrEqual(orderedBoxes[index]!.left + 1)
  }

  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-960-columns.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('archive is a dedicated header surface with a compact history list', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', TASKS_ROUTE)

  await page.getByRole('toolbar', { name: '工作区工具栏' })
    .getByRole('button', { name: '已归档' })
    .click()
  await expect(page).toHaveURL(/view=archive/)
  const archive = page.getByRole('region', { name: '已归档任务' })
  await expect(archive).toBeVisible()
  await expect(archive.getByRole('button', { name: '打开已归档任务：归档旧版任务看板交互稿' })).toBeVisible()
  await expect(archive.getByText('完成', { exact: true })).toBeVisible()
  await expect(page.locator('.taskboard-column')).toHaveCount(0)
  await expect(page.locator('.taskboard-other, [data-other-open], [data-workbench-tab-kind="route-panel"]')).toHaveCount(0)
  await expect(page.locator('.taskboard-toolbar').getByLabel('任务层级')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建任务' })).toHaveCount(0)
  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-1440-light-archive.png',
    STABLE_SCREENSHOT_OPTIONS,
  )
})

test('empty data still renders the six status cells', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await openBoard(page, 'light', EMPTY_ROUTE)

  await expect(page.locator('.taskboard-column')).toHaveCount(6)
  for (const name of COLUMN_NAMES) {
    await expect(page.getByRole('heading', { name })).toBeVisible()
  }
  await expect(page.locator('.taskboard-column__empty')).toHaveCount(6)
  await expect(page.locator('.taskboard-card')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新建任务' })).toBeVisible()
  await expect(page.locator('body')).toHaveScreenshot(
    'taskboard-empty-six-cells.png',
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

  // 看板上下文保持可见：六格与任务卡仍在路由区域渲染
  await expect(page.locator('.taskboard-column')).toHaveCount(6)
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
