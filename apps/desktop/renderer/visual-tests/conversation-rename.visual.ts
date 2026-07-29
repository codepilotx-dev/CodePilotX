import { expect, test } from '@playwright/test'

test('rename dialog accepts typed text', async ({ page }) => {
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '更多会话操作' }).click()
  await page.getByRole('menuitem', { name: /重命名对话/ }).click()

  const input = page.getByRole('textbox', { name: '重命名对话' })
  await expect(input).toBeFocused()
  await input.fill('重命名输入回归')
  await expect(input).toHaveValue('重命名输入回归')
  await page.getByRole('button', { name: '重命名', exact: true }).click()
  await expect(page.getByText('重命名输入回归', { exact: true })).toBeVisible()
})
