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
    await expect(rightPanel.getByRole('textbox', { name: '筛选文件' })).toBeFocused()
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
    .toBeCloseTo(bottomPanel!.height, 0)
  const bottomResizeGuide = page.locator(
    'body > .workbench-resize-guide--bottom',
  )
  await expect(bottomResizeGuide).toBeVisible()
  await expect(
    bottomPanelElement.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  await expect(
    bottomPanelElement.locator('[data-resize-skeleton-active]'),
  ).toHaveCount(0)
  await expect(
    bottomPanelElement.locator('.workbench-panel-header'),
  ).toHaveCSS('filter', 'none')
  const bottomResizeGuideBox = await bottomResizeGuide.boundingBox()
  expect(bottomResizeGuideBox).not.toBeNull()
  expect(bottomResizeGuideBox!.y).toBeCloseTo(
    bottomSeparatorBox!.y - 80,
    0,
  )
  const bottomPointerUpStartedAt = Date.now()
  await page.mouse.up()
  expect(Date.now() - bottomPointerUpStartedAt).toBeLessThan(200)
  await expect
    .poll(async () => (await bottomPanelElement.boundingBox())?.height)
    .toBeGreaterThan(bottomPanel!.height)
  await expect(bottomResizeGuide).toBeHidden()
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
  await page.getByRole('menuitem', { name: '禁用文字差异' }).click()
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
  const reviewDiffContent = reviewDiffPreview.locator(
    ':scope > [data-resize-skeleton-content]',
  )
  const reviewDiffSkeleton = reviewDiffPreview.locator(
    ':scope > [data-resize-skeleton-overlay]',
  )
  const reviewFileTreeContent = reviewFileTree.locator(
    ':scope > [data-resize-skeleton-content]',
  )
  const reviewFileTreeSkeleton = reviewFileTree.locator(
    ':scope > [data-resize-skeleton-overlay]',
  )
  await expect(reviewDiffSkeleton).toBeHidden()
  await expect(reviewFileTreeSkeleton).toBeHidden()
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
  await rightSeparator.dblclick()
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
  const pointerMoveDurations: number[] = []
  for (let step = 1; step <= 60; step += 1) {
    const pointerMoveStartedAt = Date.now()
    await page.mouse.move(
      separatorBox!.x - (96 * step) / 60,
      separatorBox!.y + 40,
    )
    pointerMoveDurations.push(Date.now() - pointerMoveStartedAt)
  }
  const sortedPointerMoveDurations = [...pointerMoveDurations].sort(
    (left, right) => left - right,
  )
  expect(
    sortedPointerMoveDurations[
      Math.floor(sortedPointerMoveDurations.length * 0.95)
    ],
  ).toBeLessThan(80)
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  const rightResizeGuide = page.locator(
    'body > .workbench-resize-guide--right',
  )
  await expect(rightResizeGuide).toBeVisible()
  await expect(reviewDiffPreview).toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(reviewDiffSkeleton).toBeVisible()
  await expect(reviewDiffContent).toHaveCSS('visibility', 'hidden')
  await expect(reviewFileTree).not.toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(reviewFileTreeContent).toHaveCSS('visibility', 'visible')
  await expect(reviewFileTreeSkeleton).toBeHidden()
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')
  await expect(rightPanel.locator('.workbench-panel-header')).toHaveCSS(
    'filter',
    'none',
  )
  const rightResizeGuideBox = await rightResizeGuide.boundingBox()
  expect(rightResizeGuideBox).not.toBeNull()
  expect(rightResizeGuideBox!.x).toBeCloseTo(separatorBox!.x - 96, 0)
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeGreaterThan(resetWidth!)
  await expect(rightResizeGuide).toBeHidden()
  await expect(reviewDiffPreview).not.toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(reviewDiffSkeleton).toBeHidden()
  await expect(reviewDiffContent).toHaveCSS('visibility', 'visible')
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
    await expect(rightResizeGuide).toBeVisible()
    await expect(reviewDiffPreview).toHaveAttribute(
      'data-resize-skeleton-active',
      '',
    )
    await expect(reviewDiffSkeleton).toBeVisible()
    await expect(reviewDiffContent).toHaveCSS('visibility', 'hidden')
  }
  await beginCancelledResize()
  await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent('pointercancel'))
  })
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect(rightResizeGuide).toBeHidden()
  await expect(reviewDiffSkeleton).toBeHidden()
  await expect(reviewDiffContent).toHaveCSS('visibility', 'visible')
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')

  await beginCancelledResize()
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await expect
    .poll(async () => (await rightPanel.boundingBox())?.width)
    .toBeCloseTo(resetWidth!, 0)
  await expect(rightResizeGuide).toBeHidden()
  await expect(reviewDiffSkeleton).toBeHidden()
  await expect(reviewDiffContent).toHaveCSS('visibility', 'visible')
  await expect(
    rightPanel.locator('.workbench-panel-content'),
  ).toHaveCSS('filter', 'none')

  const fileTreeSeparator = rightPanel.getByRole('separator', {
    name: '调整审查文件导航宽度',
  })
  const fileTreePreview = rightPanel.locator(
    '.review-file-tree-resize-preview',
  )
  const initialFileTreeWidth = (await reviewFileTree.boundingBox())?.width
  const fileTreeSeparatorBox = await fileTreeSeparator.boundingBox()
  expect(initialFileTreeWidth).toBeGreaterThan(239)
  expect(fileTreeSeparatorBox).not.toBeNull()
  await page.mouse.move(
    fileTreeSeparatorBox!.x + fileTreeSeparatorBox!.width / 2,
    fileTreeSeparatorBox!.y + fileTreeSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  const fileTreePointerMoveDurations: number[] = []
  for (let step = 1; step <= 60; step += 1) {
    const pointerMoveStartedAt = Date.now()
    await page.mouse.move(
      fileTreeSeparatorBox!.x - (72 * step) / 60,
      fileTreeSeparatorBox!.y + 36,
    )
    fileTreePointerMoveDurations.push(Date.now() - pointerMoveStartedAt)
  }
  const sortedFileTreePointerMoveDurations = [
    ...fileTreePointerMoveDurations,
  ].sort((left, right) => left - right)
  expect(
    sortedFileTreePointerMoveDurations[
      Math.floor(sortedFileTreePointerMoveDurations.length * 0.95)
    ],
  ).toBeLessThan(80)
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(initialFileTreeWidth!, 0)
  await expect(reviewFileTree).toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(reviewFileTreeSkeleton).toBeVisible()
  await expect(reviewFileTreeContent).toHaveCSS('visibility', 'hidden')
  await expect(reviewDiffPreview).not.toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(reviewDiffContent).toHaveCSS('visibility', 'visible')
  await expect(fileTreePreview).toBeVisible()
  const fileTreePreviewBox = await fileTreePreview.boundingBox()
  expect(fileTreePreviewBox).not.toBeNull()
  expect(fileTreePreviewBox!.x).toBeCloseTo(fileTreeSeparatorBox!.x - 72, 0)
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeGreaterThan(initialFileTreeWidth!)
  await expect(fileTreePreview).toBeHidden()
  await expect(reviewFileTreeSkeleton).toBeHidden()
  await expect(reviewFileTreeContent).toHaveCSS('visibility', 'visible')

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
  await expect(reviewFileTreeSkeleton).toBeVisible()
  await fileTreeSeparator.dispatchEvent('pointercancel', { pointerId: 1 })
  await page.mouse.up()
  await expect
    .poll(async () => (await reviewFileTree.boundingBox())?.width)
    .toBeCloseTo(cancelledFileTreeWidth!, 0)
  await expect(fileTreePreview).toBeHidden()
  await expect(reviewFileTreeSkeleton).toBeHidden()
  await expect(reviewFileTreeContent).toHaveCSS('visibility', 'visible')

  const shrinkSeparatorBox = await rightSeparator.boundingBox()
  expect(shrinkSeparatorBox).not.toBeNull()
  await page.mouse.move(
    shrinkSeparatorBox!.x + shrinkSeparatorBox!.width / 2,
    shrinkSeparatorBox!.y + shrinkSeparatorBox!.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(shrinkSeparatorBox!.x + 64, shrinkSeparatorBox!.y + 30)
  const shrinkGuideBox = await rightResizeGuide.boundingBox()
  expect(shrinkGuideBox).not.toBeNull()
  expect(shrinkGuideBox!.x).toBeCloseTo(shrinkSeparatorBox!.x + 64, 0)
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

test('Review uses the same targeted skeleton when moved to the bottom panel', async ({
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
  const bottomReviewDiffSkeleton = bottomReviewDiff.locator(
    ':scope > [data-resize-skeleton-overlay]',
  )
  const bottomReviewDiffContent = bottomReviewDiff.locator(
    ':scope > [data-resize-skeleton-content]',
  )
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
  await expect(bottomReviewDiff).toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect(bottomReviewDiffSkeleton).toBeVisible()
  await expect(bottomReviewDiffContent).toHaveCSS('visibility', 'hidden')
  await expect(bottomReviewFileTree).not.toHaveAttribute(
    'data-resize-skeleton-active',
    '',
  )
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeCloseTo(bottomHeight!, 0)
  await page.mouse.up()
  await expect
    .poll(async () => (await bottomPanel.boundingBox())?.height)
    .toBeGreaterThan(bottomHeight!)
  await expect(bottomReviewDiffSkeleton).toBeHidden()
  await expect(bottomReviewDiffContent).toHaveCSS('visibility', 'visible')
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
      page.getByText('我们该做什么？', { exact: true }),
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

  await page.getByTitle('展开侧边栏').click()
  await expect(sidebar).toHaveClass(/is-docked/)
  await page.setViewportSize({ width: 900, height: 800 })
  await expect(sidebar).toHaveClass(/is-docked/)
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
  await expect(page.getByRole('searchbox', { name: '搜索设置' })).toBeVisible()

  await page.keyboard.press('Control+b')
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.getByRole('searchbox', { name: '搜索设置' })).toBeVisible()

  await page.mouse.move(600, 400)
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.setViewportSize({ width: 720, height: 800 })
  await expect(sidebar).toHaveClass(/is-collapsed/)
  await page.mouse.move(6, 400)
  await expect(sidebar).toHaveClass(/is-preview/)
  await expect(page.locator('.sidebar-drawer-backdrop')).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: '搜索设置' })).toBeVisible()
})

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
    page.getByRole('textbox', { name: '搜索代码主题…' }),
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
      probe.style.background =
        'color-mix(in oklab, var(--color-text-strong) 2.5%, transparent)'
      probe.style.color = 'var(--color-text-strong)'
      document.body.append(probe)
      const expectedBackgroundColor = getComputedStyle(probe).backgroundColor
      const expectedForeground = getComputedStyle(probe).color
      probe.remove()
      return {
        backgroundMatchesFog: style.backgroundColor === expectedBackgroundColor,
        borderRadius: style.borderRadius,
        colorMatchesForeground: style.color === expectedForeground,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundMatchesFog: true,
    borderRadius: '8px',
    colorMatchesForeground: true,
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '12px',
  })

  const languageDropdown = page.getByRole('combobox', { name: '语言' })
  await languageDropdown.click()
  const languageMenu = page.getByRole('listbox')
  await expect(languageMenu).toBeVisible()
  await expect(
    languageMenu.evaluate((menu) => {
      const style = getComputedStyle(menu)
      const bounds = menu.getBoundingClientRect()
      const firstItem = menu.querySelector<HTMLElement>(
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
        width: bounds.width,
      }
    }),
  ).resolves.toEqual({
    backdropFilter: 'blur(8px)',
    borderRadius: '12px',
    itemFontSize: '12px',
    itemHeight: 28,
    itemLineHeight: '18px',
    padding: '4px',
    width: 240,
  })
  await expect(page.getByRole('textbox', { name: '搜索语言' })).toBeVisible()
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
      foregroundProbe.style.color = 'var(--color-text-strong)'
      const secondaryProbe = document.createElement('span')
      secondaryProbe.style.color = 'var(--color-text-meta)'
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
      const probe = document.createElement('span')
      probe.style.background =
        'color-mix(in srgb, var(--color-text-strong) 5%, transparent)'
      document.body.append(probe)
      const expectedBackgroundColor = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        backgroundMatchesForegroundFivePercent:
          style.backgroundColor === expectedBackgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
        height: bounds.height,
        lineHeight: style.lineHeight,
        paddingInline: style.paddingInline,
      }
    }),
  ).resolves.toEqual({
    backgroundMatchesForegroundFivePercent: true,
    borderColor: 'rgba(0, 0, 0, 0)',
    borderRadius: '8px',
    fontSize: '14px',
    height: 28,
    lineHeight: '18px',
    paddingInline: '8px',
  })

  await page.keyboard.press('Control+f')
  const search = page.getByRole('searchbox', { name: '搜索设置' })
  await expect(search).toBeFocused()
  await search.fill('对比度')
  await expect(page.getByRole('option', { name: /对比度.*外观/ })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/tab=appearance/)
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
  await expect(preview).toHaveAttribute('data-diff-style', 'split')
  await expect(preview).toHaveAttribute('data-line-diff-type', 'none')
  await expect(preview).toHaveAttribute('data-hunk-separators', 'line-info')
  await expect(preview).toHaveAttribute('data-expansion-line-count', '8')
  await expect(preview.locator('.appearance-diff-side')).toHaveCount(2)

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
    galleryMaxWidth: '512px',
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
    page.getByRole('textbox', { name: '搜索代码主题…' }),
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
  const motionOffButton = reduceMotionGroup.getByRole('button', {
    name: '关闭',
  })
  await symbolButton.click()
  await motionOffButton.click()
  await expect(symbolButton).toHaveAttribute('aria-pressed', 'true')
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
    fontSize: '12px',
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
      const foregroundProbe = document.createElement('span')
      foregroundProbe.style.color = 'var(--color-text-strong)'
      document.body.append(foregroundProbe)
      const foreground = getComputedStyle(foregroundProbe).color
      foregroundProbe.remove()
      return {
        switchSize: [switchBounds.width, switchBounds.height],
        thumbSize: [thumbBounds.width, thumbBounds.height],
        thumbUsesForeground:
          getComputedStyle(thumb).backgroundColor === foreground,
      }
    }),
  ).resolves.toMatchObject({
    switchSize: [32, 20],
    thumbSize: [16, 16],
    thumbUsesForeground: true,
  })

  const uiFontSizeInput = page.getByRole('spinbutton', { name: '界面字号' })
  await expect(
    uiFontSizeInput.evaluate((input) => {
      const style = getComputedStyle(input)
      const bounds = input.getBoundingClientRect()
      const unit = input.parentElement?.querySelector('span')
      const unitStyle = unit ? getComputedStyle(unit) : null
      const probe = document.createElement('span')
      probe.style.background = 'var(--color-background-control)'
      probe.style.color = 'var(--color-text-foreground-secondary)'
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
  await rightPanel.getByRole('button', { name: '切换变更范围' }).click()
  const menu = page.locator('.popover-review-scope')
  await expect(menu).toBeVisible()
  await expect(menu.getByText('未提交', { exact: true })).toBeVisible()
  await expect(menu.locator('.review-source-menu-separator')).toHaveCount(2)
  expect(
    await menu.getByRole('menuitem').allTextContents(),
  ).toEqual(['上一轮', '未暂存', '已暂存', '提交', '分支'])
  return menu
}
