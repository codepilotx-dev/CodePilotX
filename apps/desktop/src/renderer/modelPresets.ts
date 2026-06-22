export type ModelPreset = {
  id: string
  label: string
  value: string
  shortLabel?: string
}

export const CUSTOM_MODEL_PRESET_ID = '__custom__'

export const MODEL_PRESETS: ModelPreset[] = buildModelPresets([])

export function buildModelPresets(models: string[]): ModelPreset[] {
  return models.map(model => ({
    id: model,
    label: getModelDisplayLabel(model),
    value: model,
    shortLabel: shortenModelLabel(model),
  }))
}

export function getModelDisplayLabel(model: string): string {
  switch (model) {
    case 'deepseek-v4-pro':
      return 'V4 Pro'
    case 'deepseek-v4-flash':
      return 'V4 Flash'
    default:
      return model
  }
}

export function getModelDescription(model: string): string | null {
  switch (model) {
    case 'deepseek-v4-pro':
      return '复杂 Agent / 高质量代码任务'
    case 'deepseek-v4-flash':
      return '快速响应 / 经济使用'
    default:
      return null
  }
}

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
    const version = dsMatch[1]?.toUpperCase() ?? ''
    const tier = dsMatch[2] ?? ''
    return tier ? `${version} ${capitalizeAscii(tier)}` : version
  }

  const gptMatch = /^gpt-([\d.]+)(?:-(\w+))?.*$/i.exec(cleaned)
  if (gptMatch) {
    const version = gptMatch[1]
    const variant = gptMatch[2] ?? ''
    return variant ? `${version} ${variant.toLowerCase()}` : version
  }

  return cleaned.length > 14 ? `${cleaned.slice(0, 14)}...` : cleaned
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

function capitalizeAscii(value: string): string {
  return value
    ? `${value[0]?.toUpperCase() ?? ''}${value.slice(1).toLowerCase()}`
    : ''
}
