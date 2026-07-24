import type {
  CatalogProvider,
  IntegrationListResponse,
} from '@codepilotx/shared'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
} from '../../../shared/types.js'

export function catalogProviderToDesktop(
  catalogProvider: CatalogProvider,
  integration?: IntegrationListResponse['integrations'][number],
): DesktopModelProviderSummary {
  const { provider } = catalogProvider
  const models = catalogProvider.models.filter(model => model.enabled)
  const modelMetadata = Object.fromEntries(
    models.map(model => {
      const cost = model.cost[0]
      const metadata: DesktopModelMetadata = {
        id: model.id,
        name: model.name,
        contextWindow: model.limit.context,
        outputTokens: model.limit.output,
        inputCost: cost?.input,
        outputCost: cost?.output,
        cacheReadCost: cost?.cache.read,
        toolCall: model.capabilities.tools,
        structuredOutput: model.capabilities.output.some(
          output => output === 'json' || output === 'structured',
        ),
        vision: model.capabilities.input.includes('image'),
        modalities: {
          input: [...model.capabilities.input],
          output: [...model.capabilities.output],
        },
        modelType: model.family,
        tags: [model.status],
        variants: model.variants.map(variant => variant.id),
      }
      return [model.id, metadata]
    }),
  )
  const configured = provider.integrationID
    ? Boolean(integration?.connections.length)
    : provider.disabled !== true
  return {
    providerID: provider.id,
    integrationID: provider.integrationID,
    kind: provider.id === 'github-copilot' ? 'github-copilot' : provider.api.type,
    displayName: provider.name,
    baseURL: provider.api.url,
    defaultModels: models.map(model => model.id),
    modelMetadata,
    apiKeyConfigured: configured,
    envVars: integration?.methods
      .filter(method => method.type === 'env')
      .flatMap(method => method.names),
    npmPackage: provider.api.type === 'aisdk' ? provider.api.package : undefined,
    logoURL: `https://models.dev/logos/${encodeURIComponent(provider.id)}.svg`,
    modelsDevSource: true,
    requiresBaseURL: provider.api.type === 'aisdk' && !provider.api.url,
  }
}
