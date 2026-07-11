import type { ModelProviderID } from '../../../shared/types.js'

type ProviderConfiguration = {
  providerID: ModelProviderID
  kind: string
  apiKeyConfigured: boolean
}

export function getConfiguredProviderIDs(
  providers: ProviderConfiguration[],
  copilotAuthenticated: boolean,
): Set<ModelProviderID> {
  return new Set(
    providers
      .filter(
        provider =>
          provider.apiKeyConfigured ||
          ((provider.kind === 'github-copilot' ||
            provider.providerID === 'github-copilot') &&
            copilotAuthenticated),
      )
      .map(provider => provider.providerID),
  )
}
