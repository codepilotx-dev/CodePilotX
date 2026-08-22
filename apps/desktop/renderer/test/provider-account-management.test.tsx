import { describe, expect, test } from 'bun:test'
import type { UsageSourceDescriptor } from '@codepilotx/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopModelProviderSummary } from '../shared/types.js'
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from '../src/features/models/ProviderCatalog.js'
import {
  getProviderConnectionChoices,
} from '../src/features/models/provider-management/ProviderConnectionDialog.js'

describe('model center account management', () => {
  test('offers billing and OAuth choices while configured catalog cards link to accounts', () => {
    const choices = getProviderConnectionChoices(
      { ...modelProvider('anthropic', 'Anthropic'), authMethods: ['oauth'] },
      [
      billingSource(),
      subscriptionSource(),
      ],
    )
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
    expect(html).not.toContain('<h2>供应商</h2>')
    expect(html).not.toContain('浏览完整目录')
    expect(html).toContain('2 个')
    expect(html).toContain('>查看<')
    expect(html).toContain('>连接<')
  })
})

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
