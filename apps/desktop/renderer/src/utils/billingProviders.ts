import type { ModelProviderID } from '../../shared/types.js'

export type BillingProviderEntry = {
  id: 'deepseek' | 'minimax'
  displayName: string
  matches: (providerID: ModelProviderID | null | undefined) => boolean
}

export const BILLING_PROVIDERS: readonly BillingProviderEntry[] = [
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    matches: providerID => providerID === 'deepseek',
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    matches: providerID => providerID === 'minimax',
  },
]

export function isBillingProviderID(
  providerID: ModelProviderID | null | undefined,
): boolean {
  return BILLING_PROVIDERS.some(entry => entry.matches(providerID))
}
