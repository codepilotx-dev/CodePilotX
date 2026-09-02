import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

/*
 * Frozen contracts for the non-color design-token refactor.
 *
 * This suite intentionally describes the FUTURE state of the token system and
 * is allowed to fail against today's source. It statically reads the real
 * files with node:fs; there are no snapshots and no quantity baselines.
 *
 * Frozen semantics (do not weaken to make tests green):
 * - tokens.scss defines semantic type roles, a corrected 4px spacing scale,
 *   semantic radius/motion/z-index roles, and no root --control-/--layout-/
 *   --app-icon-/--menu- geometry tokens.
 * - check-style-contracts.ts + style-contracts.json grow a featureTokenContract
 *   that governs non-color tokens across styles, TSX, inline styles, Tailwind
 *   arbitrary values and component geometry, with precise reasons and stale
 *   detection.
 * - base.scss reduced-motion zeroes every system motion token.
 */

function read(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), 'utf8')
}

function extractTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>()
  for (const match of source.matchAll(/(^|[\r\n])[ \t]*(--[\w-]+)[ \t]*:[ \t]*([^;]+);/g)) {
    tokens.set(match[2], match[3].trim())
  }
  return tokens
}

function missingFrom(tokens: Map<string, string>, expected: string[]): string[] {
  return expected.filter((name) => !tokens.has(name))
}

function blockContent(source: string, openPattern: RegExp): string | undefined {
  const startMatch = source.match(openPattern)
  if (!startMatch) return undefined
  const start = startMatch.index! + startMatch[0].length
  let depth = 1
  let index = start
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) break
    }
  }
  return depth === 0 ? source.slice(start, index) : undefined
}

describe('non-color design token contracts', () => {
  test('tokens.scss defines the semantic type role tokens', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const roles = [
      'display',
      'caption',
      'label',
      'body-sm',
      'body',
      'body-lg',
      'reading',
      'row-title',
      'control',
      'heading-sm',
      'heading-md',
      'heading-lg',
      'heading-xl',
      'metric',
      'code',
    ].map((role) => `--cpx-sys-type-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.scss must define every type role as a --cpx-sys-type-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.scss locks the Codex typography sizes, weights, and role-specific line heights', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    expect(tokens.get('--cpx-sys-font-family-sans')).toBe(
      '"Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    )
    const expected: Record<string, string> = {
      '--cpx-sys-font-size-code': '13px',
      '--cpx-sys-font-size-xs': '12px',
      '--cpx-sys-font-size-sm': '13px',
      '--cpx-sys-font-size-md': '14px',
      '--cpx-sys-font-size-lg': '16px',
      '--cpx-sys-font-size-xl': '18px',
      '--cpx-sys-font-size-2xl': '20px',
      '--cpx-sys-font-size-3xl': '24px',
      '--cpx-sys-font-size-4xl': '28px',
      '--cpx-sys-font-weight-regular': '400',
      '--cpx-sys-font-weight-body': '400',
      '--cpx-sys-font-weight-medium': '500',
      '--cpx-sys-font-weight-bold': '600',
      '--cpx-sys-line-height-caption': 'calc(var(--cpx-sys-font-size-xs) + 4px)',
      '--cpx-sys-line-height-label': 'calc(var(--cpx-sys-font-size-xs) + 4px)',
      '--cpx-sys-line-height-body-sm': 'calc(var(--cpx-sys-font-size-sm) + 5px)',
      '--cpx-sys-line-height-body': 'calc(var(--cpx-sys-font-size-md) + 6px)',
      '--cpx-sys-line-height-body-lg': 'calc(var(--cpx-sys-font-size-lg) + 8px)',
      '--cpx-sys-line-height-heading-sm': 'calc(var(--cpx-sys-font-size-lg) + 6px)',
      '--cpx-sys-line-height-heading-md': 'calc(var(--cpx-sys-font-size-xl) + 6px)',
      '--cpx-sys-line-height-heading-lg': 'calc(var(--cpx-sys-font-size-2xl) + 8px)',
      '--cpx-sys-line-height-heading-xl': 'calc(var(--cpx-sys-font-size-3xl) + 6px)',
      '--cpx-sys-line-height-display': 'calc(var(--cpx-sys-font-size-4xl) + 6px)',
      '--cpx-sys-line-height-reading': 'calc(var(--cpx-sys-font-size-md) + 10px)',
      '--cpx-sys-line-height-code': 'calc(var(--cpx-sys-font-size-code) + 7px)',
    }
    const mismatched = Object.entries(expected).filter(
      ([name, value]) => tokens.get(name) !== value,
    )

    expect(
      mismatched,
      `Codex typography contract mismatch: ${mismatched.map(([name, value]) => `${name}=${tokens.get(name) ?? '(missing)'} (expected ${value})`).join(', ') || 'none'}`,
    ).toEqual([])

    const roles: Record<string, string> = {
      '--cpx-sys-type-display': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-4xl) / var(--cpx-sys-line-height-display) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-caption': 'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-xs) / var(--cpx-sys-line-height-caption) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-label': 'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-xs) / var(--cpx-sys-line-height-label) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body-sm': 'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-sm) / var(--cpx-sys-line-height-body-sm) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body': 'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-body) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-body-lg': 'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-lg) / var(--cpx-sys-line-height-body-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-reading': 'var(--cpx-sys-font-weight-body) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-reading) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-row-title': 'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-md) / var(--cpx-sys-line-height-body) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-control': 'var(--cpx-sys-font-weight-medium) var(--cpx-sys-font-size-sm) / var(--cpx-sys-line-height-body-sm) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-sm': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-lg) / var(--cpx-sys-line-height-heading-sm) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-md': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-xl) / var(--cpx-sys-line-height-heading-md) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-lg': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-2xl) / var(--cpx-sys-line-height-heading-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-heading-xl': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-3xl) / var(--cpx-sys-line-height-heading-xl) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-metric': 'var(--cpx-sys-font-weight-bold) var(--cpx-sys-font-size-2xl) / var(--cpx-sys-line-height-heading-lg) var(--cpx-sys-font-family-sans)',
      '--cpx-sys-type-code': 'var(--cpx-sys-font-weight-regular) var(--cpx-sys-font-size-code) / var(--cpx-sys-line-height-code) var(--cpx-sys-font-family-mono)',
    }
    expect(
      Object.entries(roles).filter(([name, value]) => tokens.get(name) !== value),
    ).toEqual([])

    for (const [size, lineHeight] of [[16, 22], [18, 24], [20, 28], [24, 30]]) {
      expect(lineHeight).toBeGreaterThanOrEqual(size)
    }
  })

  test('DesktopThemeProvider applies one UI-size delta to the complete scale including 4xl', async () => {
    const provider = await read('../src/features/theme/DesktopThemeProvider.tsx')
    const scaleBlock = provider.match(/const scale = \{([\s\S]*?)\n  \}/)?.[1]
    expect(scaleBlock, 'DesktopThemeProvider must declare its UI font scale').toBeDefined()

    const scale = new Map<string, number>()
    for (const match of scaleBlock!.matchAll(/'?([\w]+)'?\s*:\s*(\d+)/g)) {
      scale.set(match[1], Number(match[2]))
    }
    expect(Object.fromEntries(scale)).toEqual({
      xs: 12,
      sm: 13,
      md: 14,
      lg: 16,
      xl: 18,
      '2xl': 20,
      '3xl': 24,
      '4xl': 28,
    })
    expect(provider).toContain('const delta = uiFontSize - 14')
    expect(provider).toContain('`${base + delta}px`')
    expect(provider).toContain("'--cpx-sys-font-size-4xl'")

    for (const uiFontSize of [11, 14, 16]) {
      const delta = uiFontSize - 14
      const derived = [...scale.values()].map(base => base + delta)
      expect(derived).toEqual([12, 13, 14, 16, 18, 20, 24, 28].map(base => base + delta))
    }
  })

  test('base, utilities, and Tailwind consume the shared typography roles', async () => {
    const [base, utilities, tailwind] = await Promise.all([
      read('../src/styles/base.scss'),
      read('../src/styles/design-system/utilities.scss'),
      read('../src/styles/tailwind.css'),
    ])

    expect(base).toMatch(/body\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-body\);/)
    for (const role of ['display', 'label', 'body-sm', 'body-lg', 'reading', 'row-title', 'control', 'metric', 'code', 'title-xl']) {
      expect(utilities).toContain(`'type-${role}'`)
    }
    expect(utilities).toContain("'font-body': (font-weight: var(--cpx-sys-font-weight-body))")

    const mappings = {
      xs: 'xs',
      sm: 'sm',
      base: 'md',
      lg: 'lg',
      xl: 'xl',
      '2xl': '2xl',
      '3xl': '3xl',
      '4xl': '4xl',
    }
    for (const [tailwindName, tokenName] of Object.entries(mappings)) {
      expect(tailwind).toContain(`--text-${tailwindName}: var(--cpx-sys-font-size-${tokenName});`)
    }
  })

  test('representative components keep page, section, row, reading, control, metric, and meta responsibilities distinct', async () => {
    const [settings, session, markdown, button, billing, conversation] = await Promise.all([
      read('../src/styles/features/_settings-core.scss'),
      read('../src/styles/features/_session-page.scss'),
      read('../src/styles/markdown.scss'),
      read('../src/styles/components/button.scss'),
      read('../src/styles/features/_settings-billing.scss'),
      read('../src/styles/features/_canonical-conversation.scss'),
    ])

    expect(settings).toMatch(/\.settings-page-title\s*\{[^}]*font:\s*var\(--cpx-sys-type-heading-xl\);/s)
    expect(settings).toMatch(/\.settings-section-title\s*\{[^}]*font:\s*var\(--cpx-sys-type-heading-sm\);/s)
    expect(settings).toMatch(/\.settings-management-row-title\s*\{[^}]*font:\s*var\(--cpx-sys-type-row-title\);/s)
    expect(session).toMatch(/\.quick-chat-hero\s*\{[^}]*font:\s*var\(--cpx-sys-type-display\);/s)
    expect(markdown).toMatch(/\.md-body\s*\{[^}]*font:\s*var\(--cpx-sys-type-reading\);/s)
    expect(markdown).toMatch(/h2\s*\{[^}]*font:\s*var\(--cpx-sys-type-heading-lg\);/s)
    expect(button).toMatch(/\.ui-button\s*\{[^}]*font:\s*var\(--cpx-sys-type-control\);/s)
    expect(billing).toMatch(/\.usage-metric-card strong\s*\{[^}]*font:\s*var\(--cpx-sys-type-metric\);[^}]*font-variant-numeric:\s*tabular-nums;/s)
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-caption\);/)
  })

  test('tokens.scss defines the corrected 4px spacing scale 1..8 = 4/8/12/16/20/24/28/32px', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const expected: Record<string, string> = {
      '--cpx-sys-space-1': '4px',
      '--cpx-sys-space-2': '8px',
      '--cpx-sys-space-3': '12px',
      '--cpx-sys-space-4': '16px',
      '--cpx-sys-space-5': '20px',
      '--cpx-sys-space-6': '24px',
      '--cpx-sys-space-7': '28px',
      '--cpx-sys-space-8': '32px',
    }
    const mismatched = Object.entries(expected).filter(([name, value]) => tokens.get(name) !== value)
    const details = mismatched
      .map(([name, value]) => `${name}=${tokens.get(name) ?? '(missing)'} (expected ${value})`)
      .join(', ')

    expect(
      details,
      `tokens.scss space scale must be 4/8/12/16/20/24/28/32px: ${details || 'ok'}`,
    ).toBe('')
  })

  test('tokens.scss defines semantic radius roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const roles = [
      'indicator',
      'compact',
      'control',
      'container',
      'floating',
      'pill',
    ].map((role) => `--cpx-sys-radius-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.scss must define every radius role as a --cpx-sys-radius-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.scss defines semantic motion roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const roles = [
      'instant',
      'feedback',
      'exit',
      'state',
      'enter',
      'panel',
      'loading',
    ].map((role) => `--cpx-sys-motion-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.scss must define every motion role as a --cpx-sys-motion-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.scss defines semantic z-index roles', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const roles = [
      'local',
      'sticky',
      'dock',
      'composer',
      'modal',
      'popover',
      'tooltip',
      'toast',
    ].map((role) => `--cpx-sys-z-${role}`)

    const missing = missingFrom(tokens, roles)
    expect(
      missing,
      `tokens.scss must define every z-index role as a --cpx-sys-z-* token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.scss no longer defines root geometry tokens --control-/--layout-/--app-icon-/--menu-', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    const banned = [...tokens.keys()].filter((name) =>
      /^--(?:control|layout|app-icon|menu)-/.test(name),
    )

    expect(
      banned,
      `tokens.scss must not define root geometry tokens: ${banned.join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('check-style-contracts.ts implements the featureTokenContract', async () => {
    const checker = await read('../scripts/check-style-contracts.ts')

    expect(checker).toContain('featureTokenContract')

    // Coverage: styles + scripts/TSX + inline style + Tailwind arbitrary +
    // component geometry + every literal non-color dimension.
    for (const marker of [
      'feature styles must not use literal',
      'feature TSX must not use literal',
      'inline style',
      'Tailwind arbitrary',
      'semantic typography role',
      'component geometry',
      'literal typography',
      'literal radius',
      'literal motion',
      'literal shadow',
      'literal z-index',
      'literal spacing',
    ]) {
      expect(
        checker.includes(marker),
        `check-style-contracts.ts must enforce the non-color token contract for "${marker}"`,
      ).toBe(true)
    }

    // Precise reason + stale detection (mirrors the feature color contract).
    expect(checker).toContain('feature token exception needs a concrete reason')
    expect(checker).toContain('stale feature token exception')
  })

  test('style-contracts.json ships a precise, stale-detectable featureTokenContract', async () => {
    const manifest = JSON.parse(await read('../style-contracts.json')) as {
      featureTokenContract: {
        roots: string[]
        componentGeometryExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        inlineStyleExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        tailwindArbitraryExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        tailwindTypographyExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalTypographyExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalRadiusExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalMotionExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalShadowExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalZIndexExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
        literalSpacingExceptions: Array<{ file: string; value?: string; localProperty?: string; reason: string }>
      }
    }

    expect(manifest.featureTokenContract, 'style-contracts.json must contain featureTokenContract').toBeDefined()
    expect(manifest.featureTokenContract.roots).toEqual([
      'src/styles/features',
      'src/styles/lazy',
    ])

    for (const [category, exceptions] of Object.entries({
      componentGeometryExceptions: manifest.featureTokenContract.componentGeometryExceptions,
      inlineStyleExceptions: manifest.featureTokenContract.inlineStyleExceptions,
      tailwindArbitraryExceptions: manifest.featureTokenContract.tailwindArbitraryExceptions,
      tailwindTypographyExceptions: manifest.featureTokenContract.tailwindTypographyExceptions,
      literalTypographyExceptions: manifest.featureTokenContract.literalTypographyExceptions,
      literalRadiusExceptions: manifest.featureTokenContract.literalRadiusExceptions,
      literalMotionExceptions: manifest.featureTokenContract.literalMotionExceptions,
      literalShadowExceptions: manifest.featureTokenContract.literalShadowExceptions,
      literalZIndexExceptions: manifest.featureTokenContract.literalZIndexExceptions,
      literalSpacingExceptions: manifest.featureTokenContract.literalSpacingExceptions,
    })) {
      expect(
        Array.isArray(exceptions),
        `featureTokenContract.${category} must be an exception array`,
      ).toBe(true)
      for (const exception of exceptions) {
        expect(
          exception.file.length > 0 && !exception.file.includes('*'),
          `${category} exception must name one concrete file without wildcards: ${exception.file}`,
        ).toBe(true)
        expect(
          exception.reason.length > 15,
          `${category} exception needs a concrete reason (>15 chars): ${exception.file} -> ${exception.value ?? exception.localProperty ?? ''}`,
        ).toBe(true)
        expect(
          (exception.value ?? exception.localProperty ?? '').length > 0,
          `${category} exception must pin the exact value or local property: ${exception.file}`,
        ).toBe(true)
      }
    }
  })

  test('base.scss reduced-motion zeroes every system motion token', async () => {
    const base = await read('../src/styles/base.scss')
    const reduceMotion = blockContent(base, /\[data-reduce-motion="on"\]\s*\{/)

    expect(
      reduceMotion,
      'base.scss must contain a :root[data-reduce-motion="on"] block that resets motion tokens',
    ).toBeDefined()

    const motionTokens = [
      '--cpx-sys-motion-instant',
      '--cpx-sys-motion-feedback',
      '--cpx-sys-motion-exit',
      '--cpx-sys-motion-state',
      '--cpx-sys-motion-enter',
      '--cpx-sys-motion-panel',
      '--cpx-sys-motion-loading',
    ]
    const declarations = new Map<string, string>()
    for (const match of reduceMotion!.matchAll(/(--cpx-sys-motion-[\w-]+)[ \t]*:[ \t]*([^;]+);/g)) {
      declarations.set(match[1], match[2].trim())
    }

    const missing = motionTokens.filter((name) => !declarations.has(name))
    expect(
      missing,
      `reduced-motion must zero every system motion token; missing: ${missing.join(', ') || 'none'}`,
    ).toEqual([])

    for (const name of motionTokens) {
      const value = declarations.get(name)
      expect(
        value !== undefined && /^0(?:ms)?$/.test(value),
        `${name} must be zeroed under reduced-motion (got: ${value ?? '(missing)'})`,
      ).toBe(true)
    }

    // base.scss must never reintroduce non-zero motion tokens (e.g. 1ms).
    const nonZero = [...declarations.entries()].filter(([, value]) => !/^0(?:ms)?$/.test(value))
    expect(
      nonZero,
      `base.scss must not set non-zero motion tokens; offending: ${nonZero.map(([name, value]) => `${name}: ${value}`).join(', ') || 'none'}`,
    ).toEqual([])
  })

  test('tokens.scss defines the 3-tier layout width tokens (reading 42rem, content 48rem, wide 1250px)', async () => {
    const tokens = extractTokens(await read('../src/styles/design-system/tokens.scss'))
    expect(tokens.get('--cpx-sys-layout-reading-max-width')).toBe('42rem')
    expect(tokens.get('--cpx-sys-layout-content-max-width')).toBe('48rem')
    expect(tokens.get('--cpx-sys-layout-wide-max-width')).toBe('1250px')
  })

  test('canonical conversation aligns final agent response with reading width', async () => {
    const conversation = await read('../src/styles/features/_canonical-conversation.scss')
    const markdown = await read('../src/styles/markdown.scss')
    expect(conversation).toMatch(/--thread-reading-width:\s*var\(--cpx-sys-layout-reading-max-width\)/)
    expect(conversation).toMatch(
      /\.canonical-text-item--result\s*\{[\s\S]*?> \.md-body\s*\{[\s\S]*?max-width:\s*var\(--thread-reading-width\)/,
    )
    expect(markdown).toMatch(
      /\.conversation-page \.canonical-text-item--result > \.md-body \.md-wide-block\s*\{[\s\S]*?width:\s*min\(\s*var\(--cpx-sys-layout-content-max-width\),\s*var\(--session-content-w\)\s*\)/,
    )
  })

  test('canonical conversation narrative content inherits one reading rhythm', async () => {
    const conversation = await read('../src/styles/features/_canonical-conversation.scss')
    const markdown = await read('../src/styles/markdown.scss')
    expect(conversation).toMatch(
      /\.canonical-turn\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-reading\);/,
    )
    for (const selector of [
      '\\.canonical-turn__thinking,\\s*\\.canonical-turn__status',
      '\\.cpx-agent-activity',
      '\\.canonical-turn-activity',
      '\\.canonical-process-card',
      '\\.cpx-agent-activity__item',
      '\\.cpx-agent-activity__details',
      '\\.cpx-agent-activity__file-changes',
      '\\.canonical-lifecycle-tool',
      '\\.canonical-subagent-card',
    ]) {
      expect(conversation).toMatch(
        new RegExp(`${selector}\\s*\\{[\\s\\S]*?font:\\s*inherit;`),
      )
    }
    expect(conversation).toMatch(
      /\.canonical-text-item\s*\{[\s\S]*?&--process\s*\{[\s\S]*?font:\s*inherit;/,
    )
    expect(conversation).toMatch(
      /\.canonical-user-message__bubble \.md-body,\s*\.canonical-text-item--process > \.md-body,\s*\.canonical-text-item--result > \.md-body/,
    )
    expect(conversation).toMatch(
      /\.canonical-turn__process\s*\{\s*gap:\s*var\(--cpx-sys-space-1\);/,
    )
    expect(markdown).toMatch(
      /\.md-table-block table\s*\{[\s\S]*?font:\s*var\(--cpx-sys-type-body\);/,
    )
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-caption\);/)
    expect(conversation).toMatch(/font:\s*var\(--cpx-sys-type-code\);/)
    expect(conversation).toMatch(
      /line-height:\s*var\(--cpx-sys-line-height-code\);/,
    )
  })

  test('Markdown code fallbacks use the shared code line-height token without a local floor', async () => {
    const markdown = await read('../src/styles/markdown.scss')
    expect(markdown).not.toMatch(/line-height:\s*max\(20px,\s*var\(--cpx-sys-line-height-code\)\)/)
    expect(markdown).toMatch(
      /\.md-code-placeholder,[\s\S]*?\.md-math-fallback\s*\{[\s\S]*?line-height:\s*var\(--cpx-sys-line-height-code\)/,
    )
  })

  test('settings page content defaults to content max width', async () => {
    const settings = await read('../src/styles/features/_settings-core.scss')
    expect(settings).toMatch(/max-width:\s*var\(--cpx-sys-layout-content-max-width\)/)
  })

  test('review diff uses shared code line-height token instead of local formula', async () => {
    const review = await read('../src/styles/features/review.scss')
    expect(review).not.toMatch(/--review-diffs-line-height:\s*max\(/)
    expect(review).toMatch(/line-height:\s*var\(--cpx-sys-line-height-code\)/)
  })
})
