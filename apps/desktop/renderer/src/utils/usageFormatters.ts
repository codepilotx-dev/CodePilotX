import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'

export type ProviderUsageSource =
  RpcResult<'usage/provider/query'>['sources'][number]
export type ProviderUsageGroup = ProviderUsageSource['groups'][number]
export type ProviderQuotaWindow = ProviderUsageGroup['quotaWindows'][number]
export type ProviderBalance = ProviderUsageGroup['balances'][number]
export type ProviderId =
  NonNullable<RpcParams<'usage/provider/query'>['providerIds']>[number]
export type ModelId = RpcResult<'usage/local/get'>['models'][number]['modelId']

export function protocolProviderId(value: string): ProviderId {
  return value as ProviderId
}

export function protocolModelId(value: string): ModelId {
  return value as ModelId
}

const numberFormatter = new Intl.NumberFormat('zh-CN')
const compactNumberFormatter = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function formatCount(value: number | undefined): string {
  return value === undefined ? '—' : numberFormatter.format(value)
}

export function formatCompactCount(value: number | undefined): string {
  return value === undefined ? '—' : compactNumberFormatter.format(value)
}

export function formatTokens(value: number | undefined): string {
  return value === undefined ? '—' : `${compactNumberFormatter.format(value)} Token`
}

export function formatUsdAmount(amount: string): string {
  return formatAmount('USD', amount)
}

export function formatAmount(currency: string, amount: string): string {
  const value = Number(amount)
  if (Number.isFinite(value) && Math.abs(value) < Number.MAX_SAFE_INTEGER) {
    try {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency,
        currencyDisplay: 'narrowSymbol',
        maximumFractionDigits: 8,
      }).format(value)
    } catch {
      return `${currency} ${amount}`
    }
  }
  return `${currency} ${amount}`
}

export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000))
  if (totalMinutes < 60) return `${totalMinutes} 分钟`
  const hours = Math.floor(totalMinutes / 60)
  const restMinutes = totalMinutes % 60
  if (hours < 24) {
    return restMinutes ? `${hours} 小时 ${restMinutes} 分` : `${hours} 小时`
  }
  const days = Math.floor(hours / 24)
  const restHours = hours % 24
  return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`
}

export function formatResetTime(
  resetsAt: number | undefined,
  now = Date.now(),
): string {
  if (resetsAt === undefined) return '不重置'
  const remaining = resetsAt - now
  if (remaining > 0 && remaining <= 8 * 24 * 60 * 60_000) {
    return `${formatDuration(remaining)}后重置`
  }
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(resetsAt)
}

export function formatCheckedAt(checkedAt: number | undefined): string {
  if (checkedAt === undefined) return '尚未查询'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(checkedAt)
}

export function quotaRemainingPercent(quota: ProviderQuotaWindow): number {
  if (quota.state === 'unlimited') return 100
  if (quota.state === 'exhausted') return 0
  if (quota.remainingPercent !== undefined) {
    return clampPercent(quota.remainingPercent)
  }
  if (
    quota.remaining !== undefined &&
    quota.limit !== undefined &&
    quota.limit > 0
  ) {
    return clampPercent((quota.remaining / quota.limit) * 100)
  }
  if (
    quota.used !== undefined &&
    quota.limit !== undefined &&
    quota.limit > 0
  ) {
    return clampPercent(100 - (quota.used / quota.limit) * 100)
  }
  return 0
}

export function formatQuotaValue(quota: ProviderQuotaWindow): string {
  if (quota.state === 'unlimited') return '无限额度'
  const percent = quotaRemainingPercent(quota)
  const parts = [`剩余 ${percent}%`]
  if (quota.remaining !== undefined) {
    parts.push(`${formatCount(quota.remaining)} ${quotaUnitLabel(quota.unit)}`)
  } else if (quota.used !== undefined && quota.limit !== undefined) {
    parts.push(
      `${formatCount(quota.used)} / ${formatCount(quota.limit)} ${quotaUnitLabel(quota.unit)}`,
    )
  }
  return parts.join(' · ')
}

export function quotaUnitLabel(unit: ProviderQuotaWindow['unit']): string {
  if (unit === 'tokens') return 'Token'
  if (unit === 'requests') return '次'
  if (unit === 'currency') return '金额'
  return '额度'
}

export function sourceForProvider(
  sources: readonly ProviderUsageSource[],
  providerId: string | null | undefined,
): ProviderUsageSource | undefined {
  if (!providerId) return undefined
  return sources.find(
    source =>
      source.providerIds.some(item => item === providerId) &&
      (source.status === 'available' || source.connection.kind !== 'none'),
  ) ?? sources.find(source => source.providerIds.some(item => item === providerId))
}

export function criticalQuotaWindows(
  source: ProviderUsageSource | undefined,
  limit = 3,
): ProviderQuotaWindow[] {
  if (!source) return []
  return source.groups
    .flatMap(group => group.quotaWindows)
    .sort((left, right) => {
      if (left.state === 'exhausted' && right.state !== 'exhausted') return -1
      if (right.state === 'exhausted' && left.state !== 'exhausted') return 1
      if (left.state === 'unlimited' && right.state !== 'unlimited') return 1
      if (right.state === 'unlimited' && left.state !== 'unlimited') return -1
      return quotaRemainingPercent(left) - quotaRemainingPercent(right)
    })
    .slice(0, limit)
}

export function allBalances(
  source: ProviderUsageSource | undefined,
): ProviderBalance[] {
  return source?.groups.flatMap(group => group.balances) ?? []
}

const statusOrder: Record<ProviderUsageSource['status'], number> = {
  available: 0,
  'permission-required': 1,
  'plan-required': 1,
  unavailable: 1,
  'not-connected': 2,
  unsupported: 3,
}

export function sortProviderUsageSources(
  sources: readonly ProviderUsageSource[],
): ProviderUsageSource[] {
  return [...sources].sort((left, right) => {
    const leftConnected = left.connection.kind === 'none' ? 1 : 0
    const rightConnected = right.connection.kind === 'none' ? 1 : 0
    return leftConnected - rightConnected
      || statusOrder[left.status] - statusOrder[right.status]
      || left.displayName.localeCompare(right.displayName, 'zh-CN')
  })
}

export function usageStatusLabel(
  status: ProviderUsageSource['status'],
): string {
  if (status === 'available') return '可用'
  if (status === 'not-connected') return '未连接'
  if (status === 'permission-required') return '需要权限'
  if (status === 'plan-required') return '需要套餐'
  if (status === 'unsupported') return '仅支持控制台查看'
  return '暂不可用'
}
