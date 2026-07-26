import type {
  DailyUsagePoint,
  ModelOrToolUsage,
  ProviderUsageSource,
} from "@codepilotx/agent-protocol"
import { Provider, type Credential } from "@codepilotx/model-schema"

export type { DailyUsagePoint, ModelOrToolUsage, ProviderUsageSource }
export type UsageRange = "today" | "7d" | "30d"
export type UsageGroup = ProviderUsageSource["groups"][number]
export type UsageStatus = ProviderUsageSource["status"]
export type UsageErrorCategory = NonNullable<ProviderUsageSource["error"]>["category"]

export type ResolvedUsageCredential = {
  value: Credential.Value
  connection: ProviderUsageSource["connection"]
}

export type UsageQueryContext = {
  range: UsageRange
  timeZone: string
  force: boolean
  now: number
  providers: readonly Provider.Info[]
  credential: (providerIds: readonly string[], envNames?: readonly string[]) => Promise<ResolvedUsageCredential | null>
  billingCredential: (sourceId: string, envNames?: readonly string[]) => Promise<ResolvedUsageCredential | null>
  request: (url: string, init?: RequestInit) => Promise<unknown>
}

export interface ProviderUsageAdapter {
  readonly sourceId: string
  readonly providerIds: readonly string[]
  readonly displayName: string
  readonly scope: ProviderUsageSource["scope"]
  readonly stability: ProviderUsageSource["stability"]
  readonly cacheMs?: number
  matches(provider: Provider.Info): boolean
  query(context: UsageQueryContext): Promise<ProviderUsageSource>
}

export const emptySource = (
  adapter: ProviderUsageAdapter,
  status: UsageStatus,
  connection: ProviderUsageSource["connection"] = {
    kind: "none",
    disconnectible: false,
  },
): ProviderUsageSource => ({
  sourceId: adapter.sourceId,
  providerIds: adapter.providerIds.map((id) => Provider.ID.make(id)),
  displayName: adapter.displayName,
  scope: adapter.scope,
  stability: adapter.stability,
  status,
  connection,
  groups: [],
})
