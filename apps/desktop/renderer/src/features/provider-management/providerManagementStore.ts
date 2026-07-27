import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'
import type { CodePilotXDesktopClient } from '../../services/desktop-client/index.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import type {
  DesktopApiKeySummary,
  DesktopProviderCredential,
} from '../../../shared/types.js'
import type {
  ProviderManagementSnapshot,
  ProviderUsageQueryParams,
  ProviderUsageQueryResult,
} from './types.js'

export type ProviderManagementClient = Pick<
  CodePilotXDesktopClient,
  | 'listModelProviders'
  | 'getModelProviderState'
  | 'listProviderCredentials'
  | 'listUsageSources'
  | 'queryProviderUsage'
  | 'connectUsageCredential'
  | 'disconnectUsageCredential'
  | 'createApiKey'
  | 'updateApiKey'
  | 'testApiKey'
  | 'setActiveProviderCredential'
  | 'setProviderCredentialEnabled'
  | 'reorderApiKeys'
  | 'deleteProviderCredential'
  | 'subscribeAgentEventEnvelopes'
>

export type ProviderManagementStore = {
  getSnapshot(): ProviderManagementSnapshot
  subscribe(listener: () => void): () => void
  ensureLoaded(): Promise<ProviderManagementSnapshot>
  refresh(): Promise<ProviderManagementSnapshot>
  refreshConnections(): Promise<ProviderManagementSnapshot>
  refreshSources(): Promise<RpcResult<'usage/source/list'>>
  querySources(
    params: ProviderUsageQueryParams,
  ): Promise<ProviderUsageQueryResult>
  connectUsageCredential(
    input: Parameters<ProviderManagementClient['connectUsageCredential']>[0],
  ): ReturnType<ProviderManagementClient['connectUsageCredential']>
  disconnectUsageCredential(
    input: Parameters<ProviderManagementClient['disconnectUsageCredential']>[0],
  ): ReturnType<ProviderManagementClient['disconnectUsageCredential']>
  createApiKey(
    input: Parameters<ProviderManagementClient['createApiKey']>[0],
  ): ReturnType<ProviderManagementClient['createApiKey']>
  updateApiKey(
    input: Parameters<ProviderManagementClient['updateApiKey']>[0],
  ): ReturnType<ProviderManagementClient['updateApiKey']>
  testApiKey(
    credentialId: Parameters<ProviderManagementClient['testApiKey']>[0],
  ): ReturnType<ProviderManagementClient['testApiKey']>
  setActiveCredential(
    ...input: Parameters<ProviderManagementClient['setActiveProviderCredential']>
  ): ReturnType<ProviderManagementClient['setActiveProviderCredential']>
  setCredentialEnabled(
    ...input: Parameters<ProviderManagementClient['setProviderCredentialEnabled']>
  ): ReturnType<ProviderManagementClient['setProviderCredentialEnabled']>
  reorderApiKeys(
    ...input: Parameters<ProviderManagementClient['reorderApiKeys']>
  ): ReturnType<ProviderManagementClient['reorderApiKeys']>
  deleteCredential(
    credentialId: Parameters<ProviderManagementClient['deleteProviderCredential']>[0],
  ): ReturnType<ProviderManagementClient['deleteProviderCredential']>
  invalidate(): void
}

const INITIAL_SNAPSHOT: ProviderManagementSnapshot = {
  loaded: false,
  loading: false,
  refreshingSources: false,
  error: null,
  providers: [],
  currentProviderState: null,
  credentials: [],
  apiKeys: [],
  usageSources: [],
  usageResults: [],
  usageGeneratedAt: null,
  usageRange: null,
  usageTimeZone: null,
}

const providerCredentialToApiKey = (
  credential: DesktopProviderCredential,
): DesktopApiKeySummary => ({
  id: credential.id,
  providerId: credential.providerId,
  label: credential.label,
  maskedValue: credential.maskedValue ?? '',
  enabled: credential.enabled,
  active: credential.active,
  priority: credential.order,
  health: credential.health ?? { status: 'untested' },
  createdAt: credential.createdAt,
  updatedAt: credential.updatedAt,
})

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message
    : '供应商连接状态暂时无法加载。'

const mergeUsageResults = (
  current: ProviderManagementSnapshot['usageResults'],
  next: ProviderUsageQueryResult['sources'],
) => {
  const merged = new Map(current.map(source => [source.sourceId, source]))
  for (const source of next) merged.set(source.sourceId, source)
  return [...merged.values()]
}

const usageConnectionIdentity = (
  connection: ProviderManagementSnapshot['usageSources'][number]['connection'],
): string => [
  connection.kind,
  connection.credentialId ?? '',
  connection.maskedValue ?? '',
].join('\u0000')

const reconcileUsageResults = (
  current: ProviderManagementSnapshot['usageResults'],
  previousSources: ProviderManagementSnapshot['usageSources'],
  nextSources: ProviderManagementSnapshot['usageSources'],
) => {
  const previousById = new Map(
    previousSources.map(source => [source.sourceId, source]),
  )
  const nextById = new Map(nextSources.map(source => [source.sourceId, source]))
  return current.filter(result => {
    const next = nextById.get(result.sourceId)
    if (!next || next.connection.kind === 'none') return false
    const previous = previousById.get(result.sourceId)
    return previous === undefined
      || usageConnectionIdentity(previous.connection)
        === usageConnectionIdentity(next.connection)
  })
}

export function createProviderManagementStore(
  client: ProviderManagementClient,
): ProviderManagementStore {
  let snapshot = INITIAL_SNAPSHOT
  let loadRequest: Promise<ProviderManagementSnapshot> | null = null
  let eventSubscription: (() => void) | null = null
  let queryContextKey: string | null = null
  let queryEpoch = 0
  const pendingQueriesByEpoch = new Map<number, number>()
  const listeners = new Set<() => void>()

  const update = (
    change: Partial<ProviderManagementSnapshot>,
  ): ProviderManagementSnapshot => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
    return snapshot
  }

  const refresh = (): Promise<ProviderManagementSnapshot> => {
    if (loadRequest) return loadRequest
    update({ loading: true, error: null })
    const pending = Promise.allSettled([
      client.listModelProviders(),
      client.getModelProviderState(),
      client.listProviderCredentials(),
      client.listUsageSources(),
    ]).then(results => {
      const errors = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map(result => errorMessage(result.reason))
      const nextUsageSources = results[3]?.status === 'fulfilled'
        ? [...results[3].value.sources]
        : snapshot.usageSources
      const credentials = results[2]?.status === 'fulfilled'
        ? [...results[2].value]
        : snapshot.credentials
      return update({
        loaded: true,
        loading: false,
        error: errors.length > 0 ? [...new Set(errors)].join('；') : null,
        ...(results[0]?.status === 'fulfilled'
          ? { providers: [...results[0].value] }
          : {}),
        ...(results[1]?.status === 'fulfilled'
          ? { currentProviderState: results[1].value }
          : {}),
        ...(results[2]?.status === 'fulfilled'
          ? {
              credentials,
              apiKeys: credentials
                .filter(credential => credential.kind === 'api-key')
                .map(providerCredentialToApiKey),
            }
          : {}),
        ...(results[3]?.status === 'fulfilled'
          ? {
              usageSources: nextUsageSources,
              usageResults: reconcileUsageResults(
                snapshot.usageResults,
                snapshot.usageSources,
                nextUsageSources,
              ),
            }
          : {}),
      })
    }).finally(() => {
      if (loadRequest === pending) loadRequest = null
    })
    loadRequest = pending
    return pending
  }

  const refreshSources = async (): Promise<RpcResult<'usage/source/list'>> => {
    update({ refreshingSources: true, error: null })
    try {
      const result = await client.listUsageSources()
      const nextUsageSources = [...result.sources]
      update({
        loaded: true,
        refreshingSources: false,
        usageSources: nextUsageSources,
        usageResults: reconcileUsageResults(
          snapshot.usageResults,
          snapshot.usageSources,
          nextUsageSources,
        ),
      })
      return result
    } catch (error) {
      update({ refreshingSources: false, error: errorMessage(error) })
      throw error
    }
  }

  const refreshConnections = async (): Promise<ProviderManagementSnapshot> => {
    update({ refreshingSources: true, error: null })
    const results = await Promise.allSettled([
      client.listProviderCredentials(),
      client.listUsageSources(),
    ])
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => errorMessage(result.reason))
    const nextUsageSources = results[1]?.status === 'fulfilled'
      ? [...results[1].value.sources]
      : snapshot.usageSources
    const credentials = results[0]?.status === 'fulfilled'
      ? [...results[0].value]
      : snapshot.credentials
    return update({
      loaded: true,
      refreshingSources: false,
      error: errors.length > 0 ? [...new Set(errors)].join('；') : null,
      ...(results[0]?.status === 'fulfilled'
        ? {
            credentials,
            apiKeys: credentials
              .filter(credential => credential.kind === 'api-key')
              .map(providerCredentialToApiKey),
          }
        : {}),
      ...(results[1]?.status === 'fulfilled'
        ? {
            usageSources: nextUsageSources,
            usageResults: reconcileUsageResults(
              snapshot.usageResults,
              snapshot.usageSources,
              nextUsageSources,
            ),
          }
        : {}),
    })
  }

  const refreshCatalog = async (): Promise<ProviderManagementSnapshot> => {
    const results = await Promise.allSettled([
      client.listModelProviders(),
      client.getModelProviderState(),
    ])
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => errorMessage(result.reason))
    return update({
      error: errors.length > 0 ? [...new Set(errors)].join('；') : snapshot.error,
      ...(results[0]?.status === 'fulfilled'
        ? { providers: [...results[0].value] }
        : {}),
      ...(results[1]?.status === 'fulfilled'
        ? { currentProviderState: results[1].value }
        : {}),
    })
  }

  const refreshApiKeys = async (): Promise<void> => {
    try {
      const credentials = [...await client.listProviderCredentials()]
      update({
        credentials,
        apiKeys: credentials
          .filter(credential => credential.kind === 'api-key')
          .map(providerCredentialToApiKey),
      })
    } catch (error) {
      update({ error: errorMessage(error) })
    }
  }

  const invalidateProviderCredentialResults = (
    providerId: string | undefined,
  ) => {
    const sourceIds = new Set(snapshot.usageSources.filter(source =>
      source.connectionMethod.kind === 'provider-credential'
      && (
        providerId === undefined
        || source.providerIds.some(id => String(id) === providerId)
      ),
    ).map(source => source.sourceId))
    update({
      usageResults: snapshot.usageResults.filter(
        result => !sourceIds.has(result.sourceId),
      ),
    })
  }

  const ensureEventSubscription = () => {
    if (eventSubscription !== null) return
    eventSubscription = client.subscribeAgentEventEnvelopes({}, event => {
      if (event.type === 'catalog/updated') {
        void refreshCatalog()
        return
      }
      if (event.type === 'provider/credential/updated') {
        void refreshConnections()
        return
      }
      if (event.type === 'usage/source/updated') {
        void refreshSources().catch(() => {})
      }
    })
  }

  const querySources = async (
    params: RpcParams<'usage/provider/query'>,
  ): Promise<RpcResult<'usage/provider/query'>> => {
    const contextKey = `${params.range}\u0000${params.timeZone}`
    if (queryContextKey !== contextKey) {
      queryContextKey = contextKey
      queryEpoch += 1
    }
    const requestEpoch = queryEpoch
    pendingQueriesByEpoch.set(
      requestEpoch,
      (pendingQueriesByEpoch.get(requestEpoch) ?? 0) + 1,
    )
    update({ refreshingSources: true, error: null })
    try {
      const result = await client.queryProviderUsage(params)
      if (requestEpoch !== queryEpoch) return result
      const sameRange = snapshot.usageRange === params.range
        && snapshot.usageTimeZone === params.timeZone
      update({
        usageResults: sameRange
          ? mergeUsageResults(snapshot.usageResults, result.sources)
          : [...result.sources],
        usageGeneratedAt: result.generatedAt,
        usageRange: result.range,
        usageTimeZone: result.timeZone,
      })
      return result
    } catch (error) {
      if (requestEpoch === queryEpoch) update({ error: errorMessage(error) })
      throw error
    } finally {
      const remaining = (pendingQueriesByEpoch.get(requestEpoch) ?? 1) - 1
      if (remaining > 0) {
        pendingQueriesByEpoch.set(requestEpoch, remaining)
      } else {
        pendingQueriesByEpoch.delete(requestEpoch)
        if (requestEpoch === queryEpoch) {
          update({ refreshingSources: false })
        }
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      ensureEventSubscription()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ensureLoaded: () => {
      ensureEventSubscription()
      return snapshot.loaded
        ? Promise.resolve(snapshot)
        : loadRequest ?? refresh()
    },
    refresh,
    refreshConnections,
    refreshSources,
    querySources,
    async connectUsageCredential(input) {
      const result = await client.connectUsageCredential(input)
      update({
        usageSources: snapshot.usageSources.map(source =>
          source.sourceId === result.sourceId
            ? { ...source, connection: result.connection }
            : source,
        ),
        usageResults: snapshot.usageResults.filter(
          source => source.sourceId !== result.sourceId,
        ),
      })
      return result
    },
    async disconnectUsageCredential(input) {
      const result = await client.disconnectUsageCredential(input)
      update({
        usageSources: snapshot.usageSources.map(source =>
          source.sourceId === result.sourceId
            ? {
                ...source,
                connection: {
                  kind: 'none' as const,
                  disconnectible: false,
                },
              }
            : source,
        ),
        usageResults: snapshot.usageResults.filter(
          source => source.sourceId !== result.sourceId,
        ),
      })
      return result
    },
    async createApiKey(input) {
      const result = await client.createApiKey(input)
      invalidateProviderCredentialResults(String(input.providerId))
      await refreshConnections()
      return result
    },
    async updateApiKey(input) {
      const providerId = snapshot.apiKeys.find(
        key => key.id === input.credentialId,
      )?.providerId
      const result = await client.updateApiKey(input)
      invalidateProviderCredentialResults(
        providerId === undefined ? undefined : String(providerId),
      )
      await refreshConnections()
      return result
    },
    async testApiKey(credentialId) {
      const result = await client.testApiKey(credentialId)
      await refreshApiKeys()
      return result
    },
    async setActiveCredential(...input) {
      const result = await client.setActiveProviderCredential(...input)
      invalidateProviderCredentialResults(String(input[0]))
      await refreshConnections()
      return result
    },
    async setCredentialEnabled(...input) {
      const providerId = snapshot.apiKeys.find(
        key => key.id === input[0],
      )?.providerId
      const result = await client.setProviderCredentialEnabled(...input)
      invalidateProviderCredentialResults(
        providerId === undefined ? undefined : String(providerId),
      )
      await refreshConnections()
      return result
    },
    async reorderApiKeys(...input) {
      const result = await client.reorderApiKeys(...input)
      await refreshApiKeys()
      return result
    },
    async deleteCredential(credentialId) {
      const providerId = snapshot.apiKeys.find(
        key => key.id === credentialId,
      )?.providerId
      const result = await client.deleteProviderCredential(credentialId)
      invalidateProviderCredentialResults(
        providerId === undefined ? undefined : String(providerId),
      )
      await refreshConnections()
      return result
    },
    invalidate() {
      update({ loaded: false, error: null })
    },
  }
}

export const providerManagementStore =
  createProviderManagementStore(desktopClient)
