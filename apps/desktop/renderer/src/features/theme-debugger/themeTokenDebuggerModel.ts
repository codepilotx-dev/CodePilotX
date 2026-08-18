export type ThemeTokenName = `--${string}`

export type ThemeTokenValueType =
  | 'color'
  | 'shadow'
  | 'radius'
  | 'border'
  | 'dimension'
  | 'typography'
  | 'custom'

export type ThemeTokenOperand =
  | { kind: 'token'; token: ThemeTokenName }
  | { kind: 'literal'; value: string }

export type ThemeTokenRecipe =
  | {
      kind: 'reference'
      source: ThemeTokenOperand
    }
  | {
      kind: 'color-mix'
      from: ThemeTokenOperand
      to: ThemeTokenOperand
      toAmount: number
      colorSpace: 'srgb' | 'oklab'
    }
  | {
      kind: 'literal'
      value: string
    }

export type ThemeTokenDraft = {
  customTokens: Record<ThemeTokenName, ThemeTokenRecipe>
  overrides: Record<ThemeTokenName, ThemeTokenRecipe>
}

export type ThemeComponentCategory =
  | 'primitives'
  | 'containers'
  | 'layout'
  | 'features'

export type ThemePropertySlot = {
  id: string
  label: string
  group: string
  valueType: ThemeTokenValueType
  cssProperty?: string
  targetToken: ThemeTokenName
  description: string
  contrastAgainst?: ThemeTokenName
  presetTokens?: readonly ThemeTokenName[]
  presetValues?: readonly string[]
}

export type ThemeComponentContrastCheck = {
  label: string
  foregroundToken: ThemeTokenName
  backgroundToken: ThemeTokenName
}

export type ThemeComponentDefinition = {
  id: string
  label: string
  category: ThemeComponentCategory
  description: string
  slots: readonly ThemePropertySlot[]
  contrastChecks?: readonly ThemeComponentContrastCheck[]
}

export type RuntimeToken = {
  name: ThemeTokenName
  valueType: ThemeTokenValueType
  resolvedValue: string
  authoredValue: string
  source: 'stylesheet' | 'inline-derived'
  references: number
}

// Backwards compatibility alias for RuntimeColorToken
export type RuntimeColorToken = RuntimeToken

export const CUSTOM_TOKEN_NAME = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/
export const HEX_COLOR = /^#[0-9a-f]{6}$/i
export const HEX_COLOR_SHORT = /^#[0-9a-f]{3}$/i
export const SIMPLE_VAR_REGEX = /^\s*var\(\s*(--[a-zA-Z0-9_-]+)\s*\)\s*$/

export function getDefaultLiteralForType(type: ThemeTokenValueType): string {
  switch (type) {
    case 'color':
      return '#FFFFFF'
    case 'shadow':
      return '0 8px 24px -16px rgba(0, 0, 0, 0.25)'
    case 'border':
      return '1px solid var(--color-token-border-light)'
    case 'radius':
      return '8px'
    case 'dimension':
      return '24px'
    case 'typography':
      return '14px'
    case 'custom':
    default:
      return 'inherit'
  }
}

export function getPlaceholderForType(type: ThemeTokenValueType): string {
  switch (type) {
    case 'color':
      return '#FFFFFF 或 rgb(255, 255, 255)'
    case 'shadow':
      return '0 8px 24px -16px rgba(0,0,0,0.25)'
    case 'border':
      return '1px solid var(--color-token-border-light)'
    case 'radius':
      return '8px / 12px / 9999px'
    case 'dimension':
      return '24px / 16px / 1.5rem'
    case 'typography':
      return '14px / var(--font-family-mono)'
    case 'custom':
    default:
      return 'CSS 声明值'
  }
}

export function isColorValue(value: string | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (HEX_COLOR.test(trimmed) || HEX_COLOR_SHORT.test(trimmed)) return true
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/i.test(trimmed)) return true
  if (/^hsla?\(/i.test(trimmed)) return true
  if (/^color-mix\(/i.test(trimmed)) return true
  if (trimmed === 'transparent' || trimmed === 'currentColor') return true
  return false
}

export function detectTokenType(name: string, value?: string): ThemeTokenValueType {
  const lowerName = name.toLowerCase()
  const lowerVal = (value ?? '').trim().toLowerCase()

  if (
    lowerName.startsWith('--color-') ||
    lowerName.includes('background') ||
    lowerName.includes('foreground') ||
    lowerName.includes('border-color') ||
    lowerName.startsWith('--vscode-') ||
    isColorValue(lowerVal)
  ) {
    if (lowerName.startsWith('--layer-edge') || lowerName.includes('-border') && (lowerVal.includes('solid') || lowerVal.includes('dashed'))) {
      return 'border'
    }
    return 'color'
  }

  if (lowerName.includes('shadow') || lowerVal.includes('drop-shadow') || (lowerVal.includes('px') && lowerVal.includes('rgba('))) {
    return 'shadow'
  }

  if (lowerName.includes('radius')) {
    return 'radius'
  }

  if (
    lowerName.includes('height') ||
    lowerName.includes('width') ||
    lowerName.includes('size') ||
    lowerName.includes('space') ||
    lowerName.includes('pad') ||
    lowerName.includes('gap') ||
    lowerName.includes('margin') ||
    lowerName.includes('padding') ||
    /^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)$/.test(lowerVal)
  ) {
    return 'dimension'
  }

  if (
    lowerName.includes('font') ||
    lowerName.includes('type-') ||
    lowerName.includes('line-height')
  ) {
    return 'typography'
  }

  if (lowerName.includes('edge') || lowerName.includes('border') || lowerName.includes('ring')) {
    return 'border'
  }

  return 'custom'
}

export function getCssPropertyForType(type: ThemeTokenValueType, customProperty?: string): string {
  if (customProperty) return customProperty
  switch (type) {
    case 'color':
      return 'background-color'
    case 'shadow':
      return 'box-shadow'
    case 'radius':
      return 'border-radius'
    case 'border':
      return 'border'
    case 'dimension':
      return 'height'
    case 'typography':
      return 'font-size'
    case 'custom':
    default:
      return 'display'
  }
}

export function isValidCssValue(cssProperty: string, value: string, valueType?: ThemeTokenValueType): boolean {
  if (!value || typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed) return false

  // If running in browser environment with CSS.supports
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    try {
      if (trimmed.startsWith('var(') && trimmed.endsWith(')')) {
        return true
      }
      return CSS.supports(cssProperty, trimmed)
    } catch {
      // Fallback to pattern matching only if CSS.supports throws
    }
  }

  // Safe pattern matching fallback for testing and node environments without CSS.supports
  if (valueType === 'color' || cssProperty.includes('color') || cssProperty.includes('background')) {
    return HEX_COLOR.test(trimmed) || HEX_COLOR_SHORT.test(trimmed) || /^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed) || /^color-mix\(/i.test(trimmed) || trimmed === 'transparent' || trimmed === 'currentColor' || trimmed.startsWith('var(')
  }

  if (valueType === 'radius' || cssProperty.includes('radius')) {
    return /^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|pt)?$/.test(trimmed) || trimmed === '0' || trimmed === 'inherit' || trimmed.startsWith('var(')
  }

  if (valueType === 'dimension' || cssProperty.includes('height') || cssProperty.includes('width') || cssProperty.includes('size')) {
    return /^-?\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|pt)?$/.test(trimmed) || trimmed === '0' || trimmed === 'auto' || trimmed === 'inherit' || trimmed.startsWith('calc(') || trimmed.startsWith('var(')
  }

  if (valueType === 'shadow' || cssProperty.includes('shadow')) {
    return trimmed === 'none' || trimmed.includes('px') || trimmed.includes('rgba(') || trimmed.includes('rgb(') || trimmed.startsWith('var(')
  }

  if (valueType === 'border' || cssProperty.includes('border') || cssProperty.includes('edge')) {
    return trimmed === 'none' || trimmed.includes('solid') || trimmed.includes('dashed') || trimmed.includes('dotted') || trimmed.includes('px') || trimmed.startsWith('var(')
  }

  if (valueType === 'typography' || cssProperty.includes('font')) {
    return /^-?\d+(?:\.\d+)?(?:px|rem|em|%)?$/.test(trimmed) || trimmed.includes('sans-serif') || trimmed.includes('monospace') || trimmed.includes('system-ui') || trimmed.startsWith('var(')
  }

  return true
}

export function parseSimpleVar(authoredValue: string | undefined): ThemeTokenName | null {
  if (!authoredValue) return null
  const match = authoredValue.trim().match(SIMPLE_VAR_REGEX)
  return match ? (match[1] as ThemeTokenName) : null
}

export type SlotBindingInfo =
  | {
      kind: 'override'
      boundToken?: ThemeTokenName
      recipe: ThemeTokenRecipe
      isDirectTokenRef: boolean
    }
  | {
      kind: 'authored'
      boundToken: ThemeTokenName
    }
  | {
      kind: 'default'
    }

export function getBoundTokenName(info: SlotBindingInfo): ThemeTokenName | undefined {
  if (info.kind === 'override') return info.boundToken
  if (info.kind === 'authored') return info.boundToken
  return undefined
}

export function resolveSlotBinding(
  targetToken: ThemeTokenName,
  draft: ThemeTokenDraft,
  runtimeTokens: readonly RuntimeToken[],
): SlotBindingInfo {
  const overrideRecipe = draft.overrides[targetToken]
  if (overrideRecipe) {
    if (overrideRecipe.kind === 'reference' && overrideRecipe.source.kind === 'token') {
      return {
        kind: 'override',
        boundToken: overrideRecipe.source.token,
        recipe: overrideRecipe,
        isDirectTokenRef: true,
      }
    }
    return {
      kind: 'override',
      recipe: overrideRecipe,
      isDirectTokenRef: false,
    }
  }

  const token = runtimeTokens.find(t => t.name === targetToken)
  const simpleVar = parseSimpleVar(token?.authoredValue)
  if (simpleVar) {
    return {
      kind: 'authored',
      boundToken: simpleVar,
    }
  }

  return {
    kind: 'default',
  }
}

export function createReferenceRecipe(token: ThemeTokenName): ThemeTokenRecipe {
  return { kind: 'reference', source: { kind: 'token', token } }
}

export function createLiteralRecipe(value: string): ThemeTokenRecipe {
  return { kind: 'reference', source: { kind: 'literal', value } }
}

export function createMixRecipe(
  from: ThemeTokenOperand,
  to: ThemeTokenOperand,
  toAmount: number,
): ThemeTokenRecipe {
  return {
    kind: 'color-mix',
    from,
    to,
    toAmount: Math.max(0, Math.min(100, toAmount)),
    colorSpace: 'srgb',
  }
}

export function serializeOperand(operand: ThemeTokenOperand): string {
  return operand.kind === 'token' ? `var(${operand.token})` : operand.value
}

export function serializeRecipe(recipe: ThemeTokenRecipe): string {
  if (recipe.kind === 'reference') return serializeOperand(recipe.source)
  if (recipe.kind === 'literal') return recipe.value
  if (recipe.kind === 'color-mix') {
    const amount = Math.max(0, Math.min(100, recipe.toAmount))
    const fromAmount = Number((100 - amount).toFixed(2))
    const toAmount = Number(amount.toFixed(2))
    return `color-mix(in ${recipe.colorSpace}, ${serializeOperand(recipe.from)} ${fromAmount}%, ${serializeOperand(recipe.to)} ${toAmount}%)`
  }
  return ''
}

export function recipeDependencies(recipe: ThemeTokenRecipe): string[] {
  if (recipe.kind === 'reference') {
    return recipe.source.kind === 'token' ? [recipe.source.token] : []
  }
  if (recipe.kind === 'color-mix') {
    const operands = [recipe.from, recipe.to]
    return operands.flatMap(operand => (operand.kind === 'token' ? [operand.token] : []))
  }
  return []
}

function validateOperand(
  name: string,
  operand: ThemeTokenOperand,
  expectedType: ThemeTokenValueType,
  cssProperty: string,
): string | null {
  if (operand.kind === 'literal') {
    if (expectedType === 'color' && !HEX_COLOR.test(operand.value) && !HEX_COLOR_SHORT.test(operand.value) && !isColorValue(operand.value)) {
      return `${name} 的固定颜色格式无效：${operand.value}（必须为 6 位 HEX 格式如 #FFFFFF 或合法 CSS 颜色）`
    }
    if (!isValidCssValue(cssProperty, operand.value, expectedType)) {
      return `${name} 的固定值格式无效：${operand.value}（不符合 ${cssProperty} 语法）`
    }
  }
  return null
}

export function validateDraft(
  draft: ThemeTokenDraft,
  knownTokens: ReadonlySet<string>,
): string | null {
  const recipes = { ...draft.customTokens, ...draft.overrides }
  for (const name of Object.keys(draft.customTokens)) {
    if (!CUSTOM_TOKEN_NAME.test(name)) return `自定义 token 名称无效：${name}`
    if (knownTokens.has(name)) return `自定义 token 已存在：${name}`
  }
  for (const [name, recipe] of Object.entries(recipes)) {
    const tokenType = detectTokenType(name)
    const cssProperty = getCssPropertyForType(tokenType)

    if (recipe.kind === 'reference') {
      const err = validateOperand(name, recipe.source, tokenType, cssProperty)
      if (err) return err
    } else if (recipe.kind === 'literal') {
      if (!isValidCssValue(cssProperty, recipe.value, tokenType)) {
        return `${name} 的固定值格式无效：${recipe.value}`
      }
    } else if (recipe.kind === 'color-mix') {
      if (tokenType !== 'color') {
        return `${name} 是非颜色 Token（${tokenType}），不能使用 color-mix 混色配方`
      }
      const fromErr = validateOperand(name, recipe.from, 'color', 'background-color')
      if (fromErr) return fromErr
      const toErr = validateOperand(name, recipe.to, 'color', 'background-color')
      if (toErr) return toErr
      if (!Number.isFinite(recipe.toAmount) || recipe.toAmount < 0 || recipe.toAmount > 100) {
        return `${name} 的混色比例无效（必须为 0 到 100 之间的数值）`
      }
      if (recipe.from.kind === 'literal' && recipe.to.kind === 'literal') {
        return `${name} 的混色两端均为固定色，请直接使用固定色模式`
      }
    }
    for (const dependency of recipeDependencies(recipe)) {
      if (!knownTokens.has(dependency) && !(dependency in draft.customTokens)) {
        return `${name} 引用了未知 token：${dependency}`
      }
    }
  }

  // Check for dependency cycles
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function checkCycle(token: string): string | null {
    visited.add(token)
    inStack.add(token)
    const recipe = recipes[token as ThemeTokenName]
    if (recipe) {
      for (const dep of recipeDependencies(recipe)) {
        if (!visited.has(dep)) {
          const err = checkCycle(dep)
          if (err) return err
        } else if (inStack.has(dep)) {
          return `检测到 Token 之间的循环引用：${token} -> ${dep}`
        }
      }
    }
    inStack.delete(token)
    return null
  }

  for (const token of Object.keys(recipes)) {
    if (!visited.has(token)) {
      const cycleError = checkCycle(token)
      if (cycleError) return cycleError
    }
  }

  return null
}

export function sortCustomTokens(
  customTokens: Record<string, ThemeTokenRecipe>,
): string[] {
  const result: string[] = []
  const visited = new Set<string>()

  function visit(token: string): void {
    if (visited.has(token)) return
    visited.add(token)
    const recipe = customTokens[token as ThemeTokenName]
    if (recipe) {
      for (const dep of recipeDependencies(recipe)) {
        if (dep in customTokens) {
          visit(dep)
        }
      }
    }
    result.push(token)
  }

  for (const token of Object.keys(customTokens).sort()) {
    visit(token)
  }
  return result
}

export function validateCustomTokenDeletion(
  tokenToDelete: ThemeTokenName,
  draft: ThemeTokenDraft,
  components: readonly ThemeComponentDefinition[],
): { canDelete: boolean; references: string[] } {
  const references: string[] = []

  // Check draft overrides referencing this custom token
  for (const [targetToken, recipe] of Object.entries(draft.overrides)) {
    const deps = recipeDependencies(recipe)
    if (deps.includes(tokenToDelete)) {
      const slotMatch = components
        .flatMap(c => c.slots.map(s => ({ component: c.label, slot: s.label, token: s.targetToken })))
        .find(s => s.token === targetToken)
      if (slotMatch) {
        references.push(`${slotMatch.component} · ${slotMatch.slot} (${targetToken})`)
      } else {
        references.push(`覆盖规则 (${targetToken})`)
      }
    }
  }

  // Check other custom tokens referencing this token
  for (const [customName, recipe] of Object.entries(draft.customTokens)) {
    if (customName !== tokenToDelete) {
      const deps = recipeDependencies(recipe)
      if (deps.includes(tokenToDelete)) {
        references.push(`自定义 Token (${customName})`)
      }
    }
  }

  return {
    canDelete: references.length === 0,
    references,
  }
}

export function generateThemeTokenCode(
  draft: ThemeTokenDraft,
  inlineTokenNames: ReadonlySet<string>,
  options: {
    scope?: 'all' | 'component'
    componentSlots?: readonly ThemePropertySlot[]
  } = {},
): string {
  const { scope = 'all', componentSlots = [] } = options
  const targetTokenSet = scope === 'component' ? new Set(componentSlots.map(s => s.targetToken)) : null

  const scssCustomLines: string[] = []
  const sortedCustom = sortCustomTokens(draft.customTokens)
  for (const name of sortedCustom) {
    scssCustomLines.push(`  ${name}: ${serializeRecipe(draft.customTokens[name as ThemeTokenName])};`)
  }

  const scssOverrideLines: string[] = []
  const tsOverrideLines: string[] = []

  const overrideKeys = Object.keys(draft.overrides).sort() as ThemeTokenName[]
  for (const name of overrideKeys) {
    if (targetTokenSet && !targetTokenSet.has(name)) continue
    const recipe = draft.overrides[name]
    const serialized = serializeRecipe(recipe)
    if (inlineTokenNames.has(name)) {
      tsOverrideLines.push(`  '${name}': '${serialized}',`)
    } else {
      scssOverrideLines.push(`  ${name}: ${serialized};`)
    }
  }

  const sections: string[] = []

  if (scssCustomLines.length || scssOverrideLines.length) {
    sections.push(
      [
        '// codex-semantic-tokens.scss or _theme-token-debugger.scss',
        ':root {',
        ...(scssCustomLines.length ? ['  /* 自定义 Token */', ...scssCustomLines] : []),
        ...(scssOverrideLines.length ? ['  /* 覆盖规则 */', ...scssOverrideLines] : []),
        '}',
      ].join('\n'),
    )
  }

  if (tsOverrideLines.length) {
    sections.push(
      [
        '// themeVariables.ts (deriveThemeVariables)',
        'const overrides: Record<string, string> = {',
        ...tsOverrideLines,
        '}',
      ].join('\n'),
    )
  }

  return sections.join('\n\n') || '/* 没有可导出的 Token 修改 */'
}

export function parseRgbChannels(colorStr: string): [number, number, number] | null {
  const hexMatch = colorStr.trim().match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (hexMatch) {
    return [parseInt(hexMatch[1], 16), parseInt(hexMatch[2], 16), parseInt(hexMatch[3], 16)]
  }
  const rgbMatch = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])]
  }
  return null
}

export function calculateLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(val => {
    const s = val / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function calculateContrastRatio(
  foreground: string | undefined,
  background: string | undefined,
): number | null {
  if (!foreground || !background) return null
  const fgRgb = parseRgbChannels(foreground)
  const bgRgb = parseRgbChannels(background)
  if (!fgRgb || !bgRgb) return null

  const lumFg = calculateLuminance(fgRgb)
  const lumBg = calculateLuminance(bgRgb)
  const brightest = Math.max(lumFg, lumBg)
  const darkest = Math.min(lumFg, lumBg)
  return (brightest + 0.05) / (darkest + 0.05)
}
