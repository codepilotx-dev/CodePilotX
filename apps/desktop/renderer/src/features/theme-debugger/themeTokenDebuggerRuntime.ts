import {
  serializeRecipe,
  type RuntimeColorToken,
  type ThemeTokenDraft,
} from './themeTokenDebuggerModel.js'

export type { RuntimeColorToken } from './themeTokenDebuggerModel.js'

const STYLE_ATTRIBUTE = 'data-codepilotx-theme-debugger'

function collectRuleTokens(
  rules: CSSRuleList,
  declared: Map<string, string>,
  references: Map<string, number>,
): void {
  for (const rule of Array.from(rules)) {
    if ('cssRules' in rule) {
      try {
        collectRuleTokens((rule as CSSGroupingRule).cssRules, declared, references)
      } catch {
        // Cross-origin or browser-owned nested rules are intentionally ignored.
      }
    }
    if (!(rule instanceof CSSStyleRule)) continue
    for (const name of Array.from(rule.style)) {
      if (name.startsWith('--')) {
        const authored = rule.style.getPropertyValue(name).trim()
        if (authored) declared.set(name, authored)
      }
    }
    for (const match of rule.cssText.matchAll(/var\((--[\w-]+)/g)) {
      const name = match[1]
      if (name) references.set(name, (references.get(name) ?? 0) + 1)
    }
  }
}

export function scanRuntimeColorTokens(): RuntimeColorToken[] {
  const declared = new Map<string, string>()
  const references = new Map<string, number>()
  for (const sheet of Array.from(document.styleSheets)) {
    if ((sheet.ownerNode as Element | null)?.hasAttribute(STYLE_ATTRIBUTE)) continue
    try {
      collectRuleTokens(sheet.cssRules, declared, references)
    } catch {
      // A stylesheet without same-origin CSSOM access must not break the tool.
    }
  }
  const inline = new Set<string>()
  for (const name of Array.from(document.documentElement.style)) {
    if (name.startsWith('--')) {
      const authored = document.documentElement.style.getPropertyValue(name).trim()
      if (authored) declared.set(name, authored)
      inline.add(name)
    }
  }
  const computed = getComputedStyle(document.documentElement)
  const probe = document.createElement('span')
  probe.hidden = true
  document.documentElement.append(probe)
  const result = Array.from(declared.keys())
    .flatMap(name => {
      const authoredValue = declared.get(name) || computed.getPropertyValue(name).trim()
      if (!authoredValue || !CSS.supports('color', authoredValue)) return []
      probe.style.color = `var(${name})`
      const resolvedValue = getComputedStyle(probe).color
      if (!resolvedValue) return []
      return [{
        name: name as `--${string}`,
        resolvedValue,
        authoredValue,
        source: inline.has(name) ? ('inline-derived' as const) : ('stylesheet' as const),
        references: references.get(name) ?? 0,
      }]
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  probe.remove()
  return result
}

export function applyThemeTokenDraft(draft: ThemeTokenDraft): void {
  let style = document.head.querySelector<HTMLStyleElement>(`style[${STYLE_ATTRIBUTE}]`)
  const declarations = [...Object.entries(draft.customTokens), ...Object.entries(draft.overrides)]
    .map(([name, recipe]) => `  ${name}: ${serializeRecipe(recipe)} !important;`)
  if (!declarations.length) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.setAttribute(STYLE_ATTRIBUTE, '')
    document.head.append(style)
  }
  style.textContent = `:root {\n${declarations.join('\n')}\n}`
}

export function clearThemeTokenDraft(): void {
  document.head.querySelector(`style[${STYLE_ATTRIBUTE}]`)?.remove()
}
