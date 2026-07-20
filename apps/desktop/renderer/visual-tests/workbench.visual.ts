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
    prepare: async (page) => {
      await page.getByRole('button', { name: '显示右侧面板' }).click()
      await expect(
        page.getByRole('complementary', { name: '右侧面板' }),
      ).toBeVisible()
      await page
        .getByRole('complementary', { name: '右侧面板' })
        .getByRole('button', { name: /^审阅/ })
        .click()
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
        if (viewport.width > 960) {
          await scenario.prepare?.(page)
        }
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
        await expect(page.locator('html')).toHaveAttribute(
          'data-code-theme-id',
          mode === 'light' ? 'codex-light' : 'codex-dark',
        )
        await closeTransientErrorToast(page, 3_000)
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
  test(`open file empty state ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 })
    await page.emulateMedia({
      colorScheme: mode,
      forcedColors: 'none',
      reducedMotion: 'reduce',
    })
    await page.goto('/?visualCase=rich#/sessions/visual-rich')
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
  await page.goto('/?visualCase=rich#/sessions/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
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
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/sessions/visual-rich')
  await closeTransientErrorToast(page)
  await expect(
    page.getByText('已完成工作台结构梳理。', { exact: true }),
  ).toBeVisible()

  const header = page.getByRole('toolbar', { name: '会话工具栏' })
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
  await expect(
    page.locator(
      '[role="tabpanel"][data-app-shell-tab-panel-controller="bottom"]',
    ),
  ).toBeFocused()
  const bottomPanel = await page
    .getByRole('complementary', { name: '底部面板' })
    .boundingBox()
  const workspace = await page.locator('.desktop-workspace').boundingBox()
  expect(bottomPanel!.x).toBeCloseTo(workspace!.x, 0)
  expect(bottomPanel!.width).toBeCloseTo(workspace!.width, 0)
  await expect(page.getByRole('tab', { name: /终端/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('button', { name: '移到底部面板' }).click()
  await expect(page.getByRole('tab', { name: /审查/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  const sessionMenuButton = page.getByRole('button', {
    name: '更多会话操作',
  })
  await sessionMenuButton.click()
  await expect(
    page.getByRole('menuitem', { name: /显示 workflow 事件/ }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sessionMenuButton).toBeFocused()
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
    await page.goto('/?visualCase=rich#/sessions/visual-rich')
    await closeTransientErrorToast(page)
    await expect(
      page.getByText('已完成工作台结构梳理。', { exact: true }),
    ).toBeVisible()

    const summary = page.locator('.thread-summary-panel')
    const summaryHeader = summary.locator('.thread-summary-section > header').first()
    await expect(summary).toBeVisible()
    await expect(summaryHeader).toBeVisible()

    const commandGroup = page.locator('.timeline-command-group-summary').first()
    await commandGroup.click()
    const commandRow = page.locator('.timeline-command-row').first()
    await commandRow.click()
    const commandShell = page.locator('.timeline-command-shell').first()
    await expect(commandShell).toBeVisible()

    const surfaces = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>('.thread-summary-panel')
      const header = panel?.querySelector<HTMLElement>(
        '.thread-summary-section > header',
      )
      const shell = document.querySelector<HTMLElement>('.timeline-command-shell')
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
        output: resolveBackground(shell, '--color-bg-soft'),
        panel: getComputedStyle(panel).backgroundColor,
        panelSurface: resolveBackground(panel, '--surface-panel'),
        raised: resolveBackground(panel, '--surface-raised'),
        shell: getComputedStyle(shell).backgroundColor,
      }
    })

    expect(surfaces).toEqual({
      header: surfaces?.raised,
      output: surfaces?.output,
      panel: surfaces?.raised,
      panelSurface: surfaces?.panelSurface,
      raised: surfaces?.raised,
      shell: surfaces?.output,
    })
    expect(surfaces?.shell).not.toBe(surfaces?.panelSurface)
  })
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
  await page.goto('/?visualCase=rich#/quick-chat')
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

test('turn navigation preview matches Codex geometry and output limits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.emulateMedia({
    colorScheme: 'dark',
    forcedColors: 'none',
    reducedMotion: 'no-preference',
  })
  await page.goto('/?visualCase=turn-nav#/sessions/visual-turn-nav')
  await closeTransientErrorToast(page)
  await expect(page.getByText('第 4 轮已完成。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消置顶摘要' }).click()

  const rail = page.getByRole('navigation', { name: '用户消息导航' })
  await expect(rail).toBeVisible()
  const items = rail.getByRole('button')
  await expect(items).toHaveCount(4)
  await expect(rail.locator('[aria-current="true"]')).toHaveCount(1)

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

test('narrow sidebar uses floating preview without drawer or backdrop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 800 })
  await page.goto('/?visualCase=empty#/quick-chat')
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
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
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
  await page.goto('/?visualCase=empty#/quick-chat')
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
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
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
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
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
  await page.goto('/?visualCase=empty#/settings?tab=appearance')
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
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem('codepilotx.desktop.appearance.v3'),
      ),
    )
    .toContain('"dracula"')

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

test('settings shell search and appearance source contracts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=empty#/settings?tab=general')
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

  await page.goto('/?visualCase=empty#/settings?tab=config')
  const sandboxDropdown = page.getByRole('combobox', { name: '沙盒设置' })
  await sandboxDropdown.click()
  const sandboxMenu = page.getByRole('listbox')
  await expect(sandboxMenu).toBeVisible()
  await expect(
    sandboxMenu.evaluate((menu) => {
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
  await page.goto('/?visualCase=empty#/settings?tab=general')
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
  await expect(
    page
      .getByRole('button', { name: '导入' })
      .evaluate((button) => getComputedStyle(button).fontSize),
  ).resolves.toBe('14px')
  await expect(
    page
      .getByRole('button', { name: '复制主题' })
      .evaluate((button) => getComputedStyle(button).fontSize),
  ).resolves.toBe('14px')
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
      await closeButton.click()
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(100)
  } while (true)
}
