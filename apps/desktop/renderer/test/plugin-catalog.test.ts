import { describe, expect, test } from 'bun:test'
import type { PluginSummary } from '@codepilotx/agent-protocol'
import {
  PLUGIN_CATALOG_DESCRIPTORS,
  filterPluginCatalog,
  groupPluginCatalogBySource,
  mergePluginCatalog,
  pluginPrimaryAction,
  pluginStatusLabel,
  selectInstalledPluginOverview,
} from '../src/features/plugins/pluginCatalog.js'
import { groupSkillsForDisplay } from '../src/features/plugins/skillCatalog.js'
import type { DesktopSkillCatalogItem } from '../shared/types.js'

function taskPlanning(enabled: boolean): PluginSummary {
  return {
    id: 'task-planning',
    name: '任务规划',
    version: '1.0.0',
    description: '澄清目标并生成可执行的任务规划。',
    developerName: 'CodePilotX',
    category: 'Productivity',
    source: 'bundled',
    installationPolicy: 'INSTALLED_BY_DEFAULT',
    installed: true,
    enabled,
    status: 'ready',
    capabilities: ['task-planning'],
    skills: ['task-planning'],
  }
}

function catalog(plugins: PluginSummary[] | undefined = [taskPlanning(true)], error: unknown = null) {
  return mergePluginCatalog(PLUGIN_CATALOG_DESCRIPTORS, plugins, error)
}

describe('plugin catalog state', () => {
  test('maps the real task planning plugin to enabled and disabled states', () => {
    expect(catalog([taskPlanning(true)]).find(item => item.id === 'task-planning')?.status).toBe('enabled')
    expect(catalog([taskPlanning(false)]).find(item => item.id === 'task-planning')?.status).toBe('disabled')
  })

  test('keeps all six Featured plugins unavailable with disabled install actions', () => {
    const featured = catalog().filter(item => item.category === 'included')
    expect(featured.map(item => item.id)).toEqual([
      'computer-use', 'browser', 'chrome', 'spreadsheets', 'presentations', 'github',
    ])
    for (const item of featured) {
      expect(item.status).toBe('unavailable')
      expect(pluginStatusLabel(item)).toBe('即将推出')
      expect(pluginPrimaryAction(item)).toEqual({ kind: 'install', label: '安装', disabled: true })
    }
  })

  test('keeps static entries visible when the real plugin request fails', () => {
    const items = catalog([], new Error('RPC failed'))
    expect(items).toHaveLength(7)
    expect(items.some(item => item.id === 'task-planning')).toBe(false)
    expect(items.find(item => item.id === 'browser')?.status).toBe('unavailable')
  })
})

describe('plugin catalog filtering and actions', () => {
  const items = catalog()

  test('matches trimmed, case-insensitive name and description queries', () => {
    expect(filterPluginCatalog(items, ' GITHUB ', 'all', 'all').map(item => item.id)).toEqual(['github'])
    expect(filterPluginCatalog(items, '任务规划', 'all', 'all').map(item => item.id)).toEqual(['task-planning'])
  })

  test('combines category and status filters', () => {
    expect(filterPluginCatalog(items, '', 'manageable', 'enabled').map(item => item.id)).toEqual(['task-planning'])
    expect(filterPluginCatalog(items, '', 'included', 'disabled')).toEqual([])
  })

  test('exposes MiniMax only as an external documentation action', () => {
    const minimax = items.find(item => item.id === 'minimax')!
    expect(pluginPrimaryAction(minimax)).toEqual({ kind: 'open-external', label: '查看安装说明', disabled: false })
    expect(pluginStatusLabel(minimax)).toBe('外部工具')
  })
})

describe('plugin catalog presentation selectors', () => {
  test('groups categories in their fixed order', () => {
    expect(groupPluginCatalogBySource(catalog()).map(group => group.category)).toEqual([
      'included', 'manageable', 'external',
    ])
  })

  test('puts only installed and enabled real plugins on the shelf', () => {
    expect(selectInstalledPluginOverview(catalog([taskPlanning(true)])).map(item => item.id)).toEqual(['task-planning'])
    expect(selectInstalledPluginOverview(catalog([taskPlanning(false)]))).toEqual([])
  })
})

describe('skill catalog presentation selectors', () => {
  const skills = [
    { id: 'one', name: 'One', installed: false },
    { id: 'two', name: 'Two', installed: true },
  ] as DesktopSkillCatalogItem[]

  test('splits installed and recommended skills', () => {
    const groups = groupSkillsForDisplay(skills)
    expect(groups.installed.map(skill => skill.id)).toEqual(['two'])
    expect(groups.recommended.map(skill => skill.id)).toEqual(['one'])
  })
})
