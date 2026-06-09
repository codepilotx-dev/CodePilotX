export type ModelPreset = {
  id: string
  label: string
  value: string
}

export const DEFAULT_MODEL_PRESET_ID = '__default__'
export const CUSTOM_MODEL_PRESET_ID = '__custom__'

export const MODEL_PRESETS: ModelPreset[] = [
  { id: DEFAULT_MODEL_PRESET_ID, label: '默认模型', value: '' },
  { id: 'gpt-5.5', label: 'GPT-5.5', value: 'gpt-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4', value: 'gpt-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', value: 'gpt-5.4-mini' },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'GPT-5.3-Codex-Spark',
    value: 'gpt-5.3-codex-spark',
  },
]

export function findModelPresetByValue(value: string): ModelPreset | undefined {
  return MODEL_PRESETS.find(preset => preset.value === value)
}

export function resolveModelPresetId(
  model: string,
  selectedModelPreset: string | undefined,
): string {
  if (selectedModelPreset && selectedModelPreset !== CUSTOM_MODEL_PRESET_ID) {
    return selectedModelPreset
  }
  return findModelPresetByValue(model)?.id ?? CUSTOM_MODEL_PRESET_ID
}
