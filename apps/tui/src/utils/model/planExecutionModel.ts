import { getSettings_DEPRECATED } from '../settings/settings.js'
import {
  getSelectedProviderConfig,
  getSelectedProviderID,
} from './providerConfig.js'
import { parseUserSpecifiedModel, type ModelSetting } from './model.js'

export const PLAN_EXECUTION_MODEL_ENV = 'CODEPILOTX_PLAN_EXECUTION_MODEL'

export function getDefaultPlanExecutionModelSetting(): string {
  const provider = getSelectedProviderConfig()
  if (provider.kind === 'anthropic') {
    return 'default'
  }
  return provider.defaultModels[0] ?? ''
}

export function getConfiguredPlanExecutionModelSetting(): string | undefined {
  const envModel = process.env[PLAN_EXECUTION_MODEL_ENV]?.trim()
  if (envModel) return envModel
  const settings = getSettings_DEPRECATED() || {}
  const configured = settings.planExecutionModel?.trim()
  return configured || undefined
}

export function getPlanExecutionModelSetting(
  override?: string | null,
): string {
  const cleanOverride = override?.trim()
  return (
    cleanOverride ||
    getConfiguredPlanExecutionModelSetting() ||
    getDefaultPlanExecutionModelSetting()
  )
}

export function resolvePlanExecutionModel(override?: string | null): string {
  const setting = getPlanExecutionModelSetting(override)
  if (!setting) return setting
  if (getSelectedProviderConfig().kind !== 'anthropic') {
    return setting
  }
  return parseUserSpecifiedModel(setting as ModelSetting)
}

export function formatPlanExecutionModelForDisplay(model: string): string {
  const providerID = getSelectedProviderID()
  return providerID === 'anthropic' ? model : `${providerID}/${model}`
}
