import { expect, test } from '@playwright/test'
import {
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

test('command menu opens from the sidebar, filters tasks, and selects a numbered result', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto(
    '/?visualCase=rich&visualSwitchTargets=1#/new',
  )
  await waitForVisualPage(page, 'dark', page.locator('main'))

  const trigger = page.getByRole('button', { name: '搜索任务' })
  await trigger.click()

  const backdrop = page.locator('.command-menu-backdrop')
  const dialog = page.getByRole('dialog', { name: '任务命令菜单' })
  const input = page.getByRole('searchbox', { name: '搜索任务' })
  await expect(backdrop).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0.48)',
  )
  await expect(input).toBeFocused()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Codex 富消息工作台', { exact: true })).toBeVisible()
  await expect(
    dialog.getByRole('img', { name: '任务正在运行' }),
  ).toBeVisible()

  await page.keyboard.press('ArrowDown')
  await expect(
    dialog.locator('[cmdk-item][data-value="task:visual-switch-c"]'),
  ).toHaveAttribute('data-selected', 'true')

  await input.fill('B')
  await expect(input).toHaveValue('B')
  await expect(dialog.getByText('切换目标 B', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新建任务', { exact: true })).toHaveCount(0)

  await page.keyboard.press('Control+1')
  await expect(page).toHaveURL(/#\/threads\/visual-switch-b$/u)
  await expect(page.getByRole('dialog', { name: '任务命令菜单' })).toHaveCount(0)
})

test('command menu restores focus and disables file search without a workspace', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'light')
  await page.goto('/?visualCase=empty#/new')
  await waitForVisualPage(page, 'light', page.locator('main'))

  const trigger = page.getByRole('button', { name: '搜索任务' })
  await trigger.click()
  const backdrop = page.locator('.command-menu-backdrop')
  const dialog = page.getByRole('dialog', { name: '任务命令菜单' })
  await expect(backdrop).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0.48)',
  )
  await expect(dialog.getByText('暂无任务', { exact: true })).toBeVisible()
  const searchFiles = page.locator('[cmdk-item][data-value="recommendation:search-files"]')
  await expect(searchFiles).toHaveAttribute('data-disabled', 'true')
  await expect(searchFiles).toContainText('请先打开文件夹')

  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('searchbox', { name: '搜索任务' })).toBeFocused()

  await backdrop.click({
    position: { x: 4, y: 4 },
  })
  await expect(dialog).toHaveCount(0)
})

test('command menu supports hover, Enter, and the file-search shortcut', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=rich&visualSwitchTargets=1#/new')
  await waitForVisualPage(page, 'dark', page.locator('main'))

  await page.keyboard.press('Control+K')
  const target = page.locator(
    '[cmdk-item][data-value="task:visual-switch-b"]',
  )
  await target.hover()
  await expect(target).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/threads\/visual-switch-b$/u)

  await page.keyboard.press('Control+K')
  await expect(
    page.locator('[cmdk-item][data-value="recommendation:search-files"]'),
  ).not.toHaveAttribute('data-disabled', 'true')
  await page.keyboard.press('Control+P')
  await expect(
    page.getByRole('searchbox', { name: '筛选文件' }),
  ).toBeFocused()
})
