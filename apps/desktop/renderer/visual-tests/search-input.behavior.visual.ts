import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  prepareVisualTheme,
  waitForVisualPage,
} from './visual-test-helpers.js'

test('SearchInput — clear button and Escape behavior', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/settings/appearance')

  // Navigate to general settings
  await page.getByRole('button', { name: '搜索设置' }).first().click()
  await page.getByRole('button', { name: '搜索设置' }).fill('语言')
  const searchInput = page.getByRole('combobox', { name: '搜索设置' })

  // Wait for search results to appear
  const results = page.locator('#settings-search-results')
  await expect(results).toBeVisible()

  // Clear button appears
  const clearButton = page.getByRole('button', { name: '清除搜索' })
  await expect(clearButton).toBeVisible()

  // Click clear → value is empty, input still focused
  await clearButton.click()
  await expect(searchInput).toHaveValue('')
  await expect(searchInput).toBeFocused()

  // Escape clears non-empty query
  await searchInput.fill('general')
  await page.keyboard.press('Escape')
  await expect(searchInput).toHaveValue('')

  // Escape on empty → input still focused (no crash)
  await page.keyboard.press('Escape')
  await expect(searchInput).toBeFocused()
})

test('SettingsDropdown searchable — combobox keyboard and clear behavior', async ({
  page,
}) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/settings/appearance')

  // Wait for general settings page
  const languageTrigger = page.getByRole('button', { name: '语言' })
  await waitForVisualPage(page, 'light', languageTrigger)

  // Open the language dropdown
  await languageTrigger.click()

  // The search input should be focused
  const searchField = page.getByRole('combobox', { name: /搜索/ })
  await expect(searchField).toBeVisible()
  await expect(searchField).toBeFocused()

  // aria-controls should point to an existing listbox
  const controlsId = await searchField.getAttribute('aria-controls')
  expect(controlsId).not.toBeNull()
  const listbox = page.locator(`#${controlsId}`)
  await expect(listbox).toBeVisible()
  await expect(listbox).toHaveAttribute('role', 'listbox')

  // aria-expanded should be true when opened
  await expect(searchField).toHaveAttribute('aria-expanded', 'true')

  // Filter items
  await searchField.fill('English')
  await expect(page.getByRole('option', { name: /English/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Chinese/ })).not.toBeVisible()

  // ArrowDown + Enter selects first option
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /English/ })).toBeVisible()

  // Open again and test empty state
  await languageTrigger.click()
  const searchField2 = page.getByRole('combobox', { name: /搜索/ })
  await searchField2.fill('zzzznotexist')
  // Empty state message
  await expect(page.getByText('未找到匹配项')).toBeVisible()

  // First Escape clears query
  await page.keyboard.press('Escape')
  await expect(searchField2).toHaveValue('')

  // Second Escape closes popover and returns focus to trigger
  await page.keyboard.press('Escape')
  await expect(languageTrigger).toBeFocused()
  await expect(searchField2).not.toBeVisible()
})

test('SearchInput — forced-colors focus outline', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await page.emulateMedia({ forcedColors: 'active' })
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/search')

  const searchInput = page.getByRole('searchbox', { name: /搜索/ })
  await waitForVisualPage(page, 'light', searchInput)

  // Focus the standard search input
  await searchInput.focus()

  // The outer container should have a visible focus style under forced-colors
  const container = searchInput.locator('..')
  await expect(container).toHaveCSS('outline-style', 'solid')
})

test('SearchInput — clearing restores focus in compact and embedded variants', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/new')

  // The file tree search (compact variant)
  const fileSearch = page.getByLabel('筛选文件')
  await expect(fileSearch).toBeVisible()

  await fileSearch.fill('test')
  const clearBtn = page.getByRole('button', { name: '清除搜索' })
  await expect(clearBtn).toBeVisible()

  await clearBtn.click()
  await expect(fileSearch).toHaveValue('')
  await expect(fileSearch).toBeFocused()
})
