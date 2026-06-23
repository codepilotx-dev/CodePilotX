// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import {
  isClaudeAISubscriber,
  isMaxSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import { getModelStrings } from './modelStrings.js'
import {
  COST_TIER_3_15,
  COST_HAIKU_35,
  COST_HAIKU_45,
  formatModelPricing,
} from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { checkOpus1mAccess, checkSonnet1mAccess } from './check1mAccess.js'
import { getAPIProvider } from './providers.js'
import { isModelAllowed } from './modelAllowlist.js'
import {
  getCanonicalName,
  getDefaultSonnetModel,
  getDefaultOpusModel,
  getDefaultHaikuModel,
  getMarketingNameForModel,
  getUserSpecifiedModelSetting,
  isOpus1mMergeEnabled,
  getOpus46PricingSuffix,
  type ModelSetting,
} from './model.js'
import { has1mContext } from '../context.js'
import { getGlobalConfig } from '../config.js'
import {
  getSelectedProviderConfig,
  getSelectedProviderID,
  formatProviderModel,
  getCachedProviderModels,
} from './providerConfig.js'

// @[MODEL LAUNCH]: Update all the available and default model option strings below.

export type ModelOption = {
  value: ModelSetting
  label: string
  description: string
  descriptionForModel?: string
}

function getCustomSonnetOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customSonnetModel = process.env.CODEPILOTX_DEFAULT_MODEL
  // When a 3P user has a custom default-tier model string, show it directly
  if (is3P && customSonnetModel) {
    const is1m = has1mContext(customSonnetModel)
    return {
      value: 'default',
      label:
        process.env.CODEPILOTX_DEFAULT_MODEL_NAME ?? customSonnetModel,
      description:
        process.env.CODEPILOTX_DEFAULT_MODEL_DESCRIPTION ??
        `Custom default model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.CODEPILOTX_DEFAULT_MODEL_DESCRIPTION ?? `Custom default model${is1m ? ' with 1M context' : ''}`} (${customSonnetModel})`,
    }
  }
}

// @[MODEL LAUNCH]: Update or add model option functions (getSonnetXXOption, getOpusXXOption, etc.)
// with the new model's label and description. These appear in the /model picker.
function getSonnet46Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet46 : 'default',
    label: 'Default',
    description: `Default tier · Best for everyday tasks${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Default tier - best for everyday tasks. Generally recommended for most coding tasks',
  }
}

function getCustomOpusOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customOpusModel = process.env.CODEPILOTX_DEEP_MODEL
  // When a 3P user has a custom deep-tier model string, show it directly
  if (is3P && customOpusModel) {
    const is1m = has1mContext(customOpusModel)
    return {
      value: 'deep',
      label: process.env.CODEPILOTX_DEEP_MODEL_NAME ?? customOpusModel,
      description:
        process.env.CODEPILOTX_DEEP_MODEL_DESCRIPTION ??
        `Custom deep model${is1m ? ' (1M context)' : ''}`,
      descriptionForModel: `${process.env.CODEPILOTX_DEEP_MODEL_DESCRIPTION ?? `Custom deep model${is1m ? ' with 1M context' : ''}`} (${customOpusModel})`,
    }
  }
}

function getOpus41Option(): ModelOption {
  return {
    value: 'deep',
    label: 'Deep',
    description: `Deep tier · Legacy`,
    descriptionForModel: 'Deep tier - legacy version',
  }
}

function getOpus46Option(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 : 'deep',
    label: 'Deep',
    description: `Deep tier · Most capable for complex work${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel: 'Deep tier - most capable for complex work',
  }
}

export function getSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().sonnet46 + '[1m]' : 'default[1m]',
    label: 'Default (1M context)',
    description: `Default tier for long sessions${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
    descriptionForModel:
      'Default tier with 1M context window - for long sessions with large codebases',
  }
}

export function getOpus46_1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'deep[1m]',
    label: 'Deep (1M context)',
    description: `Deep tier for long sessions${getOpus46PricingSuffix(fastMode)}`,
    descriptionForModel:
      'Deep tier with 1M context window - for long sessions with large codebases',
  }
}

function getCustomHaikuOption(): ModelOption | undefined {
  const is3P = getAPIProvider() !== 'firstParty'
  const customHaikuModel = process.env.CODEPILOTX_FAST_MODEL
  // When a 3P user has a custom fast-tier model string, show it directly
  if (is3P && customHaikuModel) {
    return {
      value: 'fast',
      label: process.env.CODEPILOTX_FAST_MODEL_NAME ?? customHaikuModel,
      description:
        process.env.CODEPILOTX_FAST_MODEL_DESCRIPTION ?? 'Custom fast model',
      descriptionForModel: `${process.env.CODEPILOTX_FAST_MODEL_DESCRIPTION ?? 'Custom fast model'} (${customHaikuModel})`,
    }
  }
}

function getHaiku45Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'fast',
    label: 'Fast',
    description: `Fast tier · Fastest for quick answers${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_45)}`}`,
    descriptionForModel:
      'Fast tier - fastest for quick answers. Lower cost but less capable than the default tier.',
  }
}

function getHaiku35Option(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: 'fast',
    label: 'Fast',
    description: `Fast tier for simple tasks${is3P ? '' : ` · ${formatModelPricing(COST_HAIKU_35)}`}`,
    descriptionForModel:
      'Fast tier - faster and lower cost, but less capable than the default tier. Use for simple tasks.',
  }
}

function getHaikuOption(): ModelOption {
  // Return correct fast-tier option based on provider
  const fastModel = getDefaultHaikuModel()
  return fastModel === getModelStrings().haiku45
    ? getHaiku45Option()
    : getHaiku35Option()
}

function getMaxOpusOption(fastMode = false): ModelOption {
  return {
    value: 'deep',
    label: 'Deep',
    description: `Deep tier · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`,
  }
}

export function getMaxSonnet46_1MOption(): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  const billingInfo = isClaudeAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'default[1m]',
    label: 'Default (1M context)',
    description: `Default tier with 1M context${billingInfo}${is3P ? '' : ` · ${formatModelPricing(COST_TIER_3_15)}`}`,
  }
}

export function getMaxOpus46_1MOption(fastMode = false): ModelOption {
  const billingInfo = isClaudeAISubscriber() ? ' · Billed as extra usage' : ''
  return {
    value: 'deep[1m]',
    label: 'Deep (1M context)',
    description: `Deep tier with 1M context${billingInfo}${getOpus46PricingSuffix(fastMode)}`,
  }
}

function getMergedOpus1MOption(fastMode = false): ModelOption {
  const is3P = getAPIProvider() !== 'firstParty'
  return {
    value: is3P ? getModelStrings().opus46 + '[1m]' : 'deep[1m]',
    label: 'Deep (1M context)',
    description: `Deep tier with 1M context · Most capable for complex work${!is3P && fastMode ? getOpus46PricingSuffix(fastMode) : ''}`,
    descriptionForModel:
      'Deep tier with 1M context - most capable for complex work',
  }
}

const MaxSonnet46Option: ModelOption = {
  value: 'default',
  label: 'Default',
  description: 'Default tier · Best for everyday tasks',
}

const MaxHaiku45Option: ModelOption = {
  value: 'fast',
  label: 'Fast',
  description: 'Fast tier · Fastest for quick answers',
}

function getOpusPlanOption(): ModelOption {
  return {
    value: 'plan',
    label: 'Plan Mode',
    description: 'Use the deep tier in plan mode, default tier otherwise',
  }
}

// @[MODEL LAUNCH]: Update the model picker lists below to include/reorder options for the new model.
// Each user tier (ant, Max/Team Premium, Pro/Team Standard/Enterprise, PAYG 1P, PAYG 3P) has its own list.
function getModelOptionsBase(fastMode = false): ModelOption[] {
  if (process.env.USER_TYPE === 'ant') {
    // Build options from antModels config
    const antModelOptions: ModelOption[] = getAntModels().map(m => ({
      value: m.alias,
      label: m.label,
      description: m.description ?? `[ANT-ONLY] ${m.label} (${m.model})`,
    }))

    return [
      ...antModelOptions,
      getMergedOpus1MOption(fastMode),
      getSonnet46Option(),
      getSonnet46_1MOption(),
      getHaiku45Option(),
    ]
  }

  if (isClaudeAISubscriber()) {
    if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
      // Max and Team Premium users: deep is default, show default as alternative
      const premiumOptions: ModelOption[] = []
      if (!isOpus1mMergeEnabled() && checkOpus1mAccess()) {
        premiumOptions.push(getMaxOpus46_1MOption(fastMode))
      }

      premiumOptions.push(MaxSonnet46Option)
      if (checkSonnet1mAccess()) {
        premiumOptions.push(getMaxSonnet46_1MOption())
      }

      premiumOptions.push(MaxHaiku45Option)
      return premiumOptions
    }

    // Pro/Team Standard/Enterprise users: default is default, show deep as alternative
    const standardOptions: ModelOption[] = []
    if (checkSonnet1mAccess()) {
      standardOptions.push(getMaxSonnet46_1MOption())
    }

    if (isOpus1mMergeEnabled()) {
      standardOptions.push(getMergedOpus1MOption(fastMode))
    } else {
      standardOptions.push(getMaxOpusOption(fastMode))
      if (checkOpus1mAccess()) {
        standardOptions.push(getMaxOpus46_1MOption(fastMode))
      }
    }

    standardOptions.push(MaxHaiku45Option)
    return standardOptions
  }

  // PAYG 1P API: default + default 1M + deep + deep 1M + fast
  if (getAPIProvider() === 'firstParty') {
    const payg1POptions: ModelOption[] = []
    if (checkSonnet1mAccess()) {
      payg1POptions.push(getSonnet46_1MOption())
    }
    if (isOpus1mMergeEnabled()) {
      payg1POptions.push(getMergedOpus1MOption(fastMode))
    } else {
      payg1POptions.push(getOpus46Option(fastMode))
      if (checkOpus1mAccess()) {
        payg1POptions.push(getOpus46_1MOption(fastMode))
      }
    }
    payg1POptions.push(getHaiku45Option())
    return payg1POptions
  }

  // PAYG 3P: default + default 1M + deep + deep 1M + fast
  const payg3pOptions: ModelOption[] = []

  const customSonnet = getCustomSonnetOption()
  if (customSonnet !== undefined) {
    payg3pOptions.push(customSonnet)
  } else {
    // Add the current default-tier option.
    payg3pOptions.push(getSonnet46Option())
    if (checkSonnet1mAccess()) {
      payg3pOptions.push(getSonnet46_1MOption())
    }
  }

  const customOpus = getCustomOpusOption()
  if (customOpus !== undefined) {
    payg3pOptions.push(customOpus)
  } else {
    // Add deep-tier options.
    payg3pOptions.push(getOpus41Option())
    payg3pOptions.push(getOpus46Option(fastMode))
    if (checkOpus1mAccess()) {
      payg3pOptions.push(getOpus46_1MOption(fastMode))
    }
  }
  const customHaiku = getCustomHaikuOption()
  if (customHaiku !== undefined) {
    payg3pOptions.push(customHaiku)
  } else {
    payg3pOptions.push(getHaikuOption())
  }
  return payg3pOptions
}

// @[MODEL LAUNCH]: Add the new model ID to the appropriate family pattern below
// so the "newer version available" hint works correctly.
/**
 * Map a full model name to its family alias and the marketing name of the
 * version the alias currently resolves to. Used to detect when a user has
 * a specific older version pinned and a newer one is available.
 */
function getModelFamilyInfo(
  model: string,
): { alias: string; currentVersionName: string } | null {
  const canonical = getCanonicalName(model)

  // Sonnet family
  if (
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-sonnet-4-') ||
    canonical.includes('claude-3-7-sonnet') ||
    canonical.includes('claude-3-5-sonnet')
  ) {
    const currentName = getMarketingNameForModel(getDefaultSonnetModel())
    if (currentName) {
      return { alias: 'Sonnet', currentVersionName: currentName }
    }
  }

  // Opus family
  if (canonical.includes('claude-opus-4')) {
    const currentName = getMarketingNameForModel(getDefaultOpusModel())
    if (currentName) {
      return { alias: 'Opus', currentVersionName: currentName }
    }
  }

  // Haiku family
  if (
    canonical.includes('claude-haiku') ||
    canonical.includes('claude-3-5-haiku')
  ) {
    const currentName = getMarketingNameForModel(getDefaultHaikuModel())
    if (currentName) {
      return { alias: 'Haiku', currentVersionName: currentName }
    }
  }

  return null
}

/**
 * Returns a ModelOption for a known Anthropic model with a human-readable
 * label, and an upgrade hint if a newer version is available via the alias.
 * Returns null if the model is not recognized.
 */
function getKnownModelOption(model: string): ModelOption | null {
  const marketingName = getMarketingNameForModel(model)
  if (!marketingName) return null

  const familyInfo = getModelFamilyInfo(model)
  if (!familyInfo) {
    return {
      value: model,
      label: marketingName,
      description: model,
    }
  }

  // Check if the alias currently resolves to a different (newer) version
  if (marketingName !== familyInfo.currentVersionName) {
    return {
      value: model,
      label: marketingName,
      description: `Newer version available · select ${familyInfo.alias} for ${familyInfo.currentVersionName}`,
    }
  }

  // Same version as the alias — just show the friendly name
  return {
    value: model,
    label: marketingName,
    description: model,
  }
}

export function getModelOptions(fastMode = false): ModelOption[] {
  const selectedProvider = getSelectedProviderConfig()
  if (selectedProvider.kind !== 'anthropic') {
    const currentModel = getUserSpecifiedModelSetting()
    const providerModels =
      getCachedProviderModels(getSelectedProviderID()) ??
      selectedProvider.defaultModels
    const options: ModelOption[] = [
      ...providerModels.map(model => ({
        value: model,
        label: model,
        description: formatProviderModel(getSelectedProviderID(), model),
      })),
    ]
    if (
      currentModel !== undefined &&
      currentModel !== null &&
      !options.some(option => option.value === currentModel)
    ) {
      options.push({
        value: currentModel,
        label: currentModel,
        description: 'Current provider model',
      })
    }
    return options
  }

  const options = getModelOptionsBase(fastMode)

  // Add the custom model from the ANTHROPIC_CUSTOM_MODEL_OPTION env var
  const envCustomModel = process.env.ANTHROPIC_CUSTOM_MODEL_OPTION
  if (
    envCustomModel &&
    !options.some(existing => existing.value === envCustomModel)
  ) {
    options.push({
      value: envCustomModel,
      label: process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME ?? envCustomModel,
      description:
        process.env.ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION ??
        `Custom model (${envCustomModel})`,
    })
  }

  // Append additional model options fetched during bootstrap
  for (const opt of getGlobalConfig().additionalModelOptionsCache ?? []) {
    if (!options.some(existing => existing.value === opt.value)) {
      options.push(opt)
    }
  }

  // Add custom model from either the current model value or the initial one
  // if it is not already in the options.
  let customModel: ModelSetting = null
  const currentMainLoopModel = getUserSpecifiedModelSetting()
  const initialMainLoopModel = getInitialMainLoopModel()
  if (currentMainLoopModel !== undefined && currentMainLoopModel !== null) {
    customModel = currentMainLoopModel
  } else if (initialMainLoopModel !== null) {
    customModel = initialMainLoopModel
  }
  if (customModel === null || options.some(opt => opt.value === customModel)) {
    return filterModelOptionsByAllowlist(options)
  } else if (customModel === 'plan') {
    return filterModelOptionsByAllowlist([...options, getOpusPlanOption()])
  } else if (customModel === 'deep' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMaxOpusOption(fastMode),
    ])
  } else if (customModel === 'deep[1m]' && getAPIProvider() === 'firstParty') {
    return filterModelOptionsByAllowlist([
      ...options,
      getMergedOpus1MOption(fastMode),
    ])
  } else {
    // Try to show a human-readable label for known Anthropic models, with an
    // upgrade hint if the alias now resolves to a newer version.
    const knownOption = getKnownModelOption(customModel)
    if (knownOption) {
      options.push(knownOption)
    } else {
      options.push({
        value: customModel,
        label: customModel,
        description: 'Custom model',
      })
    }
    return filterModelOptionsByAllowlist(options)
  }
}

/**
 * Filter model options by the availableModels allowlist.
 * Always preserves the "Default" option (value: null).
 */
function filterModelOptionsByAllowlist(options: ModelOption[]): ModelOption[] {
  const settings = getSettings_DEPRECATED() || {}
  if (!settings.availableModels) {
    return options // No restrictions
  }
  return options.filter(
    opt =>
      opt.value === null || (opt.value !== null && isModelAllowed(opt.value)),
  )
}
