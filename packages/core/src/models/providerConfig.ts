import { unsupportedCoreFeature } from '../errors/unsupported.js'
import type {
  ModelProviderConfig,
  ModelProviderID,
  ProviderBalanceInfo,
  ProviderTokenPlanUsageInfo,
} from './provider.js'

export type ProviderApiKeySaveResult = {
  success: boolean
  warning?: string
}

export type SaveSelectedProviderOptions = {
  providerID: ModelProviderID
  modelID: string
  baseURL?: string
}

export type SaveSelectedProviderResult = {
  error?: Error
}

export type ProviderModelListResult = {
  models: string[]
  error?: string
}

export type ProviderBalanceResult = {
  isAvailable: boolean
  balances: ProviderBalanceInfo[]
  tokenPlanUsages?: ProviderTokenPlanUsageInfo[]
  error?: string
}

export async function listProviderConfigs(): Promise<ModelProviderConfig[]> {
  unsupportedCoreFeature(
    'model provider config',
    'Provider config storage still depends on TUI settings and key storage.',
  )
}

export async function getProviderConfig(
  _providerID: ModelProviderID,
): Promise<ModelProviderConfig> {
  unsupportedCoreFeature(
    'model provider config',
    'Provider config storage still depends on TUI settings and key storage.',
  )
}

export function getSelectedProviderConfig(): ModelProviderConfig {
  unsupportedCoreFeature(
    'model provider config',
    'Provider config storage still depends on TUI settings and key storage.',
  )
}

export function getSelectedProviderID(): ModelProviderID {
  unsupportedCoreFeature(
    'model provider config',
    'Provider config storage still depends on TUI settings and key storage.',
  )
}

export function saveSelectedProvider(
  _options: SaveSelectedProviderOptions,
): SaveSelectedProviderResult {
  unsupportedCoreFeature(
    'model provider config',
    'Provider config storage still depends on TUI settings and key storage.',
  )
}

export async function fetchProviderModels(_options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<ProviderModelListResult> {
  unsupportedCoreFeature(
    'model provider config',
    'Provider model fetching still depends on TUI provider adapters.',
  )
}

export async function fetchProviderBalance(_options: {
  providerID: ModelProviderID
  apiKey?: string
  baseURL?: string
}): Promise<ProviderBalanceResult> {
  unsupportedCoreFeature(
    'model provider config',
    'Provider balance fetching still depends on TUI provider adapters.',
  )
}

export function getCachedProviderModels(_providerID: ModelProviderID): string[] | null {
  unsupportedCoreFeature(
    'model provider config',
    'Provider model cache still depends on TUI settings.',
  )
}

export function getProviderApiKey(_providerID: ModelProviderID): string | null {
  unsupportedCoreFeature(
    'model provider config',
    'Provider key storage still depends on TUI secure storage.',
  )
}

export function getProviderApiKeySource(_providerID: ModelProviderID): string | null {
  unsupportedCoreFeature(
    'model provider config',
    'Provider key storage still depends on TUI secure storage.',
  )
}

export function saveProviderApiKey(
  _providerID: ModelProviderID,
  _apiKey: string,
): ProviderApiKeySaveResult {
  unsupportedCoreFeature(
    'model provider config',
    'Provider key storage still depends on TUI secure storage.',
  )
}

export function deleteProviderApiKey(
  _providerID: ModelProviderID,
): ProviderApiKeySaveResult {
  unsupportedCoreFeature(
    'model provider config',
    'Provider key storage still depends on TUI secure storage.',
  )
}
