import { describe, expect, test } from 'bun:test'

describe('Codex CPX design system token contract', () => {
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
      /\.settings-row\s*\{[\s\S]*?padding: 12px 0;/,
    )
    expect(settings).toMatch(
      /\.settings-row \+ \.settings-row[\s\S]*?height: 0\.5px;/,
    )
  })

  test('defines component-scoped semantic aliases and consumes them in real selectors', async () => {
    const [tokens, rightDock, sidebar, modal, popover] = await Promise.all([
      Bun.file(new URL('../src/styles/design-system/codex-semantic-tokens.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/_layout-right-dock.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/features/layout-sidebar.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/modal.scss', import.meta.url)).text(),
      Bun.file(new URL('../src/styles/popover.scss', import.meta.url)).text(),
    ])

    // Verify token definitions in codex-semantic-tokens.scss
    expect(tokens).toContain('--cpx-comp-dock-bg: var(--cpx-sys-color-panel);')
    expect(tokens).toContain('--cpx-comp-dock-border: var(--cpx-sys-color-border-subtle);')
    expect(tokens).toContain('--cpx-comp-sidebar-bg: var(--cpx-sys-color-surface-under);')
    expect(tokens).toContain('--cpx-comp-sidebar-border: 0;')
    expect(tokens).toContain('--cpx-comp-modal-bg: var(--cpx-sys-color-elevated-secondary);')
    expect(tokens).toContain('--cpx-comp-modal-border: 1px solid var(--cpx-sys-color-border-subtle);')

    // Verify consumption in real component selectors
    expect(rightDock).toContain('--cpx-comp-dock-bg')
    expect(rightDock).toContain('--cpx-comp-dock-border')
    expect(rightDock).toContain('--cpx-comp-dock-tab-radius')
    expect(sidebar).toContain('--cpx-comp-sidebar-bg')
    expect(sidebar).toContain('--cpx-comp-sidebar-border')
    expect(sidebar).toContain('--cpx-comp-sidebar-item-active-bg')
    expect(modal).toContain('--cpx-comp-modal-bg')
    expect(modal).toContain('--cpx-comp-modal-shadow')
    expect(popover).toContain('--cpx-comp-dropdown-menu-bg')
    expect(popover).toContain('--cpx-comp-tooltip-bg')
  })
})
