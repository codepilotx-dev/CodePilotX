import React, { Suspense, useEffect, type ReactNode } from 'react'
import {
  Bot,
  Folder,
  FileText,
  FileCode2,
  GitPullRequest,
  Globe2,
  ListChecks,
  MessageCirclePlus,
  Paperclip,
  SquarePlus,
  SquareTerminal,
} from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopPermissionMode,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../../shared/types.js'
import type { ReviewTabUiState } from './conversationUiState.js'
import type { SideChatComposerRenderContext } from '../../session/conversation/SideChatThreadPanel.js'
import type { ConversationItemContextValue } from '../../session/timeline/ConversationItemContext.js'
import type { OpenPlanInDockRequest } from '../../session/workflow/WorkflowPlanCard.js'
import type { FileDocumentLoadErrorPhase } from '../dock/RightDockPanels.js'
import { FileTypeIcon } from '../FileTypeIcon.js'
import { createWorkspaceFileTabId } from './workspaceFileTabId.js'
import type {
  MarkdownFileViewMode,
  WorkbenchTabDescriptor,
  WorkbenchTabKind,
} from '../dock/rightDockState.js'
import {
  WorkbenchPanelEmpty,
  WorkbenchPanelLoading,
  WorkbenchPanelUnavailable,
} from '../panels/WorkbenchPanelStates.js'
import { desktopBrowserClient } from '../../../services/desktop-client/desktop-browser-client.js'

const DesktopBrowserPanel = React.lazy(() => import('../../browser/DesktopBrowserPanel.js').then(module => ({ default: module.DesktopBrowserPanel })))
const WorkspaceReviewSidebar = React.lazy(() => import('../../review/workspace/WorkspaceReviewSidebar.js').then(module => ({ default: module.WorkspaceReviewSidebar })))
const RightDockFilePreviewPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockFilePreviewPanel })))
const RightDockFilesPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockFilesPanel })))
const RightDockPlanPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockPlanPanel })))
const RightDockSkillPreviewPanel = React.lazy(() => import('../dock/RightDockPanels.js').then(module => ({ default: module.RightDockSkillPreviewPanel })))
const SideChatThreadPanel = React.lazy(() => import('../../session/conversation/SideChatThreadPanel.js').then(module => ({ default: module.SideChatThreadPanel })))
const TerminalPanel = React.lazy(() => import('../../terminal/TerminalPanel.js').then(module => ({ default: module.TerminalPanel })))
const UserAttachmentPreviewPanel = React.lazy(() => import('../../session/attachments/UserAttachmentPreviewPanel.js').then(module => ({ default: module.UserAttachmentPreviewPanel })))

function deferred(element: ReactNode): ReactNode {
  return <Suspense fallback={null}>{element}</Suspense>
}

function BrowserTabContent({
  context,
}: {
  context: WorkbenchTabRenderContext['browser']
}): React.ReactNode {
  const { availability, onStateChange, state } = context
  const initialized = state !== null
  useEffect(() => {
    if (availability.status !== 'available') return
    const unsubscribe = desktopBrowserClient.onBrowserStateChange(
      onStateChange,
    )
    if (!initialized) {
      void desktopBrowserClient
        .openBrowser()
        .then(onStateChange)
        .catch(() => undefined)
    } else {
      void desktopBrowserClient
        .setBrowserVisible(true)
        .then(onStateChange)
        .catch(() => undefined)
    }
    return () => {
      unsubscribe()
      void desktopBrowserClient.setBrowserVisible(false).catch(() => undefined)
    }
  }, [availability.status, initialized, onStateChange])

  if (availability.status === 'loading') {
    return <WorkbenchPanelLoading label="正在连接内置浏览器…" />
  }
  if (availability.status === 'unavailable') {
    return (
      <WorkbenchPanelUnavailable
        title="内置浏览器不可用"
        description={
          availability.reason ??
          '当前桌面运行环境没有提供浏览器能力。'
        }
      />
    )
  }
  if (!state) {
    return <WorkbenchPanelLoading label="正在启动内置浏览器…" />
  }
  return deferred(<DesktopBrowserPanel {...context} state={state} />)
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
    availability: WorkbenchTabAvailability
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
    activeTabId: WorkbenchTabDescriptor['id'] | null
    available: boolean
    focusVersion: number
    isCreating: (
      tabId: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>['id'],
    ) => boolean
    itemContext: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
      status: DesktopSessionStatus,
    ) => ConversationItemContextValue
    getPermissionMode: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
    ) => DesktopPermissionMode
    onInteractionError: (message: string) => void
    onOpenPatchReview?: (path?: string) => void
    onOpenPlan?: (request: OpenPlanInDockRequest) => void
    onRecreate: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
    ) => void
    onStateChange: (
      threadId: string,
      count: number,
      status: DesktopSessionStatus,
    ) => void
    renderComposer: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
      context: SideChatComposerRenderContext,
    ) => ReactNode
  }
  sideTask: {
    activeTaskId: string | null
    availability: WorkbenchTabAvailability
    content?: ReactNode
  }
  terminal: {
    availability: WorkbenchTabAvailability
    threadId: string | null
    onDisplayPathChange: (displayPath: string | null) => void
  }
}

export type WorkbenchTabLifecycle =
  | 'unmount-when-hidden'
  | 'keep-alive-hidden'
  | 'external-surface'

export type WorkbenchTabAvailability = {
  status: 'loading' | 'available' | 'unavailable'
  reason?: string
}

export type WorkbenchTabDefinition = {
  kind: WorkbenchTabKind
  label: string
  icon: ReactNode
  shortcut?: string
  launcher: boolean
  launcherLabel?: string
  launcherIcon?: ReactNode
  launcherShortcut?: string | null
  lifecycle: WorkbenchTabLifecycle
  getAvailability?: (
    context: WorkbenchTabRenderContext,
  ) => WorkbenchTabAvailability
  getTitle: (tab: WorkbenchTabDescriptor) => string
  getIcon?: (tab: WorkbenchTabDescriptor) => ReactNode
  render: (
    tab: WorkbenchTabDescriptor,
    context: WorkbenchTabRenderContext,
  ) => ReactNode
}

const iconSize = 14

const WORKBENCH_LAUNCHER_ORDER: Partial<Record<WorkbenchTabKind, number>> = {
  review: 0,
  terminal: 1,
  browser: 2,
  'file-browser': 3,
  'side-chat': 4,
}

export function getWorkbenchLauncherPresentation(
  definition: WorkbenchTabDefinition,
): {
  label: string
  icon: ReactNode
  shortcut?: string
} {
  return {
    label: definition.launcherLabel ?? definition.label,
    icon: definition.launcherIcon ?? definition.icon,
    shortcut:
      definition.launcherShortcut === undefined
        ? definition.shortcut
        : definition.launcherShortcut ?? undefined,
  }
}

const definitions: readonly WorkbenchTabDefinition[] = [
  {
    kind: 'review',
    label: '审阅',
    icon: <GitPullRequest size={iconSize} />,
    shortcut: 'Ctrl+Shift+G',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    launcherIcon: <SquarePlus size={iconSize} />,
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
    lifecycle: 'external-surface',
    getAvailability: context => context.browser.availability,
    getTitle: () => '浏览器',
    render: (_tab, context) => <BrowserTabContent context={context.browser} />,
  },
  {
    kind: 'file-browser',
    label: '打开文件',
    icon: <FileText size={iconSize} />,
    shortcut: 'Ctrl+Shift+E',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    launcherLabel: '文件',
    launcherIcon: <Folder size={iconSize} />,
    launcherShortcut: 'Ctrl+P',
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
    lifecycle: 'unmount-when-hidden',
    getTitle: tab =>
      tab.kind === 'file-preview'
        ? basename(tab.relativePath)
        : '文件预览',
    getIcon: () => <FileText size={iconSize} />,
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
    lifecycle: 'unmount-when-hidden',
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
    kind: 'skill-preview',
    label: '技能预览',
    icon: <FileCode2 size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: tab => tab.kind === 'skill-preview' ? tab.skill.name : '技能预览',
    render: tab => deferred(
      tab.kind === 'skill-preview' ? (
        <RightDockSkillPreviewPanel tab={tab} />
      ) : null,
    ),
  },
  {
    kind: 'attachment-preview',
    label: '用户附件',
    icon: <Paperclip size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: () => '用户附件',
    render: tab => tab.kind === 'attachment-preview'
      ? deferred(<UserAttachmentPreviewPanel tab={tab} />)
      : null,
  },
  {
    kind: 'side-chat',
    label: '侧边聊天',
    icon: <MessageCirclePlus size={iconSize} />,
    shortcut: 'Ctrl+Alt+S',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    getTitle: tab => tab.kind === 'side-chat' ? tab.title : '侧边聊天',
    render: (tab, context) => tab.kind === 'side-chat'
      ? deferred(
          <SideChatThreadPanel
            active={context.sideChat.activeTabId === tab.id}
            creating={context.sideChat.isCreating(tab.id)}
            focusVersion={context.sideChat.focusVersion}
            itemContext={status => context.sideChat.itemContext(tab, status)}
            onInteractionError={context.sideChat.onInteractionError}
            onOpenPatchReview={context.sideChat.onOpenPatchReview}
            onOpenPlan={context.sideChat.onOpenPlan}
            onRecreate={context.sideChat.onRecreate}
            onStateChange={context.sideChat.onStateChange}
            permissionMode={context.sideChat.getPermissionMode(tab)}
            renderComposer={context.sideChat.renderComposer}
            tab={tab}
          />,
        )
      : null,
  },
  {
    kind: 'terminal',
    label: '终端',
    icon: <SquareTerminal size={iconSize} />,
    shortcut: 'Ctrl+`',
    launcher: true,
    launcherShortcut: null,
    lifecycle: 'keep-alive-hidden',
    getAvailability: context => context.terminal.availability,
    getTitle: () => '终端',
    render: (_tab, context) => {
      if (context.terminal.availability.status === 'loading') {
        return <WorkbenchPanelLoading label="正在连接集成终端…" />
      }
      if (context.terminal.availability.status === 'unavailable') {
        return (
          <WorkbenchPanelUnavailable
            title="集成终端不可用"
            description={
              context.terminal.availability.reason ??
              '当前桌面运行环境没有提供终端能力。'
            }
          />
        )
      }
      return context.terminal.threadId ? (
        deferred(
          <TerminalPanel
            threadId={context.terminal.threadId}
            onDisplayPathChange={context.terminal.onDisplayPathChange}
          />,
        )
      ) : (
        <WorkbenchPanelEmpty
          title="请先创建任务"
          description="集成终端会绑定到当前任务的工作目录。"
        />
      )
    },
  },
  {
    kind: 'side-task',
    label: '子智能体',
    icon: <Bot size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getAvailability: context => context.sideTask.availability,
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
  return definitions
    .filter(definition => definition.launcher)
    .map((definition, index) => ({ definition, index }))
    .sort((left, right) => {
      const leftOrder = WORKBENCH_LAUNCHER_ORDER[left.definition.kind]
      const rightOrder = WORKBENCH_LAUNCHER_ORDER[right.definition.kind]
      return (
        (leftOrder ?? Object.keys(WORKBENCH_LAUNCHER_ORDER).length + left.index) -
        (rightOrder ?? Object.keys(WORKBENCH_LAUNCHER_ORDER).length + right.index)
      )
    })
    .map(({ definition }) => definition)
}

export function createLauncherTab(
  kind: WorkbenchTabKind,
): WorkbenchTabDescriptor | null {
  if (kind === 'review') return { id: 'review', kind: 'review' }
  if (kind === 'browser') return { id: 'browser', kind: 'browser' }
  if (kind === 'file-browser') {
    return { id: 'file-browser', kind: 'file-browser' }
  }
  if (kind === 'side-chat') return null
  if (kind === 'terminal') return { id: 'terminal', kind: 'terminal' }
  return null
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}
