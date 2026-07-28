import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  groupPluginCatalogBySource,
  mergeBuiltinPluginState,
  pluginPrimaryAction,
  pluginStatusLabel,
  selectIncludedPluginOverview,
} from '../src/features/plugins/pluginCatalog.js'
import { groupSkillsForDisplay } from '../src/features/plugins/skillCatalog.js'
import type { DesktopSkillCatalogItem } from '../shared/types.js'

function catalog(
  plugins: { id: string; enabled: boolean }[] | undefined = [],
  error: unknown = null,
) {
  return mergeBuiltinPluginState(
    PLUGIN_CATALOG_DESCRIPTORS,
    plugins,
    error,
  )
}

describe('plugin catalog state', () => {
  test('maps the builtin Browser response to enabled and disabled states', () => {
    const enabled = catalog([{ id: 'browser@builtin', enabled: true }])
    const disabled = catalog([{ id: 'browser@builtin', enabled: false }])

    expect(enabled.find(item => item.id === 'browser')?.status).toBe('enabled')
    expect(disabled.find(item => item.id === 'browser')?.status).toBe('disabled')
  })

  test('keeps Browser unavailable when the builtin API returns no matching item', () => {
    const browser = catalog().find(item => item.id === 'browser')

    expect(browser?.status).toBe('unavailable')
    expect(browser && pluginPrimaryAction(browser)).toEqual({
      kind: 'toggle-builtin',
      label: '当前不可用',
      disabled: true,
    })
  })

  test('keeps the static catalog and marks Browser when loading fails', () => {
    const items = catalog([], new Error('IPC failed'))
    const browser = items.find(item => item.id === 'browser')

    expect(items).toHaveLength(7)
    expect(browser?.status).toBe('error')
    expect(browser && pluginStatusLabel(browser)).toBe('状态读取失败')
    expect(items.find(item => item.id === 'github')?.status).toBe('included')
    expect(items.find(item => item.id === 'minimax')?.status).toBe('included')
  })

  test('uses a disabled pending action before the builtin response arrives', () => {
    const browser = mergeBuiltinPluginState(
      PLUGIN_CATALOG_DESCRIPTORS,
      undefined,
    ).find(item => item.id === 'browser')

    expect(browser?.status).toBe('loading')
    expect(browser && pluginPrimaryAction(browser)).toEqual({
      kind: 'toggle-builtin',
      label: '正在检查',
      disabled: true,
    })
  })
})

describe('plugin catalog filtering and actions', () => {
  const items = catalog([{ id: 'browser@builtin', enabled: true }])

  test('matches trimmed, case-insensitive name and description queries', () => {
    expect(filterPluginCatalog(items, '  GITHUB  ', 'all', 'all').map(item => item.id)).toEqual([
      'github',
    ])
    expect(filterPluginCatalog(items, '电子表格', 'all', 'all').map(item => item.id)).toEqual([
      'spreadsheets',
    ])
  })

  test('combines category and status filters and can return no results', () => {
    expect(filterPluginCatalog(items, '', 'manageable', 'enabled').map(item => item.id)).toEqual([
      'browser',
    ])
    expect(filterPluginCatalog(items, '', 'included', 'disabled')).toEqual([])
  })

  test('does not expose actions for included plugins', () => {
    const included = items.find(item => item.id === 'computer-use')

    expect(included && pluginPrimaryAction(included)).toBeNull()
    expect(included && pluginStatusLabel(included)).toBe('内置')
  })

  test('exposes MiniMax only as an external documentation action', () => {
    const minimax = items.find(item => item.id === 'minimax')

    expect(minimax && pluginPrimaryAction(minimax)).toEqual({
      kind: 'open-external',
      label: '查看安装说明',
      disabled: false,
    })
    expect(minimax && pluginStatusLabel(minimax)).toBe('外部工具')
  })
})

describe('plugin catalog presentation selectors', () => {
  const items = catalog([{ id: 'browser@builtin', enabled: false }])

  test('groups sources in a fixed order without empty groups', () => {
    const shuffled = [
      items.find(item => item.id === 'minimax'),
      items.find(item => item.id === 'github'),
      items.find(item => item.id === 'browser'),
    ].filter(item => item !== undefined)

    expect(groupPluginCatalogBySource(shuffled).map(group => group.category)).toEqual([
      'included',
      'manageable',
      'external',
    ])
    expect(
      groupPluginCatalogBySource(
        shuffled.filter(item => item.category !== 'included'),
      ).map(group => group.category),
    ).toEqual(['manageable', 'external'])
  })

  test('selects only the five static included plugins for the overview', () => {
    const overview = selectIncludedPluginOverview(items)

    expect(overview.map(item => item.id)).toEqual([
      'computer-use',
      'chrome',
      'spreadsheets',
      'presentations',
      'github',
    ])
    expect(overview.some(item => item.id === 'browser')).toBe(false)
    expect(overview.some(item => item.id === 'minimax')).toBe(false)
  })

  test('preserves runtime state mapping inside source groups', () => {
    const groups = groupPluginCatalogBySource(items)
    const browser = groups
      .find(group => group.category === 'manageable')
      ?.items.find(item => item.id === 'browser')

    expect(browser?.status).toBe('disabled')
    expect(pluginPrimaryAction(browser!)).toEqual({
      kind: 'toggle-builtin',
      label: '启用',
      disabled: false,
      pressed: false,
    })
  })
})

describe('skill catalog presentation selectors', () => {
  const skills = [
    { id: 'one', name: 'One', installed: false },
    { id: 'two', name: 'Two', installed: true },
    { id: 'three', name: 'Three', installed: false },
    { id: 'four', name: 'Four', installed: true },
  ] as DesktopSkillCatalogItem[]

  test('splits installed and recommended skills without changing their order', () => {
    const groups = groupSkillsForDisplay(skills)

    expect(groups.installed.map(skill => skill.id)).toEqual(['two', 'four'])
    expect(groups.recommended.map(skill => skill.id)).toEqual(['one', 'three'])
    expect([
      ...groups.installed.map(skill => skill.id),
      ...groups.recommended.map(skill => skill.id),
    ].sort()).toEqual(['four', 'one', 'three', 'two'])
  })

  test('returns empty groups without inventing catalog entries', () => {
    expect(groupSkillsForDisplay([])).toEqual({
      installed: [],
      recommended: [],
    })
  })
})
