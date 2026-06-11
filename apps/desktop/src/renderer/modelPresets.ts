export type ModelPreset = {
  id: string
  label: string
  value: string
  shortLabel?: string
}

export const DEFAULT_MODEL_PRESET_ID = '__default__'
export const CUSTOM_MODEL_PRESET_ID = '__custom__'

export const MODEL_PRESETS: ModelPreset[] = buildModelPresets([])

export function buildModelPresets(
  models: string[],
  defaultLabel = '默认模型',
): ModelPreset[] {
  return [
    { id: DEFAULT_MODEL_PRESET_ID, label: defaultLabel, value: '' },
    ...models.map(model => ({
      id: model,
      label: model,
      value: model,
      shortLabel: shortenModelLabel(model),
    })),
  ]
}

// 把冗长的模型名截成 trigger chip 友好的短名，例如：
// "claude-3-5-sonnet-20241022" -> "3.5 sonnet"
// "deepseek-v4-pro"            -> "v4 pro"
// "gpt-4o-mini"                -> "4o mini"
export function shortenModelLabel(model: string): string {
  const cleaned = model.trim()
  if (!cleaned) return ''

  const claudeMatch = /^claude-(\d+)-(\d+)(?:-(\d+))?-([a-z]+).*$/i.exec(cleaned)
  if (claudeMatch) {
    const major = claudeMatch[1]
    const minor = claudeMatch[2]
    const tier = claudeMatch[3]
    const family = claudeMatch[4] ?? ''
    const familyLabel =
      family.toLowerCase() === 'sonnet'
        ? 'sonnet'
        : family.toLowerCase() === 'haiku'
          ? 'haiku'
          : family.toLowerCase() === 'opus'
            ? 'opus'
            : family
    return tier
      ? `${major}.${minor}.${tier} ${familyLabel}`.trim()
      : `${major}.${minor} ${familyLabel}`.trim()
  }

  const dsMatch = /^deepseek-(v\d+)(?:-(\w+))?.*$/i.exec(cleaned)
  if (dsMatch) {
    const version = dsMatch[1]
    const tier = dsMatch[2] ?? ''
    return tier ? `${version} ${tier.toLowerCase()}` : version
  }

  const gptMatch = /^gpt-([\d.]+)(?:-(\w+))?.*$/i.exec(cleaned)
  if (gptMatch) {
    const version = gptMatch[1]
    const variant = gptMatch[2] ?? ''
    return variant ? `${version} ${variant.toLowerCase()}` : version
  }

  return cleaned.length > 14 ? `${cleaned.slice(0, 14)}…` : cleaned
}

export function findModelPresetByValue(
  value: string,
  presets = MODEL_PRESETS,
): ModelPreset | undefined {
  return presets.find(preset => preset.value === value)
}

export function resolveModelPresetId(
  model: string,
  selectedModelPreset: string | undefined,
  presets = MODEL_PRESETS,
): string {
  if (selectedModelPreset && selectedModelPreset !== CUSTOM_MODEL_PRESET_ID) {
    return presets.some(preset => preset.id === selectedModelPreset)
      ? selectedModelPreset
      : CUSTOM_MODEL_PRESET_ID
  }
  return findModelPresetByValue(model, presets)?.id ?? CUSTOM_MODEL_PRESET_ID
}
