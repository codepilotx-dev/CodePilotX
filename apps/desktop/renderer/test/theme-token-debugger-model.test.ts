import { describe, expect, test } from 'bun:test'

import {
  CATEGORY_LABELS,
  DROPDOWN_COMPONENT,
  THEME_COMPONENTS,
  getComponentsByCategory,
  getThemeComponent,
} from '../src/features/theme-debugger/themeComponentRegistry.js'
import {
  calculateContrastRatio,
  calculateLuminance,
  createLiteralRecipe,
  createMixRecipe,
  createReferenceRecipe,
  detectTokenType,
  generateThemeTokenCode,
  getBoundTokenName,
  getDefaultLiteralForType,
  getPlaceholderForType,
  isColorValue,
  isValidCssValue,
  parseRgbChannels,
  parseSimpleVar,
  resolveSlotBinding,
  serializeRecipe,
  validateCustomTokenDeletion,
  validateDraft,
  type RuntimeToken,
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
  '--layer-panel-fill',
  '--layer-floating-fill',
  '--shadow-floating',
  '--radius-control',
  '--radius-floating',
  '--workbench-tab-strip-height',
  '--sidebar-background',
  '--sidebar-border',
  '--sidebar-item-active-background',
  '--right-dock-background',
  '--right-dock-border-color',
  '--modal-surface-background',
  '--modal-surface-border',
  '--tooltip-surface-background',
])

describe('theme token debugger component registry', () => {
  test('covers all 13 components across 4 categories', () => {
    expect(THEME_COMPONENTS.length).toBe(13)

    const expectedIds = [
      'dropdown',
      'button',
      'input',
      'switch-segmented',
      'tooltip-scroll-chip',
      'surfaces',
      'modal',
      'sidebar-dock',
      'workbench',
      'menubar',
      'composer',
      'terminal',
      'review-diff',
    ]

    for (const id of expectedIds) {
      const comp = getThemeComponent(id)
      expect(comp).toBeDefined()
      expect(comp!.slots.length).toBeGreaterThan(0)
    }

    expect(getComponentsByCategory('primitives').length).toBe(5)
    expect(getComponentsByCategory('containers').length).toBe(2)
    expect(getComponentsByCategory('layout').length).toBe(3)
    expect(getComponentsByCategory('features').length).toBe(3)
    expect(Object.keys(CATEGORY_LABELS).length).toBe(4)
  })

  test('covers component semantic aliases for independent scoping', () => {
    const sidebarDock = getThemeComponent('sidebar-dock')!
    expect(sidebarDock.slots.some(s => s.targetToken === '--sidebar-background')).toBe(true)
    expect(sidebarDock.slots.some(s => s.targetToken === '--right-dock-background')).toBe(true)
    expect(sidebarDock.slots.some(s => s.targetToken === '--right-dock-tab-radius')).toBe(true)

    const modal = getThemeComponent('modal')!
    expect(modal.slots.some(s => s.targetToken === '--modal-surface-background')).toBe(true)
    expect(modal.slots.some(s => s.targetToken === '--modal-surface-shadow')).toBe(true)

    const tooltip = getThemeComponent('tooltip-scroll-chip')!
    expect(tooltip.slots.some(s => s.targetToken === '--tooltip-surface-background')).toBe(true)
    expect(tooltip.slots.some(s => s.targetToken === '--tooltip-surface-shadow')).toBe(true)

    const surfaces = getThemeComponent('surfaces')!
    expect(surfaces.slots.some(s => s.targetToken === '--layer-panel-fill')).toBe(true)
    expect(surfaces.slots.some(s => s.targetToken === '--layer-floating-fill')).toBe(true)
  })

  test('covers Dropdown 14 slots and contrast checks', () => {
    const dropdown = getThemeComponent('dropdown')
    expect(dropdown).toBeDefined()
    expect(dropdown?.slots).toHaveLength(14)
    expect(dropdown?.contrastChecks).toHaveLength(5)
  })
})

describe('theme token debugger multi-type token classification and validation', () => {
  test('accurately detects token value types', () => {
    expect(detectTokenType('--color-token-bg-primary')).toBe('color')
    expect(detectTokenType('--vscode-dropdown-background')).toBe('color')
    expect(detectTokenType('--shadow-floating')).toBe('shadow')
    expect(detectTokenType('--shadow-control-sm')).toBe('shadow')
    expect(detectTokenType('--radius-control')).toBe('radius')
    expect(detectTokenType('--radius-pill')).toBe('radius')
    expect(detectTokenType('--button-radius-md')).toBe('radius')
    expect(detectTokenType('--button-size-compact')).toBe('dimension')
    expect(detectTokenType('--workbench-tab-strip-height')).toBe('dimension')
    expect(detectTokenType('--font-family-mono')).toBe('typography')
    expect(detectTokenType('--type-body')).toBe('typography')
    expect(detectTokenType('--layer-edge')).toBe('border')
  })

  test('provides typed default literals and placeholders', () => {
    expect(getDefaultLiteralForType('color')).toBe('#FFFFFF')
    expect(getDefaultLiteralForType('radius')).toBe('8px')
    expect(getDefaultLiteralForType('shadow')).toContain('rgba')
    expect(getDefaultLiteralForType('border')).toContain('solid')
    expect(getDefaultLiteralForType('dimension')).toBe('24px')
    expect(getDefaultLiteralForType('typography')).toBe('14px')

    expect(getPlaceholderForType('color')).toContain('#FFFFFF')
    expect(getPlaceholderForType('radius')).toContain('px')
    expect(getPlaceholderForType('shadow')).toContain('rgba')
  })

  test('validates CSS values accurately', () => {
    expect(isColorValue('#FFFFFF')).toBe(true)
    expect(isColorValue('#123')).toBe(true)
    expect(isColorValue('rgb(0, 0, 0)')).toBe(true)
    expect(isColorValue('rgba(255, 255, 255, 0.5)')).toBe(true)
    expect(isColorValue('color-mix(in srgb, red 50%, white)')).toBe(true)
    expect(isColorValue('16px')).toBe(false)
    expect(isColorValue('none')).toBe(false)

    expect(isValidCssValue('background-color', '#FFFFFF', 'color')).toBe(true)
    expect(isValidCssValue('border-radius', '12px', 'radius')).toBe(true)
    expect(isValidCssValue('border-radius', '9999px', 'radius')).toBe(true)
    expect(isValidCssValue('box-shadow', '0 8px 24px -16px rgba(0,0,0,0.2)', 'shadow')).toBe(true)
    expect(isValidCssValue('border', '1px solid #E0E0E0', 'border')).toBe(true)
    expect(isValidCssValue('height', '46px', 'dimension')).toBe(true)
  })
})

describe('theme token debugger recipes, bindings, and code generation', () => {
  test('generates reference and literal recipes', () => {
    const refRecipe = createReferenceRecipe('--color-background-control')
    expect(serializeRecipe(refRecipe)).toBe('var(--color-background-control)')

    const litRecipe = createLiteralRecipe('12px')
    expect(serializeRecipe(litRecipe)).toBe('12px')
  })

  test('resolves authored, override and default slot bindings', () => {
    const runtimeTokens: RuntimeToken[] = [
      {
        name: '--color-token-dropdown-background',
        valueType: 'color',
        resolvedValue: 'rgb(30, 30, 30)',
        authoredValue: 'var(--vscode-dropdown-background)',
        source: 'stylesheet',
        references: 4,
      },
      {
        name: '--workbench-tab-strip-height',
        valueType: 'dimension',
        resolvedValue: '46px',
        authoredValue: '46px',
        source: 'stylesheet',
        references: 2,
      },
    ]

    const emptyDraft: ThemeTokenDraft = { customTokens: {}, overrides: {} }

    const bgBinding = resolveSlotBinding('--color-token-dropdown-background', emptyDraft, runtimeTokens)
    expect(bgBinding.kind).toBe('authored')
    expect(getBoundTokenName(bgBinding)).toBe('--vscode-dropdown-background')

    const heightBinding = resolveSlotBinding('--workbench-tab-strip-height', emptyDraft, runtimeTokens)
    expect(heightBinding.kind).toBe('default')

    const overriddenDraft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--workbench-tab-strip-height': createLiteralRecipe('50px'),
      },
    }
    const overriddenBinding = resolveSlotBinding('--workbench-tab-strip-height', overriddenDraft, runtimeTokens)
    expect(overriddenBinding.kind).toBe('override')
  })

  test('supports single component and all modifications code export scopes', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-custom-bg': createLiteralRecipe('#202020'),
      },
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-token-custom-bg'),
        '--workbench-tab-strip-height': createLiteralRecipe('52px'),
      },
    }

    const dropdown = getThemeComponent('dropdown')!

    // Export current component only
    const componentCode = generateThemeTokenCode(draft, new Set(), {
      scope: 'component',
      componentSlots: dropdown.slots,
    })
    expect(componentCode).toContain('--color-token-dropdown-background: var(--color-token-custom-bg);')
    expect(componentCode).not.toContain('--workbench-tab-strip-height')

    // Export all modifications
    const allCode = generateThemeTokenCode(draft, new Set(), { scope: 'all' })
    expect(allCode).toContain('--color-token-dropdown-background: var(--color-token-custom-bg);')
    expect(allCode).toContain('--workbench-tab-strip-height: 52px;')
  })

  test('protects custom tokens from deletion when referenced', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-base': createReferenceRecipe('--color-token-bg-primary'),
      },
      overrides: {
        '--color-token-dropdown-background': createReferenceRecipe('--color-token-base'),
      },
    }

    const check = validateCustomTokenDeletion('--color-token-base', draft, THEME_COMPONENTS)
    expect(check.canDelete).toBe(false)
    expect(check.references.length).toBe(1)
  })

  test('validates cycle detection, unknown tokens, and rejects color-mix for non-color tokens', () => {
    const cyclicDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-a': createReferenceRecipe('--color-token-b'),
        '--color-token-b': createReferenceRecipe('--color-token-a'),
      },
      overrides: {},
    }
    expect(validateDraft(cyclicDraft, knownTokens)).toContain('循环引用')

    const invalidMixAmountDraft: ThemeTokenDraft = {
      customTokens: {
        '--color-token-bad-amount': {
          kind: 'color-mix',
          from: { kind: 'token', token: '--color-token-bg-primary' },
          to: { kind: 'literal', value: '#FFFFFF' },
          toAmount: 150,
          colorSpace: 'srgb',
        },
      },
      overrides: {},
    }
    expect(validateDraft(invalidMixAmountDraft, knownTokens)).toContain('混色比例无效')

    const nonColorMixDraft: ThemeTokenDraft = {
      customTokens: {
        '--radius-token-bad-mix': {
          kind: 'color-mix',
          from: { kind: 'token', token: '--radius-control' },
          to: { kind: 'literal', value: '12px' },
          toAmount: 50,
          colorSpace: 'srgb',
        },
      },
      overrides: {},
    }
    expect(validateDraft(nonColorMixDraft, knownTokens)).toContain('非颜色 Token')
  })
})

describe('theme token debugger WCAG contrast calculation', () => {
  test('calculates WCAG contrast ratio accurately', () => {
    expect(parseRgbChannels('#FFFFFF')).toEqual([255, 255, 255])
    expect(parseRgbChannels('rgb(0, 0, 0)')).toEqual([0, 0, 0])
    expect(parseRgbChannels('invalid')).toBeNull()

    const lumWhite = calculateLuminance([255, 255, 255])
    const lumBlack = calculateLuminance([0, 0, 0])
    expect(lumWhite).toBeCloseTo(1, 2)
    expect(lumBlack).toBeCloseTo(0, 2)

    const blackOnWhite = calculateContrastRatio('#000000', '#FFFFFF')
    expect(blackOnWhite).toBeCloseTo(21, 0)
  })
})
