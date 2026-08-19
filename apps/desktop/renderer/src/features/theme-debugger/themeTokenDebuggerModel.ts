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
      return '1px solid var(--cpx-sys-color-border-subtle)'
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
      return '1px solid var(--cpx-sys-color-border-subtle)'
    case 'radius':
      return '8px / 12px / 9999px'
    case 'dimension':
      return '24px / 16px / 1.5rem'
    case 'typography':
      return '14px / var(--cpx-sys-font-family-mono)'
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
    lowerName.startsWith('--cpx-sys-radius') ||
    lowerName.includes('radius')
  ) {
    return 'radius'
  }

  if (
    lowerName.startsWith('--cpx-sys-shadow') ||
    lowerName.includes('shadow') ||
    lowerVal.includes('drop-shadow') ||
    (lowerVal.includes('px') && lowerVal.includes('rgba('))
  ) {
    return 'shadow'
  }

  if (
    lowerName.startsWith('--cpx-sys-font') ||
    lowerName.includes('font') ||
    lowerName.includes('type-') ||
    lowerName.includes('line-height')
  ) {
    return 'typography'
  }

  if (
    lowerName.startsWith('--cpx-sys-space') ||
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
    lowerName.startsWith('--layer-edge') ||
    lowerName.includes('edge') ||
    (lowerName.endsWith('-border') && (lowerVal.includes('solid') || lowerVal.includes('dashed') || lowerVal === '0'))
  ) {
    return 'border'
  }

  if (
    lowerName.startsWith('--cpx-sys-color-') ||
    lowerName.startsWith('--color-') ||
    lowerName.includes('background') ||
    lowerName.includes('foreground') ||
    lowerName.includes('-bg') ||
    lowerName.includes('-fg') ||
    lowerName.includes('border-color') ||
    lowerName.includes('focus-border') ||
    lowerName.includes('-border') ||
    lowerName.includes('fill') ||
    lowerName.startsWith('--vscode-') ||
    isColorValue(lowerVal)
  ) {
    return 'color'
  }

  if (lowerName.includes('border') || lowerName.includes('ring')) {
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
    const cssProp = getCssPropertyForType(tokenType)

    if (recipe.kind === 'reference') {
      const err = validateOperand(name, recipe.source, tokenType, cssProp)
      if (err) return err
      if (recipe.source.kind === 'token' && !knownTokens.has(recipe.source.token) && !draft.customTokens[recipe.source.token]) {
        return `${name} 引用的 token 不存在：${recipe.source.token}`
      }
    } else if (recipe.kind === 'literal') {
      const operand: ThemeTokenOperand = { kind: 'literal', value: recipe.value }
      const err = validateOperand(name, operand, tokenType, cssProp)
      if (err) return err
    } else if (recipe.kind === 'color-mix') {
      if (tokenType !== 'color') {
        return `${name} 仅色彩类型 Token 支持 color-mix 混合计算`
      }
      const errFrom = validateOperand(name, recipe.from, 'color', 'background-color')
      if (errFrom) return errFrom
      const errTo = validateOperand(name, recipe.to, 'color', 'background-color')
      if (errTo) return errTo

      if (recipe.from.kind === 'token' && !knownTokens.has(recipe.from.token) && !draft.customTokens[recipe.from.token]) {
        return `${name} 混合来源引用的 token 不存在：${recipe.from.token}`
      }
      if (recipe.to.kind === 'token' && !knownTokens.has(recipe.to.token) && !draft.customTokens[recipe.to.token]) {
        return `${name} 混合目标引用的 token 不存在：${recipe.to.token}`
      }
    }
  }

  // Cycle check
  const graph = new Map<string, string[]>()
  for (const [name, recipe] of Object.entries(recipes)) {
    graph.set(name, recipeDependencies(recipe))
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()

  function hasCycle(node: string): boolean {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    const deps = graph.get(node) ?? []
    for (const dep of deps) {
      if (graph.has(dep) && hasCycle(dep)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }

  for (const name of Object.keys(recipes)) {
    if (hasCycle(name)) return `检测到 Token 循环引用：${name}`
  }

  return null
}

export function validateCustomTokenDeletion(
  tokenToDelete: ThemeTokenName,
  draft: ThemeTokenDraft,
): string | null {
  const allRecipes = { ...draft.customTokens, ...draft.overrides }
  for (const [name, recipe] of Object.entries(allRecipes)) {
    if (name === tokenToDelete) continue
    const deps = recipeDependencies(recipe)
    if (deps.includes(tokenToDelete)) {
      return `无法删除 ${tokenToDelete}：正被 ${name} 引用`
    }
  }
  return null
}

export function parseRgbChannels(colorString: string): [number, number, number] | null {
  if (!colorString) return null
  const trimmed = colorString.trim()

  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1)
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ]
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ]
    }
    return null
  }

  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (match && match[1] && match[2] && match[3]) {
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
  }

  return null
}

export function calculateLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const val = c / 255
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * (rs ?? 0) + 0.7152 * (gs ?? 0) + 0.0722 * (bs ?? 0)
}

export function calculateContrastRatio(fgResolved: string, bgResolved: string): number | null {
  const fgRgb = parseRgbChannels(fgResolved)
  const bgRgb = parseRgbChannels(bgResolved)
  if (!fgRgb || !bgRgb) return null

  const l1 = calculateLuminance(...fgRgb)
  const l2 = calculateLuminance(...bgRgb)

  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)

  return (lighter + 0.05) / (darker + 0.05)
}

export function generateThemeTokenCode(
  draft: ThemeTokenDraft,
  options: {
    format: 'scss' | 'css' | 'json'
    scope?: 'all' | 'custom-only' | 'overrides-only' | string
    selectedComponentSlots?: readonly ThemePropertySlot[]
  },
): string {
  const { format, scope = 'all', selectedComponentSlots } = options

  let exportOverrides: Record<ThemeTokenName, ThemeTokenRecipe> = { ...draft.overrides }
  let exportCustoms: Record<ThemeTokenName, ThemeTokenRecipe> = { ...draft.customTokens }

  if (scope === 'custom-only') {
    exportOverrides = {}
  } else if (scope === 'overrides-only') {
    exportCustoms = {}
  } else if (scope !== 'all' && selectedComponentSlots) {
    const slotTokenSet = new Set(selectedComponentSlots.map(s => s.targetToken))
    const filtered: Record<ThemeTokenName, ThemeTokenRecipe> = {}
    for (const [k, v] of Object.entries(exportOverrides)) {
      if (slotTokenSet.has(k as ThemeTokenName)) {
        filtered[k as ThemeTokenName] = v
      }
    }
    exportOverrides = filtered
    exportCustoms = {}
  }

  if (format === 'json') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(exportCustoms)) out[k] = serializeRecipe(v)
    for (const [k, v] of Object.entries(exportOverrides)) out[k] = serializeRecipe(v)
    return JSON.stringify(out, null, 2)
  }

  const lines: string[] = []
  lines.push(':root {')

  const customKeys = Object.keys(exportCustoms)
  if (customKeys.length > 0) {
    lines.push('  // 自定义 Token 变量')
    for (const key of customKeys.sort()) {
      lines.push(`  ${key}: ${serializeRecipe(exportCustoms[key as ThemeTokenName]!)};`)
    }
  }

  const overrideKeys = Object.keys(exportOverrides)
  if (overrideKeys.length > 0) {
    if (customKeys.length > 0) lines.push('')
    lines.push('  // 组件与主题覆盖 Token')
    for (const key of overrideKeys.sort()) {
      lines.push(`  ${key}: ${serializeRecipe(exportOverrides[key as ThemeTokenName]!)};`)
    }
  }

  lines.push('}')
  return lines.join('\n')
}
