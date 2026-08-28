import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginCatalogCard } from '../src/features/plugins/PluginCatalogCard.js'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  mergeBuiltinPluginState,
} from '../src/features/plugins/pluginCatalog.js'

function renderCard(id: 'browser' | 'minimax'): string {
  const item = mergeBuiltinPluginState(
    PLUGIN_CATALOG_DESCRIPTORS,
    [{ id: 'browser@builtin', enabled: true }],
  ).find(candidate => candidate.id === id)

  if (!item) throw new Error(`Missing plugin fixture: ${id}`)

  return renderToStaticMarkup(
    <PluginCatalogCard
      item={item}
      onOpenDetails={() => undefined}
      onPrimaryAction={() => undefined}
    />,
  )
}

describe('plugin catalog controls', () => {
  test('renders builtin enabled state as a switch instead of an action button', () => {
    const html = renderCard('browser')

    expect(html).toContain('data-catalog-item-id="plugin:browser"')
    expect(html).toContain('<img')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('aria-pressed')
  })

  test('keeps external installation guidance as a text action button', () => {
    const html = renderCard('minimax')

    expect(html).toContain('class="ui-button')
    expect(html).toContain('查看安装说明')
    expect(html).toContain('<svg')
    expect(html).not.toContain('<img')
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('role="switch"')
  })
})
