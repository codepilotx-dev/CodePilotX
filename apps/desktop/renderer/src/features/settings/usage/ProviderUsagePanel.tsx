import type { RpcParams, RpcResult } from '@codepilotx/agent-protocol'
import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { SkeletonBlock, SkeletonRegion } from '../../../components/ui/Skeleton.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  allBalances,
  clampPercent,
  formatAmount,
  formatCheckedAt,
  formatCompactCount,
  formatCount,
  formatQuotaValue,
  formatResetTime,
  type ProviderId,
  quotaRemainingPercent,
  sortProviderUsageSources,
  usageStatusLabel,
  type ProviderUsageSource,
} from '../../../utils/usageFormatters.js'
import { useIntegrationOAuthAuthorization } from '../../models/useIntegrationOAuthAuthorization.js'

type ProviderRange = RpcParams<'usage/provider/query'>['range']
type ProviderUsageResult = RpcResult<'usage/provider/query'>
type BillingSourceId =
  RpcParams<'usage/credential/disconnect'>['sourceId']

type Props = {
  data: ProviderUsageResult | null
  error: string | null
  loading: boolean
  range: ProviderRange
  onRangeChange: (range: ProviderRange) => void
  onRefresh: (providerIds?: readonly ProviderId[], force?: boolean) => void
  onChanged: (providerIds: readonly ProviderId[]) => void
}

const RANGE_OPTIONS = [
  { value: 'today', label: '今日' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
] as const

const BILLING_SOURCE_IDS = new Set<BillingSourceId>([
  'openai-admin',
  'anthropic-admin',
  'openrouter-management',
  'xai-management',
  'cloudflare-ai-gateway',
])

const OTHER_PROVIDER_DETAILS: Readonly<Record<string, {
  description: string
  url: string
}>> = {
  'google-console': {
    description: '普通推理 Key 没有稳定的账户余额或历史账务 API。',
    url: 'https://aistudio.google.com/usage',
  },
  'groq-console': {
    description: '普通推理 Key 没有稳定的账户余额或历史账务 API。',
    url: 'https://console.groq.com/settings/usage',
  },
  'together-console': {
    description: '普通推理 Key 没有稳定的账户余额或历史账务 API。',
    url: 'https://api.together.ai/settings/billing',
  },
  'cerebras-console': {
    description: '普通推理 Key 没有稳定的账户余额或历史账务 API。',
    url: 'https://cloud.cerebras.ai/',
  },
  'huggingface-console': {
    description: '普通推理 Token 没有稳定的账户余额或历史账务 API。',
    url: 'https://huggingface.co/settings/billing',
  },
  'nvidia-console': {
    description: '普通推理 Key 没有稳定的账户余额或历史账务 API。',
    url: 'https://build.nvidia.com/settings/api-keys',
  },
  'bedrock-console': {
    description: '用量依赖云 IAM 与 Cost Explorer，本次不连接云账户。',
    url: 'https://console.aws.amazon.com/costmanagement/home',
  },
  'azure-openai-console': {
    description: '用量依赖 Azure IAM 与 Cost Management，本次不连接云账户。',
    url: 'https://portal.azure.com/#view/Microsoft_Azure_CostManagement/Menu/~/overview',
  },
  'alibaba-console': {
    description: '管理数据需要云账号 AK/SK 或签名请求，本次不连接云账户。',
    url: 'https://bailian.console.aliyun.com/',
  },
  'volcengine-console': {
    description: '管理数据需要云账号 AK/SK 或签名请求，本次不连接云账户。',
    url: 'https://console.volcengine.com/ark/',
  },
  'mistral-console': {
    description: 'Admin Usage 目前面向 Enterprise/Preview，暂缓接入。',
    url: 'https://console.mistral.ai/usage/',
  },
}

export function ProviderUsagePanel({
  data,
  error,
  loading,
  range,
  onRangeChange,
  onRefresh,
  onChanged,
}: Props): React.ReactNode {
  const sources = useMemo(
    () => sortProviderUsageSources(data?.sources ?? []),
    [data],
  )
  const providerSources = sources.filter(source => source.status !== 'unsupported')
  const directorySources = sources.filter(source => source.status === 'unsupported')

  return (
    <div
      aria-labelledby="usage-providers-tab"
      className="usage-panel"
      id="usage-providers-panel"
      role="tabpanel"
    >
      <div className="usage-panel-toolbar">
        <div>
          <h3>账户与套餐</h3>
          <p>按来源分别查询余额、组织用量、成本与套餐窗口；单个来源失败不会影响其他卡片。</p>
        </div>
        <div className="usage-toolbar-actions">
          <SegmentedControl
            ariaLabel="账户用量时间范围"
            onChange={onRangeChange}
            options={RANGE_OPTIONS}
            value={range}
          />
          <Button loading={loading} onClick={() => onRefresh(undefined, true)}>
            全部刷新
          </Button>
        </div>
      </div>

      {error ? <div className="usage-inline-error" role="status">{error}</div> : null}
      {loading && !data ? <ProviderUsageSkeleton /> : null}
      {!loading && providerSources.length === 0 && directorySources.length === 0 ? (
        <div className="usage-empty-state" role="status">
          <h3>尚未发现可查询来源</h3>
          <p>连接模型 Provider 或管理凭据后，这里会显示账户与套餐信息。</p>
        </div>
      ) : null}

      <div className="provider-usage-list">
        {providerSources.map(source => (
          <ProviderUsageCard
            key={source.sourceId}
            loading={loading}
            onChanged={() => onChanged(source.providerIds)}
            onRefresh={() => onRefresh(
              source.providerIds.length > 0 ? [...source.providerIds] : undefined,
              true,
            )}
            source={source}
          />
        ))}
      </div>

      <OtherProviderDirectory sources={directorySources} />
    </div>
  )
}

function ProviderUsageSkeleton(): React.ReactNode {
  return (
    <SkeletonRegion className="usage-loading" label="正在查询账户与套餐">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonBlock className="usage-loading-provider" key={index} />
      ))}
    </SkeletonRegion>
  )
}

function ProviderUsageCard({
  source,
  loading,
  onRefresh,
  onChanged,
}: {
  source: ProviderUsageSource
  loading: boolean
  onRefresh: () => void
  onChanged: () => void
}): React.ReactNode {
  const isVercel = source.sourceId.toLowerCase().includes('vercel')
  const isClaudeSubscription =
    source.scope === 'subscription' &&
    source.sourceId.toLowerCase().includes('anthropic')
  const billingSourceId = BILLING_SOURCE_IDS.has(source.sourceId as BillingSourceId)
    ? source.sourceId as BillingSourceId
    : null
  const balances = allBalances(source)
  return (
    <article
      className="provider-usage-card"
      data-status={source.status}
      data-stability={source.stability}
    >
      <header className="provider-usage-header">
        <div>
          <div className="provider-usage-title">
            <h3>{source.displayName}</h3>
            <span className="usage-badge">{scopeLabel(source.scope)}</span>
            <span className="usage-badge" data-stability={source.stability}>
              {source.stability === 'official' ? '官方接口' : '实验性'}
            </span>
            <span className="usage-badge" data-status={source.status}>
              {usageStatusLabel(source.status)}
            </span>
          </div>
          <p>
            {connectionLabel(source)}
            {' · '}
            {formatCheckedAt(source.checkedAt)}
          </p>
        </div>
        <Button loading={loading} onClick={onRefresh}>刷新</Button>
      </header>

      {isVercel ? (
        <div className="usage-cost-notice" role="note">
          Vercel Reporting API 为计费查询，当前价格以官方为准；CodePilotX 使用一小时缓存且不会后台轮询。
        </div>
      ) : null}
      {source.stability === 'experimental' ? (
        <div className="usage-experimental-note">
          实验性来源可能随官方客户端端点变化；失败只影响此卡片。
        </div>
      ) : null}
      {source.error ? (
        <div className="usage-source-error" role="status">
          <strong>{source.error.message}</strong>
          <span>{source.error.retryable ? '可以稍后重试。' : errorCategoryLabel(source.error.category)}</span>
        </div>
      ) : null}

      {source.groups.length > 0 ? (
        <div className="provider-usage-groups">
          {source.groups.map(group => (
            <ProviderUsageGroupCard group={group} key={group.id} />
          ))}
        </div>
      ) : balances.length === 0 && source.status === 'available' ? (
        <p className="usage-chart-empty">来源已连接，但当前时间范围没有返回用量。</p>
      ) : null}

      {billingSourceId && (
        source.connection.kind === 'none' ||
        source.connection.kind === 'env' ||
        source.connection.kind === 'billing-key'
      ) ? (
        <BillingCredentialForm
          connected={source.connection.kind === 'billing-key'}
          maskedValue={source.connection.maskedValue}
          onChanged={onChanged}
          sourceId={billingSourceId}
        />
      ) : null}
      {isClaudeSubscription ? (
        <ClaudeSubscriptionConnection
          connected={source.connection.kind === 'oauth'}
          credentialId={source.connection.credentialId}
          onChanged={onChanged}
        />
      ) : null}
    </article>
  )
}

function ProviderUsageGroupCard({
  group,
}: {
  group: ProviderUsageSource['groups'][number]
}): React.ReactNode {
  return (
    <section className="provider-usage-group">
      <h4>{group.label}</h4>
      {group.balances.length > 0 ? (
        <div className="provider-balance-grid">
          {group.balances.map(balance => (
            <div className="provider-balance" key={`${group.id}/${balance.currency}`}>
              <span>{balance.currency} 余额</span>
              <strong>{formatAmount(balance.currency, balance.total)}</strong>
              {balance.components.map(component => (
                <small key={component.label}>
                  {component.label} {formatAmount(balance.currency, component.amount)}
                </small>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {group.quotaWindows.length > 0 ? (
        <div className="provider-quota-grid">
          {group.quotaWindows.map(quota => {
            const percent = quotaRemainingPercent(quota)
            return (
              <div className="provider-quota" data-state={quota.state} key={quota.id}>
                <div>
                  <strong>{quota.label}</strong>
                  <span>{formatQuotaValue(quota)}</span>
                </div>
                <div
                  aria-label={`${quota.label}，${formatQuotaValue(quota)}`}
                  className="provider-quota-track"
                  role="progressbar"
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={quota.state === 'unlimited' ? 100 : percent}
                >
                  <span style={{ '--quota-remaining': percent / 100 } as React.CSSProperties} />
                </div>
                <small>{quota.state === 'unlimited' ? '不受额度限制' : formatResetTime(quota.resetsAt)}</small>
              </div>
            )
          })}
        </div>
      ) : null}

      {group.totals ? (
        <dl className="provider-totals">
          <div><dt>输入 Token</dt><dd>{formatCompactCount(group.totals.inputTokens)}</dd></div>
          <div><dt>输出 Token</dt><dd>{formatCompactCount(group.totals.outputTokens)}</dd></div>
          <div><dt>缓存 Token</dt><dd>{formatCompactCount(group.totals.cachedTokens)}</dd></div>
          <div><dt>请求数</dt><dd>{formatCount(group.totals.requests)}</dd></div>
          {group.totals.costs.map(cost => (
            <div key={cost.currency}><dt>{cost.currency} 成本</dt><dd>{formatAmount(cost.currency, cost.amount)}</dd></div>
          ))}
        </dl>
      ) : null}
      {group.series && group.series.length > 0 ? (
        <ProviderSeries points={group.series} />
      ) : null}
      {group.breakdown && group.breakdown.length > 0 ? (
        <ol className="provider-breakdown">
          {group.breakdown.map(item => (
            <li key={`${item.kind}/${item.id}`}>
              <span><strong>{item.label}</strong><small>{item.kind === 'model' ? '模型' : '工具'}</small></span>
              <span>
                {item.requests !== undefined ? `${formatCount(item.requests)} 次` : null}
                {item.inputTokens !== undefined || item.outputTokens !== undefined
                  ? ` · ${formatCompactCount((item.inputTokens ?? 0) + (item.outputTokens ?? 0) + (item.cachedTokens ?? 0))} Token`
                  : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  )
}

function ProviderSeries({
  points,
}: {
  points: NonNullable<ProviderUsageSource['groups'][number]['series']>
}): React.ReactNode {
  const tokenValues = points.map(point =>
    point.inputTokens + point.outputTokens + point.cachedTokens,
  )
  const costValues = points.map(point => point.costs.reduce((sum, cost) => {
    const value = Number(cost.amount)
    return sum + (Number.isFinite(value) && value >= 0 ? value : 0)
  }, 0))
  const mode = tokenValues.some(value => value > 0)
    ? 'tokens'
    : costValues.some(value => value > 0)
      ? 'costs'
      : 'requests'
  const values = mode === 'tokens'
    ? tokenValues
    : mode === 'costs'
      ? costValues
      : points.map(point => point.requests)
  const max = Math.max(1, ...values)
  const width = Math.max(240, points.length * 18)
  return (
    <div className="provider-series">
      <svg aria-label="来源每日用量趋势" preserveAspectRatio="none" role="img" viewBox={`0 0 ${width} 64`}>
        {values.map((value, index) => (
          <rect
            fill="var(--usage-chart-1)"
            height={(value / max) * 56}
            key={points[index]?.date}
            rx="2"
            width="12"
            x={index * 18 + 3}
            y={60 - (value / max) * 56}
          >
            <title>{mode === 'tokens'
              ? `${points[index]?.date} · ${formatCount(value)} Token`
              : mode === 'costs'
                ? `${points[index]?.date} · ${(points[index]?.costs ?? []).map(cost => formatAmount(cost.currency, cost.amount)).join(' / ')}`
                : `${points[index]?.date} · ${formatCount(value)} 次请求`}
            </title>
          </rect>
        ))}
      </svg>
    </div>
  )
}

function BillingCredentialForm({
  sourceId,
  connected,
  maskedValue,
  onChanged,
}: {
  sourceId: BillingSourceId
  connected: boolean
  maskedValue?: string
  onChanged: () => void
}): React.ReactNode {
  const [key, setKey] = useState('')
  const [teamId, setTeamId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function connect(): Promise<void> {
    if (!key.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (sourceId === 'xai-management') {
        await desktopClient.connectUsageCredential({
          sourceId,
          key: key.trim(),
          teamId: teamId.trim(),
        })
      } else if (sourceId === 'cloudflare-ai-gateway') {
        await desktopClient.connectUsageCredential({
          sourceId,
          key: key.trim(),
          accountId: accountId.trim(),
        })
      } else {
        await desktopClient.connectUsageCredential({ sourceId, key: key.trim() })
      }
      setKey('')
      setTeamId('')
      setAccountId('')
      onChanged()
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await desktopClient.disconnectUsageCredential({ sourceId })
      onChanged()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    } finally {
      setBusy(false)
    }
  }

  const auxiliaryMissing = sourceId === 'xai-management'
    ? !teamId.trim()
    : sourceId === 'cloudflare-ai-gateway'
      ? !accountId.trim()
      : false
  return (
    <div className="usage-connection-form">
      <div>
        <h4>{connected ? '替换管理凭据' : '连接管理凭据'}</h4>
        <p>
          {connected && maskedValue
            ? `已保存 ${maskedValue}；输入框不会回显现有密钥。`
            : '凭据仅由 Agent 加密保存，不会进入推理 Key 池。'}
        </p>
      </div>
      <div className="usage-connection-fields">
        <Input
          aria-label={`${sourceId} 管理密钥`}
          autoComplete="off"
          onChange={event => setKey(event.target.value)}
          placeholder={connected ? '输入新密钥以替换' : '管理密钥'}
          type="password"
          value={key}
        />
        {sourceId === 'xai-management' ? (
          <Input
            aria-label="xAI Team ID"
            onChange={event => setTeamId(event.target.value)}
            placeholder="Team ID"
            value={teamId}
          />
        ) : null}
        {sourceId === 'cloudflare-ai-gateway' ? (
          <Input
            aria-label="Cloudflare Account ID"
            onChange={event => setAccountId(event.target.value)}
            placeholder="Account ID"
            value={accountId}
          />
        ) : null}
        <div className="usage-connection-actions">
          <Button
            disabled={!key.trim() || auxiliaryMissing}
            loading={busy}
            onClick={() => void connect()}
          >
            {connected ? '替换连接' : '连接'}
          </Button>
          {connected ? (
            <Button loading={busy} onClick={() => void disconnect()} tone="danger">
              断开
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="usage-form-error" role="status">{error}</p> : null}
    </div>
  )
}

function ClaudeSubscriptionConnection({
  connected,
  credentialId,
  onChanged,
}: {
  connected: boolean
  credentialId?: ProviderUsageSource['connection']['credentialId']
  onChanged: () => void
}): React.ReactNode {
  type Integration =
    Awaited<ReturnType<typeof desktopClient.listIntegrations>>[number]
  type OAuthMethod = Extract<Integration['methods'][number], { type: 'oauth' }>
  const [integrationMethod, setIntegrationMethod] = useState<{
    integrationID: Integration['id']
    methodID: OAuthMethod['id']
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const oauth = useIntegrationOAuthAuthorization({
    integrationID: integrationMethod?.integrationID ?? null,
    methodID: integrationMethod?.methodID ?? null,
    onComplete: onChanged,
    onError: setError,
  })

  useEffect(() => {
    let cancelled = false
    void desktopClient.listIntegrations().then(integrations => {
      const integration = integrations.find(item => item.id === 'usage.anthropic.subscription')
      const method = integration?.methods.find(item => item.type === 'oauth')
      if (!cancelled && integration && method) {
        setIntegrationMethod({
          integrationID: integration.id,
          methodID: method.id,
        })
      }
    }).catch(loadError => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : String(loadError))
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function disconnect(): Promise<void> {
    if (!credentialId) return
    setError(null)
    try {
      await desktopClient.disconnectIntegration({
        integrationID: integrationMethod?.integrationID
          ?? (() => { throw new Error('Claude 订阅集成当前不可用。') })(),
        credentialID: credentialId,
      })
      oauth.reset()
      onChanged()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    }
  }

  return (
    <div className="usage-connection-form">
      <div>
        <h4>Claude 订阅授权</h4>
        <p>仅请求个人资料与推理用量权限，不会成为 Anthropic 推理凭据。</p>
      </div>
      <div className="usage-connection-actions">
        <Button
          disabled={!integrationMethod}
          loading={oauth.busy}
          onClick={() => void oauth.start()}
        >
          {connected ? '重新授权' : '浏览器授权'}
        </Button>
        {connected ? (
          <Button
            disabled={!credentialId}
            loading={oauth.busy}
            onClick={() => void disconnect()}
            tone="danger"
          >
            断开
          </Button>
        ) : null}
      </div>
      {oauth.attempt ? (
        <div className="usage-oauth-attempt">
          <p>{oauth.attempt.instructions || oauth.status}</p>
          {oauth.attempt.url ? (
            <a
              href={oauth.attempt.url}
              onClick={openExternalLink}
              rel="noreferrer"
              target="_blank"
            >
              打开授权页面
            </a>
          ) : null}
          {oauth.attempt.mode === 'code' ? (
            <div className="usage-connection-fields">
              <Input
                aria-label="Claude 授权返回码"
                onChange={event => oauth.setCode(event.target.value)}
                placeholder="输入授权返回码"
                value={oauth.code}
              />
              <Button
                disabled={!oauth.code.trim()}
                loading={oauth.submittingCode}
                onClick={() => void oauth.submitCode()}
              >
                提交
              </Button>
            </div>
          ) : null}
        </div>
      ) : oauth.status ? <p className="usage-form-status">{oauth.status}</p> : null}
      {error ? <p className="usage-form-error" role="status">{error}</p> : null}
    </div>
  )
}

function OtherProviderDirectory({
  sources,
}: {
  sources: readonly ProviderUsageSource[]
}): React.ReactNode {
  if (sources.length === 0) return null
  return (
    <section className="usage-provider-directory">
      <header>
        <h3>其他可连接厂商</h3>
        <p>以下厂商暂不通过付费模型探针推测余额；请前往官方控制台查看。</p>
      </header>
      <div className="usage-provider-directory-grid">
        {sources.map(source => {
          const details = OTHER_PROVIDER_DETAILS[source.sourceId]
          if (!details) return null
          return (
          <article key={source.sourceId}>
            <div><h4>{source.displayName}</h4><p>{details.description}</p></div>
            <a
              href={details.url}
              onClick={openExternalLink}
              rel="noreferrer"
              target="_blank"
            >
              打开控制台
            </a>
          </article>
          )
        })}
      </div>
    </section>
  )
}

function scopeLabel(scope: ProviderUsageSource['scope']): string {
  if (scope === 'api-key') return '当前 Key'
  if (scope === 'account') return '账户'
  if (scope === 'organization') return '组织'
  return '订阅'
}

function connectionLabel(source: ProviderUsageSource): string {
  if (source.connection.kind === 'provider-key') return '使用当前推理 Key'
  if (source.connection.kind === 'billing-key') {
    return `独立管理凭据${source.connection.maskedValue ? ` · ${source.connection.maskedValue}` : ''}`
  }
  if (source.connection.kind === 'oauth') return 'OAuth 已连接'
  if (source.connection.kind === 'env') return '使用环境变量'
  return '未连接'
}

function errorCategoryLabel(
  category: NonNullable<ProviderUsageSource['error']>['category'],
): string {
  if (category === 'authentication') return '请检查凭据。'
  if (category === 'permission') return '当前凭据缺少所需权限。'
  if (category === 'plan') return '当前账户或套餐不支持此查询。'
  if (category === 'rate-limit') return '厂商接口当前限流。'
  if (category === 'network') return '暂时无法连接厂商接口。'
  if (category === 'invalid-response') return '厂商返回了无法识别的数据。'
  return '查询暂时失败。'
}

function openExternalLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault()
  void desktopClient.openExternalURL(event.currentTarget.href)
}
