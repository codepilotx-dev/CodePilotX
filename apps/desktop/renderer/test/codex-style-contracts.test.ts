import { describe, expect, test } from 'bun:test'
import { LAB_DEMOS } from '../src/features/labs/labRegistry.js'

describe('Codex semantic token contract', () => {
  test('exports exactly 117 unique semantic color tokens', async () => {
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

    expect(tokens).toHaveLength(117)
    expect(new Set(tokens).size).toBe(117)
    expect(tokens).toContain('--color-token-input-background')
    expect(tokens).toContain('--color-token-dropdown-background')
    expect(tokens).toContain('--color-token-main-surface-primary')
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
