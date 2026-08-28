import { describe, expect, test } from 'bun:test'
import type { PluginSummary } from '@codepilotx/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginCatalogCard } from '../src/features/plugins/PluginCatalogCard.js'
import { PLUGIN_CATALOG_DESCRIPTORS, mergePluginCatalog } from '../src/features/plugins/pluginCatalog.js'

const taskPlanning: PluginSummary = {
  id: 'task-planning', name: '任务规划', version: '1.0.0',
  description: '拆解和规划复杂工作', developerName: 'CodePilotX',
  category: 'Productivity', source: 'bundled',
  installationPolicy: 'INSTALLED_BY_DEFAULT', installed: true, enabled: true,
  status: 'ready', capabilities: ['task-planning'], skills: ['task-planning'],
}

function renderCard(id: 'task-planning' | 'browser' | 'minimax'): string {
  const item = mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, [taskPlanning])
    .find(candidate => candidate.id === id)
  if (!item) throw new Error(`Missing plugin fixture: ${id}`)
  return renderToStaticMarkup(
    <PluginCatalogCard item={item} onOpenDetails={() => undefined} onPrimaryAction={() => undefined} />,
  )
}

describe('plugin catalog controls', () => {
  test('renders the real task planning state as a switch', () => {
    const html = renderCard('task-planning')
    expect(html).toContain('data-catalog-item-id="plugin:task-planning"')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('<img')
    expect(html).not.toContain('<svg')
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  test('renders Browser as a disabled upcoming install instead of a switch', () => {
    const html = renderCard('browser')
    expect(html).toContain('<img')
    expect(html).toContain('即将推出')
    expect(html).toContain('安装')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('role="switch"')
    expect(html.match(/<button/g)).toHaveLength(2)
  })

  test('keeps external installation guidance as a text action button', () => {
    const html = renderCard('minimax')
    expect(html).toContain('查看安装说明')
    expect(html).toContain('<svg')
    expect(html).not.toContain('role="switch"')
  })
})
