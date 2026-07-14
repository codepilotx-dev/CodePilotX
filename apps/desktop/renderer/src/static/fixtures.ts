export type StaticSession = {
  id: string
  title: string
  workspace: string
  path: string
  updatedAt: string
  pinned?: boolean
  active?: boolean
}

export type StaticMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  title: string
  body: string
  meta: string
}

export type StaticPlugin = {
  id: string
  name: string
  summary: string
  category: string
  enabled: boolean
}

export type StaticSearchResult = {
  id: string
  title: string
  path: string
  excerpt: string
}

export const staticSessions: StaticSession[] = [
  {
    id: 'static-session-1',
    title: '迁移 renderer 静态 UI',
    workspace: 'CodePilotX-Ts',
    path: 'F:\\CodeProject\\CodePilotX-Ts',
    updatedAt: '刚刚',
    pinned: true,
    active: true,
  },
  {
    id: 'static-session-2',
    title: '整理桌面设置页面',
    workspace: 'CodePilotX-Ts',
    path: 'F:\\CodeProject\\CodePilotX-Ts',
    updatedAt: '12 分钟前',
  },
  {
    id: 'static-session-3',
    title: '检查插件市场空态',
    workspace: 'Design Lab',
    path: 'F:\\CodeProject\\DesignLab',
    updatedAt: '昨天',
  },
]

export const staticMessages: StaticMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    title: '用户',
    body: '现在可以开始迁移 renderer 了，只保留 UI，第一版做静态全页面。',
    meta: '09:41',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    title: 'CodePilotX',
    body: '已生成静态 UI 迁移计划：保留当前 Electron 和 agent 架构，不接真实接口，先验证导航、设置、插件、搜索、自动化和会话页面的视觉结构。',
    meta: '09:42',
  },
  {
    id: 'msg-3',
    role: 'system',
    title: '工作流',
    body: '计划、执行、审阅三个阶段已在静态时间线中展示，按钮处于禁用状态。',
    meta: '静态预览',
  },
]

export const staticPlugins: StaticPlugin[] = [
  {
    id: 'browser',
    name: 'Browser',
    summary: '网页浏览、页面检查和本地应用 QA 的桌面入口。',
    category: '内置',
    enabled: true,
  },
  {
    id: 'figma',
    name: 'Figma',
    summary: '把代码和页面转换成可编辑设计稿。',
    category: '设计',
    enabled: false,
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    summary: '查找和处理 Drive、Docs、Sheets、Slides 文件。',
    category: '连接器',
    enabled: false,
  },
]

export const staticSearchResults: StaticSearchResult[] = [
  {
    id: 'search-1',
    title: 'renderer 静态迁移计划',
    path: 'apps/desktop/renderer/src/App.tsx',
    excerpt: 'Provider、Router 和静态页面入口。',
  },
  {
    id: 'search-2',
    title: '桌面样式 tokens',
    path: 'apps/desktop/renderer/src/styles/design-system/tokens.scss',
    excerpt: '源视觉系统的颜色、间距、字号和布局变量。',
  },
  {
    id: 'search-3',
    title: '静态会话数据',
    path: 'apps/desktop/renderer/src/static/fixtures.ts',
    excerpt: '本地 fixture 驱动所有页面，无网络请求。',
  },
]

export const staticSettingsSections = [
  '常规',
  '外观',
  '模型连接',
  'Git',
  'MCP',
  '记忆',
  '个人资料',
  '快捷键',
]

export const staticAutomationPrompts = [
  '每天 09:00 汇总未读任务',
  'PR 创建后运行审查',
  '工作区变化时生成摘要',
]
