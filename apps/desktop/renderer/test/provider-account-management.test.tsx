import { describe, expect, test } from 'bun:test'
import type {
  ProviderUsageSource,
  UsageSourceDescriptor,
} from '@codepilotx/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  DesktopIntegration,
  DesktopModelProviderSummary,
} from '../shared/types.js'
import {
  AccountWorkspaceEmptyState,
} from '../src/features/models/ApiKeyWorkspace.js'
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from '../src/features/models/ProviderCatalog.js'
import {
  AccountProviderGroup,
  buildAccountGroupSummary,
} from '../src/features/models/provider-management/AccountProviderGroup.js'
import {
  getProviderConnectionChoices,
} from '../src/features/models/provider-management/ProviderConnectionDialog.js'
import type {
  ConfiguredProviderGroup,
} from '../src/features/provider-management/index.js'

describe('model center account management', () => {
  test('shows source-aware balance, connection states, and at most three critical quotas', () => {
    const summary = buildAccountGroupSummary(configuredGroup(), [usageResult()])
    const html = renderToStaticMarkup(
      <AccountProviderGroup
        expanded={false}
        group={configuredGroup()}
        summary={summary}
        onOpenProvider={() => {}}
        onOpenUsage={() => {}}
        onToggle={() => {}}
      >
        <span>连接详情</span>
      </AccountProviderGroup>,
    )

    expect(summary.quotas).toHaveLength(3)
    expect(html).toContain('活动 Key · USD')
    expect(html).toContain('管理凭据 1')
    expect(html).toContain('订阅已授权')
    expect(html).toContain('OAuth 已连接')
    expect(html).toContain('供应商')
    expect(html).toContain('查看用量')
    expect(html).not.toContain('第四额度')
  })

  test('empty account workspace only links back to the supplier catalog', () => {
    const html = renderToStaticMarkup(
      <AccountWorkspaceEmptyState onOpenCatalog={() => {}} />,
    )

    expect(html).toContain('尚未连接任何供应商')
    expect(html).toContain('前往供应商')
    expect(html).not.toContain('全部 Provider')
    expect(html).not.toContain('新增 Key')
  })

  test('offers billing and OAuth choices while configured catalog cards link to accounts', () => {
    const choices = getProviderConnectionChoices(oauthIntegration(), [
      billingSource(),
      subscriptionSource(),
    ])
    expect(choices.map(choice => choice.kind)).toEqual([
      'inference-oauth',
      'billing',
      'usage-oauth',
    ])

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={[
          catalogItem('openai', false),
          catalogItem('anthropic', true),
        ]}
        query=""
        onAddConnection={() => {}}
        onManageConnection={() => {}}
        onQueryChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain('账户连接')
    expect(html).toContain('>连接<')
  })
})

function configuredGroup(): ConfiguredProviderGroup {
  const provider = modelProvider('openai', 'OpenAI')
  return {
    provider,
    current: true,
    configured: true,
    apiKeys: [],
    integration: null,
    usageSources: [],
    connections: [
      {
        id: 'active-key',
        kind: 'inference-key',
        origin: 'api-key',
        providerIds: ['openai'],
        label: '生产 Key',
        active: true,
      },
      {
        id: 'billing',
        kind: 'billing-key',
        origin: 'usage-source',
        providerIds: ['openai'],
        label: 'OpenAI Admin',
        active: true,
      },
      {
        id: 'subscription',
        kind: 'subscription',
        origin: 'usage-source',
        providerIds: ['openai'],
        label: '订阅',
        active: true,
      },
      {
        id: 'oauth',
        kind: 'oauth',
        origin: 'integration',
        providerIds: ['openai'],
        label: 'OAuth',
        active: true,
      },
    ],
    activeConnection: {
      id: 'active-key',
      kind: 'inference-key',
      origin: 'api-key',
      providerIds: ['openai'],
      label: '生产 Key',
      active: true,
    },
  }
}

function usageResult(): ProviderUsageSource {
  return {
    sourceId: 'openai-key',
    providerIds: ['openai'],
    displayName: 'OpenAI 当前 Key',
    scope: 'api-key',
    stability: 'official',
    status: 'available',
    connection: {
      kind: 'provider-key',
      disconnectible: false,
    },
    groups: [{
      id: 'account',
      label: '账户',
      balances: [{
        currency: 'USD',
        total: '12.5',
        components: [],
      }],
      quotaWindows: [
        quota('first', '第一额度', 5),
        quota('second', '第二额度', 20),
        quota('third', '第三额度', 40),
        quota('fourth', '第四额度', 80),
      ],
    }],
  } as ProviderUsageSource
}

function quota(id: string, label: string, remainingPercent: number) {
  return {
    id,
    label,
    unit: 'tokens' as const,
    remainingPercent,
    state: 'normal' as const,
  }
}

function oauthIntegration(): DesktopIntegration {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    methods: [{
      id: 'oauth',
      type: 'oauth',
      label: 'OAuth',
      prompts: [],
    }],
    connections: [],
  }
}

function billingSource(): UsageSourceDescriptor {
  return source({
    sourceId: 'anthropic-admin',
    displayName: 'Anthropic Admin',
    connectionMethod: {
      kind: 'billing-key',
      sourceId: 'anthropic-admin',
      fields: [{
        name: 'key',
        label: 'Admin Key',
        secret: true,
        required: true,
      }],
    },
  })
}

function subscriptionSource(): UsageSourceDescriptor {
  return source({
    sourceId: 'anthropic-subscription',
    displayName: 'Claude 订阅',
    connectionMethod: {
      kind: 'oauth',
      integrationId: 'usage.anthropic.subscription',
      methodId: 'claude-subscription-browser',
    },
  })
}

function source(input: {
  sourceId: string
  displayName: string
  connectionMethod: UsageSourceDescriptor['connectionMethod']
}): UsageSourceDescriptor {
  return {
    sourceId: input.sourceId,
    canonicalProviderId: 'anthropic',
    providerIds: ['anthropic'],
    displayName: input.displayName,
    scope: 'account',
    stability: 'official',
    availability: 'queryable',
    capabilities: ['balance'],
    queryPolicy: 'cached',
    connection: { kind: 'none', disconnectible: false },
    connectionMethod: input.connectionMethod,
  } as UsageSourceDescriptor
}

function catalogItem(
  id: string,
  canAddConnection: boolean,
): ProviderCatalogItem {
  return {
    id,
    name: id,
    source: '内置',
    modelCount: 1,
    current: false,
    canAddConnection,
    status: {
      label: canAddConnection ? '未配置' : '已配置',
      tone: canAddConnection ? 'neutral' : 'positive',
    },
  }
}

function modelProvider(
  providerID: string,
  displayName: string,
): DesktopModelProviderSummary {
  return {
    providerID,
    displayName,
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: true,
  }
}
