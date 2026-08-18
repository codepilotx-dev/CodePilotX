import {
  detectTokenType,
  serializeRecipe,
  type RuntimeToken,
  type ThemeTokenDraft,
  type ThemeTokenName,
} from './themeTokenDebuggerModel.js'

const OVERRIDE_STYLE_ID = 'codepilotx-theme-debugger-overrides'

export function collectRuleTokens(
  rule: CSSStyleRule,
  declaredTokens: Map<string, string>,
  tokenRefCounts: Map<string, number>,
): void {
  const cssText = rule.cssText
  const varMatches = cssText.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)
  for (const match of varMatches) {
    const name = match[1]
    tokenRefCounts.set(name, (tokenRefCounts.get(name) ?? 0) + 1)
  }

  const style = rule.style
  for (let i = 0; i < style.length; i++) {
    const prop = style[i]
    if (prop.startsWith('--')) {
      const authored = style.getPropertyValue(prop).trim()
      if (authored) {
        declaredTokens.set(prop, authored)
      }
    }
  }
}

export function scanRuntimeTokens(): RuntimeToken[] {
  if (typeof document === 'undefined') return []

  const declaredTokens = new Map<string, string>()
  const tokenRefCounts = new Map<string, number>()

  try {
    for (let s = 0; s < document.styleSheets.length; s++) {
      const sheet = document.styleSheets[s]
      // Skip the debugger's own dynamically injected stylesheet
      if (sheet.ownerNode instanceof HTMLElement && sheet.ownerNode.id === OVERRIDE_STYLE_ID) {
        continue
      }
      try {
        const rules = sheet.cssRules || sheet.rules
        if (!rules) continue
        for (let r = 0; r < rules.length; r++) {
          const rule = rules[r]
          if (rule instanceof CSSStyleRule) {
            collectRuleTokens(rule, declaredTokens, tokenRefCounts)
          } else if (rule instanceof CSSLayerBlockRule || rule instanceof CSSMediaRule) {
            for (let sub = 0; sub < rule.cssRules.length; sub++) {
              const subRule = rule.cssRules[sub]
              if (subRule instanceof CSSStyleRule) {
                collectRuleTokens(subRule, declaredTokens, tokenRefCounts)
              }
            }
          }
        }
      } catch {
        // Cross-origin or inaccessible stylesheet - continue safely
      }
    }
  } catch {
    // Top-level stylesheet enumeration error - continue safely
  }

  const rootStyle = window.getComputedStyle(document.documentElement)
  const result: RuntimeToken[] = []

  for (const [name, authored] of declaredTokens.entries()) {
    const resolved = rootStyle.getPropertyValue(name).trim() || authored
    const valueType = detectTokenType(name, resolved || authored)

    result.push({
      name: name as ThemeTokenName,
      valueType,
      resolvedValue: resolved,
      authoredValue: authored,
      source: 'stylesheet',
      references: tokenRefCounts.get(name) ?? 0,
    })
  }

  // Sort by name
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

// Backwards compatibility
export const scanRuntimeColorTokens = scanRuntimeTokens

export function applyThemeTokenDraft(draft: ThemeTokenDraft): void {
  if (typeof document === 'undefined') return

  let styleTag = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null
  if (!styleTag) {
    styleTag = document.createElement('style')
    styleTag.id = OVERRIDE_STYLE_ID
    styleTag.setAttribute('data-codepilotx-theme-debugger', 'true')
    document.head.appendChild(styleTag)
  }

  const rules: string[] = []

  for (const [name, recipe] of Object.entries(draft.customTokens)) {
    rules.push(`  ${name}: ${serializeRecipe(recipe)};`)
  }

  for (const [name, recipe] of Object.entries(draft.overrides)) {
    rules.push(`  ${name}: ${serializeRecipe(recipe)};`)
  }

  if (rules.length) {
    styleTag.textContent = `:root {\n${rules.join('\n')}\n}`
  } else {
    styleTag.textContent = ''
  }
}

export function clearThemeTokenDraft(): void {
  if (typeof document === 'undefined') return
  const styleTag = document.getElementById(OVERRIDE_STYLE_ID)
  if (styleTag) {
    styleTag.remove()
  }
}
