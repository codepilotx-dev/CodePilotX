export const MODEL_ALIASES = [
  'fast',
  'default',
  'deep',
  'plan',
  'default[1m]',
  'deep[1m]',
] as const
export type ModelAlias = (typeof MODEL_ALIASES)[number]

export function isModelAlias(modelInput: string): modelInput is ModelAlias {
  return MODEL_ALIASES.includes(modelInput as ModelAlias)
}

/**
 * Bare model tier aliases that act as wildcards in the availableModels allowlist.
 * When "deep" is in the allowlist, any configured deep-tier model is allowed.
 * When a specific model ID is in the allowlist, only that exact version is allowed.
 */
export const MODEL_FAMILY_ALIASES = ['default', 'deep', 'fast'] as const

export function isModelFamilyAlias(model: string): boolean {
  return (MODEL_FAMILY_ALIASES as readonly string[]).includes(model)
}
