import { describe, expect, test } from 'bun:test'
import { expectSourceContains, expectSourceNotContains } from './source-contract.js'

describe('Codex CPX design system token contract', () => {
  test('guards interaction semantics and visual ownership without broad exceptions', async () => {
    const [checker, manifestText] = await Promise.all([
      Bun.file(new URL('../scripts/check-style-contracts.ts', import.meta.url)).text(),
      Bun.file(new URL('../style-contracts.json', import.meta.url)).text(),
    ])
    const manifest = JSON.parse(manifestText) as {
      interactionContract: { interactiveRowAllowedFiles: string[] }
    }

    expect(manifest.interactionContract.interactiveRowAllowedFiles).toEqual([
      'src/components/ui/DropdownActions.tsx',
      'src/components/ui/PopoverItem.tsx',
      'src/components/ui/SearchablePopoverContent.tsx',
      'src/features/session/summary/ThreadSummaryPanel.tsx',
    ])
    expect(checker).toContain('feature styles must not target .ui-button')
    expect(checker).toContain('legacy interactive-row escape modifier is forbidden')
    expect(checker).toContain('Button must not represent persistent pressed/selected state')
    expect(checker).toContain('Popover radio-group trigger must not use Button')
    expect(checker).toContain('stale interactive-row allowed file')
  })

  test('governs feature colors through precise, stale-detectable exceptions', async () => {
    const [checker, manifestText, guidance] = await Promise.all([
      Bun.file(new URL('../scripts/check-style-contracts.ts', import.meta.url)).text(),
      Bun.file(new URL('../style-contracts.json', import.meta.url)).text(),
      Bun.file(new URL('../../../../docs/design/renderer-color-system.md', import.meta.url)).text(),
    ])
    const manifest = JSON.parse(manifestText) as {
      featureColorContract: {
        roots: string[]
        componentTokenExceptions: Array<{ file: string; token: string; reason: string }>
        literalColorExceptions: Array<{ file: string; value: string; reason: string }>
        colorMixExceptions: Array<{ file: string; localProperty: string; reason: string }>
      }
    }

    expect(manifest.featureColorContract.roots).toEqual(['src/styles/features', 'src/styles/lazy'])
    for (const exception of [
      ...manifest.featureColorContract.componentTokenExceptions,
      ...manifest.featureColorContract.literalColorExceptions,
      ...manifest.featureColorContract.colorMixExceptions,
    ]) {
      expect(exception.file).not.toContain('*')
      expect(exception.reason.length).toBeGreaterThan(15)
    }
    expect(checker).toContain('feature styles must use system semantic colors')
    expect(checker).toContain('feature styles must not use literal color')
    expect(checker).toContain('feature color-mix must not combine multiple semantic/local colors')
    expect(checker).toContain('stale feature component-token exception')
    expect(checker).toContain('stale feature literal-color exception')
    expect(checker).toContain('stale feature color-mix exception')
    expect(guidance).toContain('系统语义颜色')
    expect(guidance).toContain('组件私有实现')
    expect(guidance).toContain('Agent 选择流程')
  })

  test('exports component tokens for all 13 components', async () => {
    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
    ).text()
    const tokens = Array.from(
      stylesheet.matchAll(/^\s*(--cpx-comp-[\w-]+):/gm),
      (match) => match[1],
    )

    expect(tokens.length).toBeGreaterThan(50)
    expect(tokens).toContain('--cpx-comp-dropdown-trigger-bg')
    expect(tokens).toContain('--cpx-comp-dropdown-menu-bg')
    expect(tokens).toContain('--cpx-comp-dropdown-item-hover-bg')
    expect(tokens).toContain('--cpx-comp-button-bg')
    expect(tokens).toContain('--cpx-comp-button-primary-bg')
    expect(tokens).toContain('--cpx-comp-input-bg')
    expect(tokens).toContain('--cpx-comp-input-border')
    expect(tokens).toContain('--cpx-comp-sidebar-bg')
    expect(tokens).toContain('--cpx-comp-dock-bg')
    expect(tokens).toContain('--cpx-comp-terminal-bg')
    expect(tokens).toContain('--cpx-comp-diff-inserted-line-bg')
  })

  test('maps Dropdown states and searchable gutters through shared contracts', async () => {
    const [tokens, popover, rows, select, searchablePopover, projectSwitcher, branchSwitcher] =
      await Promise.all([
        Bun.file(
          new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
        ).text(),
        Bun.file(new URL('../src/styles/popover.css', import.meta.url)).text(),
        Bun.file(new URL('../src/styles/components/interactive-row.css', import.meta.url)).text(),
        Bun.file(new URL('../src/components/ui/Select.tsx', import.meta.url)).text(),
        Bun.file(new URL('../src/components/ui/SearchablePopoverContent.tsx', import.meta.url)).text(),
        Bun.file(
          new URL('../src/features/session/composer/ProjectSwitcherPopover.tsx', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/features/session/composer/BranchSelectPopover.tsx', import.meta.url),
        ).text(),
      ])

    expectSourceContains(
      tokens,
      '--cpx-comp-dropdown-menu-border: var(--cpx-sys-color-border-default)',
    )
    expectSourceContains(tokens, '--cpx-comp-dropdown-item-pressed-bg: var(--cpx-sys-color-active)')
    expectSourceContains(popover, ".popover-surface[data-theme-component='dropdown-surface']")
    expectSourceContains(popover, '--cpx-comp-row-hover-bg: var(--cpx-comp-dropdown-item-hover-bg)')
    expectSourceContains(rows, '--cpx-comp-row-selected-bg, var(--cpx-sys-color-selected)')
    expectSourceContains(rows, '.popover-item[aria-selected="true"]')
    expectSourceContains(rows, '.settings-dropdown-item:has(.settings-dropdown-item-indicator)')
    expectSourceContains(rows, '.permission-select-item:has(.permission-select-item-indicator)')
    expectSourceContains(rows, '--cpx-comp-row-bg, transparent')
    expectSourceContains(rows, '--cpx-comp-row-hover-bg')
    expectSourceContains(rows, '--cpx-comp-row-pressed-bg')
    expectSourceContains(
      rows,
      '.settings-dropdown-item[data-state="checked"]:has(.settings-dropdown-item-indicator)',
    )
    expectSourceContains(
      rows,
      '.permission-select-item[data-state="checked"]:has(.permission-select-item-indicator)',
    )
    expectSourceContains(
      rows,
      '):where([data-highlighted]:not(:hover):not(:focus-visible):not(:active))',
    )
    expectSourceContains(select, 'data-highlighted={activeIndex === index || undefined}')
    expectSourceNotContains(select, 'data-state=')
    // The searchable gutter moved from popover.scss into the component it
    // belongs to; `tw:p-1` is the shared 4px menu surface padding.
    expectSourceContains(searchablePopover, 'className="popover-search-region tw:flex-none tw:bg-transparent tw:p-1"')
    expectSourceNotContains(projectSwitcher, 'listClassName="popover-section"')
    expectSourceContains(branchSwitcher, 'listClassName="branch-popover-list-scroll"')
    expectSourceNotContains(branchSwitcher, 'branch-popover-list-scroll popover-section')
  })

  test('keeps the permission Select on shared rich-menu geometry', async () => {
    const [rows, composerControls] = await Promise.all([
      Bun.file(new URL('../src/styles/components/interactive-row.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-controls.css', import.meta.url)).text(),
    ])

    expect(rows).toMatch(
      /\.interactive-row--rich,[\s\S]*?\.permission-select-item\s*\{[\s\S]*?--interactive-row-current-min-height:/,
    )
    expect(rows).toMatch(
      /\.permission-select-scroll-content\s*\{[\s\S]*?gap: var\(--cpx-comp-row-gap-y\);/,
    )
    expect(composerControls).not.toMatch(/\.permission-select-item-icon\s*\{[^}]*padding-right:/)
    expect(composerControls).not.toMatch(/\.permission-select-item-body\s*\{[^}]*padding-right:/)
  })

  test('keeps diff backgrounds separate from raw decoration colors', async () => {
    const stylesheet = await Bun.file(
      new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
    ).text()

    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-inserted-line-bg: var(--cpx-sys-color-diff-added-line)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-inserted-text-bg: var(--cpx-sys-color-diff-added-text)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-removed-line-bg: var(--cpx-sys-color-diff-removed-line)',
    )
    expectSourceContains(
      stylesheet,
      '--cpx-comp-diff-removed-text-bg: var(--cpx-sys-color-diff-removed-text)',
    )
  })

  test('does not reintroduce removed theme compatibility aliases', async () => {
    const sources = await Promise.all(
      ['../src/features/theme/themeVariables.ts', '../src/styles/design-system/tokens.css'].map(
        (path) => Bun.file(new URL(path, import.meta.url)).text(),
      ),
    )
    const removedAliasPattern =
      /--(?:color-bg(?:-[\w-]+)?|surface-[\w-]+|state-[\w-]+|border-(?:subtle|muted|control|strong)|color-text(?:-(?:strong|meta|soft|mute|muted|placeholder|disabled|on-accent))?)(?=['"]?\s*:)/

    for (const source of sources) {
      expect(source.match(removedAliasPattern)).toBeNull()
    }
  })

  test('keeps primary/secondary buttons distinct and settings rows height-free', async () => {
    const [buttons, settings, settingsRow, tokens] = await Promise.all([
      Bun.file(new URL('../src/components/ui/Button.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/settings/SettingsRow.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
    ])

    // primary：foreground 实底、反色文字；secondary：5% 弱背景、透明边框。
    expectSourceContains(
      buttons,
      'tw:border-app-border-strong tw:bg-app-primary-action tw:text-app-primary-action-foreground',
    )
    expectSourceContains(tokens, '--cpx-comp-button-primary-bg: var(--cpx-sys-color-fg-primary);')
    expectSourceContains(
      tokens,
      '--cpx-comp-button-primary-fg: var(--cpx-sys-color-surface-canvas);',
    )
    expectSourceContains(
      buttons,
      'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_5%,transparent)]',
    )
    expectSourceContains(buttons, 'tw:border-transparent tw:text-app-text')
    // 设置行不再锁死 64px：行本身不携带固定高度，高度由 12px 块级内边距
    // 驱动（compact 档 8px）；`+` 兄弟行的 0.5px 分隔线仍是共享几何。
    expect(settings).not.toMatch(/\.settings-row\s*\{[\s\S]*?min-height: 64px;/)
    expectSourceContains(settingsRow, "size === 'compact' ? 'tw:py-2' : 'tw:py-3'")
    expect(settingsRow).not.toMatch(/tw:(?:h|min-h)-/)
    expect(settings).toMatch(/\.settings-row \+ \.settings-row[\s\S]*?height: 0\.5px;/)
  })

  test('keeps settings navigation and responsive rows on one alignment contract', async () => {
    const [sidebar, settings, navigation] = await Promise.all([
      Bun.file(new URL('../src/styles/primitives/sidebar.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/settings/SettingsNav.tsx', import.meta.url)).text(),
    ])

    // 设置导航与侧栏共用 8px 内边距契约：导航滚动区从该共享变量取
    // padding-inline，不再有独立的 settings-nav gutter 变量。
    expectSourceContains(sidebar, '--sidebar-inline-gutter: var(--cpx-sys-space-2);')
    expect(sidebar).toMatch(
      /\.settings-nav-scroll-content\s*\{[\s\S]*?padding-inline: var\(--sidebar-inline-gutter\);/,
    )
    expect(settings).toMatch(
      /@container \(max-width: 42rem\)[\s\S]*?\.settings-management-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
    )
    expect(settings).not.toMatch(/@media \(max-width: 900px\)[\s\S]*?\.settings-row\s*\{/)
    // `_settings-billing.scss` 已随迁移删除；用量页不再拥有行级样式，设置行的
    // 唯一几何来源是 `SettingsRow.tsx` + 共享分隔线。这里改为对合并后的
    // `primitives/settings.css` 做同一「不得新增裸行/控制区覆盖」检查。
    expect(settings).not.toMatch(/(?:^|[\r\n])\s*\.settings-row,\s*$/m)
    expect(settings).not.toMatch(/(?:^|[\r\n])\s*\.settings-row-control\s*\{/m)
    // 迁移后内边距/间距由 TSX utility 承担：导航滚动区 = space-2 内边距 +
    // space-4 分组间距（原 `--settings-nav-inline-gutter` 语义）。
    const navScrollClass =
      navigation.match(/contentClassName="(settings-nav-scroll-content [^"]*)"/)?.[1] ?? ''
    expect(navScrollClass).toContain('tw:px-2')
    expect(navScrollClass).toContain('tw:gap-4')
  })

  test('keeps provider and extension management on shared settings geometry', async () => {
    const [
      settings,
      providerCatalog,
      plugins,
      extensionRow,
      skillDialog,
      mcpDialog,
      pluginDialog,
    ] = await Promise.all([
      Bun.file(new URL('../src/styles/primitives/settings.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/models/ProviderCatalog.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/settings/plugins/PluginsSettingsPage.tsx', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/features/settings/plugins/ExtensionManagementRow.tsx', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/features/settings/plugins/SkillDetailsDialog.tsx', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/features/settings/plugins/McpEditorDialog.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/features/plugins/PluginDetailsDialog.tsx', import.meta.url)).text(),
    ])

    expectSourceContains(settings, '.settings-management-list')
    expectSourceContains(settings, '.settings-management-dialog-row')
    expectSourceContains(providerCatalog, 'settings-management-list')
    expectSourceContains(extensionRow, 'settings-management-row')
    // 供应商目录不再用 auto-fill 卡片网格，改走共享管理列表几何。
    expectSourceNotContains(providerCatalog, 'repeat(auto-fill')
    expectSourceContains(plugins, 'settings-content-inner plugins-settings-content')
    expect(plugins).not.toMatch(/tw:(?:max-w-\[60rem\]|px-8|py-16)/)
    for (const dialog of [skillDialog, mcpDialog]) {
      expectSourceNotContains(dialog, 'tw:rounded-3xl')
      expect(dialog).not.toMatch(/Dialog\.Content[\s\S]{0,300}permission-modal(?:\s|")/)
    }
    // `.plugin-details-dialog` 复用共享弹窗表面（`ui-dialog-surface` /
    // `settings-management-dialog`）：自身的 utility 列表不得出现边框、背景、
    // 圆角或阴影，等价于原 marketplace.scss 的规则块检查。
    const pluginDialogSurface =
      pluginDialog.match(/settings-management-dialog plugin-details-dialog ([^'"\n]*)/)?.[1] ?? ''
    expect(pluginDialogSurface.length).toBeGreaterThan(0)
    expect(pluginDialogSurface).not.toMatch(/tw:(?:border(?:-|\s|$)|rounded|shadow|bg-)/)
  })

  test('keeps primary routes and workbench panels on their shared alignment axes', async () => {
    const [automationView, pets, pullRequests, setup, review, browser] = await Promise.all([
      Bun.file(new URL('../src/features/automation/AutomationView.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/features/pet/PetCatalogPage.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/pull-requests/PullRequestsPlaceholder.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/features/models/setup/ModelSetupPage.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/review/workspace/WorkspaceReviewSidebar.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/features/browser/DesktopBrowserPanel.tsx', import.meta.url)).text(),
    ])

    // 自动化页只通过共享 PrimaryPageLayout 渲染，不再覆盖其内部结构类名。
    expectSourceContains(automationView, '<PrimaryPageLayout')
    expect(automationView).not.toMatch(/primary-page-layout__(?:header|body)/)
    expectSourceContains(pets, '<PrimaryPageLayout')
    expectSourceContains(pullRequests, '<PrimaryPageLayout')
    // 模型引导页的两行网格改由 TSX utility 承担（原 `_model-setup.scss` 规则）。
    expectSourceContains(setup, 'tw:grid-rows-[36px_minmax(0,1fr)]')
    expectSourceContains(review, 'tw:px-4 tw:py-1')
    // 状态行保留语义类名与 alert 角色，迁移只在其上追加 utility。
    expect(browser).toMatch(/className="browser-status-row[^"]*"[\s\S]*?role="alert"/)
  })

  test('keeps prominent elevation distinct from flat and transient surfaces', async () => {
    const [systemTokens, componentTokens, cards, composer, summary, rightDock] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/components/card.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-shell.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-shadow-prominent:/g)).toHaveLength(1)
    expectSourceContains(
      systemTokens,
      '--cpx-sys-shadow-raised: inset 0 1px 0 rgba(255, 255, 255, 0.7);',
    )
    expectSourceContains(
      componentTokens,
      '--cpx-comp-composer-shadow: var(--cpx-sys-shadow-prominent);',
    )
    expect(cards).toMatch(/\.composer\s*\{[\s\S]*?box-shadow: var\(--cpx-comp-composer-shadow\);/)
    expectSourceNotContains(composer, 'box-shadow: var(--cpx-sys-shadow-floating)')
    expect(summary).toMatch(
      /\.thread-summary-panel\s*\{[\s\S]*?box-shadow: var\(--cpx-sys-shadow-prominent\);/,
    )
    expect(summary).toMatch(
      /\.thread-summary-popover \.thread-summary-panel,[\s\S]*?box-shadow: none;/,
    )
    expectSourceNotContains(rightDock, '--cpx-sys-shadow-prominent')
  })

  test('keeps high-frequency motion immediate and CSS/Motion timings aligned', async () => {
    const [systemTokens, motionTransitions] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/motion/motionTransitions.ts', import.meta.url)).text(),
    ])

    for (const [role, duration] of [
      ['instant', '0ms'],
      ['feedback', '160ms'],
      ['exit', '160ms'],
      ['state', '160ms'],
      ['enter', '160ms'],
      ['panel', '220ms'],
      ['loading', '900ms'],
    ]) {
      expectSourceContains(systemTokens, `--cpx-sys-motion-${role}: ${duration};`)
    }

    expectSourceContains(motionTransitions, 'duration: 0.16,')
    expect(motionTransitions.match(/duration: 0\.16,/g)).toHaveLength(4)
    expectSourceContains(motionTransitions, 'duration: 0.22,')
    expectSourceContains(motionTransitions, "duration: 0.9,\n  ease: 'linear'")
  })

  test('keeps the radius scale optical correction and roles canonical', async () => {
    const [
      systemTokens,
      componentTokens,
      tailwind,
      buttons,
      composer,
      conversation,
      summary,
      cards,
      rightDock,
    ] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/tailwind.css', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/Button.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/composer-shell.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/primitives/conversation.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/components/card.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-radius-optical-scale:/g)).toHaveLength(1)
    expect(systemTokens.match(/--cpx-sys-corner-shape:/g)).toHaveLength(1)
    expectSourceContains(systemTokens, '--cpx-sys-radius-optical-scale: 1;')
    expectSourceNotContains(systemTokens, '--cpx-sys-radius-optical-scale: 1.25;')
    expectSourceContains(systemTokens, '--cpx-sys-corner-shape: round;')
    expectSourceNotContains(systemTokens, '--cpx-sys-corner-shape: superellipse(1.5);')
    const expectedSizes: Record<string, string> = {
      '2xs': '5px',
      xs: '5px',
      sm: '8px',
      md: '10px',
      lg: '14px',
      xl: '18px',
      '2xl': '18px',
      '3xl': '24px',
      '4xl': '24px',
      full: '9999px',
    }
    for (const [size, value] of Object.entries(expectedSizes)) {
      expect(systemTokens.match(new RegExp(`--cpx-sys-radius-${size}:`, 'g'))).toHaveLength(1)
      expectSourceContains(systemTokens, `--cpx-sys-radius-${size}: ${value};`)
    }
    for (const [role, size] of [
      ['indicator', 'xs'],
      ['compact', 'xs'],
      ['control', 'md'],
      ['container', 'lg'],
      ['floating', 'lg'],
      ['prominent', 'xl'],
      ['pill', 'full'],
    ]) {
      expect(systemTokens.match(new RegExp(`--cpx-sys-radius-${role}:`, 'g'))).toHaveLength(1)
      expectSourceContains(systemTokens, `--cpx-sys-radius-${role}: var(--cpx-sys-radius-${size});`)
    }
    for (const size of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full']) {
      expectSourceContains(tailwind, `--radius-${size}: var(--cpx-sys-radius-${size});`)
    }
    expectSourceNotContains(tailwind, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceContains(
      componentTokens,
      '--cpx-comp-modal-radius: var(--cpx-sys-radius-prominent);',
    )
    expectSourceContains(
      componentTokens,
      '--cpx-comp-sidebar-item-radius: var(--cpx-sys-radius-item);',
    )

    // 圆角由语义角色 utility 表达，不再使用按档位缩放的局部变量。
    expectSourceNotContains(buttons, '--button-radius-scale')
    expect(buttons).toMatch(/tw:rounded-(?:lg|md|2xl|full)/)
    expectSourceNotContains(buttons, '@supports (corner-shape: superellipse(1.5))')
    expectSourceContains(composer, '--composer-radius: var(--cpx-sys-radius-prominent);')
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-layout=['"]single-line['"]\]\[data-composer-radius-variant=['"]default['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-pill\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant=['"]single-line['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-prominent\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant=['"]compact['"]\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-container\);/,
    )
    expectSourceNotContains(composer, 'var(--cpx-sys-radius-optical-scale)')
    expect(composer).not.toMatch(
      /\.composer-stack\[data-placement=['"]new-session['"]\][^{]*\{[^}]*--composer-radius/,
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface]',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="coding"]',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="working"]',
    )
    expectSourceContains(
      composer,
      '.composer-stack[data-composer-layout="multiline"][data-composer-radius-variant="default"]',
    )
    expectSourceNotContains(composer, 'calc(var(--cpx-sys-radius-xl) * 2)')
    expect(conversation.match(/border-radius: var\(--cpx-sys-radius-2xl\);/g)).toHaveLength(1)
    expectSourceContains(conversation, 'border-radius: var(--user-message-bubble-radius);')
    expectSourceNotContains(conversation, 'var(--cpx-sys-radius-optical-scale)')
    expectSourceContains(conversation, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceContains(summary, 'border-radius: var(--cpx-sys-radius-prominent);')
    expectSourceContains(summary, 'corner-shape: var(--cpx-sys-corner-shape);')
    expectSourceNotContains(cards, '--cpx-sys-radius-prominent')
    expectSourceNotContains(rightDock, '--cpx-sys-radius-prominent')
  })

  test('keeps user messages and inline summaries on dedicated semantics', async () => {
    const [systemTokens, conversation, summary, threadSummary] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/primitives/conversation.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/primitives/session.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/session/summary/ThreadSummaryPanel.tsx', import.meta.url),
      ).text(),
    ])

    expect(systemTokens.match(/--cpx-sys-color-message-user-bg:/g)).toHaveLength(1)
    expect(systemTokens).toMatch(
      /--cpx-sys-color-message-user-bg:\s*color-mix\(\s*in srgb,\s*var\(--cpx-sys-color-fg-primary\)\s*5%,\s*transparent\s*\)\s*;/,
    )
    expect(conversation.match(/--cpx-sys-color-message-user-bg/g)).toHaveLength(1)
    expectSourceContains(conversation, 'background: var(--cpx-sys-color-message-user-bg);')
    expectSourceNotContains(conversation, 'var(--cpx-sys-color-surface-panel) 78%')

    expect(summary.match(/--thread-summary-inline-width:/g)).toHaveLength(1)
    expect(summary).toMatch(
      /\.workflow-page__main,\s*\.thread-summary-popover\s*\{[\s\S]*?--thread-summary-inline-width: calc\(var\(--cpx-sys-space-1\) \* 75\);/,
    )
    expect(summary).not.toMatch(
      /\.workflow-page__main\[data-thread-summary-inline=['"]true['"]\][\s\S]*?padding-inline-end:/,
    )
    // 内联面板与浮层共用同一条宽度契约：两者都通过
    // `--thread-summary-inline-width` 的 utility 取宽，浮层挂在 Portal 上，
    // 由共享常量再声明一次（原 `.thread-summary-inline` / `.thread-summary-popover`
    // 宽度规则）。
    const inlinePanelClass =
      threadSummary.match(/className="(thread-summary-inline [^"]*)"/)?.[1] ?? ''
    expect(inlinePanelClass).toContain('tw:w-[var(--thread-summary-inline-width)]')
    expectSourceContains(
      threadSummary,
      "const THREAD_SUMMARY_WIDTH_CLASS = 'tw:w-[var(--thread-summary-inline-width)] tw:max-w-full'",
    )
    expectSourceContains(threadSummary, 'thread-summary-popover ${THREAD_SUMMARY_WIDTH_CLASS}')
    expect(summary).not.toMatch(/width:\s*(?:260|272|300)px/)
  })

  test('keeps component tokens private to shared component styles', async () => {
    const [
      systemTokens,
      tokens,
      rightDock,
      sidebar,
      chrome,
      workbenchShell,
      workbenchLayout,
      tabStrip,
      dockFrame,
      panelSurface,
      modal,
      popover,
      tooltip,
    ] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/tokens.css', import.meta.url)).text(),
      Bun.file(
        new URL('../src/styles/design-system/codex-semantic-tokens.css', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/features/layout-right-dock.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/primitives/sidebar.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/layout/MenuBar.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/layout/shell/WorkbenchShellView.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/features/layout-workbench.css', import.meta.url)).text(),
      Bun.file(new URL('../src/features/layout/tabs/WorkbenchTabStrip.tsx', import.meta.url)).text(),
      Bun.file(new URL('../src/features/layout/dock/WorkbenchDockFrame.tsx', import.meta.url)).text(),
      Bun.file(
        new URL('../src/features/layout/panels/WorkbenchPanelSurface.tsx', import.meta.url),
      ).text(),
      Bun.file(new URL('../src/styles/modal.css', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/popover.css', import.meta.url)).text(),
      Bun.file(new URL('../src/components/ui/Tooltip.tsx', import.meta.url)).text(),
      ])

    // Window chrome and workspace regions stay independently addressable while
    // panels follow the workspace surface by default.
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-titlebar-bg: var(--cpx-sys-color-workbench-sidebar-bg);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-sidebar-bg: var(--cpx-ref-gray-2);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-main-bg: var(--cpx-sys-color-surface-canvas);',
    )
    expectSourceContains(
      systemTokens,
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expectSourceNotContains(
      systemTokens,
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-surface-recessed);',
    )

    // Verify token definitions in codex-semantic-tokens.css
    expectSourceContains(tokens, '--cpx-comp-dock-bg: var(--cpx-sys-color-workbench-panel-bg);')
    expectSourceContains(tokens, '--cpx-comp-dock-border: var(--cpx-sys-color-border-subtle);')
    expectSourceContains(
      tokens,
      '--cpx-comp-sidebar-bg: var(--cpx-sys-color-workbench-sidebar-bg);',
    )
    expectSourceContains(
      tokens,
      '--cpx-comp-workbench-panel-bg: var(--cpx-sys-color-workbench-panel-bg);',
    )
    expectSourceContains(
      tokens,
      '--cpx-comp-workbench-main-surface-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expectSourceContains(tokens, '--cpx-comp-sidebar-border: 0;')
    expectSourceContains(tokens, '--cpx-comp-modal-bg: var(--cpx-sys-color-surface-raised);')
    expectSourceContains(
      tokens,
      '--cpx-comp-modal-border: 1px solid var(--cpx-sys-color-border-subtle);',
    )

    // Feature styles consume public system semantics instead of component aliases.
    expectSourceNotContains(rightDock, '--cpx-comp-dock-bg')
    expectSourceNotContains(rightDock, '--cpx-comp-dock-border')
    expectSourceNotContains(rightDock, '--cpx-comp-dock-tab-radius')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-bg')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-border')
    expectSourceNotContains(sidebar, '--cpx-comp-sidebar-item-active-bg')
    expectSourceNotContains(sidebar, 'sidebar-sticky-section-clip')
    expectSourceContains(rightDock, '--cpx-sys-color-workbench-panel-bg')
    // 标题栏与工作区表面已改用映射到同一系统语义的 utility：MenuBar 取
    // titlebar 表面，工作台主体取 main 表面并保留左侧分隔边框。
    expectSourceContains(chrome, 'tw:bg-app-titlebar')
    expectSourceContains(workbenchShell, 'tw:bg-app-main')
    expectSourceContains(workbenchShell, 'tw:border-l tw:border-app-border')
    expect(workbenchLayout).not.toMatch(/\.desktop-workspace-panel--bottom\s*\{[^}]*border-top:/)

    // Panel and toolbar borders moved out of the dock stylesheet into the
    // components that render them, still on public system semantics.
    expectSourceContains(tabStrip, 'tw:rounded-control')
    expectSourceContains(dockFrame, 'tw:border-l tw:border-app-border')
    expectSourceContains(dockFrame, 'tw:border-t tw:border-app-border')
    expectSourceContains(panelSurface, 'tw:border-b tw:border-app-border-subtle')
    expectSourceContains(modal, '--cpx-comp-modal-bg')
    expectSourceContains(modal, '--cpx-comp-modal-shadow')
    expectSourceContains(popover, '--cpx-comp-dropdown-menu-bg')
    // Tooltip 表面迁到组件 utility，仍消费 `--cpx-comp-tooltip-*` 对应的
    // raised 表面与 floating 阴影。
    expectSourceContains(tooltip, 'tw:bg-app-raised')
    expectSourceContains(tooltip, 'tw:shadow-lg')
  })
})
