import type { DesktopBuiltinPlugin } from '../../../shared/types.js'

export type PluginCategory = 'included' | 'manageable' | 'external'

export type PluginRuntimeStatus =
  | 'included'
  | 'loading'
  | 'enabled'
  | 'disabled'
  | 'unavailable'
  | 'error'

export type PluginActionKind =
  | 'none'
  | 'toggle-builtin'
  | 'open-external'

export type PluginIconName =
  | 'browser'
  | 'computer-use'
  | 'chrome'
  | 'spreadsheets'
  | 'presentations'
  | 'github'
  | 'minimax'

export type PluginTone =
  | 'chrome'
  | 'codepilotx'
  | 'sheet'
  | 'slides'
  | 'github'
  | 'creative'

export type PluginCatalogDescriptor = {
  id: string
  builtinPluginId?: string
  externalURL?: string
  name: string
  description: string
  category: PluginCategory
  actionKind: PluginActionKind
  iconName: PluginIconName
  tone: PluginTone
}

export type PluginCatalogItem = PluginCatalogDescriptor & {
  status: PluginRuntimeStatus
}

export type PluginCatalogGroup = {
  category: PluginCategory
  label: string
  items: PluginCatalogItem[]
}

export type PluginCategoryFilter = 'all' | PluginCategory
export type PluginStatusFilter =
  | 'all'
  | 'enabled'
  | 'disabled'
  | 'unavailable'

export type PluginPrimaryAction = {
  kind: Exclude<PluginActionKind, 'none'>
  label: string
  disabled: boolean
  pressed?: boolean
}

export const MINIMAX_CLI_DOCS_URL =
  'https://platform.minimax.io/docs/token-plan/minimax-cli'

export const PLUGIN_CATEGORY_ORDER = [
  'included',
  'manageable',
  'external',
] as const satisfies readonly PluginCategory[]

export const PLUGIN_CATEGORY_LABELS: Record<PluginCategory, string> = {
  manageable: '可管理',
  included: '内置',
  external: '外部工具',
}

export const PLUGIN_INCLUDED_OVERVIEW_ORDER = [
  'computer-use',
  'chrome',
  'spreadsheets',
  'presentations',
  'github',
] as const

export const PLUGIN_CATALOG_DESCRIPTORS = [
  {
    id: 'browser',
    builtinPluginId: 'browser@builtin',
    name: 'Browser',
    description: '控制应用内浏览器并执行网页任务',
    category: 'manageable',
    actionKind: 'toggle-builtin',
    iconName: 'browser',
    tone: 'chrome',
  },
  {
    id: 'computer-use',
    name: 'Computer Use',
    description: '通过 CodePilotX 控制 Windows 应用',
    category: 'included',
    actionKind: 'none',
    iconName: 'computer-use',
    tone: 'codepilotx',
  },
  {
    id: 'chrome',
    name: 'Chrome',
    description: '通过 CodePilotX 控制 Chrome 浏览器',
    category: 'included',
    actionKind: 'none',
    iconName: 'chrome',
    tone: 'chrome',
  },
  {
    id: 'spreadsheets',
    name: 'Spreadsheets',
    description: '创建和编辑电子表格文件',
    category: 'included',
    actionKind: 'none',
    iconName: 'spreadsheets',
    tone: 'sheet',
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: '创建和编辑演示文稿',
    category: 'included',
    actionKind: 'none',
    iconName: 'presentations',
    tone: 'slides',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: '处理 PR、Issue、CI 和发布流程',
    category: 'included',
    actionKind: 'none',
    iconName: 'github',
    tone: 'github',
  },
  {
    id: 'minimax',
    externalURL: MINIMAX_CLI_DOCS_URL,
    name: 'MiniMax',
    description: '查看官方 MiniMax CLI 的安装与使用说明',
    category: 'external',
    actionKind: 'open-external',
    iconName: 'minimax',
    tone: 'creative',
  },
] as const satisfies readonly PluginCatalogDescriptor[]

export function mergeBuiltinPluginState(
  descriptors: readonly PluginCatalogDescriptor[],
  builtinPlugins: readonly DesktopBuiltinPlugin[] | undefined,
  loadError: unknown = null,
): PluginCatalogItem[] {
  const builtinState = new Map(
    builtinPlugins?.map(plugin => [plugin.id, plugin.enabled] as const),
  )

  return descriptors.map(descriptor => {
    if (descriptor.actionKind !== 'toggle-builtin') {
      return { ...descriptor, status: 'included' }
    }

    if (loadError !== null && loadError !== undefined) {
      return { ...descriptor, status: 'error' }
    }

    if (builtinPlugins === undefined) {
      return { ...descriptor, status: 'loading' }
    }

    if (
      !descriptor.builtinPluginId ||
      !builtinState.has(descriptor.builtinPluginId)
    ) {
      return { ...descriptor, status: 'unavailable' }
    }

    return {
      ...descriptor,
      status: builtinState.get(descriptor.builtinPluginId)
        ? 'enabled'
        : 'disabled',
    }
  })
}

export function filterPluginCatalog(
  items: readonly PluginCatalogItem[],
  query: string,
  category: PluginCategoryFilter,
  status: PluginStatusFilter,
): PluginCatalogItem[] {
  const keyword = query.trim().toLocaleLowerCase()

  return items.filter(item => {
    if (category !== 'all' && item.category !== category) return false
    if (status === 'unavailable') {
      if (item.status !== 'unavailable' && item.status !== 'error') return false
    } else if (status !== 'all' && item.status !== status) {
      return false
    }
    if (!keyword) return true

    return `${item.name}\n${item.description}`
      .toLocaleLowerCase()
      .includes(keyword)
  })
}

export function groupPluginCatalogBySource(
  items: readonly PluginCatalogItem[],
): PluginCatalogGroup[] {
  return PLUGIN_CATEGORY_ORDER.flatMap(category => {
    const groupedItems = items.filter(item => item.category === category)
    if (groupedItems.length === 0) return []

    return [{
      category,
      label: PLUGIN_CATEGORY_LABELS[category],
      items: groupedItems,
    }]
  })
}

export function selectIncludedPluginOverview(
  items: readonly PluginCatalogItem[],
): PluginCatalogItem[] {
  return PLUGIN_INCLUDED_OVERVIEW_ORDER.flatMap(id => {
    const item = items.find(candidate => candidate.id === id)
    if (!item || item.category !== 'included' || item.actionKind !== 'none') {
      return []
    }
    return [item]
  })
}

export function pluginPrimaryAction(
  item: PluginCatalogItem,
): PluginPrimaryAction | null {
  if (item.actionKind === 'none') return null

  if (item.actionKind === 'open-external') {
    return {
      kind: 'open-external',
      label: '查看安装说明',
      disabled: !item.externalURL,
    }
  }

  if (item.status === 'enabled') {
    return {
      kind: 'toggle-builtin',
      label: '禁用',
      disabled: false,
      pressed: true,
    }
  }
  if (item.status === 'disabled') {
    return {
      kind: 'toggle-builtin',
      label: '启用',
      disabled: false,
      pressed: false,
    }
  }

  return {
    kind: 'toggle-builtin',
    label: item.status === 'loading' ? '正在检查' : '当前不可用',
    disabled: true,
  }
}

export function pluginStatusLabel(item: PluginCatalogItem): string {
  if (item.category === 'external') return '外部工具'
  if (item.category === 'included') return '内置'

  switch (item.status) {
    case 'loading':
      return '正在检查'
    case 'enabled':
      return '已启用'
    case 'disabled':
      return '已禁用'
    case 'error':
      return '状态读取失败'
    case 'unavailable':
    case 'included':
      return '当前不可用'
  }
}
