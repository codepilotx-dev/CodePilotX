import type { ReactNode } from 'react'
import {
  FileText,
  Gauge,
  GitPullRequest,
  Globe2,
  ListChecks,
  MessageSquarePlus,
  Search,
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
import { DesktopBrowserPanel } from '../browser/DesktopBrowserPanel.js'
import { ConfirmationDialogDebug } from '../debug/ConfirmationDialogDebug.js'
import { PerformanceDiagnosticsPanel } from '../debug/PerformanceDiagnosticsPanel.js'
import { ToolProbePanel } from '../debug/ToolProbePanel.js'
import { WorkspaceReviewSidebar } from '../review/WorkspaceReviewSidebar.js'
import {
  createWorkspaceFileTabId,
  RightDockFilePreviewPanel,
  RightDockFilesPanel,
  RightDockPlanPanel,
  RightDockSideChatPanel,
} from './RightDockPanels.js'
import { FileTypeIcon } from './FileTypeIcon.js'
import type {
  WorkbenchFlags,
  WorkbenchTabDescriptor,
  WorkbenchTabKind,
} from './rightDockState.js'

export type WorkbenchTabRenderContext = {
  review: {
    activeSessionId: string | null
    defaultBranch: string | null
    gitStatus: DesktopGitStatus | null
    isRefreshing: boolean
    diffMarkerStyle: DesktopDiffMarkerStyle
    reviewView: DesktopReviewView
    sessionStatus: DesktopSessionStatus
    workspacePath: string | null
    onAppendComposerText?: (text: string) => void
    onClose: () => void
    onCreateBranch: () => void
    onOpenWorkspacePath: () => void
    onRefreshDiff: () => void
    onToggleReviewView: () => void
  }
  browser: {
    state: DesktopBrowserState | null
    onAppendAnnotation: (text: string) => void
    onAppendComposerText?: (text: string) => void
    onStateChange: (state: DesktopBrowserState) => void
  }
  files: {
    files: DesktopFileEntry[]
    selectedFile: DesktopFilePreview | null
    workspace: DesktopWorkspace | null
    onOpenFileFromBrowser: (file: DesktopFileEntry) => void
    onPreviewFile: (file: DesktopFileEntry) => void
    onAppendComposerText?: (text: string) => void
    onAddComposerFiles?: (filePaths: string[]) => void
    onPinFileTab: (tabId: WorkbenchTabDescriptor['id']) => void
  }
  planContentByEventId: Readonly<Record<string, string>>
  sideChat: {
    composer: ReactNode
    focusVersion: number
    available: boolean
  }
  sideTask: {
    activeTaskId: string | null
    content?: ReactNode
  }
  flags: WorkbenchFlags
}

export type WorkbenchTabDefinition = {
  kind: WorkbenchTabKind
  label: string
  icon: ReactNode
  shortcut?: string
  launcher: boolean
  enabled: (flags: WorkbenchFlags) => boolean
  getTitle: (tab: WorkbenchTabDescriptor) => string
  getIcon?: (tab: WorkbenchTabDescriptor) => ReactNode
  render: (
    tab: WorkbenchTabDescriptor,
    context: WorkbenchTabRenderContext,
  ) => ReactNode
}

const iconSize = 14
const always = (): boolean => true
const debugOnly = (flags: WorkbenchFlags): boolean => flags.debugMode

const definitions: readonly WorkbenchTabDefinition[] = [
  {
    kind: 'review',
    label: '审阅',
    icon: <GitPullRequest size={iconSize} />,
    shortcut: 'Ctrl+Shift+G',
    launcher: true,
    enabled: always,
    getTitle: () => '审阅',
    render: (_tab, context) => (
      <WorkspaceReviewSidebar
        {...context.review}
        debugMode={context.flags.debugMode}
      />
    ),
  },
  {
    kind: 'browser',
    label: '浏览器',
    icon: <Globe2 size={iconSize} />,
    shortcut: 'Ctrl+T',
    launcher: true,
    enabled: always,
    getTitle: () => '浏览器',
    render: (_tab, context) => <DesktopBrowserPanel {...context.browser} />,
  },
  {
    kind: 'file-browser',
    label: '打开文件',
    icon: <FileText size={iconSize} />,
    shortcut: 'Ctrl+Shift+E',
    launcher: true,
    enabled: always,
    getTitle: () => '打开文件',
    render: (_tab, context) => (
      <RightDockFilesPanel
        activePath={null}
        files={context.files.files}
        workspace={context.files.workspace}
        onAddComposerFiles={context.files.onAddComposerFiles}
        onOpenFile={(file) => context.files.onOpenFileFromBrowser(file)}
      />
    ),
  },
  {
    kind: 'file-preview',
    label: '文件预览',
    icon: <FileText size={iconSize} />,
    launcher: false,
    enabled: always,
    getTitle: tab =>
      tab.kind === 'file-preview'
        ? basename(tab.relativePath)
        : '文件预览',
    getIcon: tab =>
      tab.kind === 'file-preview' ? (
        <FileTypeIcon path={tab.relativePath} size={16} />
      ) : (
        <FileText size={iconSize} />
      ),
    render: (tab, context) =>
      tab.kind === 'file-preview' ? (
        <RightDockFilePreviewPanel
          expectedPath={tab.relativePath}
          files={context.files.files}
          workspacePath={tab.workspacePath}
          workspace={context.files.workspace}
          revealLine={tab.line}
          previewTab={tab.preview}
          onPinTab={() => context.files.onPinFileTab(tab.id)}
          onOpenFile={(file, options) => {
            context.files.onPreviewFile(file)
            if (!options.preview && file.type === 'file') {
              context.files.onPinFileTab(
                createWorkspaceFileTabId(tab.workspacePath, file.path),
              )
            }
          }}
          onAddComposerFiles={context.files.onAddComposerFiles}
          onAppendComposerText={context.files.onAppendComposerText}
        />
      ) : null,
  },
  {
    kind: 'plan',
    label: '计划',
    icon: <ListChecks size={iconSize} />,
    launcher: false,
    enabled: always,
    getTitle: tab => (tab.kind === 'plan' ? tab.title : '计划'),
    render: (tab, context) => (
      <RightDockPlanPanel
        content={
          tab.kind === 'plan'
            ? tab.legacyContent ??
              context.planContentByEventId[tab.eventId] ??
              null
            : null
        }
      />
    ),
  },
  {
    kind: 'side-chat',
    label: '侧边聊天',
    icon: <MessageSquarePlus size={iconSize} />,
    shortcut: 'Ctrl+Alt+S',
    launcher: true,
    enabled: always,
    getTitle: () => '侧边聊天',
    render: (_tab, context) =>
      context.sideChat.available ? (
        <RightDockSideChatPanel
          composer={context.sideChat.composer}
          focusVersion={context.sideChat.focusVersion}
        />
      ) : (
        <div className="right-dock-empty-state">
          <strong>侧边聊天已在其他标签切换</strong>
          <span>选择此标签即可继续草稿。</span>
        </div>
      ),
  },
  {
    kind: 'side-task',
    label: '子智能体',
    icon: <MessageSquarePlus size={iconSize} />,
    launcher: false,
    enabled: always,
    getTitle: tab =>
      tab.kind === 'side-task' ? `子智能体 ${tab.taskId.slice(0, 8)}` : '子智能体',
    render: (tab, context) =>
      tab.kind === 'side-task' &&
      context.sideTask.activeTaskId === tab.taskId ? (
        context.sideTask.content ?? (
          <div className="right-dock-empty-state">正在加载子智能体…</div>
        )
      ) : (
        <div className="right-dock-empty-state">
          <strong>子智能体已在其他标签切换</strong>
          <span>选择此标签以恢复对应任务。</span>
        </div>
      ),
  },
  {
    kind: 'tool-probe',
    label: '工具探针',
    icon: <Search size={iconSize} />,
    launcher: true,
    enabled: debugOnly,
    getTitle: () => '工具探针',
    render: () => <ToolProbePanel />,
  },
  {
    kind: 'dialog-debug',
    label: '对话框调试',
    icon: <TestTube2 size={iconSize} />,
    launcher: true,
    enabled: debugOnly,
    getTitle: () => '对话框调试',
    render: () => <ConfirmationDialogDebug />,
  },
  {
    kind: 'performance-diagnostics',
    label: '性能诊断',
    icon: <Gauge size={iconSize} />,
    launcher: true,
    enabled: debugOnly,
    getTitle: () => '性能诊断',
    render: () => <PerformanceDiagnosticsPanel />,
  },
]

const registry = new Map(definitions.map(definition => [definition.kind, definition]))

export function getWorkbenchTabDefinition(
  tabOrKind: WorkbenchTabDescriptor | WorkbenchTabKind,
): WorkbenchTabDefinition {
  const kind = typeof tabOrKind === 'string' ? tabOrKind : tabOrKind.kind
  const definition = registry.get(kind)
  if (!definition) {
    throw new Error(`未注册的工作台标签：${kind}`)
  }
  return definition
}

export function getWorkbenchLauncherDefinitions(
  flags: WorkbenchFlags,
): readonly WorkbenchTabDefinition[] {
  return definitions.filter(
    definition => definition.launcher && definition.enabled(flags),
  )
}

export function createLauncherTab(
  kind: WorkbenchTabKind,
): WorkbenchTabDescriptor | null {
  if (kind === 'review') return { id: 'review', kind: 'review' }
  if (kind === 'browser') return { id: 'browser', kind: 'browser' }
  if (kind === 'file-browser') {
    return { id: 'file-browser', kind: 'file-browser' }
  }
  if (kind === 'side-chat') return { id: 'side-chat', kind: 'side-chat' }
  if (kind === 'tool-probe') return { id: 'tool-probe', kind: 'tool-probe' }
  if (kind === 'dialog-debug') {
    return { id: 'dialog-debug', kind: 'dialog-debug' }
  }
  if (kind === 'performance-diagnostics') {
    return {
      id: 'performance-diagnostics',
      kind: 'performance-diagnostics',
    }
  }
  return null
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}
