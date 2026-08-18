export type ThemeTokenName = `--${string}`

export type ThemeTokenOperand =
  | { kind: 'token'; token: ThemeTokenName }
  | { kind: 'literal'; color: `#${string}` }

export type ThemeTokenRecipe =
  | { kind: 'reference'; source: ThemeTokenOperand }
  | {
      kind: 'mix'
      from: ThemeTokenOperand
      to: ThemeTokenOperand
      toAmount: number
      colorSpace: 'srgb'
    }

export type ThemeTokenDraft = {
  customTokens: Record<string, ThemeTokenRecipe>
  overrides: Record<string, ThemeTokenRecipe>
}

export type ThemeComponentColorSlot = {
  id: string
  label: string
  group: 'trigger' | 'surface'
  targetToken: `--color-token-${string}`
  description: string
  contrastAgainst?: `--color-token-${string}`
}

export type ThemeComponentDefinition = {
  id: string
  label: string
  slots: readonly ThemeComponentColorSlot[]
}

export type ThemeComponentContrastCheck = {
  label: string
  foregroundToken: `--color-token-${string}`
  backgroundToken: `--color-token-${string}`
}

export type RuntimeColorToken = {
  name: `--${string}`
  resolvedValue: string
  authoredValue: string
  source: 'stylesheet' | 'inline-derived'
  references: number
}

export const CUSTOM_TOKEN_NAME = /^--color-token-[a-z0-9]+(?:-[a-z0-9]+)*$/
export const HEX_COLOR = /^#[0-9a-f]{6}$/i
export const SIMPLE_VAR_REGEX = /^\s*var\(\s*(--[a-zA-Z0-9_-]+)\s*\)\s*$/

export const DROPDOWN_COMPONENT_DEFINITION: ThemeComponentDefinition = {
  id: 'dropdown',
  label: 'Dropdown',
  slots: [
    // 触发器组 (Trigger Group)
    {
      id: 'trigger-background',
      label: '背景',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-background',
      description: '触发器常态背景颜色',
    },
    {
      id: 'trigger-foreground',
      label: '文字',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-foreground',
      description: '触发器文字及图标前景色',
      contrastAgainst: '--color-token-dropdown-trigger-background',
    },
    {
      id: 'trigger-border',
      label: '边框',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-border',
      description: '触发器常态边框颜色',
    },
    {
      id: 'trigger-hover-background',
      label: 'Hover',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-hover-background',
      description: '触发器悬停背景颜色',
    },
    {
      id: 'trigger-open-background',
      label: 'Open',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-open-background',
      description: '触发器展开状态背景颜色',
    },
    {
      id: 'trigger-disabled-foreground',
      label: 'Disabled',
      group: 'trigger',
      targetToken: '--color-token-dropdown-trigger-disabled-foreground',
      description: '触发器禁用文字颜色',
      contrastAgainst: '--color-token-dropdown-trigger-background',
    },
    // 菜单组 (Surface / Menu Group)
    {
      id: 'surface-background',
      label: '背景',
      group: 'surface',
      targetToken: '--color-token-dropdown-background',
      description: '弹出菜单表面背景颜色',
    },
    {
      id: 'surface-foreground',
      label: '文字',
      group: 'surface',
      targetToken: '--color-token-dropdown-foreground',
      description: '弹出菜单项常规文字颜色',
      contrastAgainst: '--color-token-dropdown-background',
    },
    {
      id: 'surface-border',
      label: '边框',
      group: 'surface',
      targetToken: '--color-token-dropdown-border',
      description: '弹出菜单表面外边框颜色',
    },
    {
      id: 'surface-item-hover-background',
      label: 'Item Hover',
      group: 'surface',
      targetToken: '--color-token-dropdown-item-hover-background',
      description: '菜单项悬停背景颜色',
      contrastAgainst: '--color-token-dropdown-foreground',
    },
    {
      id: 'surface-item-selected-background',
      label: 'Selected',
      group: 'surface',
      targetToken: '--color-token-dropdown-item-selected-background',
      description: '菜单项选中状态背景颜色',
      contrastAgainst: '--color-token-dropdown-foreground',
    },
    {
      id: 'surface-item-pressed-background',
      label: 'Pressed',
      group: 'surface',
      targetToken: '--color-token-dropdown-item-pressed-background',
      description: '菜单项按下状态背景颜色',
    },
    {
      id: 'surface-item-disabled-foreground',
      label: 'Disabled',
      group: 'surface',
      targetToken: '--color-token-dropdown-item-disabled-foreground',
      description: '菜单项禁用文字颜色',
      contrastAgainst: '--color-token-dropdown-background',
    },
    {
      id: 'focus-border',
      label: 'Focus（触发器与菜单共用）',
      group: 'surface',
      targetToken: '--color-token-dropdown-focus-border',
      description: '触发器与弹出菜单项键盘聚焦指示边框颜色',
    },
  ],
}

export const THEME_COMPONENTS: readonly ThemeComponentDefinition[] = [
  DROPDOWN_COMPONENT_DEFINITION,
]

export const DROPDOWN_CONTRAST_CHECKS: readonly ThemeComponentContrastCheck[] = [
  {
    label: '触发器文字 / 背景',
    foregroundToken: '--color-token-dropdown-trigger-foreground',
    backgroundToken: '--color-token-dropdown-trigger-background',
  },
  {
    label: '菜单文字 / 背景',
    foregroundToken: '--color-token-dropdown-foreground',
    backgroundToken: '--color-token-dropdown-background',
  },
  {
    label: '菜单文字 / 悬停',
    foregroundToken: '--color-token-dropdown-foreground',
    backgroundToken: '--color-token-dropdown-item-hover-background',
  },
  {
    label: '菜单文字 / 选中',
    foregroundToken: '--color-token-dropdown-foreground',
    backgroundToken: '--color-token-dropdown-item-selected-background',
  },
  {
    label: '禁用文字 / 菜单背景',
    foregroundToken: '--color-token-dropdown-item-disabled-foreground',
    backgroundToken: '--color-token-dropdown-background',
  },
]

export function getThemeComponent(id: string): ThemeComponentDefinition | undefined {
  return THEME_COMPONENTS.find(component => component.id === id)
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
  runtimeTokens: readonly RuntimeColorToken[],
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

export function createLiteralRecipe(color: `#${string}`): ThemeTokenRecipe {
  return { kind: 'reference', source: { kind: 'literal', color } }
}

export function createMixRecipe(
  from: ThemeTokenOperand,
  to: ThemeTokenOperand,
  toAmount: number,
): ThemeTokenRecipe {
  return {
    kind: 'mix',
    from,
    to,
    toAmount: Math.max(0, Math.min(100, toAmount)),
    colorSpace: 'srgb',
  }
}

export function serializeOperand(operand: ThemeTokenOperand): string {
  return operand.kind === 'token' ? `var(${operand.token})` : operand.color.toUpperCase()
}

export function serializeRecipe(recipe: ThemeTokenRecipe): string {
  if (recipe.kind === 'reference') return serializeOperand(recipe.source)
  const amount = Math.max(0, Math.min(100, recipe.toAmount))
  const fromAmount = Number((100 - amount).toFixed(2))
  const toAmount = Number(amount.toFixed(2))
  return `color-mix(in ${recipe.colorSpace}, ${serializeOperand(recipe.from)} ${fromAmount}%, ${serializeOperand(recipe.to)} ${toAmount}%)`
}

export function recipeDependencies(recipe: ThemeTokenRecipe): string[] {
  const operands = recipe.kind === 'reference'
    ? [recipe.source]
    : [recipe.from, recipe.to]
  return operands.flatMap(operand => operand.kind === 'token' ? [operand.token] : [])
}

function validateOperand(name: string, operand: ThemeTokenOperand): string | null {
  if (operand.kind === 'literal') {
    if (!HEX_COLOR.test(operand.color)) {
      return `${name} 的固定颜色格式无效：${operand.color}（必须为 6 位 HEX，如 #FFFFFF）`
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
    if (recipe.kind === 'reference') {
      const err = validateOperand(name, recipe.source)
      if (err) return err
    } else if (recipe.kind === 'mix') {
      const fromErr = validateOperand(name, recipe.from)
      if (fromErr) return fromErr
      const toErr = validateOperand(name, recipe.to)
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

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (name: string, path: string[]): string | null => {
    if (visiting.has(name)) return `检测到循环引用：${[...path, name].join(' → ')}`
    if (visited.has(name) || !(name in recipes)) return null
    visiting.add(name)
    for (const dependency of recipeDependencies(recipes[name]!)) {
      const error = visit(dependency, [...path, name])
      if (error) return error
    }
    visiting.delete(name)
    visited.add(name)
    return null
  }
  for (const name of Object.keys(recipes)) {
    const error = visit(name, [])
    if (error) return error
  }
  return null
}

export function validateCustomTokenDeletion(
  tokenToDelete: string,
  draft: ThemeTokenDraft,
  components: readonly ThemeComponentDefinition[] = THEME_COMPONENTS,
): { canDelete: boolean; references: string[] } {
  const references: string[] = []

  // Check slot overrides
  const slotMap = new Map<string, { componentLabel: string; slotLabel: string; group: string }>()
  for (const comp of components) {
    for (const slot of comp.slots) {
      slotMap.set(slot.targetToken, {
        componentLabel: comp.label,
        slotLabel: slot.label,
        group: slot.group === 'trigger' ? '触发器' : '菜单',
      })
    }
  }

  for (const [targetToken, recipe] of Object.entries(draft.overrides)) {
    if (recipeDependencies(recipe).includes(tokenToDelete)) {
      const slotInfo = slotMap.get(targetToken)
      if (slotInfo) {
        references.push(`${slotInfo.componentLabel} ${slotInfo.group}${slotInfo.slotLabel} (${targetToken})`)
      } else {
        references.push(`覆盖项 (${targetToken})`)
      }
    }
  }

  // Check other custom tokens
  for (const [customName, recipe] of Object.entries(draft.customTokens)) {
    if (customName !== tokenToDelete && recipeDependencies(recipe).includes(tokenToDelete)) {
      references.push(`自定义 Token (${customName})`)
    }
  }

  return {
    canDelete: references.length === 0,
    references,
  }
}

export function sortCustomTokens(draft: ThemeTokenDraft): string[] {
  const result: string[] = []
  const visited = new Set<string>()
  const visit = (name: string): void => {
    if (visited.has(name)) return
    visited.add(name)
    const recipe = draft.customTokens[name]
    if (!recipe) return
    for (const dependency of recipeDependencies(recipe)) {
      if (dependency in draft.customTokens) visit(dependency)
    }
    result.push(name)
  }
  Object.keys(draft.customTokens).sort().forEach(visit)
  return result
}

export function generateThemeTokenCode(
  draft: ThemeTokenDraft,
  inlineDerivedTokens: ReadonlySet<string>,
): string {
  const custom = sortCustomTokens(draft)
  const scssOverrides = Object.keys(draft.overrides)
    .filter(name => !inlineDerivedTokens.has(name))
    .sort()
  const inlineOverrides = Object.keys(draft.overrides)
    .filter(name => inlineDerivedTokens.has(name))
    .sort()
  const scssLines = [...custom, ...scssOverrides]
    .map(name => `  ${name}: ${serializeRecipe(draft.customTokens[name] ?? draft.overrides[name]!)};`)
  const sections: string[] = []
  if (scssLines.length) {
    sections.push(`// codex-semantic-tokens.scss\n:root {\n${scssLines.join('\n')}\n}`)
  }
  if (inlineOverrides.length) {
    sections.push(`// themeVariables.ts\n${inlineOverrides
      .map(name => `'${name}': '${serializeRecipe(draft.overrides[name]!) }',`)
      .join('\n')}`)
  }
  return sections.join('\n\n')
}

export function parseRgbChannels(value: string | undefined): [number, number, number] | null {
  if (!value) return null
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (channels && channels.length === 3 && channels.every(Number.isFinite)) {
    return [channels[0]!, channels[1]!, channels[2]!]
  }
  return null
}

export function calculateLuminance(channels: [number, number, number]): number {
  const srgb = channels
    .map(channel => channel / 255)
    .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return srgb[0]! * 0.2126 + srgb[1]! * 0.7152 + srgb[2]! * 0.0722
}

export function calculateContrastRatio(
  foreground: string | undefined,
  background: string | undefined,
): number | null {
  const fg = parseRgbChannels(foreground)
  const bg = parseRgbChannels(background)
  if (!fg || !bg) return null
  const lumFg = calculateLuminance(fg)
  const lumBg = calculateLuminance(bg)
  const [light, dark] = [lumFg, lumBg].sort((a, b) => b - a)
  return (light! + 0.05) / (dark! + 0.05)
}
