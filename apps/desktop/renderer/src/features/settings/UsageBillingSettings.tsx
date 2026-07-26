import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { ApplicationUsagePanel } from './usage/ApplicationUsagePanel.js'
import { ProviderUsagePanel } from './usage/ProviderUsagePanel.js'

type UsageTab = 'application' | 'providers'
type LocalRange = RpcParams<'usage/local/get'>['range']
type ProviderRange = RpcParams<'usage/provider/query'>['range']
type LocalUsageResult = RpcResult<'usage/local/get'>
type ProviderUsageResult = RpcResult<'usage/provider/query'>

const TAB_OPTIONS = [
  { value: 'application', label: '应用用量' },
  { value: 'providers', label: '账户与套餐' },
] as const

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
}

export function UsageBillingSettings(): React.ReactNode {
  const [tab, setTab] = useState<UsageTab>('application')
  const [localRange, setLocalRange] = useState<LocalRange>('30d')
  const [providerRange, setProviderRange] = useState<ProviderRange>('7d')
  const [localData, setLocalData] = useState<LocalUsageResult | null>(null)
  const [providerData, setProviderData] = useState<ProviderUsageResult | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [providerLoading, setProviderLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [providerError, setProviderError] = useState<string | null>(null)
  const localRequest = useRef(0)
  const providerRequest = useRef(0)
  const timeZone = localTimeZone()

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
    providerIds,
    force = false,
  }: {
    range: ProviderRange
    providerIds?: RpcParams<'usage/provider/query'>['providerIds']
    force?: boolean
  }): Promise<void> => {
    const request = ++providerRequest.current
    setProviderLoading(true)
    setProviderError(null)
    try {
      const result = await desktopClient.queryProviderUsage({
        range,
        timeZone,
        ...(providerIds && providerIds.length > 0 ? { providerIds } : {}),
        ...(force ? { force: true } : {}),
      })
      if (request !== providerRequest.current) return
      setProviderData(previous => {
        if (!providerIds || providerIds.length === 0 || !previous) return result
        const refreshedIds = new Set(result.sources.map(source => source.sourceId))
        return {
          ...result,
          sources: [
            ...previous.sources.filter(source => !refreshedIds.has(source.sourceId)),
            ...result.sources,
          ],
        }
      })
    } catch (error) {
      if (request === providerRequest.current) {
        setProviderError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (request === providerRequest.current) setProviderLoading(false)
    }
  }, [timeZone])

  useEffect(() => {
    void loadLocalUsage(localRange)
  }, [loadLocalUsage, localRange])

  useEffect(() => {
    if (tab !== 'providers') return
    void loadProviderUsage({ range: providerRange })
  }, [loadProviderUsage, providerRange, tab])

  return (
    <SettingsContentArea>
      <div
        aria-busy={localLoading || providerLoading || undefined}
        className="settings-content-inner usage-billing-settings"
      >
        <div className="settings-page-header usage-page-header">
          <div>
            <h2 className="settings-page-title">使用情况和计费</h2>
            <p className="usage-page-description">
              统一查看 CodePilotX 本机模型消耗，以及各厂商账户余额、成本和套餐额度。
            </p>
          </div>
          <SegmentedControl<UsageTab>
            ariaLabel="使用情况和计费页签"
            getPanelId={value => `usage-${value}-panel`}
            getTabId={value => `usage-${value}-tab`}
            onChange={value => setTab(value)}
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
            error={providerError}
            loading={providerLoading}
            onChanged={providerIds => void loadProviderUsage({
              range: providerRange,
              providerIds,
              force: true,
            })}
            onRangeChange={setProviderRange}
            onRefresh={(providerIds, force) => void loadProviderUsage({
              range: providerRange,
              providerIds,
              force,
            })}
            range={providerRange}
          />
        )}
      </div>
    </SettingsContentArea>
  )
}
