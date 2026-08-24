import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginCatalogRow } from '../src/features/plugins/PluginCatalogRow.js'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  mergeBuiltinPluginState,
} from '../src/features/plugins/pluginCatalog.js'

function renderRow(id: 'browser' | 'minimax'): string {
  const item = mergeBuiltinPluginState(
    PLUGIN_CATALOG_DESCRIPTORS,
    [{ id: 'browser@builtin', enabled: true }],
  ).find(candidate => candidate.id === id)

  if (!item) throw new Error(`Missing plugin fixture: ${id}`)

  return renderToStaticMarkup(
    <PluginCatalogRow
      item={item}
      onOpenDetails={() => undefined}
      onPrimaryAction={() => undefined}
    />,
  )
}

describe('plugin catalog controls', () => {
  test('renders builtin enabled state as a switch instead of an action button', () => {
    const html = renderRow('browser')

    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('aria-pressed')
  })

  test('keeps external installation guidance as a text action button', () => {
    const html = renderRow('minimax')

    expect(html).toContain('class="ui-button')
    expect(html).toContain('查看安装说明')
    expect(html).not.toContain('role="switch"')
  })
})
