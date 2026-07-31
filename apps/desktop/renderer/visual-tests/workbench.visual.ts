import { expect, test, type Locator, type Page } from '@playwright/test'

type VisualScenario = {
  id: 'empty' | 'rich' | 'permission' | 'review'
  route: string
  readyText: string
  prepare?: (page: Page) => Promise<void>
}

const SCENARIOS: readonly VisualScenario[] = [
  {
    id: 'empty',
    route: '/?visualCase=empty#/new',
    readyText: '我们应该构建什么？',
  },
  {
    id: 'rich',
    route: '/?visualCase=rich#/threads/visual-rich',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'permission',
    route: '/?visualCase=permission#/threads/visual-permission',
    readyText: '已完成工作台结构梳理。',
  },
  {
    id: 'review',
    route: '/?visualCase=review#/threads/visual-review',
    readyText: '已完成工作台结构梳理。',
    prepare: async (page) => {
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      await expect(
        page.getByRole('complementary', { name: '右侧面板' }),
      ).toBeVisible()
      await page
        .getByRole('complementary', { name: '右侧面板' })
        .getByRole('button', { name: /^审阅/ })
        .click()
      await expect(
        page
          .getByRole('complementary', { name: '右侧面板' })
          .locator('[data-review-syntax-state="ready"]')
          .first(),
      ).toBeVisible({ timeout: 10_000 })
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
        await expect(
          page.getByText(scenario.readyText, { exact: true }),
        ).toBeVisible()
        await scenario.prepare?.(page)
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
        await expect(page.locator('html')).toHaveAttribute(
          'data-code-theme-id',
          mode === 'light' ? 'codex-light' : 'codex-dark',
        )
        await closeTransientErrorToast(page, 3_000)
        await waitForMaterialIcons(page)
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
      await page.goto('/?visualCase=empty#/settings/appearance')
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
  test(`open file empty state ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    await expect(
      page.getByText('已完成工作台结构梳理。', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightPanel = page.getByRole('complementary', {
      name: '右侧面板',
    })
    await rightPanel
      .getByRole('button', { name: '打开文件 Ctrl+Shift+E' })
      .click()

    await expect(rightPanel.getByRole('tab', { name: '打开文件' })).toBeVisible()
    await expect(
      rightPanel.getByRole('region', { name: '打开文件' }),
    ).toBeVisible()
    await expect(
      rightPanel.getByLabel('文件路径：工作区根目录'),
    ).toContainText('/')
    await expect(
      rightPanel.getByRole('complementary', { name: '工作区文件树' }),
    ).toBeVisible()
    await expect(rightPanel.getByText('README.md', { exact: true })).toBeVisible()
    await expect(
      rightPanel.getByText('没有匹配的文件。', { exact: true }),
    ).toBeHidden()
    await expect(
      rightPanel.getByRole('button', { name: '隐藏文件树' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(rightPanel.getByRole('searchbox', { name: '筛选文件' })).toBeFocused()
    await expect(rightPanel.locator('.right-dock-header')).toHaveCSS(
      'height',
      '46px',
    )
    await expect(rightPanel.locator('.file-breadcrumb-toolbar')).toHaveCSS(
      'height',
      '40px',
    )
    await expect(rightPanel.locator('.right-dock-search')).toHaveCSS(
      'height',
      '28px',
    )
    await expect(rightPanel.locator('.right-dock-tabs-viewport')).toHaveCSS(
      'overflow-x',
      'auto',
    )
    await expect(
      rightPanel.locator(
        '.right-dock-tabs-viewport .right-dock-add-button',
      ),
    ).toHaveCount(0)
    const appsDirectory = rightPanel.getByRole('treeitem', { name: 'apps' })
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'false')
    await expect(
      rightPanel.locator('[data-file-tree-virtualized-scroll="true"]'),
    ).toBeVisible()
    await expect(rightPanel).toHaveScreenshot(
      `open-file-empty-${mode}.png`,
      {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      },
    )

    await appsDirectory.click()
    await expect(appsDirectory).toHaveAttribute('aria-expanded', 'true')
    await expect(
      rightPanel.getByRole('treeitem', { name: 'desktop' }),
    ).toBeVisible()
    await rightPanel.getByText('README.md', { exact: true }).click()
    await expect(rightPanel.getByRole('tab', { name: 'README.md' })).toBeVisible()
    await expect(
      rightPanel.locator('.file-breadcrumb-toolbar__path button'),
    ).toHaveCount(0)
  })
}

test('Markdown file switches between rich and source presentations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('switch', { name: '调试模式' }),
  ).toHaveCount(0)
  const assistantActions = page
    .locator('.canonical-message-actions--assistant')
    .first()
  await expect(assistantActions).toBeVisible()
  await expect(
    assistantActions.getByRole('button', { name: '复制' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '显示右侧面板' }).click()

  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel
    .getByRole('button', { name: '打开文件 Ctrl+Shift+E' })
    .click()
  await rightPanel.getByText('README.md', { exact: true }).click()

  await expect(rightPanel.getByRole('tab', { name: 'README.md' })).toBeVisible()
  await expect(
    rightPanel.getByRole('button', { name: '查看源代码' }),
  ).toBeVisible()
  await expect(rightPanel.locator('.cm-editor.cm-markdown-rich')).toBeVisible()
  await expect(rightPanel.locator('.cm-md-rich-h1')).toHaveText('CodePilotX')
  await expect(rightPanel.locator('.cm-md-rich-list-marker')).toHaveText('•')
  await expect(rightPanel.locator('.cm-md-rich-table-widget table')).toBeVisible()
  await expect(rightPanel.locator('.cm-md-rich-table-widget th')).toHaveText([
    '优化点',
    '说明',
  ])
  await expect(rightPanel.locator('.cm-md-rich-table-widget td')).toHaveText([
    '缓存命中优化',
    '稳定复用前缀',
  ])
  await expect(rightPanel.locator('.cm-md-rich-code-block').first()).toBeVisible()
  const richBlockBackgrounds = await rightPanel.evaluate(panel => {
    const table = panel.querySelector<HTMLElement>('.cm-md-rich-table-widget')
    const codeLines = panel.querySelectorAll<HTMLElement>('.cm-md-rich-code-block')
    const firstCodeLine = codeLines.item(0)
    const lastCodeLine = codeLines.item(codeLines.length - 1)
    if (!table || !firstCodeLine || !lastCodeLine) return null
    const probe = document.createElement('span')
    probe.style.backgroundColor = 'var(--surface-code-block)'
    probe.style.borderRadius = 'var(--radius-lg, var(--radius-5))'
    panel.append(probe)
    const probeStyle = getComputedStyle(probe)
    const expected = probeStyle.backgroundColor
    const expectedRadius = probeStyle.borderTopLeftRadius
    probe.remove()
    return {
      code: getComputedStyle(firstCodeLine).backgroundColor,
      codeBottomRadius: getComputedStyle(lastCodeLine).borderBottomLeftRadius,
      codeTopRadius: getComputedStyle(firstCodeLine).borderTopLeftRadius,
      expected,
      expectedRadius,
      table: getComputedStyle(table).backgroundColor,
      tableRadius: getComputedStyle(table).borderTopLeftRadius,
    }
  })
  expect(richBlockBackgrounds).toEqual({
    code: richBlockBackgrounds?.expected,
    codeBottomRadius: richBlockBackgrounds?.expectedRadius,
    codeTopRadius: richBlockBackgrounds?.expectedRadius,
    expected: richBlockBackgrounds?.expected,
    expectedRadius: richBlockBackgrounds?.expectedRadius,
    table: richBlockBackgrounds?.expected,
    tableRadius: richBlockBackgrounds?.expectedRadius,
  })
  await expect(rightPanel.locator('.cm-activeLine')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-gutters')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-foldGutter')).toHaveCount(0)

  await rightPanel.locator('.cm-md-rich-table-widget').click()
  await expect(rightPanel.locator('.cm-md-rich-table-widget')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-content')).toContainText('| 优化点 | 说明 |')

  await rightPanel.getByRole('button', { name: '查看源代码' }).click()

  await expect(
    rightPanel.getByRole('button', { name: '查看预览' }),
  ).toBeVisible()
  await expect(rightPanel.locator('.cm-editor.cm-markdown-rich')).toHaveCount(0)
  await expect(rightPanel.locator('.cm-gutters')).toBeVisible()
  await expect(rightPanel.locator('.cm-content')).toContainText('# CodePilotX')
  await expect(rightPanel.locator('.cm-foldGutter')).toHaveCount(0)
})

test('session header aligns with the right panel and bottom panel spans the workspace', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  const header = page.locator('.desktop-main-route__header-spacer')
  const workflow = page.locator('.workflow-page')
  const scrollArea = page.locator('[data-component="thread-scroll-layout"]')
  const initialHeader = await header.boundingBox()
  const initialWorkflow = await workflow.boundingBox()
  expect(initialHeader).not.toBeNull()
  expect(initialWorkflow).not.toBeNull()
  expect(initialHeader!.x).toBeCloseTo(initialWorkflow!.x, 0)
  expect(initialHeader!.width).toBeCloseTo(initialWorkflow!.width, 0)

  await scrollArea.evaluate((element) => {
    element.scrollTop = 0
  })
  const scrolledHeader = await header.boundingBox()
  expect(scrolledHeader!.y).toBeCloseTo(initialHeader!.y, 0)
  expect(scrolledHeader!.height).toBeCloseTo(initialHeader!.height, 0)

  const bottomPanelButton = page.getByRole('button', {
    name: '显示底部面板',
  })
  const rightDockButton = page.getByRole('button', {
    name: '显示右侧面板',
  })
  await expect(bottomPanelButton).toHaveAttribute('aria-pressed', 'false')
  await expect(rightDockButton).toHaveAttribute('aria-pressed', 'false')

  const rightDockButtonBefore = await rightDockButton.boundingBox()
  await rightDockButton.click()
  const activeRightDockButton = page.getByRole('button', {
    name: '关闭右侧面板',
  })
  await expect(activeRightDockButton).toHaveAttribute('aria-pressed', 'true')
  await expect(
    page.getByRole('complementary', { name: '右侧面板' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('complementary', { name: '右侧面板' })
      .getByLabel('可用面板标签'),
  ).toBeVisible()
  await page
    .getByRole('complementary', { name: '右侧面板' })
    .getByRole('button', { name: /^审阅/ })
    .click()

  const headerWithDock = await header.boundingBox()
  const dock = await page
    .getByRole('complementary', { name: '右侧面板' })
    .boundingBox()
  const dockHeader = await page.locator('.right-dock-header').boundingBox()
  const upper = await page.locator('.desktop-workspace__upper').boundingBox()
  const rightDockButtonAfter = await activeRightDockButton.boundingBox()
  expect(headerWithDock!.width).toBeLessThan(initialHeader!.width)
  expect(dock!.y).toBeCloseTo(headerWithDock!.y, 0)
  expect(dockHeader!.height).toBeCloseTo(headerWithDock!.height, 0)
  expect(headerWithDock!.width + dock!.width).toBeCloseTo(upper!.width, 0)
  expect(rightDockButtonAfter!.x).toBeCloseTo(rightDockButtonBefore!.x, 0)

  const expandRightPanel = page.getByRole('button', {
    name: '展开右侧面板',
  })
  await expandRightPanel.click()
  await expect(
    page.getByRole('button', { name: '恢复右侧面板宽度' }),
  ).toHaveAttribute('aria-pressed', 'true')
  const fullWidthDock = await page
    .getByRole('complementary', { name: '右侧面板' })
    .boundingBox()
  expect(fullWidthDock!.width).toBeCloseTo(upper!.width, 0)
  await page.getByRole('button', { name: '恢复右侧面板宽度' }).click()

  await bottomPanelButton.click()
  const activeBottomPanelButton = page.getByRole('button', {
    name: '隐藏底部面板',
  })
  await expect(activeBottomPanelButton).toHaveAttribute('aria-pressed', 'true')
  const bottomPanelElement = page.getByRole('complementary', {
    name: '底部面板',
  })
  await expect(bottomPanelElement).toBeVisible()
  const bottomPanel = await bottomPanelElement.boundingBox()
  const workspace = await page.locator('.desktop-workspace').boundingBox()
  expect(bottomPanel!.x).toBeCloseTo(workspace!.x, 0)
  expect(bottomPanel!.width).toBeCloseTo(workspace!.width, 0)
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  const bottomSeparatorBox = await bottomSeparator.boundingBox()
  expect(bottomSeparatorBox).not.toBeNull()
  await page.mouse.move(
    bottomSeparatorBox!.x + bottomSeparatorBox!.width / 2,
    bottomSeparatorBox!.y + bottomSeparatorBox!.height / 2,
  )
  const bottomPointerDownStartedAt = Date.now()
  await page.mouse.down()
  expect(Date.now() - bottomPointerDownStartedAt).toBeLessThan(200)
  await page.mouse.move(bottomSeparatorBox!.x + 40, bottomSeparatorBox!.y - 80, {
    steps: 6,
  })
  await expect
    .poll(async () => (await bottomPanelElement.boundingBox())?.height)
    .toBeGreaterThan(bottomPanel!.height + 48)
  await expect(page.locator('.workbench-resize-guide')).toHaveCount(0)
  await expect(
    bottomPanelElement.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  await expect(
    bottomPanelElement.locator('.workbench-panel-header'),
  ).toHaveCSS('filter', 'none')
  const bottomPointerUpStartedAt = Date.now()
  await page.mouse.up()
  expect(Date.now() - bottomPointerUpStartedAt).toBeLessThan(200)
  await expect
    .poll(async () => (await bottomPanelElement.boundingBox())?.height)
    .toBeGreaterThan(bottomPanel!.height)
  await expect(
    bottomPanelElement.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  await bottomSeparator.dblclick()

  const sessionMenuButton = page.getByRole('button', {
    name: '更多会话操作',
  })
  await sessionMenuButton.click()
  await expect(
    page.getByRole('menuitem', { name: /显示 workflow 事件/ }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(sessionMenuButton).toBeFocused()

  await page.getByRole('menuitem', { name: '窗口', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: '最小化' })).toBeVisible()
  await expect(
    page.getByRole('menuitem', { name: /调试/ }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('right panel scales with its workspace and keeps a constrained manual override', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  const rightPanelShell = page.locator('.desktop-workspace-panel--right')
  await expect(rightPanel).toBeVisible()
  await rightPanel.getByRole('button', { name: '审阅 Ctrl+Shift+G' }).click()
  const sourceMenu = await openAndAssertReviewSourceMenu(page, rightPanel)
  await page.keyboard.press('Escape')
  await expect(sourceMenu).toBeHidden()
  const smallDiffSection = rightPanel.getByLabel(
    'apps/desktop/renderer/test/codex-style-contracts.test.ts diff',
  )
  await expect(smallDiffSection).toBeVisible({ timeout: 10_000 })
  const regularDiff = smallDiffSection.locator(
    '.review-codex-diff:not(.review-codex-diff--virtual)',
  )
  await expect(regularDiff).toBeVisible({ timeout: 10_000 })
  await expect(regularDiff).toHaveAttribute(
    'data-review-syntax-state',
    'ready',
    { timeout: 10_000 },
  )
  await expect(
    smallDiffSection.locator('.review-codex-diff--virtual'),
  ).toHaveCount(0)
  await expect
    .poll(async () => rightPanel.locator('.review-diff-word').count())
    .toBeGreaterThan(0)

  const addedRow = rightPanel
    .locator(
      '.review-codex-diff__line[data-line-type="change-addition"]',
    )
    .first()
  await expect(addedRow).toBeVisible()
  const diffColors = await addedRow.evaluate(row => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-decoration-added)'
    document.body.append(probe)
    const colors = {
      lineBackground: getComputedStyle(row).backgroundColor,
      rawAdded: getComputedStyle(probe).color,
    }
    probe.remove()
    return colors
  })
  expect(diffColors.lineBackground).not.toBe(diffColors.rawAdded)

  await rightPanel
    .locator('.review-sidebar-actions')
    .getByRole('button', { name: '更多' })
    .click()
  const textDiffCheckbox = page.getByRole('menuitemcheckbox', {
    name: '文字差异',
  })
  await expectCompactInteractiveRow(textDiffCheckbox, {
    borderRadius: '10px',
    fontSize: '12px',
    height: 27,
    lineHeight: '17px',
    paddingInline: '8px',
  })
  await textDiffCheckbox.click()
  await expect(rightPanel.locator('.review-diff-word')).toHaveCount(0)
  await smallDiffSection.locator('.preview-header').click()

  const reviewFileTree = rightPanel.getByRole('region', {
    name: '审查文件导航',
  })
  await expect(reviewFileTree).toBeVisible()
  const searchRegion = reviewFileTree.locator('.review-file-search-region')
  const searchInput = searchRegion.locator('.review-file-search')
  await expect(searchRegion).toBeVisible()
  await expect(searchInput).toHaveCSS('border-radius', '8px')
  await expect(searchInput).toHaveCSS('border-top-width', '1px')
  const [searchRegionBox, searchInputBox] = await Promise.all([
    searchRegion.boundingBox(),
    searchInput.boundingBox(),
  ])
  expect(searchRegionBox).not.toBeNull()
  expect(searchInputBox).not.toBeNull()
  expect(searchInputBox!.x - searchRegionBox!.x).toBeGreaterThanOrEqual(10)
  await expect(
    reviewFileTree.locator('[data-git-status="added"]'),
  ).toBeVisible()
  await expect(
    reviewFileTree.locator('[data-git-status="modified"]').first(),
  ).toBeVisible()
  await expect(
    reviewFileTree.locator('[data-git-status="deleted"]'),
  ).toBeVisible()
  await expect(
    reviewFileTree.locator('.review-file-tree-directory-status').first(),
  ).toBeVisible()
  await expect(reviewFileTree.locator('.review-file-counts')).toHaveCount(0)
  const [directoryStatusBox, fileStatusBox] = await Promise.all([
    reviewFileTree
      .locator('.review-file-tree-directory-status')
      .first()
      .boundingBox(),
    reviewFileTree.locator('[data-git-status="added"]').boundingBox(),
  ])
  expect(directoryStatusBox).not.toBeNull()
  expect(fileStatusBox).not.toBeNull()
  expect(
    directoryStatusBox!.x + directoryStatusBox!.width / 2,
  ).toBeCloseTo(fileStatusBox!.x + fileStatusBox!.width / 2, 0)
  const gitStatusColors = await reviewFileTree
    .locator(
      '[data-git-status="added"], [data-git-status="modified"], [data-git-status="deleted"]',
    )
    .evaluateAll(nodes =>
      Array.from(new Set(nodes.map(node => getComputedStyle(node).color))),
    )
  expect(gitStatusColors).toHaveLength(3)
  await reviewFileTree
    .getByRole('button', { name: /WorkspaceReviewDiff\.tsx/ })
    .click()
  const largeDiffSection = rightPanel.getByLabel(
    'apps/desktop/renderer/src/features/review/diff/WorkspaceReviewDiff.tsx diff',
  )
  await rightPanel.locator('.review-diff-scroll').evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  await largeDiffSection.evaluate(element =>
    element.scrollIntoView({ block: 'nearest' }),
  )
  await expect(largeDiffSection).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () =>
      rightPanel
        .locator(
          '.review-codex-diff--virtual .review-codex-diff__virtual-row',
        )
        .count(),
    )
    .toBeGreaterThan(10)
  expect(
    await rightPanel
      .locator(
        '.review-codex-diff--virtual .review-codex-diff__virtual-row',
      )
      .count(),
  ).toBeLessThan(100)
  const reviewDiffPreview = rightPanel.locator('.review-diff-preview')
  await expect(
    rightPanel.locator('[data-resize-skeleton-target]'),
  ).toHaveCount(0)
  await expect(page.locator('.workbench-resize-guide')).toHaveCount(0)
  const initialWidth = (await rightPanel.boundingBox())?.width
  expect(initialWidth).toBeGreaterThan(320)
  const rightSeparator = page.getByRole('separator', {
    name: '调整右侧面板宽度',
  })
  await expect(rightSeparator).toHaveAttribute('aria-valuemin', '320')
  expect(
    Number(await rightSeparator.getAttribute('aria-valuemax')),
  ).toBeGreaterThan(320)
  await rightSeparator.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(initialWidth!)
  const keyboardWidth = (await rightPanel.boundingBox())?.width
  await rightSeparator.press('Home')
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .not.toBeCloseTo(keyboardWidth!, 0)
  const resetWidth = (await rightPanel.boundingBox())?.width
  expect(resetWidth).toBeGreaterThan(320)
  await expect
    .poll(async () => Number(await rightSeparator.getAttribute('aria-valuenow')))
    .toBeCloseTo(resetWidth!, 0)

  const separatorBox = await rightSeparator.boundingBox()
  expect(separatorBox).not.toBeNull()
  await page.mouse.move(
    separatorBox!.x + separatorBox!.width / 2,
    separatorBox!.y + separatorBox!.height / 2,
  )
  await page.evaluate(() => {
    const resizeWindow = window as Window & {
      __resizeLongTaskDurations?: number[]
      __resizeLongTaskObserver?: PerformanceObserver
    }
    resizeWindow.__resizeLongTaskObserver?.disconnect()
    resizeWindow.__resizeLongTaskDurations = []
    resizeWindow.__resizeLongTaskObserver = new PerformanceObserver(list => {
      resizeWindow.__resizeLongTaskDurations?.push(
        ...list.getEntries().map(entry => entry.duration),
      )
    })
    resizeWindow.__resizeLongTaskObserver.observe({ type: 'longtask' })
  })
  await page.mouse.down()
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(
      separatorBox!.x - (96 * step) / 60,
      separatorBox!.y + 40,
    )
  }
  await expect
    .poll(async () => (await rightPanelShell.boundingBox())?.width)
    .toBeGreaterThan(resetWidth! + 48)
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(resetWidth! + 48)
  const [liveRightPanelBox, liveRightPanelShellBox] = await Promise.all([
    rightPanel.boundingBox(),
    rightPanelShell.boundingBox(),
  ])
  expect(liveRightPanelBox).not.toBeNull()
  expect(liveRightPanelShellBox).not.toBeNull()
  expect(liveRightPanelBox!.x).toBeCloseTo(liveRightPanelShellBox!.x, 0)
  await expect
    .poll(async () =>
      rightPanelShell
        .locator('.desktop-workspace-panel__surface')
        .evaluate(element => Number.parseFloat(getComputedStyle(element).width)),
    )
    .toBeCloseTo(resetWidth!, 0)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(reviewFileTree).toBeVisible()
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  await expect(rightPanel.locator('.workbench-panel-header')).toHaveCSS(
    'filter',
    'none',
  )
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(resetWidth!)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  const resizeLongTaskDurations = await page.evaluate(() => {
    const resizeWindow = window as Window & {
      __resizeLongTaskDurations?: number[]
      __resizeLongTaskObserver?: PerformanceObserver
    }
    resizeWindow.__resizeLongTaskObserver?.disconnect()
    return resizeWindow.__resizeLongTaskDurations ?? []
  })
  expect(Math.max(0, ...resizeLongTaskDurations)).toBeLessThan(200)
  await rightSeparator.dblclick()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)

  const beginCancelledResize = async (): Promise<void> => {
    const box = await rightSeparator.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(box!.x - 64, box!.y + 30, { steps: 4 })
    await expect
      .poll(async () => (await rightPanelShell.boundingBox())?.width)
      .toBeGreaterThan(resetWidth! + 32)
    await expect
      .poll(async () => (await rightPanel.boundingBox())?.width)
      .toBeGreaterThan(resetWidth! + 32)
    const [cancelPreviewPanelBox, cancelPreviewShellBox] = await Promise.all([
      rightPanel.boundingBox(),
      rightPanelShell.boundingBox(),
    ])
    expect(cancelPreviewPanelBox).not.toBeNull()
    expect(cancelPreviewShellBox).not.toBeNull()
    expect(cancelPreviewPanelBox!.x).toBeCloseTo(
      cancelPreviewShellBox!.x,
      0,
    )
    await expect(reviewDiffPreview).toBeVisible()
  }
  await beginCancelledResize()
  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent('pointercancel'))
  })
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')

  await beginCancelledResize()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect(reviewDiffPreview).toBeVisible()
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')

  const fileTreeSeparator = rightPanel.getByRole('separator', {
    name: '调整审查文件导航宽度',
  })
  const initialFileTreeWidth = (await reviewFileTree.boundingBox())?.width
  const initialDiffPreviewWidth = (await reviewDiffPreview.boundingBox())?.width
  const fileTreeSeparatorBox = await fileTreeSeparator.boundingBox()
  expect(initialFileTreeWidth).toBeGreaterThan(239)
  expect(initialDiffPreviewWidth).toBeGreaterThan(0)
  expect(fileTreeSeparatorBox).not.toBeNull()
  await page.mouse.move(
    fileTreeSeparatorBox!.x + fileTreeSeparatorBox!.width / 2,
    fileTreeSeparatorBox!.y + fileTreeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  for (let step = 1; step <= 60; step += 1) {
    await page.mouse.move(
      fileTreeSeparatorBox!.x - (72 * step) / 60,
      fileTreeSeparatorBox!.y + 36,
    )
  }
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(initialFileTreeWidth! + 48)
  await expect
    .poll(async () => (await reviewDiffPreview.boundingBox())?.width)
    .toBeCloseTo(initialDiffPreviewWidth!, 0)
  await expect(reviewFileTree).toBeVisible()
  await expect(reviewDiffPreview).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(initialFileTreeWidth!)

  await fileTreeSeparator.dblclick()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(initialFileTreeWidth!, 0)
  const cancelledFileTreeWidth = (await reviewFileTree.boundingBox())?.width
  const cancelledFileTreeSeparatorBox = await fileTreeSeparator.boundingBox()
  expect(cancelledFileTreeSeparatorBox).not.toBeNull()
  await page.mouse.move(
    cancelledFileTreeSeparatorBox!.x +
      cancelledFileTreeSeparatorBox!.width / 2,
    cancelledFileTreeSeparatorBox!.y +
      cancelledFileTreeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    cancelledFileTreeSeparatorBox!.x - 48,
    cancelledFileTreeSeparatorBox!.y + 24,
    { steps: 4 },
  )
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(cancelledFileTreeWidth! + 24)
  await expect(reviewDiffPreview).toBeVisible()
  await fileTreeSeparator.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(cancelledFileTreeWidth!, 0)

  const shrinkSeparatorBox = await rightSeparator.boundingBox()
  expect(shrinkSeparatorBox).not.toBeNull()
  await page.mouse.move(
    shrinkSeparatorBox!.x + shrinkSeparatorBox!.width / 2,
    shrinkSeparatorBox!.y + shrinkSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(shrinkSeparatorBox!.x + 64, shrinkSeparatorBox!.y + 30)
  await expect
    .poll(async () => (await rightPanelShell.boundingBox())?.width)
    .toBeLessThan(resetWidth! - 32)
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent('pointercancel'))
  })
  await page.mouse.up()

  await page.setViewportSize({ width: 960, height: 640 })
  await expect(rightPanel).toBeVisible()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeLessThan(resetWidth!)
  await expect(reviewFileTree).toBeHidden()

  await page.setViewportSize({ width: 1440, height: 920 })
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect(reviewFileTree).toBeVisible()

  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  await sidebarSeparator.focus()
  await page.keyboard.press('End')
  await page.setViewportSize({ width: 960, height: 640 })
  await expect(rightPanel).toHaveCount(0)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const forcedRightPanel = page.getByRole('complementary', {
    name: '右侧面板',
  })
  await expect(forcedRightPanel).toBeVisible()
  await expect
    .poll(
      async () =>
        (await page.locator('.desktop-main-route').boundingBox())?.width,
    )
    .toBeLessThan(352)

  await page.setViewportSize({ width: 1000, height: 680 })
  await expect(forcedRightPanel).toBeVisible()
  await page.getByRole('button', { name: '关闭右侧面板' }).click()
  await page.setViewportSize({ width: 1440, height: 920 })
  await expect(forcedRightPanel).toHaveCount(0)
})

test('Review resizes live when moved to the bottom panel', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000)
  await page.setViewportSize({ width: 1440, height: 920 })
  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: '审阅 Ctrl+Shift+G' }).click()
  await expect(rightPanel.locator('.review-diff-preview')).toBeVisible()
  await rightPanel
    .locator('[data-panel-tab="review"]')
    .click({ button: 'right' })
  await page.getByRole('menuitem', { name: '移到底部面板' }).click()

  const bottomPanel = page.getByRole('complementary', { name: '底部面板' })
  const bottomReviewDiff = bottomPanel.locator('.review-diff-preview')
  const bottomReviewFileTree = bottomPanel.getByRole('region', {
    name: '审查文件导航',
  })
  await expect(bottomReviewDiff).toBeVisible()
  await expect(bottomReviewFileTree).toBeVisible()

  const bottomHeight = (await bottomPanel.boundingBox())?.height
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  const bottomSeparatorBox = await bottomSeparator.boundingBox()
  expect(bottomHeight).toBeGreaterThan(160)
  expect(bottomSeparatorBox).not.toBeNull()
  await page.mouse.move(
    bottomSeparatorBox!.x + bottomSeparatorBox!.width / 2,
    bottomSeparatorBox!.y + bottomSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    bottomSeparatorBox!.x + 48,
    bottomSeparatorBox!.y - 72,
    { steps: 8 },
  )
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(bottomHeight! + 48)
  await expect(bottomReviewDiff).toBeVisible()
  await expect(bottomReviewFileTree).toBeVisible()
  await page.mouse.up()
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(bottomHeight!)
  await expect(bottomReviewDiff).toBeVisible()
})

test('bottom panel scales with workspace height while preserving the upper region', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '显示底部面板' }).click()
  const bottomPanel = page.getByRole('complementary', { name: '底部面板' })
  const initialHeight = (await bottomPanel.boundingBox())?.height
  expect(initialHeight).toBeGreaterThanOrEqual(160)
  const bottomSeparator = page.getByRole('separator', {
    name: '调整底部面板高度',
  })
  await expect(bottomSeparator).toHaveAttribute('aria-valuemin', '160')
  expect(
    Number(await bottomSeparator.getAttribute('aria-valuemax')),
  ).toBeGreaterThanOrEqual(initialHeight!)
  await bottomSeparator.focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(initialHeight!)
  await bottomSeparator.dblclick()

  await page.setViewportSize({ width: 960, height: 640 })
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeLessThan(initialHeight!)
  await expect
    .poll(
      async () =>
        (await page.locator('.desktop-workspace__upper').boundingBox())?.height,
    )
    .toBeGreaterThanOrEqual(240)

  await page.setViewportSize({ width: 1440, height: 920 })
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeCloseTo(initialHeight!, 0)
})

test('narrow file panel keeps the editor and file tree side by side', async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 640 })
  await page.addInitScript(() => {
    const target = window as typeof window & {
      __fileTreeViewWrites?: number
    }
    target.__fileTreeViewWrites = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key, value) {
      if (key.startsWith('codepilotx.desktop.fileTreeView:')) {
        target.__fileTreeViewWrites =
          (target.__fileTreeViewWrites ?? 0) + 1
      }
      return original.call(this, key, value)
    }
  })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  await sidebarSeparator.focus()
  await page.keyboard.press('End')
  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel
    .getByRole('button', { name: '打开文件 Ctrl+Shift+E' })
    .click()

  const editor = rightPanel.locator('.right-dock-open-file-empty')
  const tree = rightPanel.getByRole('complementary', {
    name: '工作区文件树',
  })
  await expect(editor).toBeVisible()
  await expect(tree).toBeVisible()
  const [editorBox, treeBox] = await Promise.all([
    editor.boundingBox(),
    tree.boundingBox(),
  ])
  expect(editorBox!.width).toBeGreaterThan(0)
  expect(treeBox!.width).toBeGreaterThan(0)
  expect(editorBox!.y).toBeCloseTo(treeBox!.y, 0)
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

  await page.setViewportSize({ width: 1440, height: 920 })
  const rightPanelSeparator = page.getByRole('separator', {
    name: '调整右侧面板宽度',
  })
  await rightPanelSeparator.focus()
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(520)
  await expect
    .poll(async () => (await tree.boundingBox())?.width ?? 0)
    .toBeGreaterThan(239)
  const treeSeparator = rightPanel.getByRole('separator', {
    name: '调整文件树宽度',
  })
  const treeSeparatorBox = await treeSeparator.boundingBox()
  const treeWidthBeforeDrag = (await tree.boundingBox())!.width
  expect(treeSeparatorBox).not.toBeNull()
  await page.evaluate(() => {
    ;(
      window as typeof window & {
        __fileTreeViewWrites?: number
      }
    ).__fileTreeViewWrites = 0
  })
  await page.mouse.move(
    treeSeparatorBox!.x + treeSeparatorBox!.width / 2,
    treeSeparatorBox!.y + treeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    treeSeparatorBox!.x - 64,
    treeSeparatorBox!.y + 24,
    { steps: 8 },
  )
  await expect
    .poll(async () => (await tree.boundingBox())?.width ?? 0)
    .toBeGreaterThan(treeWidthBeforeDrag + 32)
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __fileTreeViewWrites?: number
          }
        ).__fileTreeViewWrites ?? 0,
    ),
  ).toBe(0)
  await page.mouse.up()
  await expect
    .poll(async () => (await tree.boundingBox())?.width ?? 0)
    .toBeGreaterThan(treeWidthBeforeDrag + 32)
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __fileTreeViewWrites?: number
          }
        ).__fileTreeViewWrites ?? 0,
    ),
  ).toBe(1)
})

test('wide workspace keeps the summary beside a 600px review panel', async ({
  page,
}) => {
  const viewport = { width: 1919, height: 1033 }
  await page.setViewportSize(viewport)
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'reduce',
  })
  await page.addInitScript(
    ({ ratio }) => {
      localStorage.setItem(
        'codepilotx.desktop.rightDockWidthRatio.v2',
        String(ratio),
      )
    },
    {
      ratio: 600 / (viewport.width - 275 - 1),
    },
  )
  await gotoWorkbenchFixture(
    page,
    '/?visualCase=review#/threads/visual-review',
  )
  await closeTransientErrorToast(page)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: /^审阅/ }).click()

  const summary = page.locator('.thread-summary-inline')
  const timeline = page.locator('.session-timeline-container')
  const composer = page.locator('.workflow-page__composer-inner')
  await expect(summary).toBeVisible()
  await expect(
    page.getByRole('button', { name: '取消置顶摘要' }),
  ).toBeVisible()
  const visibleSummaryRows = summary.locator(
    '.interactive-row--adaptive:visible',
  )
  await expect(visibleSummaryRows.first()).toBeVisible()
  const summaryRowGeometry = await visibleSummaryRows.evaluateAll((rows) =>
    rows.map((row) => ({
      height: row.getBoundingClientRect().height,
      paddingInline: getComputedStyle(row).paddingInline,
      radius: getComputedStyle(row).borderRadius,
      verticallyClipped:
        row instanceof HTMLElement &&
        row.scrollHeight > row.clientHeight + 1,
    })),
  )
  expect(summaryRowGeometry.every((row) => row.height >= 30)).toBe(true)
  expect(summaryRowGeometry.every((row) => row.radius === '10px')).toBe(true)
  expect(
    summaryRowGeometry.every((row) => row.paddingInline === '8px'),
  ).toBe(true)
  expect(summaryRowGeometry.some((row) => row.verticallyClipped)).toBe(false)
  await expectCodexHoverBackground(
    summary.locator('button.interactive-row--adaptive').first(),
  )

  const [summaryBox, timelineBox, composerBox, rightPanelBox] =
    await Promise.all([
      summary.boundingBox(),
      timeline.boundingBox(),
      composer.boundingBox(),
      rightPanel.boundingBox(),
    ])
  expect(summaryBox).not.toBeNull()
  expect(timelineBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(rightPanelBox).not.toBeNull()
  if (!summaryBox || !timelineBox || !composerBox || !rightPanelBox) return

  expect(summaryBox.width).toBeCloseTo(272, 0)
  expect(timelineBox.width).toBeCloseTo(640, 0)
  expect(composerBox.width).toBeCloseTo(640, 0)
  expect(rightPanelBox.width).toBeCloseTo(600, 0)
  expect(
    summaryBox.x - (timelineBox.x + timelineBox.width),
  ).toBeGreaterThanOrEqual(16)
  expect(
    rightPanelBox.x - (summaryBox.x + summaryBox.width),
  ).toBeGreaterThanOrEqual(16)

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
})

for (const mode of MODES) {
  test(`summary and command output use Codex surfaces in ${mode} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await closeTransientErrorToast(page)
    await expect(
      page.getByText('已完成工作台结构梳理。', { exact: true }),
    ).toBeVisible()

    const summary = page.locator('.thread-summary-panel')
    const summaryHeader = summary.locator('.thread-summary-section > header').first()
    await expect(summary).toBeVisible()
    await expect(summaryHeader).toBeVisible()

    const commandGroup = page
      .locator('.canonical-process-group--commands')
      .first()
    await commandGroup.locator(':scope > summary').click()
    const command = page.locator('.canonical-tool').first()
    await command.locator(':scope > summary').click()
    const commandShell = page.locator('.canonical-command-shell').first()
    await expect(commandShell).toBeVisible()

    const surfaces = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.thread-summary-panel')
      const header = panel?.querySelector<HTMLElement>(
        '.thread-summary-section > header',
      )
      const shell = document.querySelector<HTMLElement>('.canonical-command-shell')
      if (!panel || !header || !shell) return null

      const resolveBackground = (
        parent: HTMLElement,
        token: string,
      ): string => {
        const probe = document.createElement('span')
        probe.style.backgroundColor = `var(${token})`
        parent.append(probe)
        const background = getComputedStyle(probe).backgroundColor
        probe.remove()
        return background
      }

      return {
        header: getComputedStyle(header).backgroundColor,
        output: resolveBackground(
          shell,
          '--color-token-text-preformat-background',
        ),
        panel: getComputedStyle(panel).backgroundColor,
        summary: resolveBackground(
          panel,
          '--color-token-editor-widget-background',
        ),
        shell: getComputedStyle(shell).backgroundColor,
      }
    })

    expect(surfaces).toEqual({
      header: surfaces?.summary,
      output: surfaces?.output,
      panel: surfaces?.summary,
      summary: surfaces?.summary,
      shell: surfaces?.output,
    })
  })
}

for (const mode of MODES) {
  test(`accessibility ${mode}`, async ({ page }) => {
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/new')
    await closeTransientErrorToast(page)
    await expect(
      page.getByRole('heading', {
        name: /我们(?:该做什么|应该构建什么)？/,
      }),
    ).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute(
      'data-reduce-motion',
      'on',
    )

    const contrastRatio = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement)
      return ratio(
        styles.getPropertyValue('--color-token-foreground').trim(),
        styles.getPropertyValue('--color-token-main-surface-primary').trim(),
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
        const channels = [0, 2, 4].map(
          (offset) =>
            Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
        )
        const linear = channels.map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        )
        return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
      }
    })
    expect(contrastRatio).toBeGreaterThanOrEqual(4.5)

    const sidebarSeparator = page.getByRole('separator', {
      name: '调整任务侧栏宽度',
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

test('sidebar keeps one mounted tree across docked and hover preview modes', async ({
  page,
}) => {
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  const sidebarTrigger = page.locator('[data-app-shell-sidebar-trigger]')
  await page.getByTitle('收起侧边栏').click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await expect(page.locator('.sidebar-hover-zone')).toHaveCount(0)

  await page.mouse.move(600, 400)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.desktop-sidebar')).toHaveCount(1)

  await page.mouse.move(600, 400)
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await sidebarTrigger.hover()
  await expect(sidebar).toHaveClass(/is-preview/, { timeout: 1_000 })
  await page.keyboard.press('Control+b')
  await expect(sidebar).toHaveClass(/is-docked/)

  const spacer = page.locator('.desktop-sidebar-spacer')
  const sidebarWidthBeforeDrag = (await sidebar.boundingBox())!.width
  const sidebarSeparator = page.getByRole('separator', {
    name: '调整任务侧栏宽度',
  })
  const sidebarSeparatorBox = await sidebarSeparator.boundingBox()
  expect(sidebarSeparatorBox).not.toBeNull()
  await page.mouse.move(
    sidebarSeparatorBox!.x + sidebarSeparatorBox!.width / 2,
    sidebarSeparatorBox!.y + sidebarSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    sidebarSeparatorBox!.x + 64,
    sidebarSeparatorBox!.y + 24,
    { steps: 8 },
  )
  await expect
    .poll(async () => (await sidebar.boundingBox())?.width ?? 0)
    .toBeGreaterThan(sidebarWidthBeforeDrag + 32)
  await expect
    .poll(async () => (await spacer.boundingBox())?.width ?? 0)
    .toBeGreaterThan(sidebarWidthBeforeDrag + 32)
  await expect(page.locator('.sidebar-resize-guide')).toHaveCount(0)
  await page.mouse.up()
})

test('sidebar exit and re-entry keep the workspace aligned', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/?visualCase=rich#/new')
  await closeTransientErrorToast(page)

  const sidebar = page.locator('aside.desktop-sidebar')
  const spacer = page.locator('.desktop-sidebar-spacer')
  const main = page.locator('.desktop-main')
  const initialSidebarBox = await sidebar.boundingBox()
  const initialSpacerBox = await spacer.boundingBox()
  expect(initialSidebarBox).not.toBeNull()
  expect(initialSpacerBox).not.toBeNull()
  expect(initialSpacerBox!.width).toBeCloseTo(initialSidebarBox!.width, 0)

  const exitingState = await page.evaluate(async () => {
    document.querySelector<HTMLElement>('[title="收起侧边栏"]')?.click()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const element = document.querySelector<HTMLElement>('aside.desktop-sidebar')
    if (!element) return null
    const style = getComputedStyle(element)
    return {
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert'),
      opacity: Number(style.opacity),
      visibility: style.visibility,
    }
  })
  expect(exitingState).not.toBeNull()
  expect(exitingState).toMatchObject({
    ariaHidden: 'true',
    inert: true,
    visibility: 'visible',
  })

  await expect(sidebar).toHaveCSS('visibility', 'hidden')
  await expect
    .poll(async () => (await spacer.boundingBox())?.width)
    .toBeCloseTo(0, 0)

  await page.locator('[data-app-shell-sidebar-trigger]').click()
  await expect(sidebar).toHaveClass(/is-docked/)
  await expect(sidebar).toHaveCSS('visibility', 'visible')
  await expect
    .poll(async () => (await spacer.boundingBox())?.width)
    .toBeCloseTo(initialSidebarBox!.width, 0)

  const [reopenedSidebarBox, reopenedMainBox] = await Promise.all([
    sidebar.boundingBox(),
    main.boundingBox(),
  ])
  expect(reopenedSidebarBox).not.toBeNull()
  expect(reopenedMainBox).not.toBeNull()
  expect(reopenedMainBox!.x).toBeCloseTo(
    reopenedSidebarBox!.x + reopenedSidebarBox!.width,
    0,
  )
  await expect(page.locator('aside.desktop-sidebar')).toHaveCount(1)
})

test('workbench panels remain present and layout-isolated while exiting', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightShell = page.locator('.desktop-workspace-panel--right')
  const rightSurface = rightShell.locator('.desktop-workspace-panel__surface')
  const main = page.locator('.desktop-main-route')
  await expect(rightShell).toHaveAttribute(
    'data-workbench-panel-presence',
    'open',
  )
  await page.waitForTimeout(180)
  const [rightBefore, surfaceBefore, mainBefore] = await Promise.all([
    rightShell.boundingBox(),
    rightSurface.boundingBox(),
    main.boundingBox(),
  ])
  expect(rightBefore).not.toBeNull()
  expect(surfaceBefore).not.toBeNull()
  expect(mainBefore).not.toBeNull()

  const rightExit = await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('[aria-label="关闭右侧面板"]')
      ?.click()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const shell = document.querySelector<HTMLElement>(
      '.desktop-workspace-panel--right',
    )
    const immediate = shell
      ? {
          ariaHidden: shell.getAttribute('aria-hidden'),
          inert: shell.hasAttribute('inert'),
          state: shell.dataset.workbenchPanelPresence,
        }
      : null
    await new Promise(resolve => setTimeout(resolve, 40))
    const surface = shell?.querySelector<HTMLElement>(
      '.desktop-workspace-panel__surface',
    )
    const mainRoute = document.querySelector<HTMLElement>(
      '.desktop-main-route',
    )
    return {
      immediate,
      mainWidth: mainRoute?.getBoundingClientRect().width ?? 0,
      shellWidth: shell?.getBoundingClientRect().width ?? 0,
      surfaceWidth: surface?.getBoundingClientRect().width ?? 0,
    }
  })
  expect(rightExit.immediate).toEqual({
    ariaHidden: 'true',
    inert: true,
    state: 'exiting',
  })
  expect(rightExit.shellWidth).toBeLessThan(rightBefore!.width)
  expect(rightExit.shellWidth).toBeGreaterThan(0)
  expect(rightExit.surfaceWidth).toBeCloseTo(surfaceBefore!.width, 0)
  expect(rightExit.mainWidth).toBeGreaterThan(mainBefore!.width)
  await expect(rightShell).toHaveCount(0)

  await page.getByRole('button', { name: '显示右侧面板' }).click()
  await page.waitForTimeout(180)
  await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('[aria-label="关闭右侧面板"]')
      ?.click()
    await new Promise(resolve => setTimeout(resolve, 24))
    document
      .querySelector<HTMLElement>('[aria-label="显示右侧面板"]')
      ?.click()
  })
  await expect(rightShell).toHaveCount(1)
  await expect(rightShell).toHaveAttribute(
    'data-workbench-panel-presence',
    'open',
  )
  await expect(
    page.getByRole('complementary', { name: '右侧面板' }),
  ).toHaveCount(1)

  await page.getByRole('button', { name: '显示底部面板' }).click()
  const bottomShell = page.locator('.desktop-workspace-panel--bottom')
  const bottomSurface = bottomShell.locator(
    '.desktop-workspace-panel__surface',
  )
  await page.waitForTimeout(180)
  const [bottomBefore, bottomSurfaceBefore] = await Promise.all([
    bottomShell.boundingBox(),
    bottomSurface.boundingBox(),
  ])
  const bottomExit = await page.evaluate(async () => {
    document
      .querySelector<HTMLElement>('[aria-label="隐藏底部面板"]')
      ?.click()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const shell = document.querySelector<HTMLElement>(
      '.desktop-workspace-panel--bottom',
    )
    const immediateState = shell?.dataset.workbenchPanelPresence ?? null
    await new Promise(resolve => setTimeout(resolve, 40))
    const surface = shell?.querySelector<HTMLElement>(
      '.desktop-workspace-panel__surface',
    )
    return {
      immediateState,
      shellHeight: shell?.getBoundingClientRect().height ?? 0,
      surfaceHeight: surface?.getBoundingClientRect().height ?? 0,
    }
  })
  expect(bottomExit.immediateState).toBe('exiting')
  expect(bottomExit.shellHeight).toBeLessThan(bottomBefore!.height)
  expect(bottomExit.shellHeight).toBeGreaterThan(0)
  expect(bottomExit.surfaceHeight).toBeCloseTo(
    bottomSurfaceBefore!.height,
    0,
  )
  await expect(bottomShell).toHaveCount(0)
})

test('turn navigation preview matches Codex geometry and output limits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'no-preference',
  })
  await page.goto('/?visualCase=turn-nav#/threads/visual-turn-nav')
  await closeTransientErrorToast(page)
  await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消置顶摘要' }).click()

  const rail = page.getByRole('navigation', { name: '用户消息导航' })
  await expect(rail).toBeVisible()
  const items = rail.getByRole('button')
  await expect(items).toHaveCount(4)
  await expect(rail.locator('[aria-current="true"]')).toHaveCount(4)

  const lastItem = items.last()
  await expect(lastItem).toHaveCSS('width', '36px')
  await expect(lastItem).toHaveCSS('height', '10px')

  const marker = lastItem.locator('.conversation-turn-nav-marker')
  const idleMarkerBox = await marker.boundingBox()
  expect(idleMarkerBox?.width).toBeCloseTo(6, 0)

  await lastItem.focus()
  const tooltip = page.locator('.conversation-turn-preview-tooltip').last()
  const preview = tooltip.locator(
    '[data-thread-user-message-navigation-tooltip-preview]',
  ).last()
  await expect(preview).toBeVisible()
  await expect(preview).toHaveCSS('width', '320px')
  await expect(preview).toHaveCSS('padding', '8px')
  await expect(preview).toHaveCSS('font-size', '12px')
  await expect(preview).toHaveCSS('line-height', '20px')
  await expect(preview).toHaveCSS('border-radius', '12px')
  await expect(
    preview.locator('.preview-card-assistant-text'),
  ).toHaveCSS('-webkit-line-clamp', '3')

  await expect(preview.locator('.preview-card-output')).toHaveCount(2)
  await expect(preview.locator('.preview-card-output-more')).toHaveText('+1')
  await expect(tooltip.locator('.tooltip-arrow')).toHaveCount(0)
  await expect(tooltip).toHaveCSS('padding', '0px')

  await lastItem.hover()
  await expect
    .poll(async () => (await marker.boundingBox())?.width)
    .toBeCloseTo(26, 0)
})

test('turn navigation supports click, keyboard, and pointer scrubbing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'no-preference',
  })
  await page.goto('/?visualCase=turn-nav#/threads/visual-turn-nav')
  await closeTransientErrorToast(page)
  await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消置顶摘要' }).click()

  const rail = page.getByRole('navigation', { name: '用户消息导航' })
  const items = rail.getByRole('button')
  const userMessage = (text: string) =>
    page.locator('[data-turn-navigation-id] [data-user-message-bubble]').filter({
      hasText: text,
    })
  await expect(items).toHaveCount(4)

  await items.first().click()
  await expect(userMessage('第一轮：梳理 Codex 导航轨。')).toBeInViewport()

  await page.keyboard.press('Alt+ArrowDown')
  await expect(userMessage('第 2 轮：继续校准交互和视觉。')).toBeInViewport()

  const firstBox = await items.first().boundingBox()
  const lastBox = await items.last().boundingBox()
  expect(firstBox).not.toBeNull()
  expect(lastBox).not.toBeNull()
  if (!firstBox || !lastBox) return

  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(
    lastBox.x + lastBox.width / 2,
    lastBox.y + lastBox.height / 2,
    { steps: 4 },
  )
  await expect(items.last()).toHaveAttribute('data-scrub-target', '')
  await page.mouse.up()
  await expect(rail.locator('[data-scrub-target]')).toHaveCount(0)
  await expect(userMessage('第 4 轮：继续校准交互和视觉。')).toBeInViewport()
})

test('narrow sidebar uses floating preview without drawer or backdrop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await page.goto('/?visualCase=empty#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0)
  await expect(sidebar).not.toHaveClass(/is-drawer/)
  const primaryNavigationRow = page
    .getByRole('navigation', { name: '主要导航' })
    .getByRole('link', { name: '新建任务' })
  await expect(primaryNavigationRow).toBeVisible()
  await expectCompactInteractiveRow(primaryNavigationRow, {
    borderRadius: '10px',
    fontSize: '14px',
    height: 30,
    lineHeight: '20px',
    paddingInline: '8px',
  })
  await expectCodexHoverBackground(
    page
      .getByRole('navigation', { name: '主要导航' })
      .getByRole('link', { name: '拉取请求' }),
  )

  const composerUtilityRows = page.locator(
    '.composer .meta-chip:visible, .composer .composer-model-chip:visible, .composer .permission-select-trigger:visible',
  )
  await expect(composerUtilityRows.first()).toBeVisible()
  const composerRowStyles = await composerUtilityRows.evaluateAll((rows) =>
    rows.map((row) => {
      const style = getComputedStyle(row)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: row.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  )
  expect(composerRowStyles.length).toBeGreaterThanOrEqual(2)
  expect(
    composerRowStyles.every(
      (row) =>
        row.borderRadius === '9999px' &&
        row.fontSize === '12px' &&
        row.height === 28 &&
        row.lineHeight === '18px' &&
        row.paddingInline === '6px',
    ),
  ).toBe(true)

  await page.getByTitle('展开侧边栏').click()
  await expect(sidebar).toHaveClass(/is-docked/)
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(sidebar).toHaveClass(/is-docked/)
})

test('composer utility controls restore the Codex hover overlay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'reduce',
  })
  await page.goto('/?visualCase=permission#/threads/visual-permission')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  const rows = [
    page.locator('.permission-select-trigger:visible'),
    page.locator('.composer-plan-mode-chip:visible'),
    page.locator('.composer-model-chip:visible'),
  ]
  for (const row of rows) {
    await expect(row).toBeVisible()
    await expectCodexHoverBackground(row)
  }
})

test('settings toolbar trigger restores the Codex hover overlay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  const trigger = page.getByRole('combobox', { name: '默认打开目标' })
  await expectCompactInteractiveRow(trigger, {
    borderRadius: '10px',
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })
  await expectCodexHoverBackground(trigger)
})

test('settings uses the shared full-label sidebar in desktop and narrow previews', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  await expect(sidebar).toHaveAttribute('data-sidebar-content', 'settings')
  await expect(sidebar).toHaveAttribute('aria-label', '设置侧栏')
  await expect(page.getByRole('combobox', { name: '搜索设置' })).toBeVisible()
  const settingsNavigationRow = page.locator('.settings-nav-item:visible').first()
  await expect(settingsNavigationRow).toBeVisible()
  await expectCompactInteractiveRow(settingsNavigationRow, {
    borderRadius: '10px',
    fontSize: '14px',
    height: 30,
    lineHeight: '20px',
    paddingInline: '8px',
  })

  await page.keyboard.press('Control+b')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.getByRole('combobox', { name: '搜索设置' })).toBeVisible()

  await page.mouse.move(600, 400)
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.setViewportSize({ width: 720, height: 800 })
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '搜索设置' })).toBeVisible()
})

for (const mode of MODES) {
  test(`settings dropdown follows the compact row contract in ${mode} mode`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 640 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/settings/general')
    await closeTransientErrorToast(page)

    await expectCompactInteractiveRow(
      page.getByRole('combobox', { name: '默认打开目标' }),
      {
        borderRadius: '10px',
        fontSize: '14px',
        height: 28,
        lineHeight: '18px',
        paddingInline: '8px',
      },
    )

    await page.getByRole('button', { name: '语言' }).click()
    const surface = page.locator('.settings-dropdown-content--searchable')
    await expect(surface).toBeVisible()
    const surfaceContract = await surface.evaluate((element) => {
      const style = getComputedStyle(element)
      const item = element.querySelector<HTMLElement>(
        '.settings-dropdown-item',
      )
      const itemStyle = item ? getComputedStyle(item) : null
      return {
        backdropFilter: style.backdropFilter,
        borderRadius: style.borderRadius,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        itemBorderRadius: itemStyle?.borderRadius,
        itemFontSize: itemStyle?.fontSize,
        itemHeight: item?.getBoundingClientRect().height,
        itemLineHeight: itemStyle?.lineHeight,
        itemPaddingBlock: itemStyle?.paddingBlock,
        itemPaddingInline: itemStyle?.paddingInline,
        padding: style.padding,
      }
    })
    expect(surfaceContract.itemHeight).toBeCloseTo(27, 0)
    expect({
      backdropFilter: surfaceContract.backdropFilter,
      borderRadius: surfaceContract.borderRadius,
      borderTopWidth: surfaceContract.borderTopWidth,
      itemBorderRadius: surfaceContract.itemBorderRadius,
      itemFontSize: surfaceContract.itemFontSize,
      itemLineHeight: surfaceContract.itemLineHeight,
      itemPaddingBlock: surfaceContract.itemPaddingBlock,
      itemPaddingInline: surfaceContract.itemPaddingInline,
      padding: surfaceContract.padding,
    }).toEqual({
      backdropFilter: 'none',
      borderRadius: '12px',
      borderTopWidth: '1px',
      itemBorderRadius: '10px',
      itemFontSize: '12px',
      itemLineHeight: '17px',
      itemPaddingBlock: '5px',
      itemPaddingInline: '8px',
      padding: '4px',
    })
    expect(surfaceContract.boxShadow).not.toBe('none')
  })
}

test('sidebar trigger does not reopen the preview until the pointer leaves', async ({
  page,
}) => {
  await page.goto('/?visualCase=empty#/new')
  await closeTransientErrorToast(page)
  const sidebar = page.locator('aside.desktop-sidebar')
  const sidebarTrigger = page.locator('[data-app-shell-sidebar-trigger]')

  await sidebarTrigger.hover()
  await sidebarTrigger.click()
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.waitForTimeout(150)
  await expect(sidebar).toHaveClass(/is-collapsed/)

  await page.mouse.move(600, 400)
  await sidebarTrigger.hover()
  await expect(sidebar).toHaveClass(/is-preview/, { timeout: 1_000 })
})

test('Escape closes the theme picker and restores focus', async ({ page }) => {
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)
  const picker = page.getByRole('combobox', { name: '浅色代码主题' })
  await picker.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: '搜索代码主题…' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(picker).toBeFocused()
})

test('appearance modes support radio keys, variant editors, and reload persistence', async ({
  page,
}) => {
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  const lightMode = modeGroup.getByRole('radio', { name: '浅色' })
  const darkMode = modeGroup.getByRole('radio', { name: '深色' })
  const systemMode = modeGroup.getByRole('radio', { name: '系统' })

  await expect(systemMode).toBeChecked()
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeVisible()

  await lightMode.click()
  await expect(lightMode).toBeChecked()
  await expect(page.getByRole('heading', { name: '浅色主题' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '深色主题' })).toBeHidden()

  await lightMode.press('ArrowRight')
  await expect(darkMode).toBeFocused()
  await expect(darkMode).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(
    page.getByRole('radiogroup', { name: '外观模式' }).getByRole('radio', {
      name: '深色',
    }),
  ).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('Dracula code theme applies the recovered Codex runtime hierarchy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/appearance')
  await closeTransientErrorToast(page)
  await page
    .getByRole('radiogroup', { name: '外观模式' })
    .getByRole('radio', { name: '深色' })
    .click()

  await page.getByRole('combobox', { name: '深色代码主题' }).click()
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
          canvas: root
            .getPropertyValue('--color-token-main-surface-primary')
            .trim(),
          chrome: root
            .getPropertyValue('--color-token-side-bar-background')
            .trim(),
          panel: root
            .getPropertyValue('--color-token-panel-background')
            .trim(),
          composer: root
            .getPropertyValue('--color-token-elevated-background')
            .trim(),
        }
      }),
    )
    .toEqual({
      canvas: '#282a36',
      chrome: '#22232d',
      panel: '#32343f',
      composer: '#373843',
    })
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('codepilotx.desktop.appearance.v6'),
      ),
    )
    .toContain('"dracula"')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute(
    'data-code-theme-id',
    'dracula',
  )
  await page.goto('/?visualCase=rich#/threads/visual-rich')
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

  await gotoWorkbenchFixture(page, '/?visualCase=review#/threads/visual-review')
  await expect(page.locator('html')).toHaveAttribute(
    'data-code-theme-id',
    'dracula',
  )
  await page.getByRole('button', { name: '显示右侧面板' }).click()
  const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
  await rightPanel.getByRole('button', { name: /^审阅/ }).click()
  const sourceMenu = await openAndAssertReviewSourceMenu(page, rightPanel)
  await expect(sourceMenu).toHaveScreenshot(
    'desktop-dark-review-source-menu.png',
    {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  )
  await page.keyboard.press('Escape')
  await expect(
    rightPanel
      .getByLabel(
        'apps/desktop/renderer/test/codex-style-contracts.test.ts diff',
      )
      .locator('[data-review-syntax-state="ready"]'),
  ).toBeVisible({ timeout: 10_000 })
  await expect
    .poll(async () => rightPanel.locator('.review-diff-word').count())
    .toBeGreaterThan(0)
  const syntaxColors = await rightPanel
    .locator('.review-codex-diff__line-text span[style*="color"]')
    .evaluateAll(nodes =>
      Array.from(
        new Set(nodes.map(node => getComputedStyle(node).color)),
      ),
    )
  expect(syntaxColors.length).toBeGreaterThanOrEqual(3)
  const draculaDiffColors = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement)
    return {
      added: styles.getPropertyValue('--color-decoration-added').trim(),
      addedLine: styles
        .getPropertyValue('--color-diff-added-line-background')
        .trim(),
      removed: styles.getPropertyValue('--color-decoration-deleted').trim(),
      removedLine: styles
        .getPropertyValue('--color-diff-removed-line-background')
        .trim(),
    }
  })
  expect(draculaDiffColors).toEqual({
    added: '#50fa7b',
    addedLine: '#3c5b4d',
    removed: '#ff5555',
    removedLine: '#5b3d46',
  })
  await waitForMaterialIcons(rightPanel)
  await expect(rightPanel).toHaveScreenshot(
    'desktop-dark-dracula-review.png',
    {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  )
})

test('settings shell search and appearance source contracts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  const defaultOpenTarget = page.getByRole('combobox', {
    name: '默认打开目标',
  })
  await expect(
    defaultOpenTarget.evaluate((trigger) => {
      const style = getComputedStyle(trigger)
      const bounds = trigger.getBoundingClientRect()
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-text-strong)'
      document.body.append(probe)
      const expectedForeground = getComputedStyle(probe).color
      probe.remove()
      return {
        backgroundIsTransparent:
          style.backgroundColor === 'rgba(0, 0, 0, 0)',
        borderRadius: style.borderRadius,
        colorMatchesForeground: style.color === expectedForeground,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundIsTransparent: true,
    borderRadius: '10px',
    colorMatchesForeground: true,
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })

  const languageDropdown = page.getByRole('button', { name: '语言' })
  await languageDropdown.click()
  const languageMenu = page.getByRole('listbox')
  const languageSurface = page.locator(
    '.settings-dropdown-content--searchable',
  )
  await expect(languageMenu).toBeVisible()
  await expect(languageSurface).toBeVisible()
  const languageSurfaceStyles = await languageSurface.evaluate((surface) => {
    const style = getComputedStyle(surface)
    const firstItem = surface.querySelector<HTMLElement>(
      '.settings-dropdown-item',
    )
    const firstItemStyle = firstItem ? getComputedStyle(firstItem) : null
    return {
      backdropFilter: style.backdropFilter,
      borderRadius: style.borderRadius,
      itemFontSize: firstItemStyle?.fontSize,
      itemHeight: firstItem?.getBoundingClientRect().height,
      itemLineHeight: firstItemStyle?.lineHeight,
      padding: style.padding,
    }
  })
  expect(languageSurfaceStyles.itemHeight).toBeCloseTo(27, 0)
  expect({
    backdropFilter: languageSurfaceStyles.backdropFilter,
    borderRadius: languageSurfaceStyles.borderRadius,
    itemFontSize: languageSurfaceStyles.itemFontSize,
    itemLineHeight: languageSurfaceStyles.itemLineHeight,
    padding: languageSurfaceStyles.padding,
  }).toEqual({
    backdropFilter: 'none',
    borderRadius: '12px',
    itemFontSize: '12px',
    itemLineHeight: '17px',
    padding: '4px',
  })
  await expect(page.getByRole('combobox', { name: '搜索语言' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.goto('/?visualCase=empty#/settings/config')
  const permissionScopeDropdown = page.getByRole('combobox', { name: '工具权限范围' })
  await permissionScopeDropdown.click()
  const permissionScopeMenu = page.getByRole('listbox')
  await expect(permissionScopeMenu).toBeVisible()
  await expect(
    permissionScopeMenu.evaluate((menu) => {
      const item = menu.querySelector<HTMLElement>('.settings-dropdown-item')
      const label = item?.querySelector<HTMLElement>(
        '.settings-dropdown-item-label',
      )
      const detail = item?.querySelector<HTMLElement>(
        '.settings-dropdown-item-detail',
      )
      const foregroundProbe = document.createElement('span')
      foregroundProbe.style.color = 'var(--color-token-foreground)'
      const secondaryProbe = document.createElement('span')
      secondaryProbe.style.color =
        'var(--color-token-description-foreground)'
      menu.append(foregroundProbe, secondaryProbe)
      const expectedForeground = getComputedStyle(foregroundProbe).color
      const expectedSecondary = getComputedStyle(secondaryProbe).color
      foregroundProbe.remove()
      secondaryProbe.remove()
      return {
        detailMatchesSecondary:
          detail !== null &&
          getComputedStyle(detail).color === expectedSecondary,
        labelMatchesForeground:
          label !== null &&
          getComputedStyle(label).color === expectedForeground,
      }
    }),
  ).resolves.toEqual({
    detailMatchesSecondary: true,
    labelMatchesForeground: true,
  })
  await page.keyboard.press('Escape')
  await page.goto('/?visualCase=empty#/settings/general')
  await closeTransientErrorToast(page)

  await expect(
    page.getByRole('button', { name: '导入' }).evaluate((button) => {
      const style = getComputedStyle(button)
      const bounds = button.getBoundingClientRect()
      const backgroundProbe = document.createElement('span')
      backgroundProbe.style.background = 'var(--color-token-button-background)'
      const borderProbe = document.createElement('span')
      borderProbe.style.borderColor = 'var(--color-token-button-border)'
      document.body.append(backgroundProbe, borderProbe)
      const expectedBackgroundColor =
        getComputedStyle(backgroundProbe).backgroundColor
      const expectedBorderColor = getComputedStyle(borderProbe).borderColor
      backgroundProbe.remove()
      borderProbe.remove()
      return {
        backgroundMatchesButtonToken:
          style.backgroundColor === expectedBackgroundColor,
        borderMatchesButtonToken: style.borderColor === expectedBorderColor,
        borderRadius: style.borderRadius,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundMatchesButtonToken: true,
    borderMatchesButtonToken: true,
    borderRadius: '8px',
    borderWidth: '1px',
    boxShadow: 'none',
    fontSize: '14px',
    height: 28,
    lineHeight: '19.6px',
    paddingInline: '9.8px',
  })

  await page.keyboard.press('Control+F')
  await page.keyboard.up('Control')
  const search = page.getByRole('combobox', { name: '搜索设置' })
  await expect(search).toBeFocused()
  await search.evaluate((element, value) => {
    const input = element as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      data: value,
      inputType: 'insertText',
    }))
  }, '对比度')
  await expect(search).toHaveValue('对比度')
  await expect(search).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('option', { name: /对比度.*外观/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/settings\/appearance$/)
  await expect(page.getByRole('heading', { name: '外观' })).toBeVisible()

  const modeGroup = page.getByRole('radiogroup', { name: '外观模式' })
  await expect(modeGroup.getByRole('radio')).toHaveCount(3)
  await expect(
    modeGroup
      .getByRole('radio')
      .evaluateAll((radios) =>
        radios.map((radio) => radio.parentElement?.textContent?.trim()),
      ),
  ).resolves.toEqual(['系统', '浅色', '深色'])
  await expect(modeGroup.locator('svg[viewBox="0 0 170 120"]')).toHaveCount(3)
  await expect(
    modeGroup.locator('#appearance-system-preview-sheet'),
  ).toHaveCount(1)

  const preview = page.locator('.appearance-diff-preview')
  const previewDiff = preview.locator(
    '.review-codex-diff[data-diff-type="split"]',
  )
  await expect(previewDiff).toHaveCount(1)
  await expect(previewDiff).toHaveAttribute('data-overflow', 'scroll')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'bars')
  await expect(previewDiff).toHaveAttribute(
    'aria-label',
    '浅色主题差异代码',
  )
  await expect(previewDiff).toHaveAttribute(
    'data-review-syntax-state',
    'ready',
    { timeout: 10_000 },
  )
  await expect(previewDiff.locator('[data-deletions]')).toHaveCount(1)
  await expect(previewDiff.locator('[data-additions]')).toHaveCount(1)
  await expect(previewDiff.locator('.review-line-comment-button')).toHaveCount(
    0,
  )
  await expect(previewDiff.locator('.review-line-comments')).toHaveCount(0)
  await expect(previewDiff.locator('.review-hunk-actions')).toHaveCount(0)
  await expect(
    previewDiff.locator(
      '.review-codex-diff__hunk[data-separator="line-info"]',
    ),
  ).not.toHaveCount(0)
  await expect(
    previewDiff.locator('[data-line-type="buffer"]'),
  ).not.toHaveCount(0)
  await expect(previewDiff.locator('.review-diff-word')).not.toHaveCount(0)
  await expect
    .poll(() =>
      previewDiff
        .locator(
          '.review-codex-diff__line[data-line-type^="change-"] ' +
            '.review-codex-diff__line-text span[style*="color"]',
        )
        .count(),
    )
    .toBeGreaterThan(0)

  const structure = await page.evaluate(() => {
    const gallery = document.querySelector('.appearance-mode-gallery')!
    const diff = document.querySelector('.appearance-diff-preview')!
    const editors = document.querySelector('.appearance-theme-editors')!
    const inner = document.querySelector('.appearance-settings')!
    const card = document.querySelector('.appearance-mode-visual')!
    const galleryStyle = getComputedStyle(gallery)
    const innerStyle = getComputedStyle(inner)
    const cardStyle = getComputedStyle(card)
    const cardBounds = card.getBoundingClientRect()
    return {
      diffAfterGallery: Boolean(
        gallery.compareDocumentPosition(diff) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      editorsAfterDiff: Boolean(
        diff.compareDocumentPosition(editors) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      galleryMaxWidth: galleryStyle.maxWidth,
      innerMaxWidth: innerStyle.maxWidth,
      innerPadding: innerStyle.paddingTop,
      cardRadius: cardStyle.borderRadius,
      cardRatio: cardBounds.width / cardBounds.height,
    }
  })
  expect(structure).toMatchObject({
    diffAfterGallery: true,
    editorsAfterDiff: true,
    galleryMaxWidth: 'none',
    innerMaxWidth: '768px',
    innerPadding: '20px',
    cardRadius: '10px',
  })
  expect(structure.cardRatio).toBeCloseTo(17 / 12, 2)

  await modeGroup.getByRole('radio', { name: '浅色' }).click()
  await expect(page.locator('.appearance-theme-editor')).toHaveCount(1)
  await expect(
    page
      .locator('.appearance-theme-editor')
      .first()
      .locator('.settings-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).resolves.toEqual([
    '浅色主题',
    '强调色',
    '背景',
    '前景',
    'UI 字体',
    '代码字体',
    '对比度',
  ])
  const lightPicker = page.getByRole('combobox', { name: '浅色代码主题' })
  await expect(page.getByRole('button', { name: '导入' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '复制主题' })).toHaveCount(0)
  await lightPicker.click()
  await expect(page.getByRole('option')).toHaveCount(16)
  await expect(
    page.getByRole('combobox', { name: '搜索代码主题…' }),
  ).toHaveCount(0)
  await page.keyboard.press('Escape')

  const accentInput = page.getByRole('textbox', { name: '浅色强调色' })
  await accentInput.fill('#12abef')
  await expect(accentInput).toHaveValue('#12ABEF')
  await page.getByRole('button', { name: '浅色强调色颜色选择器' }).click()
  await expect(page.locator('.appearance-color-palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByPlaceholder('ui-sans-serif, system-ui, sans-serif'),
  ).toBeVisible()
  await expect(
    page.getByPlaceholder('ui-monospace, SFMono-Regular, Consolas, monospace'),
  ).toBeVisible()

  await modeGroup.getByRole('radio', { name: '系统' }).click()
  await expect(page.locator('.appearance-theme-editor')).toHaveCount(2)
  await expect(
    page
      .locator('.appearance-settings > .settings-section')
      .last()
      .locator('.settings-row-title')
      .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim())),
  ).resolves.toEqual([
    '使用指针光标',
    '差异标记',
    '界面字号',
    '代码字号',
    '减少动态效果',
  ])

  const diffMarkerGroup = page.getByRole('group', { name: '差异标记选项' })
  const reduceMotionGroup = page.getByRole('group', {
    name: '减少动态效果选项',
  })
  await expect(diffMarkerGroup.getByRole('button')).toHaveCount(2)
  await expect(reduceMotionGroup.getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)

  const groupChrome = await diffMarkerGroup.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      paddingTop: style.paddingTop,
    }
  })
  expect(groupChrome).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopWidth: '0px',
    paddingTop: '0px',
  })

  const symbolButton = diffMarkerGroup.getByRole('button', { name: '+/-' })
  const colorButton = diffMarkerGroup.getByRole('button', { name: '颜色' })
  const motionOffButton = reduceMotionGroup.getByRole('button', {
    name: '关闭',
  })
  await symbolButton.click()
  await motionOffButton.click()
  await expect(symbolButton).toHaveAttribute('aria-pressed', 'true')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'classic')
  await expect(motionOffButton).toHaveAttribute('aria-pressed', 'true')
  await expect(
    motionOffButton.evaluate((button) => {
      const style = getComputedStyle(button)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: button.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingBlock: style.paddingBlock,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    borderRadius: '9999px',
    fontSize: '13px',
    height: 24,
    lineHeight: '18px',
    paddingBlock: '2px',
    paddingInline: '8px',
  })

  const pointerSwitch = page.getByRole('switch', { name: '使用指针光标' })
  await pointerSwitch.click()
  await expect(pointerSwitch).toBeChecked()
  await expect(
    pointerSwitch.evaluate((switchElement) => {
      const thumb = switchElement.querySelector<HTMLElement>('.toggle-knob')!
      const switchBounds = switchElement.getBoundingClientRect()
      const thumbBounds = thumb.getBoundingClientRect()
      const thumbColorProbe = document.createElement('span')
      thumbColorProbe.style.color = 'white'
      document.body.append(thumbColorProbe)
      const thumbColor = getComputedStyle(thumbColorProbe).color
      thumbColorProbe.remove()
      return {
        switchSize: [switchBounds.width, switchBounds.height],
        thumbSize: [thumbBounds.width, thumbBounds.height],
        thumbUsesWhite: getComputedStyle(thumb).backgroundColor === thumbColor,
      }
    }),
  ).resolves.toMatchObject({
    switchSize: [32, 20],
    thumbSize: [16, 16],
    thumbUsesWhite: true,
  })

  await colorButton.click()
  await expect(colorButton).toHaveAttribute('aria-pressed', 'true')
  await expect(previewDiff).toHaveAttribute('data-indicators', 'bars')

  const uiFontSizeInput = page.getByRole('spinbutton', { name: '界面字号' })
  await expect(
    uiFontSizeInput.evaluate((input) => {
      const style = getComputedStyle(input)
      const bounds = input.getBoundingClientRect()
      const unit = input.parentElement?.querySelector('span')
      const unitStyle = unit ? getComputedStyle(unit) : null
      const probe = document.createElement('span')
      probe.style.background = 'var(--color-token-input-background)'
      probe.style.color = 'var(--color-token-text-secondary)'
      document.body.append(probe)
      const probeStyle = getComputedStyle(probe)
      const matches = {
        background: style.backgroundColor === probeStyle.backgroundColor,
        unitColor: unitStyle?.color === probeStyle.color,
      }
      probe.remove()
      return {
        ...matches,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        gap: getComputedStyle(input.parentElement!).gap,
        height: bounds.height,
        lineHeight: style.lineHeight,
        textAlign: style.textAlign,
        width: bounds.width,
      }
    }),
  ).resolves.toEqual({
    background: true,
    borderRadius: '8px',
    fontSize: '12px',
    gap: '8px',
    height: 28,
    lineHeight: '18px',
    textAlign: 'right',
    unitColor: true,
    width: 64,
  })

  await page.reload()
  await closeTransientErrorToast(page)
  await expect(
    page
      .getByRole('group', { name: '减少动态效果选项' })
      .getByRole('button', { name: '关闭' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

for (const mode of MODES) {
  test(`appearance ${mode} diff preview matches the canonical review surface`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await closeTransientErrorToast(page)

    const variantLabel = mode === 'light' ? '浅色' : '深色'
    await page
      .getByRole('radiogroup', { name: '外观模式' })
      .getByRole('radio', { name: variantLabel })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('codepilotx.desktop.appearance.v6')
          return raw ? JSON.parse(raw).mode : null
        }),
      )
      .toBe(mode)

    const previewDiff = page
      .getByLabel(`${variantLabel}主题差异预览`)
      .locator('.review-codex-diff[data-diff-type="split"]')
    await expect(previewDiff).toHaveAttribute(
      'data-review-syntax-state',
      'ready',
      { timeout: 10_000 },
    )
    await expect(previewDiff.locator('.review-diff-word')).not.toHaveCount(0)
    const previewStyles = await readReviewDiffComputedStyles(previewDiff)

    await gotoWorkbenchFixture(
      page,
      '/?visualCase=review#/threads/visual-review',
    )
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
    await page.getByRole('button', { name: '显示右侧面板' }).click()
    const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
    await rightPanel.getByRole('button', { name: /^审阅/ }).click()
    const reviewDiff = rightPanel
      .getByLabel(
        'apps/desktop/renderer/test/codex-style-contracts.test.ts diff',
      )
      .locator('.review-codex-diff:not(.review-codex-diff--virtual)')
    await expect(reviewDiff).toHaveAttribute(
      'data-review-syntax-state',
      'ready',
      { timeout: 10_000 },
    )
    await expect(reviewDiff.locator('.review-diff-word')).not.toHaveCount(0)

    await expect(
      readReviewDiffComputedStyles(reviewDiff),
    ).resolves.toEqual(previewStyles)
  })
}

async function closeTransientErrorToast(
  page: Page,
  waitForMilliseconds = 0,
): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭错误提示' })
  const deadline = Date.now() + waitForMilliseconds
  do {
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => undefined)
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(100)
  } while (true)
}

async function gotoWorkbenchFixture(page: Page, route: string): Promise<void> {
  const ready = page.getByText('已完成工作台结构梳理。', { exact: true })
  const maximumAttempts = 5
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    await page.goto(route)
    try {
      await ready.waitFor({ state: 'visible', timeout: 7_500 })
      return
    } catch {
      if (attempt === maximumAttempts - 1) {
        await expect(ready).toBeVisible()
        return
      }
      await page.waitForTimeout(750)
    }
  }
}

async function waitForMaterialIcons(root: Page | Locator) {
  await expect
    .poll(() =>
      root.locator('[data-material-icon-ready="false"]').count(),
    )
    .toBe(0)
}

async function openAndAssertReviewSourceMenu(
  page: Page,
  rightPanel: Locator,
): Promise<Locator> {
  const trigger = rightPanel.getByRole('button', { name: '切换变更范围' })
  await expectCompactInteractiveRow(trigger, {
    borderRadius: '10px',
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })
  await trigger.click()
  const menu = page.locator('.popover-review-scope')
  await expect(menu).toBeVisible()
  await expect
    .poll(() =>
      trigger.evaluate(element => {
        const probe = document.createElement('span')
        probe.style.background =
          'var(--color-token-list-hover-background)'
        element.append(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return getComputedStyle(element).backgroundColor === expected
      }),
    )
    .toBe(true)
  await expect(menu.getByText('未提交', { exact: true })).toBeVisible()
  await expect(menu.locator('.review-source-menu-separator')).toHaveCount(2)
  expect(
    await menu
      .locator('[role="menuitem"], [role="menuitemradio"]')
      .allTextContents(),
  ).toEqual(['上一轮', '未暂存', '已暂存', '提交', '分支'])
  const menuRows = menu.locator(
    '.popover-item:visible, .popover-sub-trigger:visible',
  )
  const menuRowStyles = await menuRows.evaluateAll((rows) =>
    rows.map((row) => {
      const style = getComputedStyle(row)
      return {
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: row.getBoundingClientRect().height,
        lineHeight: style.lineHeight,
        paddingBlock: style.paddingBlock,
        paddingInline: style.paddingInline,
      }
    }),
  )
  expect(menuRowStyles.length).toBeGreaterThanOrEqual(4)
  expect(
    menuRowStyles.every(
      (row) =>
        row.borderRadius === '10px' &&
        row.fontSize === '12px' &&
        row.lineHeight === '17px' &&
        row.paddingBlock === '5px' &&
        row.paddingInline === '8px',
    ),
  ).toBe(true)
  expect(
    menuRowStyles.every((row) => Math.abs(row.height - 27) < 0.5),
  ).toBe(true)
  return menu
}

async function expectCompactInteractiveRow(
  row: Locator,
  expected: {
    borderRadius: string
    fontSize: string
    height: number
    lineHeight: string
    paddingInline: string
  },
): Promise<void> {
  const actual = await row.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      height: element.getBoundingClientRect().height,
      lineHeight: style.lineHeight,
      paddingInline: style.paddingInline,
    }
  })
  expect(actual.height).toBeCloseTo(expected.height, 0)
  expect({
    borderRadius: actual.borderRadius,
    fontSize: actual.fontSize,
    lineHeight: actual.lineHeight,
    paddingInline: actual.paddingInline,
  }).toEqual({
    borderRadius: expected.borderRadius,
    fontSize: expected.fontSize,
    lineHeight: expected.lineHeight,
    paddingInline: expected.paddingInline,
  })
}

async function expectCodexHoverBackground(row: Locator): Promise<void> {
  const expected = await row.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.background = 'var(--color-token-list-hover-background)'
    element.append(probe)
    const background = getComputedStyle(probe).backgroundColor
    probe.remove()
    return background
  })
  const before = await row.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  )
  await row.hover()
  await expect
    .poll(() =>
      row.evaluate((element) => getComputedStyle(element).backgroundColor),
    )
    .toBe(expected)
  expect(expected).not.toBe(before)
}

async function readReviewDiffComputedStyles(diff: Locator) {
  return diff.evaluate((root) => {
    const requireElement = (selector: string): Element => {
      const element = root.querySelector(selector)
      if (!element) {
        throw new Error(`Missing canonical review diff element: ${selector}`)
      }
      return element
    }
    const readBackground = (selector: string): string =>
      getComputedStyle(requireElement(selector)).backgroundColor
    const readColor = (selector: string): string =>
      getComputedStyle(requireElement(selector)).color
    const rootStyle = getComputedStyle(root)

    return {
      addedLineBackground: readBackground(
        '.review-codex-diff__line[data-line-type="change-addition"]',
      ),
      addedNumberColor: readColor(
        '.review-codex-diff__number[data-line-type="change-addition"]',
      ),
      addedWordBackground: readBackground(
        '.review-diff-word[data-tone="added"]',
      ),
      editorBackground: rootStyle.backgroundColor,
      editorForeground: rootStyle.color,
      fontFamily: rootStyle.fontFamily,
      fontSize: rootStyle.fontSize,
      lineHeight: rootStyle.lineHeight,
      removedLineBackground: readBackground(
        '.review-codex-diff__line[data-line-type="change-deletion"]',
      ),
      removedNumberColor: readColor(
        '.review-codex-diff__number[data-line-type="change-deletion"]',
      ),
      removedWordBackground: readBackground(
        '.review-diff-word[data-tone="removed"]',
      ),
    }
  })
}
