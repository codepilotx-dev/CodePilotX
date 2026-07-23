import {
  Archive,
  Brain,
  CreditCard,
  GitBranch,
  Keyboard,
  Link,
  Package,
  Palette,
  Settings,
  Sliders,
  Square,
  User,
  Gauge,
  PawPrint,
  type LucideIcon,
} from 'lucide-react'

export type SettingsSearchRow = {
  title: string
  description: string
}

export type SettingsSectionDefinition = {
  id: string
  routeId: string
  label: string
  description: string
  icon: LucideIcon
  rows: readonly SettingsSearchRow[]
}

export type SettingsGroupDefinition = {
  id: 'personal' | 'integrations' | 'coding' | 'archived'
  title: string
  items: readonly SettingsSectionDefinition[]
}

export type SettingsRegistryItem = SettingsSectionDefinition
export type SettingsRegistryGroup = SettingsGroupDefinition

const row = (title: string, description: string): SettingsSearchRow => ({
  title,
  description,
})

export const SETTINGS_GROUPS = [
  {
    id: 'personal',
    title: '个人',
    items: [
      {
        id: 'general',
        routeId: 'general',
        label: '常规',
        description: '权限、语言、通知、听写与应用行为',
        icon: Settings,
        rows: [
          row('默认权限', '设置读取、写入、命令、联网和 MCP 请求权限'),
          row('自动审核', '配置需要授权操作的自动审核行为'),
          row('完全访问权限', '允许 CodePilotX 使用完整系统能力'),
          row('默认打开目标', '默认打开文件和文件夹的位置'),
          row('集成终端 Shell', '选择集成终端使用的 Shell'),
          row('语言', '应用 UI 语言'),
          row('需按 ^ + 回车键发送长文本提示', '调整长文本提示的发送方式'),
          row('速度', '选择聊天、子智能体和压缩的推理层级'),
          row('跟进行为', '控制任务完成后的跟进行为'),
          row('允许普通模式提问', '允许 Agent 通过结构化问题卡提问'),
          row('代码审查', '选择行内或左右分离的 diff 展示方式'),
          row('建议提示', '搜索项目文件和连接应用并建议下一步'),
          row('从其他 AI 应用导入工作内容', '导入设置、项目和最近聊天记录'),
          row('弹出窗口快捷键', '为弹出窗口设置全局快捷键'),
          row('听写', '设置按住听写、切换听写、词典和历史记录'),
          row('通知', '设置轮次完成、权限和问题通知'),
          row('显示上下文窗口使用量', '在对话框底部显示上下文使用量'),
        ],
      },
      {
        id: 'profile',
        routeId: 'profile',
        label: '个人资料',
        description: '账户身份、头像和个人信息',
        icon: User,
        rows: [row('个人资料', '查看和管理当前 CodePilotX 账户信息')],
      },
      {
        id: 'appearance',
        routeId: 'appearance',
        label: '外观',
        description: '主题、颜色、字体、动效和差异标记',
        icon: Palette,
        rows: [
          row('主题', '选择浅色、深色或跟随系统，并配置代码主题'),
          row('强调色', '设置当前主题的强调颜色'),
          row('背景', '设置当前主题的背景颜色'),
          row('前景', '设置当前主题的文字颜色'),
          row('UI 字体', '设置应用界面字体'),
          row('代码字体', '设置代码与终端字体'),
          row('半透明侧边栏', '使用系统背景材质显示透明侧边栏'),
          row('对比度', '调整当前主题的视觉对比度'),
          row('使用指针光标', '交互元素悬停时显示手形指针'),
          row('减少动态效果', '跟随系统或始终开启、关闭界面动画'),
          row('界面字号', '调整应用 UI 字号'),
          row('代码字号', '调整代码和终端字号'),
          row('差异标记', '使用颜色或加减号展示代码更改'),
          row('字体平滑', '在 macOS 上优化浅色文字边缘'),
        ],
      },
      {
        id: 'pets',
        routeId: 'pets',
        label: '宠物',
        description: '让桌面伙伴管理任务并提醒需要你处理的事项',
        icon: PawPrint,
        rows: [
          row('唤醒宠物', '显示或收起桌面宠物'),
          row('选择宠物', '选择已安装的自定义宠物'),
          row('宠物大小', '在 80 到 224 像素之间调整显示大小'),
          row('任务提醒', '显示完成、失败、权限、问题和计划提醒'),
          row('安装自定义宠物', '从 HTTPS 地址预览并安装宠物包'),
        ],
      },
      {
        id: 'config',
        routeId: 'config',
        label: '配置',
        description: '安全沙盒、审批、任务模型与数据设置',
        icon: Sliders,
        rows: [
          row('批准策略', '选择 CodePilotX 何时请求批准'),
          row('沙盒运行环境', '安装、修复或卸载 Windows 沙盒运行环境'),
          row('沙盒设置', '设置命令、文件和网络访问范围'),
          row('审批执行者', '选择由你或 Guardian 处理审批'),
          row('任务模型', '配置快速、默认、深度和计划执行模型'),
          row('数据位置', '更改 CodePilotX 配置和会话数据目录'),
          row('自定义 config.toml 设置', '编辑底层 Codex 配置'),
          row('完整提示词诊断', '查看提示词来源、哈希与 token 估算'),
        ],
      },
      {
        id: 'personalization',
        routeId: 'personalization',
        label: '个性化',
        description: '回复个性和自定义指令',
        icon: Gauge,
        rows: [
          row('个性', '选择 CodePilotX 回复的默认语气'),
          row('自定义指令', '为所有新会话设置长期指令'),
        ],
      },
      {
        id: 'memory',
        routeId: 'memory',
        label: '记忆',
        description: '项目记忆、工作区和召回时间线',
        icon: Brain,
        rows: [
          row('启用记忆', '允许新会话读取和写入工作区记忆'),
          row('工作区', '选择记忆所属的工作区目录'),
          row('记忆状态', '查看自动记忆运行状态'),
          row('项目记忆', '浏览和管理项目记忆内容'),
          row('召回时间线', '查看记忆在会话中的召回记录'),
        ],
      },
      {
        id: 'shortcuts',
        routeId: 'shortcuts',
        label: '键盘快捷键',
        description: '查看应用、聊天、导航和面板快捷键',
        icon: Keyboard,
        rows: [
          row('聊天快捷键', '新对话、换行、侧边聊天和快速聊天'),
          row('导航快捷键', '前进、后退、切换标签和切换对话'),
          row('面板快捷键', '显示侧栏、终端、浏览器和底部面板'),
        ],
      },
      {
        id: 'billing',
        routeId: 'billing',
        label: '使用情况和计费',
        description: '提供商余额、Token Plan 用量和重置窗口',
        icon: CreditCard,
        rows: [
          row('连接状态', '查看支持用量查询的已配置提供商'),
          row('DeepSeek', '查看 API 账户余额'),
          row('MiniMax Token Plan', '查看订阅额度与重置窗口'),
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: '集成',
    items: [
      {
        id: 'mcp',
        routeId: 'mcp',
        label: 'MCP 服务器',
        description: '配置用户、项目和本地 MCP 服务',
        icon: Link,
        rows: [
          row('服务器', '查看和管理 MCP 服务器'),
          row('名称', '设置 MCP 服务器名称'),
          row('Scope', '选择 user、project 或 local 配置范围'),
          row('模板', '使用预设模板创建 MCP 配置'),
          row('高级 JSON', '编辑并校验完整 MCP schema'),
        ],
      },
      {
        id: 'browser',
        routeId: 'browser',
        label: '浏览器',
        description: '内置浏览器隔离会话和站点权限',
        icon: Square,
        rows: [
          row('内置浏览器', '管理隔离的浏览器会话'),
          row('站点权限', '查看和管理网站访问权限'),
        ],
      },
    ],
  },
  {
    id: 'coding',
    title: '编码',
    items: [
      {
        id: 'dependencies',
        routeId: 'dependencies',
        label: '工作空间依赖项',
        description: '管理 Node.js、Python、Git Bash 和 ripgrep 运行环境',
        icon: Package,
        rows: [
          row('Node.js', '选择内置或本机版本并查看安装状态'),
          row('Python', '选择内置或本机版本并查看安装状态'),
          row('Git Bash', '选择内置或本机版本并查看安装状态'),
          row('ripgrep', '选择内置或本机版本并查看安装状态'),
        ],
      },
      {
        id: 'git',
        routeId: 'git',
        label: 'Git',
        description: '分支、拉取请求、工作树和 GitHub 账户',
        icon: GitBranch,
        rows: [
          row('分支前缀', '设置 CodePilotX 创建分支时使用的前缀'),
          row('拉取请求合并方法', '选择 PR 的默认合并方法'),
          row('在侧边栏显示 PR 图标', '显示拉取请求状态'),
          row('始终强制推送', '推送时使用 --force-with-lease'),
          row('创建草稿拉取请求', '默认创建 Draft PR'),
          row('自动删除旧工作树', '自动清理较旧的 CodePilotX 工作树'),
          row('提交指令', '设置提交信息生成指令'),
          row('拉取请求指令', '设置 PR 标题和描述生成指令'),
          row('GitHub 账号', '登录 GitHub 并管理 OAuth 状态'),
        ],
      },
    ],
  },
  {
    id: 'archived',
    title: '已归档',
    items: [
      {
        id: 'archived',
        routeId: 'archived',
        label: '已归档对话',
        description: '查看、恢复或管理已归档的对话',
        icon: Archive,
        rows: [row('归档列表', '恢复归档对话后会回到原来的分组')],
      },
    ],
  },
] as const satisfies readonly SettingsRegistryGroup[]

export type SettingsTabId =
  (typeof SETTINGS_GROUPS)[number]['items'][number]['routeId']

export const SETTINGS_ITEMS: readonly SettingsRegistryItem[] =
  SETTINGS_GROUPS.flatMap(
    group => group.items as readonly SettingsRegistryItem[],
  )

export type SettingsSearchDocument = {
  key: string
  tabId: string
  groupTitle: string
  pageLabel: string
  rowTitle?: string
  description: string
  targetId: string
}

export const SETTINGS_SEARCH_DOCUMENTS: readonly SettingsSearchDocument[] =
  SETTINGS_GROUPS.flatMap(group =>
    group.items.flatMap(item => [
      {
        key: `${item.id}:page`,
        tabId: item.routeId,
        groupTitle: group.title,
        pageLabel: item.label,
        description: item.description,
        targetId: createSettingsTargetId(item.id),
      },
      ...item.rows.map((searchRow, index) => ({
        key: `${item.id}:row:${index}`,
        tabId: item.routeId,
        groupTitle: group.title,
        pageLabel: item.label,
        rowTitle: searchRow.title,
        description: searchRow.description,
        targetId: createSettingsTargetId(item.id, searchRow.title),
      })),
    ]),
  )

export function createSettingsTargetId(
  tabId: string,
  rowTitle?: string,
): string {
  return rowTitle
    ? `settings-${tabId}-${toTargetSegment(rowTitle)}`
    : `settings-${tabId}-page`
}

function toTargetSegment(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
}
