import { describe, expect, test } from 'bun:test'
import { LAB_DEMOS } from '../src/features/labs/labRegistry.js'

describe('Codex semantic token contract', () => {
  test('exports exactly 121 unique semantic color tokens', async () => {
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

    expect(tokens).toHaveLength(121)
    expect(new Set(tokens).size).toBe(121)
    expect(tokens).toContain('--color-token-input-background')
    expect(tokens).toContain('--color-token-dropdown-background')
    expect(tokens).toContain('--color-token-main-surface-primary')
    expect(tokens).toContain('--color-token-panel-background')
    expect(tokens).toContain('--color-token-control-background')
    expect(tokens).toContain('--color-token-elevated-background')
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
})

describe('Codex Labs registry', () => {
  test('registers 18 unique lazy visual prototypes with evidence', async () => {
    expect(LAB_DEMOS).toHaveLength(18)
    expect(new Set(LAB_DEMOS.map(demo => demo.id)).size).toBe(18)

    for (const demo of LAB_DEMOS) {
      expect(demo.status).toBe('visual-prototype')
      expect(demo.evidence.sourceChunks.length).toBeGreaterThan(0)
      expect(demo.evidence.selectors.length).toBeGreaterThan(0)
      expect(demo.evidence.themeTokens.length).toBeGreaterThan(0)
      expect(demo.evidence.platformVariants).toContain('electron')
      expect(demo.evidence.platformVariants).toContain('browser-mock')

      const loaded = await demo.load()
      expect(typeof loaded.default).toBe('function')
    }
  })
})
