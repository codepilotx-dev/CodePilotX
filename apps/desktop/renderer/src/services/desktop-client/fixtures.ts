import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_UPDATE_STATUS_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../../shared/ipcChannels.js'
import { encodeDesktopBridgeArgs } from '../../../shared/desktopBridgeArgs.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../../../shared/settingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCodePilotXCollaborationMode,
} from '../../shims/core/agent/codepilotxSessionContract.js'
import type {
  CatalogProvider,
  ModelRef,
  Project,
} from '@codepilotx/shared'
import type {
  PermissionConfig,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
  ThreadSnapshot,
} from '@codepilotx/shared/thread'
import type {
  EventEnvelope,
  ProtocolCapability,
  RpcParams,
  RpcResult,
} from '@codepilotx/agent-protocol'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  normalizeDesktopThemeSettings,
} from '../../../shared/theme.js'
import { desktopUserMessageInputToPreviewText } from '../../../shared/desktopUserMessage.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopApi,
  DesktopBrowserState,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopFileRevision,
  DesktopFileSaveResult,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopReviewSource,
  DesktopSessionEvent,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
  DesktopGithubAuthMode,
  DesktopGithubAuthStatus,
  DesktopGithubLoginStatus,
  DesktopGithubProfileOverviewResult,
  DesktopGithubRepositoryListResult,
  DesktopGitStatus,
  DesktopGitOperationResult,
  DesktopPullRequestResult,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
  DesktopSubagentRead,
  DesktopUpdateStatus,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/types.js'
import {
  agentEventsFromNotification,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktopSnapshot,
  agentThreadSnapshotToDesktop,
  desktopPermissionModeToPermissionConfig,
  permissionModeFromPermissionConfig,
  projectToDesktopWorkspace,
} from '../agentThreadAdapter.js'
import {
  createAgentRpcClient,
  type AgentRpcSubscription,
} from '../agentRpcClient.js'

const BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY =
  'codepilotx.desktop.appearance.v6'
const LEGACY_BROWSER_APPEARANCE_SETTINGS_STORAGE_KEYS = [
  'codepilotx.desktop.appearance.v3',
  'codepilotx.desktop.appearance.v5',
] as const

export function emptyBrowserState(): DesktopBrowserState {
  return {
    open: false,
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    allowedSites: [],
    sitePermissions: [],
  }
}

export function defaultMockThemeSettings(): DesktopThemeSettings {
  return normalizeDesktopThemeSettings(DEFAULT_DESKTOP_THEME_SETTINGS)
}

export function readBrowserThemeSettings(storage?: Storage): DesktopThemeSettings {
  try {
    for (const key of LEGACY_BROWSER_APPEARANCE_SETTINGS_STORAGE_KEYS) {
      storage?.removeItem(key)
    }
    const value = storage?.getItem(BROWSER_APPEARANCE_SETTINGS_STORAGE_KEY)
    return value
      ? normalizeDesktopThemeSettings(JSON.parse(value))
      : defaultMockThemeSettings()
  } catch {
    return defaultMockThemeSettings()
  }
}

export function mockModelProvider(providerID: ModelProviderID): DesktopModelProviderSummary {
  return {
    providerID,
    kind: 'openai-compatible',
    displayName: 'Browser Mock',
    defaultModels: [],
    apiKeyConfigured: false,
  }
}

export function cleanGitStatus() {
  return {
    branchName: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: true,
    files: [],
  }
}

export function emptyReviewDiff(): DesktopReviewDiffResult {
  return {
    scopes: [
      { scope: 'unstaged', changedFiles: 0, additions: 0, deletions: 0 },
      { scope: 'staged', changedFiles: 0, additions: 0, deletions: 0 },
    ],
    activeScope: 'unstaged',
    files: [],
    status: cleanGitStatus(),
  }
}

export function mockWorkspace(path: string): DesktopWorkspace {
  return {
    path,
    name: path ? path.split(/[\\/]/).filter(Boolean).at(-1) ?? path : '浏览器 Mock',
    branchName: null,
  }
}

/**
 * Browser fixtures still enter the same canonical Turn renderer as real Agent
 * sessions. The adapter lives at the mock transport boundary so production
 * conversation code never falls back to the legacy flattened timeline.
 */
export function mockThreadHistoryPage(
  snapshot: DesktopSessionSnapshot,
): RpcResult<'thread/history/read'> {
  const threadId = snapshot.item.id
  const createdAt = Date.parse(snapshot.item.createdAt) || Date.now()
  const updatedAt = Date.parse(snapshot.updatedAt) || createdAt
  const permissionConfig = snapshot.settings.permissionConfig
  const mode = snapshot.settings.planModeActive ? 'plan' : 'chat'
  const model = { providerID: 'mock', id: snapshot.settings.model ?? 'mock' }
  const bundles: Array<Record<string, unknown>> = []
  let current: {
    turn: Record<string, unknown>
    inputs: Array<Record<string, unknown>>
    messages: Array<Record<string, unknown>>
    agents: Array<Record<string, unknown>>
    items: Array<Record<string, unknown>>
    approvals: Array<Record<string, unknown>>
    attachments: Array<Record<string, unknown>>
  } | null = null

  for (const [index, message] of snapshot.view.messages.entries()) {
    const messageCreatedAt = typeof message.createdAt === 'number'
      ? message.createdAt
      : Date.parse(message.createdAt ?? '') || createdAt + index
    if (message.role === 'user') {
      const turnId = `mock-turn:${message.id}`
      const agentId = `mock-agent:${message.id}`
      current = {
        turn: {
          id: turnId,
          threadId,
          sourceInputID: message.id,
          status: 'completed',
          mode,
          model,
          permissionConfig,
          rootAgentId: agentId,
          mergedInputIDs: [],
          startedAt: messageCreatedAt,
          finishedAt: messageCreatedAt,
          elapsedSeconds: 0,
          error: null,
        },
        inputs: [{
          id: message.id,
          threadId,
          turnId,
          content: message.text,
          delivery: 'start',
          mode,
          model,
          permissionConfig,
          attachmentIds: [],
          state: 'completed',
          createdAt: messageCreatedAt,
        }],
        messages: [{ id: message.id, threadId, turnId, role: 'user', createdAt: messageCreatedAt }],
        agents: [{
          id: agentId,
          threadId,
          turnId,
          parentAgentId: null,
          profile: 'main',
          task: message.text,
          model,
          sessionId: `mock-session:${turnId}`,
          depth: 0,
          status: 'completed',
          error: null,
          subagentRunId: null,
          runSequence: 0,
          createdAt: messageCreatedAt,
          updatedAt: messageCreatedAt,
        }],
        items: [],
        approvals: [],
        attachments: [],
      }
      bundles.push(current)
      continue
    }
    if (message.role !== 'assistant' || !current) continue
    const turnId = current.turn.id as string
    const agentId = current.turn.rootAgentId as string
    current.messages.push({ id: message.id, threadId, turnId, role: 'assistant', createdAt: messageCreatedAt })
    current.items.push({
      id: message.id,
      messageID: message.id,
      turnId,
      agentId,
      type: 'text',
      placement: 'result',
      text: message.text,
      status: message.streaming ? 'streaming' : 'completed',
      createdAt: messageCreatedAt,
    })
    if (message.streaming) {
      current.turn.status = 'running'
      current.turn.finishedAt = null
      current.agents[0]!.status = 'running'
    }
  }

  /* ── Process non-message events (tool calls, patches, plans) ── */

  const toolItems = new Map<string, Record<string, unknown>>()

  for (const event of snapshot.events) {
    if (!current) continue
    const turnId = current.turn.id as string
    const agentId = current.turn.rootAgentId as string
    const eventCreatedAt = typeof event.createdAt === 'number'
      ? event.createdAt
      : Date.parse(event.createdAt ?? '') || createdAt

    if (event.type === 'tool_call') {
      const toolUseId = (event as any).metadata?.toolUseId ?? event.id
      const toolName = (event as any).metadata?.toolName ?? 'Bash'
      const toolItem: Record<string, unknown> = {
        id: toolUseId,
        messageID: toolUseId,
        turnId,
        agentId,
        type: 'tool',
        callID: toolUseId,
        tool: toolName,
        title: event.content,
        state: 'running',
        input: null,
        command: null,
        output: null,
        error: null,
        startedAt: eventCreatedAt,
        finishedAt: null,
        durationMs: null,
        createdAt: eventCreatedAt,
      }
      current.items.push(toolItem)
      toolItems.set(toolUseId, toolItem)
      if (current.turn.status === 'completed') {
        current.turn.status = 'running'
        current.turn.finishedAt = null
        current.agents[0]!.status = 'running'
      }
    }

    if (event.type === 'tool_output_delta') {
      const toolUseId = (event as any).metadata?.toolUseId
      const existing = toolUseId ? toolItems.get(toolUseId) : null
      if (existing) {
        const prev = (existing.output as string) ?? ''
        existing.output = prev + event.content
        existing.state = 'completed'
        existing.finishedAt = eventCreatedAt
      }
    }

    if (event.type === 'file_patch') {
      const metadata = (event as any).metadata
      const files: Array<Record<string, unknown>> = (metadata?.files ?? []).map(
        (f: { path: string; additions?: number; deletions?: number; patch?: string }, i: number) => ({
          path: f.path,
          additions: f.additions ?? 1,
          deletions: f.deletions ?? 0,
          patch: f.patch ?? null,
        }),
      )
      current.items.push({
        id: `${event.id}`,
        messageID: `${event.id}`,
        turnId,
        agentId,
        type: 'patch',
        files,
        totalAdditions: files.reduce((sum: number, f: Record<string, unknown>) => sum + (f.additions as number), 0),
        totalDeletions: files.reduce((sum: number, f: Record<string, unknown>) => sum + (f.deletions as number), 0),
        createdAt: eventCreatedAt,
      })
    }

    if (event.type === 'proposed_plan') {
      current.items.push({
        id: `${event.id}`,
        messageID: `${event.id}`,
        turnId,
        agentId,
        type: 'plan',
        title: '实施计划',
        markdown: event.content,
        version: 0,
        status: 'completed',
        createdAt: eventCreatedAt,
      })
    }
  }

  // If there are tool items with no matching output delta, leave them as running

  return {
    thread: {
      id: threadId,
      title: snapshot.item.sessionName ?? snapshot.item.aiTitle ?? '浏览器会话',
      projectID: null,
      settings: { taskMode: mode, permissionConfig },
      createdAt,
      updatedAt,
    },
    subagents: [],
    turns: bundles,
    queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
    olderCursor: null,
    hasOlder: false,
    streamPosition: { streamId: `mock-thread:${threadId}`, sequence: 0 },
  } as unknown as RpcResult<'thread/history/read'>
}

export function mockSessionSnapshot(
  sessionId: string,
  workspace: DesktopWorkspace,
  options: CreateDesktopSessionOptions,
): DesktopSessionSnapshot {
  const now = new Date().toISOString()
  const collaborationMode = resolveCodePilotXCollaborationMode({
    collaborationMode: options.collaborationMode,
    planModeActive: options.planModeActive,
  })
  const planModeActive = planModeActiveFromCollaborationMode(collaborationMode)
  const permissionConfig = options.permissionConfig ?? desktopPermissionModeToPermissionConfig('default')
  const permissionMode = permissionModeFromDesktopConfig(permissionConfig)
  return {
    item: {
      id: sessionId,
      sessionName: options.sessionName ?? null,
      aiTitle: null,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      standalone: !options.workspacePath,
      permissionMode,
      collaborationMode,
      planModeActive,
      model: options.model ?? null,
      reviewModel: options.reviewModel ?? null,
      thinkingMode: options.thinkingMode ?? 'default',
      hasSystemPrompt: Boolean(options.systemPrompt),
      hasAppendSystemPrompt: Boolean(options.appendSystemPrompt),
      additionalDirectoryCount: options.additionalDirectories?.length ?? 0,
      status: 'idle',
      createdAt: now,
      lastMessageAt: null,
    },
    workspace,
    settings: {
      permissionConfig,
      collaborationMode,
      planModeActive,
      model: options.model,
      reviewModel: options.reviewModel,
      smallFastModel: options.smallFastModel,
      fastModel: options.fastModel,
      defaultModel: options.defaultModel,
      deepModel: options.deepModel,
      sessionName: options.sessionName,
      thinkingMode: options.thinkingMode ?? 'default',
      systemPrompt: options.systemPrompt,
      appendSystemPrompt: options.appendSystemPrompt,
      additionalDirectories: options.additionalDirectories ?? [],
    },
    view: {
      messages: [],
      toolLog: [],
      pendingPermissions: [],
      contextUsage: null,
    },
    events: [],
    workflowEvents: [],
    reviewComments: [],
    updatedAt: now,
  }
}

export function createBrowserVisualFixture(): DesktopSessionSnapshot | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const visualCase = new URLSearchParams(window.location.search).get('visualCase')
  if (
    visualCase !== 'rich' &&
    visualCase !== 'permission' &&
    visualCase !== 'review' &&
    visualCase !== 'turn-nav'
  ) {
    return null
  }

  const sessionId = `visual-${visualCase}`
  const workspace = mockWorkspace('F:\\CodeProject\\CodePilotX-Ts')
  const snapshot = mockSessionSnapshot(sessionId, workspace, {
    workspacePath: workspace.path,
    sessionName:
      visualCase === 'rich'
        ? 'Codex 富消息工作台'
        : visualCase === 'permission'
          ? '权限与计划'
          : visualCase === 'turn-nav'
            ? '用户消息导航'
            : 'Review 与 Diff',
    collaborationMode: {
      mode: visualCase === 'permission' ? 'plan' : 'default',
    },
    planModeActive: visualCase === 'permission',
    thinkingMode: 'adaptive',
  })
  const baseTime = Date.now()
  const timestamp = (offsetMs: number): string =>
    new Date(baseTime + offsetMs).toISOString()
  const createdAt = timestamp(0)
  const events: DesktopSessionEvent[] = [
    {
      id: `${sessionId}-user`,
      sessionId,
      type: 'message',
      role: 'user',
      content:
        visualCase === 'review'
          ? '请审查主题重构并确认 diff。'
          : visualCase === 'turn-nav'
            ? '第一轮：梳理 Codex 导航轨。'
          : '把核心工作台重构成 Codex 风格，并保留现有 Agent 边界。',
      createdAt,
    },
    {
      id: `${sessionId}-assistant`,
      sessionId,
      type: 'message',
      role: 'assistant',
      content:
        visualCase === 'turn-nav'
          ? '第一轮已完成。'
          : '已完成工作台结构梳理。\n\n```ts\nconst theme = mode === \"dark\" ? \"codex-dark\" : \"codex-light\"\n```\n\n- 固定 Codex 语义表面\n- 高亮主题按需加载',
      createdAt: timestamp(2_000),
    },
  ]

  if (visualCase === 'turn-nav') {
    for (let turn = 2; turn <= 4; turn += 1) {
      events.push(
        {
          id: `${sessionId}-user-${turn}`,
          sessionId,
          type: 'message',
          role: 'user',
          content: `第 ${turn} 轮：继续校准交互和视觉。`,
          createdAt: timestamp(turn * 3_000),
        },
        {
          id: `${sessionId}-assistant-${turn}`,
          sessionId,
          type: 'message',
          role: 'assistant',
          content:
            turn === 4
              ? '第 4 轮已完成。\n\n- 卡片固定 320px\n- padding 为 8px\n- 摘要最多三行'
              : `第 ${turn} 轮已完成。`,
          createdAt: timestamp(turn * 3_000 + 1_000),
        },
      )
    }
    events.push({
      id: `${sessionId}-patch`,
      sessionId,
      type: 'file_patch',
      content: '更新用户消息导航轨',
      createdAt: timestamp(13_000),
      metadata: {
        turnScoped: true,
        files: [
          { path: 'apps/desktop/renderer/src/features/session/ConversationTurnNavRail.tsx' },
          { path: 'apps/desktop/renderer/src/styles/features/timeline.scss' },
          { path: 'apps/desktop/renderer/src/components/ui/Tooltip.tsx' },
        ],
      },
    })
  }

  if (visualCase === 'rich' || visualCase === 'review') {
    events.push(
      {
        id: `${sessionId}-tool`,
        sessionId,
        type: 'tool_call',
        content: 'Bash: bun run typecheck',
        createdAt: timestamp(3_000),
        metadata: { toolName: 'Bash', toolUseId: 'visual-tool-1' },
      },
      {
        id: `${sessionId}-tool-output`,
        sessionId,
        type: 'tool_output_delta',
        content: '63 tests passed\nrenderer build complete',
        createdAt: timestamp(4_000),
        metadata: { toolName: 'Bash', toolUseId: 'visual-tool-1' },
      },
      {
        id: `${sessionId}-patch`,
        sessionId,
        type: 'file_patch',
        content: '更新 Codex 主题与工作台样式',
        createdAt: timestamp(5_000),
        metadata: {
          turnScoped: true,
          files: [
            { path: 'apps/desktop/renderer/shared/theme.ts' },
            { path: 'apps/desktop/renderer/src/styles/index.scss' },
          ],
        },
      },
    )
  }

  if (visualCase === 'permission') {
    events.push({
      id: `${sessionId}-plan`,
      sessionId,
      type: 'proposed_plan',
      role: 'assistant',
      content:
        '# 实施计划\n\n1. 固定 Codex Light / Dark\n2. 生成 91 主题白名单\n3. 验证权限、Plan 与 Dock',
      createdAt: timestamp(3_000),
    })
    snapshot.view.pendingPermissions = [
      {
        requestId: `${sessionId}-permission`,
        toolName: 'Bash',
        requestKind: 'shell-command',
        description: '允许运行 renderer 验收命令',
        input: { command: 'bun run --cwd apps/desktop/renderer test' },
      },
    ]
  }

  snapshot.events = events
  snapshot.view.messages = events
    .filter(event => event.type === 'message')
    .map(event => ({
      id: event.id,
      role: event.role as 'user' | 'assistant',
      text: event.content,
      createdAt: event.createdAt,
    }))
  snapshot.item.status = visualCase === 'rich' ? 'running' : 'idle'
  snapshot.item.lastMessageAt = events.at(-1)?.createdAt ?? createdAt
  snapshot.updatedAt = snapshot.item.lastMessageAt
  return snapshot
}

const VISUAL_REVIEW_GENERATION = 'visual-review-generation'
const VISUAL_REVIEW_REVISION = 'visual-review-revision'
const VISUAL_REVIEW_SMALL_PATH =
  'apps/desktop/renderer/test/codex-style-contracts.test.ts'
const VISUAL_REVIEW_LARGE_PATH =
  'apps/desktop/renderer/src/features/review/diff/WorkspaceReviewDiff.tsx'

export function isBrowserVisualReviewCase(): boolean {
  return import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('visualCase') === 'review'
}

function createBrowserVisualReviewLargePatch(): string {
  const changedPairs = 520
  const lines = [`@@ -1,${changedPairs} +1,${changedPairs} @@`]
  for (let line = 1; line <= changedPairs; line += 1) {
    lines.push(`-const previousValue${line} = "before-${line}"`)
    lines.push(`+const currentValue${line} = "after-${line}"`)
  }
  return lines.join('\n')
}

function createBrowserVisualReviewSmallPatch(): string {
  const context = [
    "import { LAB_DEMOS } from '../src/features/labs/labRegistry.js'",
    '',
    "describe('Codex semantic token contract', () => {",
    "  test('exports semantic color tokens', async () => {",
  ]
  const removed = [
    '    expect(tokens).toHaveLength(117)',
    '    expect(new Set(tokens).size).toBe(117)',
    '    expect(stylesheet).toContain("--color-decoration-added")',
  ]
  const added = [
    '    expect(tokens).toHaveLength(121)',
    '    expect(new Set(tokens).size).toBe(121)',
    "    expect(tokens).toContain('--color-token-input-background')",
    "    expect(tokens).toContain('--color-token-dropdown-background')",
    "    expect(tokens).toContain('--color-token-main-surface-primary')",
    "    expect(tokens).toContain('--color-token-panel-background')",
    "    expect(tokens).toContain('--color-token-control-background')",
    "    expect(tokens).toContain('--color-token-elevated-background')",
    '  })',
    '',
    "  test('keeps diff backgrounds separate from raw decoration colors', async () => {",
    '    const stylesheet = await Bun.file(',
    '      new URL(',
    "        '../src/styles/design-system/codex-semantic-tokens.scss',",
    '        import.meta.url,',
    '      ),',
    '    ).text()',
    '',
    '    expect(stylesheet).toContain(',
    "      '--vscode-diffEditor-insertedLineBackground: var(--color-diff-added-line-background)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--vscode-diffEditor-insertedTextBackground: var(--color-diff-added-text-background)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--vscode-diffEditor-removedLineBackground: var(--color-diff-removed-line-background)',",
    '    )',
    '    expect(stylesheet).toContain(',
    "      '--vscode-diffEditor-removedTextBackground: var(--color-diff-removed-text-background)',",
    '    )',
    '  })',
  ]
  return [
    '@@ -1,7 +1,35 @@',
    ...context.map(line => ` ${line}`),
    ...removed.map(line => `-${line}`),
    ...added.map(line => `+${line}`),
  ].join('\n')
}

const VISUAL_REVIEW_LARGE_PATCH = createBrowserVisualReviewLargePatch()
const VISUAL_REVIEW_SMALL_PATCH = createBrowserVisualReviewSmallPatch()

export function browserVisualReviewSummary(
  source: DesktopReviewSource,
) {
  if (!isBrowserVisualReviewCase()) return null
  const changedLines = 1_074
  return {
    snapshot: {
      projectId: 'visual-review-project',
      generation: VISUAL_REVIEW_GENERATION,
      source,
      repositoryRoot: 'F:\\CodeProject\\CodePilotX-Ts',
      headSha: '1111111111111111111111111111111111111111',
      baseSha: null,
      files: [
        {
          path: VISUAL_REVIEW_SMALL_PATH,
          previousPath: null,
          status: 'modified' as const,
          additions: 31,
          deletions: 3,
          changedLines: 34,
          changedBytes: 2_400,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
        {
          path: VISUAL_REVIEW_LARGE_PATH,
          previousPath: null,
          status: 'modified' as const,
          additions: 520,
          deletions: 520,
          changedLines: 1_040,
          changedBytes: 48_000,
          binary: false,
          revision: VISUAL_REVIEW_REVISION,
        },
      ],
      totals: {
        files: 2,
        additions: 551,
        deletions: 523,
        changedLines,
        changedBytes: 50_400,
      },
      largeDiffMode: false,
    },
    cacheState: 'fresh' as const,
  }
}

export function browserVisualReviewFileDiff(
  source: DesktopReviewSource,
  path: string,
) {
  if (!isBrowserVisualReviewCase()) return null
  const summary = browserVisualReviewSummary(source)!
  const file = summary.snapshot.files.find(candidate => candidate.path === path)
  if (!file) return null
  const smallFile = path === VISUAL_REVIEW_SMALL_PATH
  const patch = smallFile
    ? VISUAL_REVIEW_SMALL_PATCH
    : VISUAL_REVIEW_LARGE_PATCH
  return {
    file,
    revision: VISUAL_REVIEW_REVISION,
    patch,
    hunks: [{
      id: smallFile ? 'visual-review-small-hunk' : 'visual-review-large-hunk',
      header: smallFile ? '@@ -1,7 +1,35 @@' : '@@ -1,520 +1,520 @@',
      oldStart: 1,
      oldLines: smallFile ? 7 : 520,
      newStart: 1,
      newLines: smallFile ? 35 : 520,
      patch,
    }],
    renderable: true,
    tooLargeReason: null,
  }
}

export function requireMockSession(
  sessions: Map<string, DesktopSessionSnapshot>,
  sessionId: string,
): DesktopSessionSnapshot {
  const snapshot = sessions.get(sessionId)
  if (!snapshot) throw new Error(`Mock session not found: ${sessionId}`)
  return snapshot
}

export function mockCopilotLogin() {
  return {
    state: 'idle' as const,
    deviceCode: null,
    verificationUrl: null,
    error: null,
    auth: null,
    elapsedMs: 0,
  }
}

export function mockGithubLogin(mode: DesktopGithubAuthMode = 'browser') {
  return {
    loginId: null,
    mode,
    state: 'failed' as const,
    authorizationUrl: null,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error: '浏览器 mock 模式无法完成 GitHub 登录。',
    auth: null,
    elapsedMs: 0,
  }
}

export function githubLoginFailure(
  error: string,
  loginId: string | null = null,
  mode: DesktopGithubAuthMode = 'browser',
): DesktopGithubLoginStatus {
  return {
    loginId,
    mode,
    state: 'failed',
    authorizationUrl: null,
    userCode: null,
    verificationUri: null,
    expiresAt: null,
    error,
    auth: null,
    elapsedMs: 0,
  }
}

export function permissionModeFromDesktopConfig(config: PermissionConfig): DesktopPermissionMode {
  return permissionModeFromPermissionConfig(config)
}

export function noop(): void {}
