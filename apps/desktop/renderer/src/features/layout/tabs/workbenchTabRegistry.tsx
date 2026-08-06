import React, { Suspense, type ReactNode } from 'react'
import {
  Bot,
  FileText,
  GitPullRequest,
  Globe2,
  ListChecks,
  MessageSquarePlus,
  SquareTerminal,
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
} from '../../../../shared/types.js'
import type { ReviewTabUiState } from './conversationUiState.js'
import type { FileDocumentLoadErrorPhase } from '../dock/RightDockPanels.js'
import { FileTypeIcon } from '../FileTypeIcon.js'
import { createWorkspaceFileTabId } from './workspaceFileTabId.js'
import type {
  MarkdownFileViewMode,
  WorkbenchTabDescriptor,
  WorkbenchTabKind,
} from '../dock/rightDockState.js'

const DesktopBrowserPanel = React.lazy(() => import('../../browser/DesktopBrowserPanel.js').then(module => ({ default: module.DesktopBrowserPanel })))
const WorkspaceReviewSidebar = React.lazy(() => import('../../review/workspace/WorkspaceReviewSidebar.js').then(module => ({ default: module.WorkspaceReviewSidebar })))
const RightDockFilePreviewPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockFilePreviewPanel })))
const RightDockFilesPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockFilesPanel })))
const RightDockPlanPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockPlanPanel })))
const RightDockSideChatPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockSideChatPanel })))
const TerminalPanel = React.lazy(() => import('../../terminal/TerminalPanel.js').then(module => ({ default: module.TerminalPanel })))

function deferred(element: ReactNode): ReactNode {
  return <Suspense fallback={null}>{element}</Suspense>
}

export type WorkbenchTabRenderContext = {
  review: {
    activeSessionId: string | null
    projectId: string | null
    defaultBranch: string | null
    gitStatus: DesktopGitStatus | null
    isRefreshing: boolean
    diffMarkerStyle: DesktopDiffMarkerStyle
    reviewView: DesktopReviewView
    reviewTabState: ReviewTabUiState
    sessionStatus: DesktopSessionStatus
    workspacePath: string | null
    onAppendComposerText?: (text: string) => void
    onClose: () => void
    onCreateBranch: () => void
    onOpenWorkspacePath: () => void
    onRefreshDiff: () => void
    onReviewTabStateChange: (
      value:
        | ReviewTabUiState
        | ((current: ReviewTabUiState) => ReviewTabUiState),
    ) => void
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
    onSetFileMarkdownViewMode: (
      tabId: WorkbenchTabDescriptor['id'],
      mode: MarkdownFileViewMode,
    ) => void
    onLoadError: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'file-preview' }>,
      error: Error,
      phase: FileDocumentLoadErrorPhase,
    ) => void
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
  terminal: {
    threadId: string | null
    onDisplayPathChange: (displayPath: string | null) => void
  }
}

export type WorkbenchTabDefinition = {
  kind: WorkbenchTabKind
  label: string
  icon: ReactNode
  shortcut?: string
  launcher: boolean
  getTitle: (tab: WorkbenchTabDescriptor) => string
  getIcon?: (tab: WorkbenchTabDescriptor) => ReactNode
  render: (
    tab: WorkbenchTabDescriptor,
    context: WorkbenchTabRenderContext,
  ) => ReactNode
}

const iconSize = 14

const definitions: readonly WorkbenchTabDefinition[] = [
  {
    kind: 'review',
    label: '审阅',
    icon: <GitPullRequest size={iconSize} />,
    shortcut: 'Ctrl+Shift+G',
    launcher: true,
    getTitle: () => '审阅',
    render: (_tab, context) => deferred(
      <WorkspaceReviewSidebar {...context.review} />,
    ),
  },
  {
    kind: 'browser',
    label: '浏览器',
    icon: <Globe2 size={iconSize} />,
    shortcut: 'Ctrl+T',
    launcher: true,
    getTitle: () => '浏览器',
    render: (_tab, context) => deferred(<DesktopBrowserPanel {...context.browser} />),
  },
  {
    kind: 'file-browser',
    label: '打开文件',
    icon: <FileText size={iconSize} />,
    shortcut: 'Ctrl+Shift+E',
    launcher: true,
    getTitle: () => '打开文件',
    render: (tab, context) => {
      const directoryPath = tab.kind === 'file-browser' ? tab.directoryPath : undefined
      return deferred(
        <RightDockFilesPanel
          activePath={directoryPath ?? null}
          files={context.files.files}
          workspace={context.files.workspace}
          onAddComposerFiles={context.files.onAddComposerFiles}
          onOpenFile={(file) => context.files.onOpenFileFromBrowser(file)}
        />,
      )
    },
  },
  {
    kind: 'file-preview',
    label: '文件预览',
    icon: <FileText size={iconSize} />,
    launcher: false,
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
    render: (tab, context) => deferred(
      tab.kind === 'file-preview' ? (
        <RightDockFilePreviewPanel
          expectedPath={tab.relativePath}
          projectId={tab.projectId}
          folderId={tab.folderId}
          files={context.files.files}
          workspacePath={tab.workspacePath}
          workspace={context.files.workspace}
          revealLine={tab.line}
          previewTab={tab.preview}
          markdownViewMode={tab.markdownViewMode}
          onSetMarkdownViewMode={mode =>
            context.files.onSetFileMarkdownViewMode(tab.id, mode)
          }
          onPinTab={() => context.files.onPinFileTab(tab.id)}
          onLoadError={(error, phase) =>
            context.files.onLoadError(tab, error, phase)
          }
          onOpenFile={(file, options) => {
            context.files.onPreviewFile(file)
            if (!options.preview && file.type === 'file') {
              context.files.onPinFileTab(
                createWorkspaceFileTabId(
                  file.rootPath ?? tab.workspacePath,
                  file.path,
                  tab.projectId,
                  file.folderId ?? tab.folderId,
                ),
              )
            }
          }}
          onAddComposerFiles={context.files.onAddComposerFiles}
          onAppendComposerText={context.files.onAppendComposerText}
        />
      ) : null,
    ),
  },
  {
    kind: 'plan',
    label: '计划',
    icon: <ListChecks size={iconSize} />,
    launcher: false,
    getTitle: tab => (tab.kind === 'plan' ? tab.title : '计划'),
    render: (tab, context) => deferred(
      <RightDockPlanPanel
        content={
          tab.kind === 'plan'
            ? context.planContentByEventId[tab.eventId] ?? null
            : null
        }
      />,
    ),
  },
  {
    kind: 'side-chat',
    label: '侧边聊天',
    icon: <MessageSquarePlus size={iconSize} />,
    shortcut: 'Ctrl+Alt+S',
    launcher: true,
    getTitle: () => '侧边聊天',
    render: (_tab, context) =>
      context.sideChat.available ? (
        deferred(<RightDockSideChatPanel
          composer={context.sideChat.composer}
          focusVersion={context.sideChat.focusVersion}
        />)
      ) : (
        <div className="right-dock-empty-state">
          <strong>侧边聊天已在其他标签切换</strong>
          <span>选择此标签即可继续草稿。</span>
        </div>
      ),
  },
  {
    kind: 'terminal',
    label: '终端',
    icon: <SquareTerminal size={iconSize} />,
    shortcut: 'Ctrl+`',
    launcher: true,
    getTitle: () => '终端',
    render: (_tab, context) =>
      context.terminal.threadId ? (
        deferred(
          <TerminalPanel
            threadId={context.terminal.threadId}
            onDisplayPathChange={context.terminal.onDisplayPathChange}
          />,
        )
      ) : (
        <div className="right-dock-empty-state">
          <strong>请先创建任务</strong>
          <span>集成终端会绑定到当前任务的工作目录。</span>
        </div>
      ),
  },
  {
    kind: 'side-task',
    label: '子智能体',
    icon: <Bot size={iconSize} />,
    launcher: false,
    getTitle: () => '子智能体',
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

export function getWorkbenchTabDisplayTitle(
  tab: WorkbenchTabDescriptor,
  terminalDisplayPath: string | null,
): string {
  if (tab.kind === 'terminal' && terminalDisplayPath?.trim()) {
    return terminalDisplayPath
  }
  return getWorkbenchTabDefinition(tab).getTitle(tab)
}

export function getWorkbenchLauncherDefinitions(): readonly WorkbenchTabDefinition[] {
  return definitions.filter(definition => definition.launcher)
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
  if (kind === 'terminal') return { id: 'terminal', kind: 'terminal' }
  return null
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}
