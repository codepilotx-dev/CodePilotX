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
          { ...catalogItem('openai', false), logoURL: '/favicon.png' },
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
    expect(html).not.toContain('model-center-catalog-source')
    expect(html).toContain('2 个')
    expect(html).toContain('>查看<')
    expect(html).toContain('>连接<')
    expect(html).toContain(
      '<span class="provider-card-logo"><span class="ui-remote-image"',
    )
    expect(html).not.toContain('class="ui-remote-image provider-card-logo"')
    expect(html.match(/class="provider-card-logo"/g)).toHaveLength(2)
  })

  test('模型卡标题仅由独立 disclosure button 控制展开', async () => {
    const source = await Bun.file(
      new URL(
        '../src/features/models/provider-management/ProviderEditorDialog.tsx',
        import.meta.url,
      ),
    ).text()

    expect(source).toMatch(
      /<div\s+className="provider-editor-model-card-header"\s*>/,
    )
    expect(source).toMatch(
      /<button\s+aria-controls=\{contentId\}\s+aria-expanded=\{expanded\}\s+className="provider-editor-model-card-summary"/,
    )
    expect(source).toMatch(
      /<\/button>\s+<div className="provider-editor-model-card-controls">/,
    )
    expect(source).not.toContain('onClick={event => event.stopPropagation()}')
    expect(source).toContain('mountPolicy="always"')
    expect(source).toContain('const [expanded, setExpanded] = useState(defaultExpanded)')
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
