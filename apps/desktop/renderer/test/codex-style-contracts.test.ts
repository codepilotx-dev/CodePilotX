import { describe, expect, test } from 'bun:test'

describe('Codex CPX design system token contract', () => {
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

    expect(manifest.featureColorContract.roots).toEqual([
      'src/styles/features',
      'src/styles/lazy',
    ])
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
      new URL(
        '../src/styles/design-system/codex-semantic-tokens.scss',
        import.meta.url,
      ),
    ).text()
    const tokens = Array.from(
      stylesheet.matchAll(/^\s*(--cpx-comp-[\w-]+):/gm),
      match => match[1],
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

  test('maps Dropdown states through dedicated semantic slots', async () => {
    const [tokens, popover, rows] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/codex-semantic-tokens.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/popover.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/components/interactive-row.scss', import.meta.url)).text(),
    ])

    expect(tokens).toContain('--cpx-comp-dropdown-menu-border: var(--cpx-sys-color-border-default)')
    expect(tokens).toContain('--cpx-comp-dropdown-item-pressed-bg: var(--cpx-sys-color-active)')
    expect(popover).toContain(".popover-surface[data-theme-component='dropdown-surface']")
    expect(popover).toContain('--cpx-comp-row-hover-bg: var(--cpx-comp-dropdown-item-hover-bg)')
    expect(rows).toContain('--cpx-comp-row-selected-bg, var(--cpx-sys-color-selected)')
  })

  test('keeps diff backgrounds separate from raw decoration colors', async () => {
    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/codex-semantic-tokens.scss',
        import.meta.url,
      ),
    ).text()

    expect(stylesheet).toContain(
      '--cpx-comp-diff-inserted-line-bg: var(--cpx-sys-color-diff-added-line)',
    )
    expect(stylesheet).toContain(
      '--cpx-comp-diff-inserted-text-bg: var(--cpx-sys-color-diff-added-text)',
    )
    expect(stylesheet).toContain(
      '--cpx-comp-diff-removed-line-bg: var(--cpx-sys-color-diff-removed-line)',
    )
    expect(stylesheet).toContain(
      '--cpx-comp-diff-removed-text-bg: var(--cpx-sys-color-diff-removed-text)',
    )
  })

  test('does not reintroduce removed theme compatibility aliases', async () => {
    const sources = await Promise.all(
      [
        '../src/features/theme/themeVariables.ts',
        '../src/styles/design-system/tokens.scss',
      ].map(path => Bun.file(new URL(path, import.meta.url)).text()),
    )
    const removedAliasPattern =
      /--(?:color-bg(?:-[\w-]+)?|surface-[\w-]+|state-[\w-]+|border-(?:subtle|muted|control|strong)|color-text(?:-(?:strong|meta|soft|mute|muted|placeholder|disabled|on-accent))?)(?=['"]?\s*:)/

    for (const source of sources) {
      expect(source.match(removedAliasPattern)).toBeNull()
    }
  })

  test('keeps primary/secondary buttons distinct and settings rows height-free', async () => {
    const [buttons, settings] = await Promise.all([
      Bun.file(
        new URL('../src/styles/components/button.scss', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/styles/features/_settings-core.scss', import.meta.url),
      ).text(),
    ])

    // primary：foreground 实底、反色文字；secondary：5% 弱背景、透明边框。
    expect(buttons).toMatch(
      /\.ui-button\[data-color="primary"\]\s*\{[\s\S]*?background: var\(--cpx-sys-color-fg-primary\)/,
    )
    expect(buttons).toMatch(
      /\.ui-button\[data-color="secondary"\]\s*\{[\s\S]*?background: color-mix\(in srgb, var\(--cpx-sys-color-fg-primary\) 5%, transparent\)/,
    )
    expect(buttons).toMatch(
      /\.ui-button\[data-color="secondary"\]\s*\{[\s\S]*?border-color: transparent/,
    )
    // 设置行不再锁死 64px，改用 padding 驱动高度。
    expect(settings).not.toMatch(
      /\.settings-row\s*\{[\s\S]*?min-height: 64px;/,
    )
    expect(settings).toMatch(
      /\.settings-row\s*\{[\s\S]*?padding: var\(--cpx-sys-space-3\) 0;/,
    )
    expect(settings).toMatch(
      /\.settings-row \+ \.settings-row[\s\S]*?height: 0\.5px;/,
    )
  })

  test('keeps prominent elevation distinct from flat and transient surfaces', async () => {
    const [systemTokens, componentTokens, cards, composer, summary, rightDock] =
      await Promise.all([
        Bun.file(
          new URL('../src/styles/design-system/tokens.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL(
            '../src/styles/design-system/codex-semantic-tokens.scss',
            import.meta.url,
          ),
        ).text(),
        Bun.file(
          new URL('../src/styles/components/card.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_composer-shell.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_thread-summary.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_layout-right-dock.scss', import.meta.url),
        ).text(),
      ])

    expect(systemTokens.match(/--cpx-sys-shadow-prominent:/g)).toHaveLength(1)
    expect(systemTokens).toContain('--cpx-sys-shadow-raised: none;')
    expect(componentTokens).toContain(
      '--cpx-comp-composer-shadow: var(--cpx-sys-shadow-prominent);',
    )
    expect(cards).toMatch(
      /\.composer\s*\{[\s\S]*?box-shadow: var\(--cpx-comp-composer-shadow\);/,
    )
    expect(composer).not.toContain('box-shadow: var(--cpx-sys-shadow-floating)')
    expect(summary).toMatch(
      /\.thread-summary-panel\s*\{[\s\S]*?box-shadow: var\(--cpx-sys-shadow-prominent\);/,
    )
    expect(summary).toMatch(
      /\.thread-summary-popover \.thread-summary-panel,[\s\S]*?box-shadow: none;/,
    )
    expect(rightDock).not.toContain('--cpx-sys-shadow-prominent')
  })

  test('keeps optical radius correction opt-in and role-driven', async () => {
    const [systemTokens, buttons, composer, conversation, summary, cards, rightDock] =
      await Promise.all([
        Bun.file(
          new URL('../src/styles/design-system/tokens.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/components/button.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_composer-shell.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL(
            '../src/styles/features/_canonical-conversation.scss',
            import.meta.url,
          ),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_thread-summary.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/components/card.scss', import.meta.url),
        ).text(),
        Bun.file(
          new URL('../src/styles/features/_layout-right-dock.scss', import.meta.url),
        ).text(),
      ])

    expect(
      systemTokens.match(/--cpx-sys-radius-optical-scale:/g),
    ).toHaveLength(2)
    expect(systemTokens.match(/--cpx-sys-corner-shape:/g)).toHaveLength(2)
    expect(systemTokens.match(/--cpx-sys-radius-prominent:/g)).toHaveLength(1)
    expect(systemTokens).toContain('--cpx-sys-radius-optical-scale: 1;')
    expect(systemTokens).toContain('--cpx-sys-radius-optical-scale: 1.25;')
    expect(systemTokens).toContain('--cpx-sys-corner-shape: round;')
    expect(systemTokens).toContain(
      '--cpx-sys-corner-shape: superellipse(1.5);',
    )
    expect(systemTokens).toMatch(
      /--cpx-sys-radius-prominent:\s*calc\(\s*20px \* var\(--cpx-sys-radius-optical-scale\)\s*\);/,
    )
    for (const [role, value] of [
      ['control', '8px'],
      ['container', '12px'],
      ['floating', '16px'],
    ]) {
      expect(systemTokens).toContain(`--cpx-sys-radius-${role}: ${value};`)
      expect(systemTokens).not.toMatch(
        new RegExp(`--cpx-sys-radius-${role}:[^;]*optical-scale`),
      )
    }

    expect(buttons).toContain('--button-radius-scale: 1;')
    expect(buttons).toContain(
      'border-radius: calc(var(--button-radius) * var(--button-radius-scale));',
    )
    const shapedButtons = buttons.slice(
      buttons.indexOf('@supports (corner-shape: superellipse(1.5))'),
      buttons.indexOf('.segmented-control[data-variant="inset"]'),
    )
    expect(shapedButtons).toContain(
      '--button-radius-scale: var(--cpx-sys-radius-optical-scale);',
    )
    expect(shapedButtons).toContain(
      'corner-shape: var(--cpx-sys-corner-shape);',
    )
    for (const pillSize of [
      'default',
      'large',
      'composer',
      'composerSm',
      'composerUtility',
    ]) {
      expect(shapedButtons).not.toContain(`[data-size="${pillSize}"]`)
    }

    expect(composer).toContain(
      '--composer-radius: var(--cpx-sys-radius-prominent);',
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-layout="single-line"\]\[data-composer-radius-variant="default"\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-pill\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant="single-line"\]\s*\{\s*--composer-radius: var\(--cpx-sys-radius-prominent\);/,
    )
    expect(composer).toMatch(
      /\.composer-stack\[data-composer-radius-variant="compact"\][\s\S]*?var\(--cpx-sys-radius-container\) \* var\(--cpx-sys-radius-optical-scale\)/,
    )
    expect(composer).not.toMatch(
      /\.composer-stack\[data-placement="new-session"\][^{]*\{[^}]*--composer-radius/,
    )
    expect(composer).toContain(
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface]',
    )
    expect(composer).toContain(
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="coding"]',
    )
    expect(composer).toContain(
      '.composer-stack[data-composer-utility-bar-variant="home"][data-surface="working"]',
    )
    expect(composer).toContain(
      '.composer-stack[data-composer-layout="multiline"][data-composer-radius-variant="default"]',
    )
    expect(composer).not.toContain(
      'calc(var(--cpx-sys-radius-xl) * 2)',
    )
    expect(
      conversation.match(
        /var\(--cpx-sys-radius-floating\) \* var\(--cpx-sys-radius-optical-scale\)/g,
      ),
    ).toHaveLength(2)
    expect(conversation).toContain(
      'corner-shape: var(--cpx-sys-corner-shape);',
    )
    expect(summary).toContain(
      'border-radius: var(--cpx-sys-radius-prominent);',
    )
    expect(summary).toContain(
      'corner-shape: var(--cpx-sys-corner-shape);',
    )
    expect(cards).not.toContain('--cpx-sys-radius-prominent')
    expect(rightDock).not.toContain('--cpx-sys-radius-prominent')
  })

  test('keeps user messages and inline summaries on dedicated semantics', async () => {
    const [systemTokens, conversation, summary] = await Promise.all([
      Bun.file(
        new URL('../src/styles/design-system/tokens.scss', import.meta.url),
      ).text(),
      Bun.file(
        new URL(
          '../src/styles/features/_canonical-conversation.scss',
          import.meta.url,
        ),
      ).text(),
      Bun.file(
        new URL('../src/styles/features/_thread-summary.scss', import.meta.url),
      ).text(),
    ])

    expect(
      systemTokens.match(/--cpx-sys-color-message-user-bg:/g),
    ).toHaveLength(1)
    expect(systemTokens).toMatch(
      /--cpx-sys-color-message-user-bg:\s*color-mix\(in srgb, var\(--cpx-sys-color-fg-primary\) 5%, transparent\);/,
    )
    expect(
      conversation.match(/--cpx-sys-color-message-user-bg/g),
    ).toHaveLength(1)
    expect(conversation).toContain(
      'background: var(--cpx-sys-color-message-user-bg);',
    )
    expect(conversation).not.toContain(
      'var(--cpx-sys-color-surface-panel) 78%',
    )

    expect(
      summary.match(/--thread-summary-inline-width:/g),
    ).toHaveLength(1)
    expect(summary).toMatch(
      /\.workflow-page__main\s*\{[\s\S]*?--thread-summary-inline-width: calc\(var\(--cpx-sys-space-1\) \* 75\);/,
    )
    expect(summary).toMatch(
      /\.workflow-page__main\[data-thread-summary-inline="true"\][\s\S]*?padding-inline-end: calc\([\s\S]*?var\(--thread-summary-inline-width\)/,
    )
    expect(summary).toMatch(
      /\.thread-summary-inline\s*\{[\s\S]*?width: var\(--thread-summary-inline-width\);/,
    )
    expect(summary).toMatch(
      /\.thread-summary-popover,[\s\S]*?\.thread-summary-error\s*\{[\s\S]*?width: var\(--thread-summary-inline-width\);/,
    )
    expect(summary).not.toMatch(/width:\s*(?:272|300)px/)
  })

  test('keeps component tokens private to shared component styles', async () => {
    const [
      systemTokens,
      tokens,
      rightDock,
      sidebar,
      chrome,
      workbench,
      modal,
      popover,
    ] = await Promise.all([
      Bun.file(
        new URL('../src/styles/design-system/tokens.scss', import.meta.url),
      ).text(),
      Bun.file(
        new URL(
          '../src/styles/design-system/codex-semantic-tokens.scss',
          import.meta.url,
        ),
      ).text(),
      Bun.file(
        new URL(
          '../src/styles/features/_layout-right-dock.scss',
          import.meta.url,
        ),
      ).text(),
      Bun.file(
        new URL('../src/styles/features/layout-sidebar.scss', import.meta.url),
      ).text(),
      Bun.file(
        new URL('../src/styles/features/layout-chrome.scss', import.meta.url),
      ).text(),
      Bun.file(
        new URL(
          '../src/styles/features/_layout-workbench.scss',
          import.meta.url,
        ),
      ).text(),
      Bun.file(new URL('../src/styles/modal.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/popover.scss', import.meta.url)).text(),
    ])

    // Window chrome and workspace regions stay independently addressable while
    // panels follow the workspace surface by default.
    expect(systemTokens).toContain(
      '--cpx-sys-color-workbench-titlebar-bg: var(--cpx-sys-color-surface-recessed);',
    )
    expect(systemTokens).toContain(
      '--cpx-sys-color-workbench-sidebar-bg: var(--cpx-sys-color-surface-recessed);',
    )
    expect(systemTokens).toContain(
      '--cpx-sys-color-workbench-main-bg: var(--cpx-sys-color-surface-canvas);',
    )
    expect(systemTokens).toContain(
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expect(systemTokens).not.toContain(
      '--cpx-sys-color-workbench-panel-bg: var(--cpx-sys-color-surface-recessed);',
    )

    // Verify token definitions in codex-semantic-tokens.scss
    expect(tokens).toContain(
      '--cpx-comp-dock-bg: var(--cpx-sys-color-workbench-panel-bg);',
    )
    expect(tokens).toContain('--cpx-comp-dock-border: var(--cpx-sys-color-border-subtle);')
    expect(tokens).toContain(
      '--cpx-comp-sidebar-bg: var(--cpx-sys-color-workbench-sidebar-bg);',
    )
    expect(tokens).toContain(
      '--cpx-comp-workbench-panel-bg: var(--cpx-sys-color-workbench-panel-bg);',
    )
    expect(tokens).toContain(
      '--cpx-comp-workbench-main-surface-bg: var(--cpx-sys-color-workbench-main-bg);',
    )
    expect(tokens).toContain('--cpx-comp-sidebar-border: 0;')
    expect(tokens).toContain('--cpx-comp-modal-bg: var(--cpx-sys-color-surface-raised);')
    expect(tokens).toContain('--cpx-comp-modal-border: 1px solid var(--cpx-sys-color-border-subtle);')

    // Feature styles consume public system semantics instead of component aliases.
    expect(rightDock).not.toContain('--cpx-comp-dock-bg')
    expect(rightDock).not.toContain('--cpx-comp-dock-border')
    expect(rightDock).not.toContain('--cpx-comp-dock-tab-radius')
    expect(rightDock).toContain('--cpx-sys-radius-control')
    expect(sidebar).not.toContain('--cpx-comp-sidebar-bg')
    expect(sidebar).not.toContain('--cpx-comp-sidebar-border')
    expect(sidebar).not.toContain('--cpx-comp-sidebar-item-active-bg')
    expect(sidebar).toContain('--cpx-sys-color-workbench-sidebar-bg')
    expect(rightDock).toContain('--cpx-sys-color-workbench-panel-bg')
    expect(chrome).toContain('--cpx-sys-color-workbench-titlebar-bg')
    expect(workbench).toContain('--cpx-sys-color-workbench-main-bg')
    expect(workbench).toMatch(
      /\.desktop-main\s*\{[^}]*border-left: 1px solid var\(--cpx-sys-color-border-default\);/,
    )
    expect(rightDock).toMatch(
      /\.right-dock\s*\{[^}]*border-left: 1px solid var\(--cpx-sys-color-border-default\);/,
    )
    expect(rightDock).toMatch(
      /\.bottom-panel\s*\{[^}]*border-top: 1px solid var\(--cpx-sys-color-border-default\);/,
    )
    expect(rightDock).toMatch(
      /\.workbench-panel-header\s*\{[^}]*border-bottom: 1px solid var\(--cpx-sys-color-border-subtle\);/,
    )
    expect(workbench).not.toMatch(
      /\.desktop-workspace-panel--bottom\s*\{[^}]*border-top:/,
    )
    expect(modal).toContain('--cpx-comp-modal-bg')
    expect(modal).toContain('--cpx-comp-modal-shadow')
    expect(popover).toContain('--cpx-comp-dropdown-menu-bg')
    expect(popover).toContain('--cpx-comp-tooltip-bg')
  })
})
