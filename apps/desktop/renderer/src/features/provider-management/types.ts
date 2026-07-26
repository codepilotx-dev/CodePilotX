import type {
  ProviderUsageSource,
  RpcParams,
  RpcResult,
  UsageSourceDescriptor,
} from '@codepilotx/agent-protocol'
import type {
  DesktopApiKeySummary,
  DesktopIntegration,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/types.js'

export type ProviderManagementSnapshot = {
  loaded: boolean
  loading: boolean
  refreshingSources: boolean
  error: string | null
  providers: readonly DesktopModelProviderSummary[]
  currentProviderState: DesktopModelProviderState | null
  integrations: readonly DesktopIntegration[]
  apiKeys: readonly DesktopApiKeySummary[]
  usageSources: readonly UsageSourceDescriptor[]
  usageResults: readonly ProviderUsageSource[]
  usageGeneratedAt: number | null
  usageRange: RpcParams<'usage/provider/query'>['range'] | null
  usageTimeZone: string | null
}

export type ProviderConnectionKind =
  | 'inference-key'
  | 'oauth'
  | 'env'
  | 'billing-key'
  | 'subscription'

export type ProviderConnection = {
  id: string
  kind: ProviderConnectionKind
  origin: 'api-key' | 'integration' | 'usage-source'
  providerIds: readonly ModelProviderID[]
  label: string
  active: boolean
  enabled?: boolean
  credentialId?: string
  sourceId?: string
}

export type ConfiguredProviderGroup = {
  provider: DesktopModelProviderSummary
  current: boolean
  configured: true
  apiKeys: readonly DesktopApiKeySummary[]
  integration: DesktopIntegration | null
  usageSources: readonly UsageSourceDescriptor[]
  connections: readonly ProviderConnection[]
  activeConnection: ProviderConnection | null
}

export type AnalyticsSource = {
  descriptor: UsageSourceDescriptor
  result: ProviderUsageSource | null
  connected: boolean
  metered: boolean
}

export type ProviderUsageQueryParams = RpcParams<'usage/provider/query'>
export type ProviderUsageQueryResult = RpcResult<'usage/provider/query'>
