import type { ProviderUsageSource } from '@codepilotx/agent-protocol'
import {
  ChevronDown,
  ExternalLink,
  KeyRound,
  LineChart,
} from 'lucide-react'
import type React from 'react'
import type { ConfiguredProviderGroup } from '../../provider-management/index.js'
import { Button } from '../../../components/ui/Button.js'
import { IconButton } from '../../../components/ui/IconButton.js'
import { RemoteImage } from '../../../components/ui/RemoteImage.js'
import {
  formatAmount,
  formatQuotaValue,
  formatResetTime,
  quotaRemainingPercent,
  type ProviderQuotaWindow,
} from '../../../utils/usageFormatters.js'

export type AccountGroupSummary = {
  activeConnection: string
  balances: readonly {
    id: string
    label: string
    title: string
  }[]
  connectionStates: readonly string[]
  quotas: readonly {
    id: string
    label: string
    value: string
    reset: string
    state: ProviderQuotaWindow['state']
  }[]
}

export function buildAccountGroupSummary(
  group: ConfiguredProviderGroup,
  usageResults: readonly ProviderUsageSource[],
): AccountGroupSummary {
  const sourceIds = new Set(group.usageSources.map(source => source.sourceId))
  const relevantResults = usageResults.filter(result =>
    sourceIds.has(result.sourceId)
    || result.providerIds.some(providerId =>
      String(providerId) === String(group.provider.providerID)
    )
  )
  const balances = relevantResults.flatMap(source =>
    source.groups.flatMap(item => item.balances.map(balance => ({
      id: `${source.sourceId}:${item.id}:${balance.currency}`,
      label: `${balanceScopeLabel(source.scope)} · ${balance.currency} · ${formatAmount(balance.currency, balance.total)}`,
      title: `${source.displayName}（${balanceScopeLabel(source.scope)}）`,
    })))
  )
  const quotas = relevantResults
    .flatMap(source => source.groups.flatMap(item =>
      item.quotaWindows.map(quota => ({ sourceId: source.sourceId, quota }))
    ))
    .sort((left, right) => compareQuota(left.quota, right.quota))
    .slice(0, 3)
    .map(({ sourceId, quota }) => ({
      id: `${sourceId}:${quota.id}`,
      label: quota.label,
      value: formatQuotaValue(quota),
      reset: formatResetTime(quota.resetsAt),
      state: quota.state,
    }))

  return {
    activeConnection: connectionLabel(group),
    balances: [...new Map(balances.map(balance => [balance.id, balance])).values()],
    connectionStates: connectionStateLabels(group),
    quotas,
  }
}

export type AccountProviderGroupProps = {
  children: React.ReactNode
  expanded: boolean
  group: ConfiguredProviderGroup
  summary: AccountGroupSummary
  onOpenProvider: () => void
  onOpenUsage: () => void
  onToggle: () => void
  containerRef?: React.Ref<HTMLElement>
}

export function AccountProviderGroup({
  children,
  expanded,
  group,
  summary,
  onOpenProvider,
  onOpenUsage,
  onToggle,
  containerRef,
}: AccountProviderGroupProps): React.ReactNode {
  const contentId = `provider-account-${String(group.provider.providerID)}`
  return (
    <section
      className="model-center-key-group model-center-account-group"
      ref={containerRef}
      tabIndex={-1}
    >
      <header className="model-center-account-group-header">
        <div className="model-center-account-group-identity">
          <IconButton
            aria-controls={contentId}
            aria-expanded={expanded}
            className="model-center-account-disclosure"
            onClick={onToggle}
            title={expanded ? `收起 ${group.provider.displayName}` : `展开 ${group.provider.displayName}`}
            variant="plain"
          >
            <ChevronDown aria-hidden />
          </IconButton>
          {group.provider.logoURL ? (
            <RemoteImage
              alt=""
              className="model-center-provider-logo"
              fallback={<KeyRound aria-hidden />}
              src={group.provider.logoURL}
            />
          ) : <KeyRound aria-hidden />}
          <div>
            <div className="model-center-account-group-title">
              <strong>{group.provider.displayName}</strong>
              {group.current ? (
                <span className="model-center-key-badge" data-tone="active">
                  当前供应商
                </span>
              ) : null}
            </div>
            <span>{summary.activeConnection}</span>
          </div>
        </div>
        <div className="model-center-account-group-metrics">
          {summary.connectionStates.map(state => (
            <span className="model-center-account-connection-state" key={state}>
              {state}
            </span>
          ))}
          {summary.balances.map(balance => (
            <span
              className="model-center-account-balance"
              key={balance.id}
              title={balance.title}
            >
              {balance.label}
            </span>
          ))}
          {summary.quotas.map(quota => (
            <span
              className="model-center-account-quota"
              data-state={quota.state}
              key={`${quota.id}:${quota.label}`}
              title={`${quota.value}；${quota.reset}`}
            >
              <span>{quota.label}</span>
              <strong>{quota.value}</strong>
            </span>
          ))}
          {summary.connectionStates.length === 0
            && summary.balances.length === 0
            && summary.quotas.length === 0 ? (
            <span className="model-center-account-summary-empty">
              展开管理连接，历史数据可前往“用量与成本”查看
            </span>
          ) : null}
        </div>
        <div className="model-center-account-group-links">
          <Button onClick={onOpenProvider}>
            <ExternalLink aria-hidden />
            供应商
          </Button>
          <Button onClick={onOpenUsage}>
            <LineChart aria-hidden />
            查看用量
          </Button>
        </div>
      </header>
      {expanded ? (
        <div className="model-center-account-group-body" id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  )
}

function compareQuota(
  left: ProviderQuotaWindow,
  right: ProviderQuotaWindow,
): number {
  if (left.state === 'exhausted' && right.state !== 'exhausted') return -1
  if (right.state === 'exhausted' && left.state !== 'exhausted') return 1
  if (left.state === 'unlimited' && right.state !== 'unlimited') return 1
  if (right.state === 'unlimited' && left.state !== 'unlimited') return -1
  return quotaRemainingPercent(left) - quotaRemainingPercent(right)
}

function connectionLabel(group: ConfiguredProviderGroup): string {
  const connection = group.activeConnection
  if (!connection) return '已配置连接'
  if (connection.kind === 'inference-key') {
    return connection.active ? `当前推理 Key · ${connection.label}` : `推理 Key · ${connection.label}`
  }
  if (connection.kind === 'subscription') return `订阅授权 · ${connection.label}`
  if (connection.kind === 'oauth') return `OAuth · ${connection.label}`
  if (connection.kind === 'billing-key') return `管理凭据 · ${connection.label}`
  return `环境变量 · ${connection.label}`
}

function connectionStateLabels(
  group: ConfiguredProviderGroup,
): string[] {
  const billingCount = group.connections.filter(
    connection => connection.kind === 'billing-key',
  ).length
  const subscriptionCount = group.connections.filter(
    connection => connection.kind === 'subscription',
  ).length
  const oauthCount = group.connections.filter(
    connection => connection.kind === 'oauth',
  ).length
  return [
    billingCount > 0 ? `管理凭据 ${billingCount}` : null,
    subscriptionCount > 0
      ? subscriptionCount === 1 ? '订阅已授权' : `订阅授权 ${subscriptionCount}`
      : null,
    oauthCount > 0 ? oauthCount === 1 ? 'OAuth 已连接' : `OAuth 连接 ${oauthCount}` : null,
  ].filter((value): value is string => value !== null)
}

function balanceScopeLabel(
  scope: ProviderUsageSource['scope'],
): string {
  if (scope === 'api-key') return '活动 Key'
  if (scope === 'organization') return '组织'
  if (scope === 'subscription') return '订阅'
  return '账户'
}
