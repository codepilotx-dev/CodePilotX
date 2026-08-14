import { describe, expect, test } from 'bun:test'

describe('Codex semantic token contract', () => {
  test('exports exactly 122 unique semantic color tokens', async () => {
    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/codex-semantic-tokens.scss',
        import.meta.url,
      ),
    ).text()
    const tokens = Array.from(
      stylesheet.matchAll(/^\s*(--color-token-[\w-]+):/gm),
      match => match[1],
    )

    expect(tokens).toHaveLength(122)
    expect(new Set(tokens).size).toBe(122)
    expect(tokens).toContain('--color-token-input-background')
    expect(tokens).toContain('--color-token-dropdown-background')
    expect(tokens).toContain('--color-token-main-surface-primary')
    expect(tokens).toContain('--color-token-panel-background')
    expect(tokens).toContain('--color-token-control-background')
    expect(tokens).toContain('--color-token-elevated-background')
    expect(tokens).toContain('--color-token-button-pressed')
  })

  test('keeps diff backgrounds separate from raw decoration colors', async () => {
    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/codex-semantic-tokens.scss',
        import.meta.url,
      ),
    ).text()

    expect(stylesheet).toContain(
      '--vscode-diffEditor-insertedLineBackground: var(--color-diff-added-line-background)',
    )
    expect(stylesheet).toContain(
      '--vscode-diffEditor-insertedTextBackground: var(--color-diff-added-text-background)',
    )
    expect(stylesheet).toContain(
      '--vscode-diffEditor-removedLineBackground: var(--color-diff-removed-line-background)',
    )
    expect(stylesheet).toContain(
      '--vscode-diffEditor-removedTextBackground: var(--color-diff-removed-text-background)',
    )
    expect(stylesheet).not.toMatch(
      /--vscode-diffEditor-[\w-]+Background:\s*var\(--color-decoration-(?:added|deleted)\)/,
    )
  })

  test('keeps the Codex hover overlays visible before runtime theme hydration', async () => {
    const stylesheet = await Bun.file(
      new URL(
        '../src/styles/design-system/codex-semantic-tokens.scss',
        import.meta.url,
      ),
    ).text()

    expect(stylesheet).toMatch(
      /--vscode-list-activeSelectionBackground:\s*color-mix\(\s*in srgb,\s*var\(--color-text-foreground\) 5%,\s*transparent\s*\)/,
    )
    expect(stylesheet).toMatch(
      /:root\s*\{[\s\S]*--vscode-list-hoverBackground:\s*color-mix\(\s*in srgb,\s*var\(--color-text-foreground\) 5%,\s*transparent\s*\)/,
    )
    expect(stylesheet).toMatch(
      /\.electron-dark\s*\{[\s\S]*--vscode-list-hoverBackground:\s*color-mix\(\s*in srgb,\s*var\(--color-text-foreground\) 8%,\s*transparent\s*\)/,
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

  test('keeps home suggestions on one neutral hairline surface', async () => {
    const stylesheet = await Bun.file(
      new URL('../src/styles/features/_session-page.scss', import.meta.url),
    ).text()
    const suggestionCard = stylesheet.match(
      /\.new-session-suggestion-card\s*\{([\s\S]*?)\n\}/,
    )?.[1]

    expect(suggestionCard).toBeDefined()
    expect(suggestionCard).toContain('border: 0;')
    expect(suggestionCard).toContain('0 0 0 0.5px')
    expect(suggestionCard).not.toContain('var(--layer-edge)')
    expect(suggestionCard).not.toContain('0 2px 8px')
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
      /\.ui-button\[data-color="primary"\]\s*\{[\s\S]*?background: var\(--color-token-foreground\)/,
    )
    expect(buttons).toMatch(
      /\.ui-button\[data-color="secondary"\]\s*\{[\s\S]*?background: color-mix\(in srgb, var\(--color-token-foreground\) 5%, transparent\)/,
    )
    expect(buttons).toMatch(
      /\.ui-button\[data-color="secondary"\]\s*\{[\s\S]*?border-color: transparent/,
    )
    // :active 使用 canonical pressed token，不再机械映射成 selection。
    expect(buttons).toMatch(
      /\.ui-button\[data-color="secondary"\][\s\S]*?:active:not\(:disabled\)\s*\{[\s\S]*?background: var\(--color-token-button-pressed\)/,
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
})
