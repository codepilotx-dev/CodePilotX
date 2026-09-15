import type { WorkbenchPanelTarget, WorkbenchTabKind } from './rightDockState.js'

export type ViewLocation = 'sidebar' | 'right' | 'bottom' | 'floating'

export interface CompositeViewDefinition {
  readonly id: string
  readonly kind: WorkbenchTabKind
  readonly title: string
  readonly defaultLocation: ViewLocation
  readonly allowedLocations: readonly ViewLocation[]
  readonly canMove: boolean
  readonly canClose: boolean
  readonly isSingleton: boolean
}

/**
 * 内置视图注册清单（按 VS Code PaneComposite 规范抽象）
 */
export const BUILTIN_COMPOSITE_VIEWS: Record<WorkbenchTabKind, CompositeViewDefinition> = {
  'file-browser': {
    id: 'workbench.view.fileBrowser',
    kind: 'file-browser',
    title: '打开文件',
    defaultLocation: 'right',
    allowedLocations: ['sidebar', 'right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: true,
  },
  terminal: {
    id: 'workbench.view.terminal',
    kind: 'terminal',
    title: '终端',
    defaultLocation: 'bottom',
    allowedLocations: ['sidebar', 'right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: true,
  },
  review: {
    id: 'workbench.view.review',
    kind: 'review',
    title: '审查',
    defaultLocation: 'right',
    allowedLocations: ['sidebar', 'right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: true,
  },
  browser: {
    id: 'workbench.view.browser',
    kind: 'browser',
    title: '浏览器',
    defaultLocation: 'right',
    allowedLocations: ['right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: true,
  },
  'file-preview': {
    id: 'workbench.view.filePreview',
    kind: 'file-preview',
    title: '文件预览',
    defaultLocation: 'right',
    allowedLocations: ['right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: false,
  },
  plan: {
    id: 'workbench.view.plan',
    kind: 'plan',
    title: '计划',
    defaultLocation: 'right',
    allowedLocations: ['sidebar', 'right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: false,
  },
  'side-chat': {
    id: 'workbench.view.sideChat',
    kind: 'side-chat',
    title: '副会话',
    defaultLocation: 'right',
    allowedLocations: ['right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: false,
  },
  'side-task': {
    id: 'workbench.view.sideTask',
    kind: 'side-task',
    title: '后台任务',
    defaultLocation: 'right',
    allowedLocations: ['sidebar', 'right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: false,
  },
  'skill-preview': {
    id: 'workbench.view.skillPreview',
    kind: 'skill-preview',
    title: '技能预览',
    defaultLocation: 'right',
    allowedLocations: ['right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: false,
  },
  'attachment-preview': {
    id: 'workbench.view.attachmentPreview',
    kind: 'attachment-preview',
    title: '附件预览',
    defaultLocation: 'right',
    allowedLocations: ['right', 'bottom'],
    canMove: true,
    canClose: true,
    isSingleton: true,
  },
}

/**
 * 校验指定视图是否允许停靠至目标位置
 */
export function isViewAllowedAtLocation(
  kind: WorkbenchTabKind,
  location: ViewLocation,
): boolean {
  const definition = BUILTIN_COMPOSITE_VIEWS[kind]
  if (!definition) return location === 'right' || location === 'bottom'
  return definition.allowedLocations.includes(location)
}

/**
 * 获取某个面板当前可流转的目标候选位置列表（排除自身所在位置）
 */
export function getAvailableMoveTargets(
  currentLocation: WorkbenchPanelTarget,
  kind: WorkbenchTabKind,
): WorkbenchPanelTarget[] {
  const definition = BUILTIN_COMPOSITE_VIEWS[kind]
  const allowed = definition ? definition.allowedLocations : ['right', 'bottom']
  const targets: WorkbenchPanelTarget[] = []
  for (const loc of allowed) {
    if (loc !== currentLocation && (loc === 'sidebar' || loc === 'right' || loc === 'bottom')) {
      targets.push(loc)
    }
  }
  return targets
}

/**
 * 面板目标在中文 UI 上的显示名称
 */
export function panelTargetDisplayName(target: WorkbenchPanelTarget): string {
  switch (target) {
    case 'sidebar':
      return '侧边栏'
    case 'right':
      return '右侧栏'
    case 'bottom':
      return '下方面板'
  }
}
