export type ModelPreset = {
  id: string
  label: string
  value: string
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
    })),
  ]
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
