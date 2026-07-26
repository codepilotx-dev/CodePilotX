import { describe, expect, it } from 'bun:test'
import type { RpcResult } from '@codepilotx/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageBillingSettings } from '../src/features/settings/UsageBillingSettings.js'
import { ApplicationUsagePanel } from '../src/features/settings/usage/ApplicationUsagePanel.js'
import { ProviderUsagePanel } from '../src/features/settings/usage/ProviderUsagePanel.js'
import {
  criticalQuotaWindows,
  protocolModelId,
  protocolProviderId,
  sortProviderUsageSources,
  type ProviderUsageSource,
} from '../src/utils/usageFormatters.js'

function source({
  sourceId,
  displayName,
  providerId,
  quotaLabel,
  connection = 'provider-key',
  scope = 'api-key',
  stability = 'official',
}: {
  sourceId: string
  displayName: string
  providerId: string
  quotaLabel?: string
  connection?: ProviderUsageSource['connection']['kind']
  scope?: ProviderUsageSource['scope']
  stability?: ProviderUsageSource['stability']
}): ProviderUsageSource {
  return {
    sourceId,
    providerIds: [protocolProviderId(providerId)],
    displayName,
    scope,
    stability,
    status: connection === 'none' ? 'not-connected' : 'available',
    checkedAt: 1_722_000_000_000,
    connection: {
      kind: connection,
      disconnectible: false,
    },
    groups: quotaLabel ? [{
      id: `${sourceId}-quota`,
      label: displayName,
      balances: [],
      quotaWindows: [{
        id: `${sourceId}-window`,
        label: quotaLabel,
        unit: 'tokens',
        limit: 100,
        used: 25,
        remaining: 75,
        remainingPercent: 75,
        resetsAt: 1_722_003_600_000,
        state: 'normal',
      }],
    }] : [],
  }
}

describe('usage billing renderer', () => {
  it('exposes application and provider tabs', () => {
    const html = renderToStaticMarkup(<UsageBillingSettings />)
    expect(html).toContain('role="tablist"')
    expect(html).toContain('应用用量')
    expect(html).toContain('账户与套餐')
  })

  it('renders the application metrics with the default 30 day range option', () => {
    const data: RpcResult<'usage/local/get'> = {
      range: '30d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1_722_000_000_000,
      totals: {
        inputTokens: 800,
        outputTokens: 200,
        cachedTokens: 100,
        totalTokens: 1_100,
        estimatedCostUsd: '0.25',
        rootTasks: 2,
        modelResponses: 4,
        providerCalls: 5,
        activeDays: 1,
        currentStreak: 1,
        longestStreak: 1,
      },
      daily: [{
        date: '2026-07-26',
        totals: {
          inputTokens: 800,
          outputTokens: 200,
          cachedTokens: 100,
          totalTokens: 1_100,
          estimatedCostUsd: '0.25',
        },
        models: [{
          providerId: protocolProviderId('deepseek'),
          modelId: protocolModelId('deepseek-chat'),
          displayName: 'DeepSeek Chat',
          inputTokens: 800,
          outputTokens: 200,
          cachedTokens: 100,
          totalTokens: 1_100,
          estimatedCostUsd: '0.25',
          modelResponses: 4,
        }],
      }],
      models: [{
        providerId: protocolProviderId('deepseek'),
        modelId: protocolModelId('deepseek-chat'),
        displayName: 'DeepSeek Chat',
        inputTokens: 800,
        outputTokens: 200,
        cachedTokens: 100,
        totalTokens: 1_100,
        estimatedCostUsd: '0.25',
        modelResponses: 4,
        sharePercent: 100,
      }],
      heatmap: [{
        date: '2026-07-26',
        totalTokens: 1_100,
        modelResponses: 4,
      }],
    }
    const html = renderToStaticMarkup(
      <ApplicationUsagePanel
        data={data}
        error={null}
        loading={false}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
        range="30d"
      />,
    )
    expect(html).toContain('最近 30 天')
    expect(html).toContain('最近 7 天')
    expect(html).toContain('全部时间')
    expect(html).toContain('总 Token')
    expect(html).toContain('根任务数')
    expect(html).toContain('模型响应')
    expect(html).toContain('Provider 调用')
    expect(html).toContain('活跃天数')
    expect(html).toContain('估算成本')
  })

  it('sorts connected sources first and keeps Vercel reporting warning visible', () => {
    const disconnected = source({
      sourceId: 'openai-admin',
      displayName: 'OpenAI Admin',
      providerId: 'openai',
      connection: 'none',
    })
    const vercel = source({
      sourceId: 'vercel-report',
      displayName: 'Vercel AI Gateway',
      providerId: 'vercel',
      quotaLabel: '月度额度',
    })
    expect(sortProviderUsageSources([disconnected, vercel]).map(item => item.sourceId))
      .toEqual(['vercel-report', 'openai-admin'])

    const data: RpcResult<'usage/provider/query'> = {
      range: '7d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1_722_000_000_000,
      sources: [disconnected, vercel],
    }
    const html = renderToStaticMarkup(
      <ProviderUsagePanel
        data={data}
        error={null}
        loading={false}
        onChanged={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
        range="7d"
      />,
    )
    expect(html.indexOf('Vercel AI Gateway')).toBeLessThan(html.indexOf('OpenAI Admin'))
    expect(html).toContain('Vercel Reporting API 为计费查询')
    expect(html).toContain('一小时缓存')
    expect(html).toContain('今日')
    expect(html).toContain('30 天')
  })

  it('renders generic quota windows for MiniMax, Claude, Kimi and Z.ai', () => {
    const sources = [
      source({
        sourceId: 'minimax-token-plan',
        displayName: 'MiniMax Token Plan',
        providerId: 'minimax',
        quotaLabel: '5 小时额度',
      }),
      source({
        sourceId: 'anthropic-subscription',
        displayName: 'Claude 订阅',
        providerId: 'anthropic',
        quotaLabel: '7 天额度',
        connection: 'oauth',
        scope: 'subscription',
        stability: 'experimental',
      }),
      source({
        sourceId: 'kimi-code',
        displayName: 'Kimi Code',
        providerId: 'kimi-for-coding',
        quotaLabel: '周额度',
        stability: 'experimental',
      }),
      source({
        sourceId: 'zai-coding-plan',
        displayName: '智谱 Coding Plan',
        providerId: 'zai-coding-plan',
        quotaLabel: '月额度',
        stability: 'experimental',
      }),
    ]
    for (const item of sources) {
      expect(criticalQuotaWindows(item)).toHaveLength(1)
    }
    const html = renderToStaticMarkup(
      <ProviderUsagePanel
        data={{
          range: '7d',
          timeZone: 'Asia/Shanghai',
          generatedAt: 1_722_000_000_000,
          sources,
        }}
        error={null}
        loading={false}
        onChanged={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
        range="7d"
      />,
    )
    for (const label of ['5 小时额度', '7 天额度', '周额度', '月额度']) {
      expect(html).toContain(label)
    }
  })

  it('renders unsupported catalog entries once in the console directory', () => {
    const unsupported = {
      ...source({
        sourceId: 'google-console',
        displayName: 'Google Gemini',
        providerId: 'google',
        connection: 'none',
      }),
      status: 'unsupported' as const,
    }
    const html = renderToStaticMarkup(
      <ProviderUsagePanel
        data={{
          range: '7d',
          timeZone: 'Asia/Shanghai',
          generatedAt: 1_722_000_000_000,
          sources: [unsupported],
        }}
        error={null}
        loading={false}
        onChanged={() => undefined}
        onRangeChange={() => undefined}
        onRefresh={() => undefined}
        range="7d"
      />,
    )
    expect(html.match(/Google Gemini/g)).toHaveLength(1)
    expect(html).toContain('打开控制台')
  })
})
