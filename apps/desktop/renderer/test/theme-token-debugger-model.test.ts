import { describe, expect, test } from 'bun:test'

import {
  calculateContrastRatio,
  calculateLuminance,
  createLiteralRecipe,
  createMixRecipe,
  createReferenceRecipe,
  DROPDOWN_COMPONENT_DEFINITION,
  DROPDOWN_CONTRAST_CHECKS,
  generateThemeTokenCode,
  getBoundTokenName,
  getThemeComponent,
  parseRgbChannels,
  parseSimpleVar,
  resolveSlotBinding,
  serializeRecipe,
  THEME_COMPONENTS,
  validateCustomTokenDeletion,
  validateDraft,
  type RuntimeColorToken,
  type ThemeTokenDraft,
} from '../src/features/theme-debugger/themeTokenDebuggerModel.js'

const knownTokens = new Set([
  '--color-token-bg-primary',
  '--color-token-foreground',
  '--color-background-control',
  '--color-background-control-opaque',
  '--codex-base-ink',
  '--vscode-dropdown-background',
  '--vscode-dropdown-foreground',
  '--color-token-dropdown-background',
  '--color-token-dropdown-foreground',
  '--color-token-dropdown-border',
  '--color-token-dropdown-trigger-background',
  '--color-token-dropdown-trigger-foreground',
  '--color-token-dropdown-trigger-border',
  '--color-token-dropdown-trigger-hover-background',
  '--color-token-dropdown-trigger-open-background',
  '--color-token-dropdown-trigger-disabled-foreground',
  '--color-token-dropdown-item-hover-background',
  '--color-token-dropdown-item-selected-background',
  '--color-token-dropdown-item-pressed-background',
  '--color-token-dropdown-item-disabled-foreground',
  '--color-token-dropdown-focus-border',
])

describe('theme token debugger component registry', () => {
  test('covers all Dropdown slots in trigger and surface groups', () => {
    expect(THEME_COMPONENTS).toHaveLength(1)
    const dropdown = getThemeComponent('dropdown')
    expect(dropdown).toBeDefined()
    expect(dropdown?.slots).toHaveLength(14)

    const triggerSlots = dropdown!.slots.filter(s => s.group === 'trigger')
    const surfaceSlots = dropdown!.slots.filter(s => s.group === 'surface')

    expect(triggerSlots.map(s => s.id)).toEqual([
      'trigger-background',
      'trigger-foreground',
      'trigger-border',
      'trigger-hover-background',
      'trigger-open-background',
      'trigger-disabled-foreground',
    ])

    expect(surfaceSlots.map(s => s.id)).toEqual([
      'surface-background',
      'surface-foreground',
      'surface-border',
      'surface-item-hover-background',
      'surface-item-selected-background',
      'surface-item-pressed-background',
      'surface-item-disabled-foreground',
      'focus-border',
    ])

    for (const slot of dropdown!.slots) {
      expect(slot.targetToken.startsWith('--color-token-dropdown-')).toBe(true)
    }

    expect(DROPDOWN_CONTRAST_CHECKS).toHaveLength(5)
  })
})

describe('theme token debugger property bindings and recipes', () => {
  test('generates reference recipe upon property selection', () => {
    const recipe = createReferenceRecipe('--color-background-control')
    expect(recipe).toEqual({
      kind: 'reference',
      source: { kind: 'token', token: '--color-background-control' },
    })
    expect(serializeRecipe(recipe)).toBe('var(--color-background-control)')
  })

  test('binds user example three items and serializes to code', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-background-control'),
        '--color-token-dropdown-foreground': createReferenceRecipe('--codex-base-ink'),
        '--color-token-dropdown-item-hover-background': createReferenceRecipe('--color-token-bg-primary'),
      },
    }

    expect(validateDraft(draft, knownTokens)).toBeNull()

    const code = generateThemeTokenCode(draft, new Set())
    expect(code).toContain('--color-token-dropdown-background: var(--color-background-control);')
    expect(code).toContain('--color-token-dropdown-foreground: var(--codex-base-ink);')
    expect(code).toContain('--color-token-dropdown-item-hover-background: var(--color-token-bg-primary);')
  })

  test('parses simple var authored references and does not mis-infer complex recipes', () => {
    expect(parseSimpleVar('var(--vscode-dropdown-background)')).toBe('--vscode-dropdown-background')
    expect(parseSimpleVar('  var( --color-token-input-background ) ')).toBe('--color-token-input-background')
    expect(parseSimpleVar('color-mix(in srgb, var(--color-text-foreground) 5%, transparent)')).toBeNull()
    expect(parseSimpleVar('#FFFFFF')).toBeNull()
    expect(parseSimpleVar('var(--color, #000)')).toBeNull()
    expect(parseSimpleVar('')).toBeNull()
    expect(parseSimpleVar(undefined)).toBeNull()

    const runtimeTokens: RuntimeColorToken[] = [
      {
        name: '--color-token-dropdown-background',
        resolvedValue: 'rgb(30, 30, 30)',
        authoredValue: 'var(--vscode-dropdown-background)',
        source: 'stylesheet',
        references: 4,
      },
      {
        name: '--color-token-dropdown-item-hover-background',
        resolvedValue: 'rgba(255, 255, 255, 0.08)',
        authoredValue: 'color-mix(in srgb, var(--color-text-foreground) 8%, transparent)',
        source: 'stylesheet',
        references: 2,
      },
    ]

    const emptyDraft: ThemeTokenDraft = { customTokens: {}, overrides: {} }

    const bgBinding = resolveSlotBinding('--color-token-dropdown-background', emptyDraft, runtimeTokens)
    expect(bgBinding.kind).toBe('authored')
    expect(getBoundTokenName(bgBinding)).toBe('--vscode-dropdown-background')

    const hoverBinding = resolveSlotBinding('--color-token-dropdown-item-hover-background', emptyDraft, runtimeTokens)
    expect(hoverBinding.kind).toBe('default')
    expect(getBoundTokenName(hoverBinding)).toBeUndefined()

    // Override priority: draft override takes precedence over authored
    const overriddenDraft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-background-control'),
      },
    }
    const overriddenBinding = resolveSlotBinding('--color-token-dropdown-background', overriddenDraft, runtimeTokens)
    expect(overriddenBinding.kind).toBe('override')
    expect(getBoundTokenName(overriddenBinding)).toBe('--color-background-control')
  })
})

describe('theme token debugger create & apply, overrides, and independent resets', () => {
  test('creates custom token and applies to component slot', () => {
    const customRecipe = createMixRecipe(
      { kind: 'token', token: '--color-token-bg-primary' },
      { kind: 'literal', color: '#FFFFFF' },
      8,
    )
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-custom-bg': customRecipe,
      },
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-token-custom-bg'),
      },
    }

    expect(validateDraft(draft, knownTokens)).toBeNull()
    expect(serializeRecipe(customRecipe)).toBe('color-mix(in srgb, var(--color-token-bg-primary) 92%, #FFFFFF 8%)')
  })

  test('rejects mix when both operands are literal colors', () => {
    const dualLiteralMix = createMixRecipe(
      { kind: 'literal', color: '#000000' },
      { kind: 'literal', color: '#FFFFFF' },
      50,
    )
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-invalid-mix': dualLiteralMix,
      },
      overrides: {},
    }
    expect(validateDraft(draft, knownTokens)).toContain('两端均为固定色')
  })

  test('supports global override on system tokens', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--color-background-control': createLiteralRecipe('#1E1E1E'),
      },
    }
    expect(validateDraft(draft, knownTokens)).toBeNull()
    const code = generateThemeTokenCode(draft, new Set())
    expect(code).toContain('--color-background-control: #1E1E1E;')
  })

  test('slot override reset and source token global override reset are independent', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-background-control'),
        '--color-background-control': createLiteralRecipe('#252525'),
      },
    }

    // Reset slot override only
    const slotResetOverrides = { ...draft.overrides }
    delete slotResetOverrides['--color-token-dropdown-background']
    expect(slotResetOverrides['--color-background-control']).toBeDefined()

    // Reset source token override only
    const sourceResetOverrides = { ...draft.overrides }
    delete sourceResetOverrides['--color-background-control']
    expect(sourceResetOverrides['--color-token-dropdown-background']).toBeDefined()
  })

  test('protects custom tokens from deletion when referenced by slots or other tokens', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-base': createReferenceRecipe('--color-token-bg-primary'),
        '--color-token-derived': createReferenceRecipe('--color-token-base'),
      },
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-token-base'),
      },
    }

    // Attempt to delete --color-token-base (referenced by both slot and another custom token)
    const baseCheck = validateCustomTokenDeletion('--color-token-base', draft, THEME_COMPONENTS)
    expect(baseCheck.canDelete).toBe(false)
    expect(baseCheck.references).toHaveLength(2)
    expect(baseCheck.references.some(r => r.includes('Dropdown 菜单背景'))).toBe(true)
    expect(baseCheck.references.some(r => r.includes('自定义 Token (--color-token-derived)'))).toBe(true)

    // Attempt to delete --color-token-derived (not referenced by anything)
    const derivedCheck = validateCustomTokenDeletion('--color-token-derived', draft, THEME_COMPONENTS)
    expect(derivedCheck.canDelete).toBe(true)
    expect(derivedCheck.references).toHaveLength(0)
  })

  test('validates cycle detection, unknown tokens and invalid token names', () => {
    const cyclicDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-a': createReferenceRecipe('--color-token-b'),
        '--color-token-b': createReferenceRecipe('--color-token-a'),
      },
      overrides: {},
    }
    expect(validateDraft(cyclicDraft, knownTokens)).toContain('循环引用')

    const unknownDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-valid': createReferenceRecipe('--color-token-nonexistent'),
      },
      overrides: {},
    }
    expect(validateDraft(unknownDraft, knownTokens)).toContain('未知 token')

    const invalidNameDraft: ThemeTokenDraft = {
      customTokens: {
        'invalid-name': createReferenceRecipe('--color-token-bg-primary'),
      },
      overrides: {},
    }
    expect(validateDraft(invalidNameDraft, knownTokens)).toContain('自定义 token 名称无效')

    const invalidLiteralDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-bad-literal': {
          kind: 'reference',
          source: { kind: 'literal', color: '#1234' as `#${string}` },
        },
      },
      overrides: {},
    }
    expect(validateDraft(invalidLiteralDraft, knownTokens)).toContain('固定颜色格式无效')

    const invalidMixHexDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-bad-mix-hex': {
          kind: 'mix',
          from: { kind: 'token', token: '--color-token-bg-primary' },
          to: { kind: 'literal', color: 'invalid-hex' as `#${string}` },
          toAmount: 50,
          colorSpace: 'srgb',
        },
      },
      overrides: {},
    }
    expect(validateDraft(invalidMixHexDraft, knownTokens)).toContain('固定颜色格式无效')

    const invalidMixAmountDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-bad-amount': {
          kind: 'mix',
          from: { kind: 'token', token: '--color-token-bg-primary' },
          to: { kind: 'literal', color: '#FFFFFF' },
          toAmount: 150,
          colorSpace: 'srgb',
        },
      },
      overrides: {},
    }
    expect(validateDraft(invalidMixAmountDraft, knownTokens)).toContain('混色比例无效')
  })

  test('partitions generated code between SCSS root and TypeScript inline overrides', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-z': createReferenceRecipe('--color-token-a'),
        '--color-token-a': createReferenceRecipe('--color-token-bg-primary'),
      },
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-token-z'),
        '--color-background-control-opaque': createReferenceRecipe('--color-token-z'),
      },
    }

    const code = generateThemeTokenCode(draft, new Set(['--color-background-control-opaque']))
    expect(code).toContain('// codex-semantic-tokens.scss')
    expect(code).toContain('// themeVariables.ts')
    expect(code.indexOf('--color-token-a:')).toBeLessThan(code.indexOf('--color-token-z:'))
    expect(code).toContain("'--color-background-control-opaque': 'var(--color-token-z)'")
  })
})

describe('theme token debugger contrast calculation', () => {
  test('calculates WCAG contrast ratio accurately', () => {
    expect(parseRgbChannels('rgb(255, 255, 255)')).toEqual([255, 255, 255])
    expect(parseRgbChannels('rgba(0, 0, 0, 1)')).toEqual([0, 0, 0])
    expect(parseRgbChannels('invalid')).toBeNull()

    const lumWhite = calculateLuminance([255, 255, 255])
    const lumBlack = calculateLuminance([0, 0, 0])
    expect(lumWhite).toBeCloseTo(1, 2)
    expect(lumBlack).toBeCloseTo(0, 2)

    const blackOnWhite = calculateContrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')
    expect(blackOnWhite).toBeCloseTo(21, 0)

    const sameColor = calculateContrastRatio('rgb(100, 100, 100)', 'rgb(100, 100, 100)')
    expect(sameColor).toBeCloseTo(1, 1)

    expect(calculateContrastRatio(undefined, 'rgb(255, 255, 255)')).toBeNull()
  })
})
