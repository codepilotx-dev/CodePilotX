import type { ReactNode } from 'react'
import {
  FileText,
  GitPullRequest,
  Globe2,
  Gauge,
  ListChecks,
  MessageSquarePlus,
  Search,
  SquareTerminal,
  TestTube2,
} from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../shared/types.js'

export type RightDockToolId =
  | 'review'
  | 'browser'
  | 'plan'
  | 'files'
  | 'sideChat'
  | 'terminal'
  | 'toolProbe'
  | 'dialogDebug'
  | 'performanceDiagnostics'

export type RightDockFlags = {
  debugMode: boolean
}

export type RightDockPanelContext = {
  review: {
    activeSessionId: string | null
    defaultBranch: string | null
    gitStatus: DesktopGitStatus | null
    isRefreshing: boolean
    diffMarkerStyle: DesktopDiffMarkerStyle
    reviewView: DesktopReviewView
    sessionStatus: DesktopSessionStatus
    workspacePath: string | null
    onClose: () => void
    onCreateBranch: () => void
    onOpenWorkspacePath: () => void
    onRefreshDiff: () => void
    onToggleReviewView: () => void
  }
  browser: {
    state: DesktopBrowserState | null
    onAppendAnnotation: (text: string) => void
    onStateChange: (state: DesktopBrowserState) => void
  }
  files: {
    files: DesktopFileEntry[]
    selectedFile: DesktopFilePreview | null
    workspace: DesktopWorkspace | null
    onPreviewFile: (file: DesktopFileEntry) => void
  }
  plan: RightDockPlan | null
  flags: RightDockFlags
}

export type RightDockPlan = {
  title: string
  content: string
}

export type RightDockToolMeta = {
  id: RightDockToolId
  label: string
  icon: ReactNode
  shortcut?: string
  enabled: boolean | ((flags: RightDockFlags) => boolean)
}

const iconSize = 14

export const rightDockTools: readonly RightDockToolMeta[] = [
  {
    id: 'review',
    label: '审查',
    icon: <GitPullRequest size={iconSize} />,
    shortcut: 'Ctrl+Shift+R',
    enabled: true,
  },
  {
    id: 'browser',
    label: '浏览器',
    icon: <Globe2 size={iconSize} />,
    shortcut: 'Ctrl+Shift+B',
    enabled: true,
  },
  {
    id: 'plan',
    label: '计划',
    icon: <ListChecks size={iconSize} />,
    enabled: true,
  },
  {
    id: 'files',
    label: '打开文件',
    icon: <FileText size={iconSize} />,
    shortcut: 'Ctrl+P',
    enabled: true,
  },
  {
    id: 'sideChat',
    label: '侧边聊天',
    icon: <MessageSquarePlus size={iconSize} />,
    shortcut: 'Ctrl+Alt+S',
    enabled: true,
  },
  {
    id: 'terminal',
    label: '终端',
    icon: <SquareTerminal size={iconSize} />,
    shortcut: 'Ctrl+`',
    enabled: true,
  },
  {
    id: 'toolProbe',
    label: '工具探针',
    icon: <Search size={iconSize} />,
    enabled: flags => flags.debugMode,
  },
  {
    id: 'dialogDebug',
    label: '对话框调试',
    icon: <TestTube2 size={iconSize} />,
    enabled: flags => flags.debugMode,
  },
  {
    id: 'performanceDiagnostics',
    label: '性能诊断',
    icon: <Gauge size={iconSize} />,
    enabled: flags => flags.debugMode,
  },
]

export function getRightDockTool(id: string): RightDockToolMeta | undefined {
  return rightDockTools.find(tool => tool.id === id)
}

export function isRightDockToolEnabled(
  id: string,
  flags: RightDockFlags,
): boolean {
  const tool = getRightDockTool(id)
  if (!tool) return false
  return typeof tool.enabled === 'function' ? tool.enabled(flags) : tool.enabled
}
