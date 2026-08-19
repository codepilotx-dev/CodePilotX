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
  '--cpx-sys-color-surface',
  '--cpx-sys-color-surface-under',
  '--cpx-sys-color-fg-primary',
  '--cpx-sys-color-control',
  '--cpx-sys-color-border-subtle',
  '--cpx-sys-color-border-default',
  '--cpx-comp-dropdown-trigger-bg',
  '--cpx-comp-dropdown-trigger-fg',
  '--cpx-comp-dropdown-trigger-border',
  '--cpx-comp-dropdown-trigger-hover-bg',
  '--cpx-comp-dropdown-trigger-open-bg',
  '--cpx-comp-dropdown-trigger-disabled-fg',
  '--cpx-comp-dropdown-menu-bg',
  '--cpx-comp-dropdown-menu-fg',
  '--cpx-comp-dropdown-menu-border',
  '--cpx-comp-dropdown-item-hover-bg',
  '--cpx-comp-dropdown-item-selected-bg',
  '--cpx-comp-dropdown-item-pressed-bg',
  '--cpx-comp-dropdown-item-disabled-fg',
  '--cpx-comp-dropdown-focus-border',
  '--cpx-sys-shadow-floating',
  '--cpx-sys-radius-md',
  '--cpx-sys-radius-xl',
  '--cpx-comp-dock-tab-height',
  '--cpx-comp-sidebar-bg',
  '--cpx-comp-sidebar-border',
  '--cpx-comp-sidebar-item-active-bg',
  '--cpx-comp-dock-bg',
  '--cpx-comp-dock-border',
  '--cpx-comp-modal-bg',
  '--cpx-comp-modal-border',
  '--cpx-comp-tooltip-bg',
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
    expect(sidebarDock.slots.some(s => s.targetToken === '--cpx-comp-sidebar-bg')).toBe(true)
    expect(sidebarDock.slots.some(s => s.targetToken === '--cpx-comp-dock-bg')).toBe(true)
    expect(sidebarDock.slots.some(s => s.targetToken === '--cpx-comp-dock-tab-radius')).toBe(true)

    const modal = getThemeComponent('modal')!
    expect(modal.slots.some(s => s.targetToken === '--cpx-comp-modal-bg')).toBe(true)
    expect(modal.slots.some(s => s.targetToken === '--cpx-comp-modal-shadow')).toBe(true)

    const tooltip = getThemeComponent('tooltip-scroll-chip')!
    expect(tooltip.slots.some(s => s.targetToken === '--cpx-comp-tooltip-bg')).toBe(true)
    expect(tooltip.slots.some(s => s.targetToken === '--cpx-comp-tooltip-shadow')).toBe(true)

    const surfaces = getThemeComponent('surfaces')!
    expect(surfaces.slots.some(s => s.targetToken === '--cpx-comp-surface-panel')).toBe(true)
    expect(surfaces.slots.some(s => s.targetToken === '--cpx-comp-surface-floating')).toBe(true)
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
    expect(detectTokenType('--cpx-sys-color-surface')).toBe('color')
    expect(detectTokenType('--cpx-comp-dropdown-menu-bg')).toBe('color')
    expect(detectTokenType('--cpx-sys-shadow-floating')).toBe('shadow')
    expect(detectTokenType('--cpx-sys-shadow-control')).toBe('shadow')
    expect(detectTokenType('--cpx-sys-radius-md')).toBe('radius')
    expect(detectTokenType('--cpx-sys-radius-full')).toBe('radius')
    expect(detectTokenType('--cpx-comp-button-radius-md')).toBe('radius')
    expect(detectTokenType('--cpx-comp-button-size-compact')).toBe('dimension')
    expect(detectTokenType('--cpx-comp-dock-tab-height')).toBe('dimension')
    expect(detectTokenType('--cpx-sys-font-family-mono')).toBe('typography')
    expect(detectTokenType('--cpx-sys-font-size-md')).toBe('typography')
    expect(detectTokenType('--cpx-comp-surface-edge')).toBe('border')
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
    const refRecipe = createReferenceRecipe('--cpx-sys-color-control')
    expect(serializeRecipe(refRecipe)).toBe('var(--cpx-sys-color-control)')

    const litRecipe = createLiteralRecipe('12px')
    expect(serializeRecipe(litRecipe)).toBe('12px')
  })

  test('resolves authored, override and default slot bindings', () => {
    const runtimeTokens: RuntimeToken[] = [
      {
        name: '--cpx-comp-dropdown-menu-bg',
        valueType: 'color',
        resolvedValue: 'rgb(30, 30, 30)',
        authoredValue: 'var(--cpx-sys-color-elevated-secondary)',
        source: 'stylesheet',
        references: 4,
      },
      {
        name: '--cpx-comp-dock-tab-height',
        valueType: 'dimension',
        resolvedValue: '46px',
        authoredValue: '46px',
        source: 'stylesheet',
        references: 2,
      },
    ]

    const emptyDraft: ThemeTokenDraft = { customTokens: {}, overrides: {} }

    const bgBinding = resolveSlotBinding('--cpx-comp-dropdown-menu-bg', emptyDraft, runtimeTokens)
    expect(bgBinding.kind).toBe('authored')
    expect(getBoundTokenName(bgBinding)).toBe('--cpx-sys-color-elevated-secondary')

    const heightBinding = resolveSlotBinding('--cpx-comp-dock-tab-height', emptyDraft, runtimeTokens)
    expect(heightBinding.kind).toBe('default')

    const overriddenDraft: ThemeTokenDraft = {
      customTokens: {},
      overrides: {
        '--cpx-comp-dock-tab-height': createLiteralRecipe('50px'),
      },
    }
    const overriddenBinding = resolveSlotBinding('--cpx-comp-dock-tab-height', overriddenDraft, runtimeTokens)
    expect(overriddenBinding.kind).toBe('override')
  })

  test('supports single component and all modifications code export scopes', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--cpx-custom-bg': createLiteralRecipe('#202020'),
      },
      overrides: {
        '--cpx-comp-dropdown-menu-bg': createReferenceRecipe('--cpx-custom-bg'),
        '--cpx-comp-dock-tab-height': createLiteralRecipe('52px'),
      },
    }

    const dropdown = getThemeComponent('dropdown')!

    // Export current component only
    const componentCode = generateThemeTokenCode(draft, {
      format: 'css',
      scope: 'dropdown',
      selectedComponentSlots: dropdown.slots,
    })
    expect(componentCode).toContain('--cpx-comp-dropdown-menu-bg: var(--cpx-custom-bg);')
    expect(componentCode).not.toContain('--cpx-comp-dock-tab-height')

    // Export all modifications
    const allCode = generateThemeTokenCode(draft, { format: 'css', scope: 'all' })
    expect(allCode).toContain('--cpx-comp-dropdown-menu-bg: var(--cpx-custom-bg);')
    expect(allCode).toContain('--cpx-comp-dock-tab-height: 52px;')
  })

  test('protects custom tokens from deletion when referenced', () => {
    const draft: ThemeTokenDraft = {
      customTokens: {
        '--cpx-custom-base': createReferenceRecipe('--cpx-sys-color-surface'),
      },
      overrides: {
        '--cpx-comp-dropdown-menu-bg': createReferenceRecipe('--cpx-custom-base'),
      },
    }

    const error = validateCustomTokenDeletion('--cpx-custom-base', draft)
    expect(error).toContain('无法删除')
  })

  test('validates cycle detection, unknown tokens, and rejects color-mix for non-color tokens', () => {
    const cyclicDraft: ThemeTokenDraft = {
      customTokens: {
        '--cpx-custom-a': createReferenceRecipe('--cpx-custom-b'),
        '--cpx-custom-b': createReferenceRecipe('--cpx-custom-a'),
      },
      overrides: {},
    }
    expect(validateDraft(cyclicDraft, knownTokens)).toContain('循环引用')

    const nonColorMixDraft: ThemeTokenDraft = {
      customTokens: {
        '--cpx-sys-radius-bad-mix': {
          kind: 'color-mix',
          from: { kind: 'token', token: '--cpx-sys-radius-md' },
          to: { kind: 'literal', value: '12px' },
          toAmount: 50,
          colorSpace: 'srgb',
        },
      },
      overrides: {},
    }
    expect(validateDraft(nonColorMixDraft, knownTokens)).toContain('仅色彩类型 Token 支持 color-mix')
  })
})

describe('theme token debugger WCAG contrast calculation', () => {
  test('calculates WCAG contrast ratio accurately', () => {
    expect(parseRgbChannels('#FFFFFF')).toEqual([255, 255, 255])
    expect(parseRgbChannels('rgb(0, 0, 0)')).toEqual([0, 0, 0])
    expect(parseRgbChannels('invalid')).toBeNull()

    const lumWhite = calculateLuminance(255, 255, 255)
    const lumBlack = calculateLuminance(0, 0, 0)
    expect(lumWhite).toBeCloseTo(1, 2)
    expect(lumBlack).toBeCloseTo(0, 2)

    const blackOnWhite = calculateContrastRatio('#000000', '#FFFFFF')
    expect(blackOnWhite).toBeCloseTo(21, 0)
  })
})
