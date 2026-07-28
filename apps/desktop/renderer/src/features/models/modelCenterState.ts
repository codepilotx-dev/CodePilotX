import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  DesktopProviderCredential,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../shared/types.js'

export const MODEL_CENTER_VIEWS = ['providers', 'keys'] as const
export type ModelCenterView = (typeof MODEL_CENTER_VIEWS)[number]

export const MODEL_CENTER_PROVIDER_SECTIONS = ['connection', 'models', 'router'] as const
export type ModelCenterProviderSection = (typeof MODEL_CENTER_PROVIDER_SECTIONS)[number]

export type ModelCenterRouteState = {
  view: ModelCenterView
  providerId: string | null
  section: ModelCenterProviderSection
}

export type ModelCenterRoutePatch = {
  view?: ModelCenterView | null
  providerId?: string | null
  section?: ModelCenterProviderSection | null
}

export type ApiKeyFilters = {
  providerId?: string | null
  query?: string
  health?: DesktopApiKeyHealthStatus | null
}

export type ApiKeyDeleteConfirmation = {
  title: string
  description: string
}

export type ProviderCatalogSource = 'gateway' | 'custom' | 'builtin'
export type ProviderConnectionStatus =
  | 'stored-key'
  | 'oauth'
  | 'environment'
  | 'configured'
  | 'unconfigured'
export type ProviderDirectoryStatus = 'current' | ProviderConnectionStatus

export type ProviderDirectoryItem = {
  provider: DesktopModelProviderSummary
  current: boolean
  connectionStatus: ProviderConnectionStatus
  statuses: ProviderDirectoryStatus[]
  sources: ProviderCatalogSource[]
}

export type ProviderDirectoryOptions = {
  query?: string
  currentProviderId?: string | null
  currentProviderState?: DesktopModelProviderState | null
  apiKeys?: readonly DesktopApiKeySummary[]
  credentials?: readonly DesktopProviderCredential[]
}

const isModelCenterView = (value: string | null): value is ModelCenterView =>
  MODEL_CENTER_VIEWS.some(candidate => candidate === value)

const isProviderSection = (value: string | null): value is ModelCenterProviderSection =>
  MODEL_CENTER_PROVIDER_SECTIONS.some(candidate => candidate === value)

export function parseModelCenterSearchParams(
  params: URLSearchParams,
  allowedProviderIds: readonly string[],
  _fallbackProviderId?: string | null,
): ModelCenterRouteState {
  const allowed = new Set(allowedProviderIds)
  const requestedProvider = params.get('provider')

  return {
    view: isModelCenterView(params.get('view')) ? params.get('view') as ModelCenterView : 'providers',
    providerId: requestedProvider && allowed.has(requestedProvider) ? requestedProvider : null,
    section: isProviderSection(params.get('section'))
      ? params.get('section') as ModelCenterProviderSection
      : 'connection',
  }
}

export function projectProviderDirectory(
  providers: readonly DesktopModelProviderSummary[],
  options: ProviderDirectoryOptions = {},
): ProviderDirectoryItem[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''

  return providers.flatMap(provider => {
    const sources = providerSources(provider)
    const current = provider.providerID === options.currentProviderId
    const connectionStatus = providerConnectionStatus(provider, options)
    const item: ProviderDirectoryItem = {
      provider,
      current,
      connectionStatus,
      statuses: current ? ['current', connectionStatus] : [connectionStatus],
      sources,
    }
    if (!query || providerSearchText(provider, sources).includes(query)) return [item]
    return []
  })
}

/**
 * Returns a new URLSearchParams instance and leaves unrelated query parameters intact.
 * A null patch value removes the corresponding model-center parameter.
 */
export function updateModelCenterSearchParams(
  current: URLSearchParams,
  patch: ModelCenterRoutePatch,
): URLSearchParams {
  const next = new URLSearchParams(current)
  updateParam(next, 'view', patch.view)
  updateParam(next, 'provider', patch.providerId)
  updateParam(next, 'section', patch.section)
  return next
}

export function filterApiKeys(
  apiKeys: readonly DesktopApiKeySummary[],
  filters: ApiKeyFilters,
): DesktopApiKeySummary[] {
  const providerId = filters.providerId?.trim()
  const health = filters.health
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''

  return apiKeys.filter(apiKey => {
    if (providerId && apiKey.providerId !== providerId) return false
    if (health && apiKey.health.status !== health) return false
    if (!query) return true

    const searchable = [
      apiKey.label,
      apiKey.maskedValue,
      apiKey.health.status,
      apiKey.providerId,
      apiKey.active ? 'active current 当前' : 'backup 备用',
      apiKey.enabled ? 'enabled 启用' : 'disabled 停用',
    ].join(' ').toLocaleLowerCase()
    return searchable.includes(query)
  })
}

export function getApiKeyDeleteConfirmation(
  apiKey: DesktopApiKeySummary,
  apiKeys: readonly DesktopApiKeySummary[],
  providerName = apiKey.providerId,
): ApiKeyDeleteConfirmation {
  const title = `删除“${apiKey.label}”？`
  if (!apiKey.active) {
    return {
      title,
      description: '删除后无法恢复，但不会影响当前正在使用的 API Key。',
    }
  }

  return {
    title,
    description: `删除当前 API Key 后不会自动切换其他凭据，Provider“${providerName}”将等待你手动选择活动凭据。此操作无法撤销。`,
  }
}

function updateParam(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
): void {
  if (value === undefined) return
  if (value === null) {
    params.delete(key)
    return
  }
  params.set(key, value)
}

function compareApiKeyPriority(left: DesktopApiKeySummary, right: DesktopApiKeySummary): number {
  return left.priority - right.priority || left.createdAt - right.createdAt
}

function providerSources(provider: DesktopModelProviderSummary): ProviderCatalogSource[] {
  const sources: ProviderCatalogSource[] = []
  if (provider.gatewaySource) sources.push('gateway')
  if (provider.providerKind === 'custom') sources.push('custom')
  if (sources.length === 0) sources.push('builtin')
  return sources
}

function providerSearchText(
  provider: DesktopModelProviderSummary,
  sources: readonly ProviderCatalogSource[],
): string {
  const sourceTerms = sources.flatMap(source => {
    if (source === 'gateway') return ['gateway', '网关']
    if (source === 'custom') return ['custom', '自定义']
    return ['builtin', 'built-in', '内置']
  })
  return [
    provider.displayName,
    provider.providerID,
    ...sourceTerms,
  ].filter(Boolean).join(' ').toLocaleLowerCase()
}

function providerConnectionStatus(
  provider: DesktopModelProviderSummary,
  options: ProviderDirectoryOptions,
): ProviderConnectionStatus {
  if (options.apiKeys?.some(key => (
    key.providerId === provider.providerID
  ))) return 'stored-key'

  if (options.credentials?.some(credential => (
    credential.providerId === provider.providerID
    && credential.kind === 'oauth'
  ))) return 'oauth'

  const isCurrentState = options.currentProviderState?.selectedProviderID === provider.providerID
  const currentSource = isCurrentState ? options.currentProviderState?.apiKeySource : null
  if (
    isCurrentState && currentSource && currentSource !== 'secureStorage'
  ) return 'environment'

  if (
    provider.apiKeyConfigured
    || (isCurrentState && options.currentProviderState?.apiKeyConfigured)
  ) return 'configured'

  return 'unconfigured'
}
