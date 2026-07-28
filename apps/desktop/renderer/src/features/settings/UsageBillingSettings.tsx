import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  providerManagementStore,
  selectAnalyticsSources,
  useProviderManagementSnapshot,
} from '../provider-management/index.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { ApplicationUsagePanel } from './usage/ApplicationUsagePanel.js'
import { ProviderUsagePanel } from './usage/ProviderUsagePanel.js'

type UsageTab = 'application' | 'accounts'
type LocalRange = RpcParams<'usage/local/get'>['range']
type ProviderRange = RpcParams<'usage/provider/query'>['range']
type LocalUsageResult = RpcResult<'usage/local/get'>
type ProviderUsageResult = RpcResult<'usage/provider/query'>

const TAB_OPTIONS = [
  { value: 'application', label: '应用用量' },
  { value: 'accounts', label: '账户用量与成本' },
] as const

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
}

export function UsageBillingSettings(): React.ReactNode {
  const [searchParams, setSearchParams] = useSearchParams()
  const providerManagement = useProviderManagementSnapshot()
  const analyticsSources = selectAnalyticsSources(providerManagement)
  const tab: UsageTab = searchParams.get('view') === 'accounts'
    ? 'accounts'
    : 'application'
  const selectedProviderId = searchParams.get('provider') ?? undefined
  const selectedSourceId = searchParams.get('source') ?? undefined
  const querySourceIds = useMemo(() => analyticsSources
    .map(source => source.descriptor)
    .filter(source =>
      source.availability === 'queryable' &&
      source.capabilities.some(capability => capability === 'usage' || capability === 'cost'),
    )
    .filter(source =>
      !selectedProviderId ||
      source.providerIds.some(providerId => String(providerId) === selectedProviderId),
    )
    .filter(source => !selectedSourceId || source.sourceId === selectedSourceId)
    .map(source => source.sourceId), [
      analyticsSources,
      selectedProviderId,
      selectedSourceId,
    ])
  const querySourceIdsKey = JSON.stringify(querySourceIds)
  const providerNames = useMemo(
    () => Object.fromEntries(providerManagement.providers.map(provider => [
      String(provider.providerID),
      provider.displayName,
    ])),
    [providerManagement.providers],
  )
  const [localRange, setLocalRange] = useState<LocalRange>('30d')
  const [providerRange, setProviderRange] = useState<ProviderRange>('7d')
  const [localData, setLocalData] = useState<LocalUsageResult | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const localRequest = useRef(0)
  const timeZone = localTimeZone()
  const providerData: ProviderUsageResult | null =
    providerManagement.usageRange === providerRange &&
    providerManagement.usageTimeZone === timeZone &&
    providerManagement.usageGeneratedAt !== null
      ? {
          range: providerRange,
          timeZone,
          generatedAt: providerManagement.usageGeneratedAt,
          sources: [...providerManagement.usageResults],
        }
      : null

  const changeTab = useCallback((nextTab: UsageTab): void => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (nextTab === 'application') {
        next.set('view', 'application')
        next.delete('provider')
        next.delete('source')
      } else {
        next.set('view', nextTab)
      }
      return next
    })
  }, [setSearchParams])

  const loadLocalUsage = useCallback(async (
    range: LocalRange,
  ): Promise<void> => {
    const request = ++localRequest.current
    setLocalLoading(true)
    setLocalError(null)
    try {
      const result = await desktopClient.getLocalUsage({ range, timeZone })
      if (request === localRequest.current) setLocalData(result)
    } catch (error) {
      if (request === localRequest.current) {
        setLocalError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (request === localRequest.current) setLocalLoading(false)
    }
  }, [timeZone])

  const loadProviderUsage = useCallback(async ({
    range,
    sourceIds,
    force = false,
  }: {
    range: ProviderRange
    sourceIds: readonly string[]
    force?: boolean
  }): Promise<void> => {
    if (sourceIds.length === 0) return
    try {
      await providerManagementStore.querySources({
        range,
        timeZone,
        sourceIds: [...sourceIds],
        ...(force ? { force: true } : {}),
      })
    } catch {
      // The shared store keeps a safe error and the last successful result.
    }
  }, [timeZone])

  useEffect(() => {
    void loadLocalUsage(localRange)
  }, [loadLocalUsage, localRange])

  useEffect(() => {
    if (tab !== 'accounts') return
    if (!providerManagement.loaded) return
    void loadProviderUsage({ range: providerRange, sourceIds: querySourceIds })
  }, [
    loadProviderUsage,
    providerManagement.loaded,
    providerRange,
    querySourceIdsKey,
    tab,
  ])

  const clearProviderFilter = useCallback((): void => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      next.delete('provider')
      next.delete('source')
      next.set('view', 'accounts')
      return next
    })
  }, [setSearchParams])

  return (
    <SettingsContentArea>
      <div
        aria-busy={
          localLoading ||
          providerManagement.loading ||
          providerManagement.refreshingSources ||
          undefined
        }
        className="settings-content-inner usage-billing-settings"
      >
        <div className="settings-page-header usage-page-header">
          <div>
            <h2 className="settings-page-title">用量与成本</h2>
            <p className="usage-page-description">
              查看 CodePilotX 本机模型消耗，以及已连接账户的远端用量和成本趋势。
            </p>
          </div>
          <SegmentedControl<UsageTab>
            ariaLabel="用量与成本页签"
            getPanelId={value => `usage-${value}-panel`}
            getTabId={value => `usage-${value}-tab`}
            onChange={changeTab}
            options={TAB_OPTIONS}
            semantics="tabs"
            value={tab}
          />
        </div>

        {tab === 'application' ? (
          <ApplicationUsagePanel
            data={localData}
            error={localError}
            loading={localLoading}
            onRangeChange={setLocalRange}
            onRefresh={() => void loadLocalUsage(localRange)}
            range={localRange}
          />
        ) : (
          <ProviderUsagePanel
            data={providerData}
            descriptors={analyticsSources.map(source => source.descriptor)}
            error={providerManagement.error}
            loading={
              providerManagement.refreshingSources ||
              providerManagement.loading
            }
            onClearFilter={clearProviderFilter}
            onRangeChange={setProviderRange}
            onRefresh={(sourceIds, force) => void loadProviderUsage({
              range: providerRange,
              sourceIds: sourceIds ?? analyticsSources.map(source => source.descriptor.sourceId),
              force,
            })}
            providerNames={providerNames}
            range={providerRange}
            selectedProviderId={selectedProviderId}
            selectedSourceId={selectedSourceId}
          />
        )}
      </div>
    </SettingsContentArea>
  )
}
