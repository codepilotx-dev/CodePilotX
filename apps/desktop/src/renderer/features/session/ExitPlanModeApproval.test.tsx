import { expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuickChatContext } from './QuickChatContext.js'
import { ExitPlanModeApproval } from './ExitPlanModeApproval.js'
import type { DesktopPermissionRequest } from '../../../shared/types.js'

const request: DesktopPermissionRequest = {
  requestId: 'plan-1',
  toolName: 'ExitPlanMode',
  description: '确认计划',
  input: { plan: '# Plan' },
}

const mockProviderModelOptions = [
  {
    providerID: 'anthropic',
    displayName: 'Anthropic',
    modelPresets: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
      { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
    ],
    baseURL: undefined,
  },
  {
    providerID: 'minimax',
    displayName: 'MiniMax',
    modelPresets: [
      { id: 'minimax-text-01', label: 'MiniMax Text 01', value: 'minimax-text-01' },
    ],
    baseURL: 'https://api.minimax.com',
  },
]

const mockContextValue = {
  providerModelOptions: mockProviderModelOptions,
  isConversationRoute: false,
  isConversationLoading: false,
  sidebarCollapsed: false,
  activeSessionId: null,
  activeSessionPinnedAt: null,
  sessionTitle: null,
  workspaceName: null,
  workspacePath: null,
  branchName: null,
  diff: '',
  gitStatus: null,
  recentWorkspaces: [],
  permissionMode: 'default' as const,
  planModeActive: false,
  events: [],
  workflowEvents: [],
  messages: [],
  pendingPermissions: [],
  sessionStatus: 'idle' as const,
  composer: null,
  bottomPanelVisible: false,
  rightDockOpen: false,
  rightDockTool: null,
  rightDockPlanContent: null,
  rightDockNode: null,
  rightDockWidth: 400,
  debugMode: false,
  onArchiveSession: () => {},
  onCreateBranch: () => {},
  onOpenAutomation: () => {},
  onOpenWorkspacePath: () => {},
  onOpenRightDock: () => {},
  onOpenPlanInRightDock: () => {},
  onSubmitEditedUserMessage: async () => {},
  onAppendComposerText: () => {},
  onAppendSideChatText: () => {},
  onAddComposerFiles: () => {},
  onRefreshDiff: () => {},
  onToggleSidebar: () => {},
  onToggleSessionPinned: () => {},
  onCommitOrPush: () => {},
  onCreatePullRequest: () => {},
  onChooseWorkspace: async () => null,
  onCloneGithub: () => {},
  onOpenWorkspace: async () => null,
  onClearWorkspace: () => {},
  onDecidePermission: () => {},
  onAcceptExitPlanMode: () => {},
  onToggleBottomPanel: () => {},
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <QuickChatContext.Provider value={mockContextValue}>
      {element}
    </QuickChatContext.Provider>,
  )
}

test('ExitPlanModeApproval matches compact plan confirmation layout', () => {
  const html = render(
    <ExitPlanModeApproval
      request={request}
      onAccept={() => {}}
      onRevise={() => {}}
    />,
  )

  expect(html).toContain('实施此计划?')
  expect(html).toContain('使用')
  expect(html).toContain('模型')
  expect(html).toContain('保存为默认计划执行模型')
  expect(html).toContain('是，实施此计划')
  expect(html).toContain('忽略')
  expect(html).toContain('ESC')
  expect(html).toContain('提交')
  expect(html).toContain('请告知 CodePilotX 如何调整')
  expect(html).not.toContain('后续权限')
  expect(html).not.toContain('查看计划摘要')
})

test('ExitPlanModeApproval shows default option and provider model trigger', () => {
  const html = render(
    <ExitPlanModeApproval
      request={request}
      onAccept={() => {}}
      onRevise={() => {}}
    />,
  )

  // Default option is shown as the initial label
  expect(html).toContain('默认')

  // Trigger has aria-label for 计划执行模型
  expect(html).toContain('aria-label="计划执行模型"')

  // Provider names and model options exist in the data model via context
  // (portal-based menu content requires client-side rendering to display)
})
