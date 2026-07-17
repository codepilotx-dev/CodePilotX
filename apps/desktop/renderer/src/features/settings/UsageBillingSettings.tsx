import { desktopClient } from '../../services/desktopClient.js'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DesktopProviderBalanceResult,
  DesktopProviderTokenPlanUsageInfo,
  ModelProviderID,
} from '../../../shared/types.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsContentArea } from './SettingsContentArea.js'
import { SettingsSection } from './SettingsSection.js'
import {
  BILLING_PROVIDERS,
  type BillingProviderEntry,
} from '../../utils/billingProviders.js'
import { Button } from '../../components/ui/Button.js'

type ConfiguredBillingProvider = {
  providerID: ModelProviderID
  entry: BillingProviderEntry
}

export function UsageBillingSettings(): React.ReactNode {
  const [balances, setBalances] = useState<
    Partial<Record<ModelProviderID, DesktopProviderBalanceResult>>
  >({})
  const [configuredBillingProviders, setConfiguredBillingProviders] = useState<
    ConfiguredBillingProvider[]
  >([])
  const [hasConfiguredProvider, setHasConfiguredProvider] = useState<
    boolean | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshBalance = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const providers = await desktopClient.listModelProviders()
      setHasConfiguredProvider(
        providers.some(provider => provider.apiKeyConfigured),
      )
      const supportedProviders: ConfiguredBillingProvider[] = []
      for (const entry of BILLING_PROVIDERS) {
        const match = providers.find(
          item => entry.matches(item.providerID) && item.apiKeyConfigured,
        )
        if (match) {
          supportedProviders.push({ providerID: match.providerID, entry })
        }
      }
      setConfiguredBillingProviders(supportedProviders)
      if (supportedProviders.length === 0) {
        setBalances({})
        return
      }

      const results = await Promise.all(
        supportedProviders.map(async ({ providerID }) => {
          const result = await desktopClient.fetchProviderBalance({
            providerID,
          })
          return [providerID, result] as const
        }),
      )
      setBalances(Object.fromEntries(results))
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : String(refreshError),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshBalance()
  }, [refreshBalance])

  const configuredProviderLabels = useMemo(
    () =>
      configuredBillingProviders
        .map(({ entry }) => entry.displayName)
        .join('、'),
    [configuredBillingProviders],
  )

  return (
    <SettingsContentArea>
      <div className="settings-content-inner">
        <div className="settings-page-header">
          <h2 className="settings-page-title">使用情况和计费</h2>
        </div>
        {hasConfiguredProvider === false ? (
          <SettingsSection
            title="暂未连接提供商"
            description="暂未连接提供商，无法获取使用情况和计费情况！"
          >
            <SettingsRow
              title="连接状态"
              description="请先到配置页连接模型提供商并保存 API key。"
              control={
                <Button
                  disabled={loading}
                  type="button"
                  onClick={() => void refreshBalance()}
                >
                  重新检查
                </Button>
              }
            />
          </SettingsSection>
        ) : configuredBillingProviders.length === 0 ? (
          <SettingsSection
            title="暂无可显示的计费信息"
            description="这里只显示已配置 API key 且支持查询用量或余额的提供商。"
          >
            <SettingsRow
              title="支持的提供商"
              description="配置 DeepSeek 或 MiniMax API key 后，这里会显示余额或 Token Plan 用量。"
              control={
                <Button
                  disabled={loading}
                  type="button"
                  onClick={() => void refreshBalance()}
                >
                  重新检查
                </Button>
              }
            />
          </SettingsSection>
        ) : (
          <>
            {error ? (
              <SettingsSection title="查询失败" description={error}>
                <SettingsRow
                  title="已配置"
                  description={configuredProviderLabels}
                  control={
                    <Button
                      disabled={loading}
                      type="button"
                      onClick={() => void refreshBalance()}
                    >
                      重新检查
                    </Button>
                  }
                />
              </SettingsSection>
            ) : null}
            {configuredBillingProviders.map(({ providerID, entry }) =>
              entry.id === 'minimax' ? (
                <MiniMaxUsageSection
                  key={providerID}
                  loading={loading}
                  result={balances[providerID] ?? null}
                  onRefresh={refreshBalance}
                />
              ) : (
                <DeepSeekBalanceSection
                  key={providerID}
                  loading={loading}
                  result={balances[providerID] ?? null}
                  onRefresh={refreshBalance}
                />
              ),
            )}
          </>
        )}
      </div>
    </SettingsContentArea>
  )
}

function DeepSeekBalanceSection({
  loading,
  result,
  onRefresh,
}: {
  loading: boolean
  result: DesktopProviderBalanceResult | null
  onRefresh: () => Promise<void>
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Boolean(result?.balances.length)
  return (
    <SettingsSection
      title="DeepSeek"
      description="API 账户余额"
      actions={
        <ProviderActions
          loading={loading}
          loadingLabel="刷新中..."
          refreshLabel="刷新"
          secondaryLabel="控制台"
          secondaryURL="https://platform.deepseek.com/usage"
          onRefresh={onRefresh}
        />
      }
    >
      <div className="billing-provider-panel">
        <div className="billing-summary-block">
          <span className={result?.isAvailable ? 'billing-status ok' : 'billing-status'}>
            {result?.isAvailable ? '账户可用' : '账户状态'}
          </span>
          <strong>{formatDeepSeekPrimaryBalance(result)}</strong>
          <p>{formatDeepSeekInlineBreakdown(result)}</p>
          {hasDetails ? (
            <button
              aria-expanded={expanded}
              className="billing-expand-toggle"
              type="button"
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? '▴ 收起明细' : '▾ 展开明细'}
            </button>
          ) : null}
        </div>
        {hasDetails && expanded ? (
          <div className="billing-metric-grid">
            {result?.balances.map(item => (
              <React.Fragment key={item.currency}>
                <BillingMetric
                  label="币种"
                  value={item.currency}
                  detail={`总余额 ${item.totalBalance}`}
                />
                <BillingMetric
                  label="赠送余额"
                  value={item.grantedBalance || '0'}
                />
                <BillingMetric
                  label="充值余额"
                  value={item.toppedUpBalance || '0'}
                />
              </React.Fragment>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}

function MiniMaxUsageSection({
  loading,
  result,
  onRefresh,
}: {
  loading: boolean
  result: DesktopProviderBalanceResult | null
  onRefresh: () => Promise<void>
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  const usages = result?.tokenPlanUsages ?? []
  const hasDetails = usages.length > 0
  return (
    <SettingsSection
      title="MiniMax Token Plan"
      description="订阅额度与重置窗口"
      actions={
        <ProviderActions
          loading={loading}
          loadingLabel="刷新中..."
          refreshLabel="刷新"
          secondaryLabel="说明"
          secondaryURL="https://platform.minimaxi.com/docs/token-plan/faq"
          onRefresh={onRefresh}
        />
      }
    >
      <div className="billing-provider-panel">
        <div className="billing-summary-block">
          <span className={result?.isAvailable ? 'billing-status ok' : 'billing-status'}>
            {result?.isAvailable ? 'Token Plan 可用' : '账户状态'}
          </span>
          <strong>{formatMiniMaxPrimarySummary(result)}</strong>
          <p>{formatMiniMaxInlineBreakdown(result)}</p>
          {hasDetails ? (
            <button
              aria-expanded={expanded}
              className="billing-expand-toggle"
              type="button"
              onClick={() => setExpanded(value => !value)}
            >
              {expanded ? '▴ 收起明细' : '▾ 展开明细'}
            </button>
          ) : null}
        </div>
        {hasDetails && expanded ? (
          <div className="billing-usage-grid">
            {usages.map(item => (
              <MiniMaxUsageCard
                item={item}
                key={`${item.modelName}-${item.currentIntervalEndTime ?? ''}`}
              />
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}

function ProviderActions({
  loading,
  loadingLabel,
  refreshLabel,
  secondaryLabel,
  secondaryURL,
  onRefresh,
}: {
  loading: boolean
  loadingLabel: string
  refreshLabel: string
  secondaryLabel: string
  secondaryURL: string
  onRefresh: () => Promise<void>
}): React.ReactNode {
  return (
    <div className="settings-inline-actions">
      <Button
        disabled={loading}
        type="button"
        onClick={() => void onRefresh()}
      >
        {loading ? loadingLabel : refreshLabel}
      </Button>
      <Button
        type="button"
        onClick={() => void desktopClient.openExternalURL(secondaryURL)}
      >
        {secondaryLabel}
      </Button>
    </div>
  )
}

function MiniMaxUsageCard({
  item,
}: {
  item: DesktopProviderTokenPlanUsageInfo
}): React.ReactNode {
  const intervalPercent = item.currentIntervalRemainingPercent ?? 0
  return (
    <article className="billing-usage-card">
      <div className="billing-usage-card-header">
        <div>
          <h4>{formatMiniMaxResourceName(item.modelName)}</h4>
          <p>
            {formatRemainingWindow(
              item.currentIntervalRemainingTime,
              item.currentIntervalEndTime,
            )}
          </p>
        </div>
        <strong>{intervalPercent}%</strong>
      </div>
      <ProgressBar value={intervalPercent} />
      <div className="billing-usage-meta">
        <BillingMetric
          label="当前窗口"
          value={formatMiniMaxUsageValue(
            item.currentIntervalRemainingPercent,
            item.currentIntervalRemainingCount,
            item.currentIntervalTotalCount,
          )}
        />
        <BillingMetric
          label="周额度"
          value={formatMiniMaxUsageValue(
            item.currentWeeklyRemainingPercent,
            item.currentWeeklyRemainingCount,
            item.currentWeeklyTotalCount,
          )}
        />
        {item.weeklyBoostPermille != null ? (
          <BillingMetric
            label="周加成"
            value={`${item.weeklyBoostPermille / 10}%`}
          />
        ) : null}
      </div>
    </article>
  )
}

function BillingMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string
  detail?: string
}): React.ReactNode {
  return (
    <div className="billing-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  )
}

function ProgressBar({ value }: { value: number }): React.ReactNode {
  const normalizedValue = Math.max(0, Math.min(100, value))
  return (
    <div
      aria-label={`剩余 ${normalizedValue}%`}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      className="billing-progress"
      role="meter"
    >
      <span style={{ width: `${normalizedValue}%` }} />
    </div>
  )
}

function formatDeepSeekInlineBreakdown(
  result: DesktopProviderBalanceResult | null,
): string {
  if (!result) return '正在查询余额'
  if (result.error) return result.error
  if (result.balances.length === 0) {
    return result.isAvailable
      ? '接口未返回余额明细'
      : '账户当前不可用'
  }
  return result.balances
    .map(item => {
      const parts = [`充值 ${item.toppedUpBalance || '0'}`]
      if (item.grantedBalance && item.grantedBalance !== '0') {
        parts.push(`赠送 ${item.grantedBalance}`)
      }
      return parts.join(' · ')
    })
    .join(' / ')
}

function formatDeepSeekPrimaryBalance(
  result: DesktopProviderBalanceResult | null,
): string {
  const first = result?.balances[0]
  if (!first) return result?.error ? '查询失败' : '正在查询'
  return `${first.currency} ${first.totalBalance}`
}

function formatMiniMaxPrimarySummary(
  result: DesktopProviderBalanceResult | null,
): string {
  if (!result) return '正在查询'
  if (result.error) return '查询失败'
  const primary = getPrimaryMiniMaxUsage(result.tokenPlanUsages ?? [])
  if (!primary) return result.isAvailable ? '已连接' : '不可用'
  const percent = primary.currentIntervalRemainingPercent ?? '-'
  return `${formatMiniMaxResourceName(primary.modelName)} ${percent}%`
}

function formatMiniMaxInlineBreakdown(
  result: DesktopProviderBalanceResult | null,
): string {
  if (!result) return '正在查询 Token Plan 用量'
  if (result.error) return result.error
  const primary = getPrimaryMiniMaxUsage(result.tokenPlanUsages ?? [])
  if (!primary) {
    return result.isAvailable ? '接口未返回用量明细' : '账户当前不可用'
  }
  const count = formatCountPair(
    primary.currentIntervalRemainingCount,
    primary.currentIntervalTotalCount,
  )
  const weekly =
    primary.currentWeeklyRemainingPercent == null
      ? ''
      : ` · 周 ${primary.currentWeeklyRemainingPercent}%`
  return count === '-' ? weekly.replace(/^ · /, '') : `${count}${weekly}`
}

function formatMiniMaxUsageValue(
  remainingPercent: number | null,
  remainingCount: number | null,
  totalCount: number | null,
): string {
  const countText = formatCountPair(remainingCount, totalCount)
  if (remainingPercent == null) return countText
  if (countText === '-') return `${remainingPercent}%`
  return `${remainingPercent}% · ${countText}`
}

function formatCountPair(
  remaining: number | null,
  total: number | null,
): string {
  if (remaining == null && (total == null || total <= 0)) return '-'
  const remainingText = remaining == null ? '-' : formatNumber(remaining)
  if (total == null || total <= 0) return remainingText
  return `${remainingText} / ${formatNumber(total)}`
}

function formatRemainingWindow(
  remainingTime: number | null,
  endTime: number | null,
): string {
  if (remainingTime != null && remainingTime > 0) {
    return `${formatDuration(remainingTime)}后重置`
  }
  if (endTime != null && endTime > 0) {
    return `${new Date(endTime).toLocaleString()} 重置`
  }
  return '未返回重置时间'
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.max(1, Math.ceil(milliseconds / 60000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`
}

function formatMiniMaxResourceName(name: string): string {
  if (name === 'general') return '通用额度'
  if (name === 'video') return '视频额度'
  return name
}

function getPrimaryMiniMaxUsage(
  usages: DesktopProviderTokenPlanUsageInfo[],
): DesktopProviderTokenPlanUsageInfo | null {
  return usages.find(item => item.modelName === 'general') ?? usages[0] ?? null
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}
