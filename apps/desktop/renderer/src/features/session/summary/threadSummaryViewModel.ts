import type {
  Attachment,
  ExecutionPlanItem,
  ExecutionPlanStep,
  LocalContextReference,
  PlanItem,
  SubagentProjection,
  SubagentStatus,
  ThreadGoal,
  ToolItem,
} from '@codepilotx/shared/thread'
import type { DesktopBrowserState } from '../../../../shared/types.js'

export type ThreadSummaryChanges = {
  fileCount: number
  additions: number
  deletions: number
}

export type ThreadSummaryEnvironment = {
  workspaceName: string | null
  workspacePath: string
  isGitRepository: boolean
  branchName: string | null
  changedFileCount: number
  commitOrPushEnabled: boolean
  commitOrPushDisabledReason: string | null
  createPullRequestEnabled: boolean
  createPullRequestDisabledReason: string | null
}

export type ThreadSummaryGoal = {
  objective: string
  status: ThreadGoal['status']
  timeUsedSeconds: number
  tokenBudget: number | null
  tokensUsed: number
}

export type ThreadSummaryPlan = {
  eventId: string
  title: string
  content: string
  openable: true
}

export type ThreadSummaryExecutionPlanWindow = {
  steps: readonly ExecutionPlanStep[]
  hiddenBefore: number
  hiddenAfter: number
}

export type ThreadSummaryExecutionPlan = {
  id: string
  status: ExecutionPlanItem['status']
  completedSteps: number
  steps: readonly ExecutionPlanStep[]
  window: ThreadSummaryExecutionPlanWindow
}

export type ThreadSummaryAgent = {
  id: string
  name: string
  status: SubagentStatus
  state: 'running' | 'waiting' | 'finished'
  stoppable: boolean
}

export type ThreadSummaryBrowserTabState = 'loading' | 'busy' | 'suspended' | 'error' | 'idle'

export type ThreadSummaryBrowserTab = {
  tabId: string
  title: string
  domain: string | null
  state: ThreadSummaryBrowserTabState
  panel: 'right' | 'bottom'
}
/**
 * 来源条目的稳定身份：附件/引用用其 ID，网页用 URL，工具来源用已有活动
 * 标识。缺少可定位身份的来源不会进入列表。
 */
export type ThreadSummarySourceEntry =
  | { kind: 'attachment'; identity: string; label: string; attachment: Attachment }
  | {
      kind: 'reference'
      identity: string
      label: string
      reference: LocalContextReference
    }
  | { kind: 'link'; identity: string; label: string; url: string }
  | {
      kind: 'tool'
      identity: string
      label: string
      toolKind: 'web-search' | 'integration'
      source: string | null
    }

export type ThreadSummaryArtifactPreviewKind = 'image' | 'text' | 'binary'

export type ThreadSummaryArtifact = {
  artifactId: string
  name: string
  mimeType: string
  sizeBytes: number | null
  previewKind: ThreadSummaryArtifactPreviewKind
}

export type ThreadSummaryViewModel = {
  hasContent: boolean
  environment: ThreadSummaryEnvironment | null
  changes: ThreadSummaryChanges | null
  goal: ThreadSummaryGoal | null
  executionPlan: ThreadSummaryExecutionPlan | null
  plan: ThreadSummaryPlan | null
  agents: ThreadSummaryAgent[]
  browserTabs: ThreadSummaryBrowserTab[]
  sources: ThreadSummarySourceEntry[]
  artifacts: ThreadSummaryArtifact[]
}

export type ThreadSummarySourcePreview = {
  items: ThreadSummarySourceEntry[]
  totalCount: number
}

const AGENT_RUNNING_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  'preparing',
  'running',
  'steering',
])
const AGENT_WAITING_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  'queued',
  'waiting-question',
  'waiting-permission',
])

export type ThreadSummaryViewModelInput = {
  sessionId: string | null
  workspaceName: string | null
  workspacePath: string | null
  branchName: string | null
  hasGitRepository: boolean
  changedFileCount: number
  additions: number
  deletions: number
  goal: ThreadGoal | null
  turns: readonly { planItem: PlanItem | null; executionPlanItems: readonly ExecutionPlanItem[] }[]
  attachments: readonly Attachment[]
  contextReferences: readonly LocalContextReference[]
  tools: readonly ToolItem[]
  sourceLinks: readonly { label: string; url: string }[]
  subagents: readonly SubagentProjection[]
  browserTabs: readonly DesktopBrowserState[]
}

export function deriveThreadSummaryViewModel(
  input: ThreadSummaryViewModelInput,
): ThreadSummaryViewModel {
  const normalizedWorkspacePath = input.workspacePath?.trim() || null
  const normalizedBranchName = input.branchName?.trim() || null
  const isGitRepository = input.hasGitRepository
  const environment = normalizedWorkspacePath
    ? {
        workspaceName: input.workspaceName?.trim() || null,
        workspacePath: normalizedWorkspacePath,
        isGitRepository,
        branchName: normalizedBranchName,
        changedFileCount: input.changedFileCount,
        commitOrPushEnabled: isGitRepository,
        commitOrPushDisabledReason: isGitRepository ? null : '当前工作区不是 Git 仓库',
        createPullRequestEnabled: Boolean(normalizedBranchName),
        createPullRequestDisabledReason: normalizedBranchName
          ? null
          : '创建拉取请求前需要先创建或检出 Git 分支',
      }
    : null
  const changes = normalizedWorkspacePath
    ? {
        fileCount: input.changedFileCount,
        additions: input.additions,
        deletions: input.deletions,
      }
    : null
  const executionPlan = findLatestThreadSummaryExecutionPlan(input.turns)
  const agents = input.subagents.map(({ task, currentRun }) =>
    threadSummaryAgentFromProjection(task.id, task.displayName, currentRun?.status ?? 'interrupted'),
  )
  const browserTabs = collectThreadSummaryBrowserTabs(input.browserTabs, input.sessionId)
  const sources = collectThreadSummarySources(input)
  const artifacts = collectThreadSummaryArtifacts(input.tools)
  const goal = input.goal
    ? {
        objective: input.goal.objective,
        status: input.goal.status,
        timeUsedSeconds: input.goal.timeUsedSeconds,
        tokenBudget: input.goal.tokenBudget,
        tokensUsed: input.goal.tokensUsed,
      }
    : null

  return {
    hasContent: Boolean(
      environment ||
        goal ||
        executionPlan ||
        (agents.length > 0) ||
        (browserTabs.length > 0) ||
        (sources.length > 0) ||
        (artifacts.length > 0),
    ),
    environment,
    changes,
    goal,
    executionPlan,
    plan: findLatestThreadSummaryPlan(input.turns),
    agents,
    browserTabs,
    sources,
    artifacts,
  }
}

export function threadSummaryAgentFromProjection(
  id: string,
  name: string,
  status: SubagentStatus,
): ThreadSummaryAgent {
  const state = AGENT_RUNNING_STATUSES.has(status)
    ? 'running'
    : AGENT_WAITING_STATUSES.has(status)
      ? 'waiting'
      : 'finished'
  return {
    id,
    name,
    status,
    state,
    stoppable: state !== 'finished',
  }
}

export function findLatestThreadSummaryPlan(
  turns: readonly { planItem: PlanItem | null }[],
): ThreadSummaryPlan | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const planItem = turns[index]?.planItem
    if (!planItem) continue
    // 正在流式的计划还没有生成完成，右栏只能展示完成态快照。
    if (planItem.status === 'streaming') continue
    const content = planItem.markdown.trim()
    if (!content) continue
    return {
      eventId: planItem.id,
      title: planItem.title.trim() || planTitleFallback(content),
      content,
      openable: true,
    }
  }
  return null
}

function planTitleFallback(content: string): string {
  const heading = content.split(/\r?\n/).find((line) => line.trim().length > 0)
  return (heading ?? content).replace(/^#{1,6}\s*/u, '').trim() || '计划'
}

export const THREAD_SUMMARY_STEP_PREVIEW_LIMIT = 6
const THREAD_SUMMARY_STEP_WINDOW_SIZE = 3

export function findLatestThreadSummaryExecutionPlan(
  turns: readonly { executionPlanItems: readonly ExecutionPlanItem[] }[],
): ThreadSummaryExecutionPlan | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const item = turns[index]?.executionPlanItems.at(-1)
    // 只使用最近一份非空执行计划，不与正式计划混合。
    if (item && item.steps.length > 0) return summarizeExecutionPlan(item)
  }
  return null
}

function summarizeExecutionPlan(item: ExecutionPlanItem): ThreadSummaryExecutionPlan {
  return {
    id: item.id,
    status: item.status,
    completedSteps: item.steps.filter((step) => step.status === 'completed').length,
    steps: item.steps,
    window: buildThreadSummaryExecutionPlanWindow(item.steps),
  }
}

/**
 * 长执行计划的聚焦窗口：不超过 6 步完整展示；超过时显示进行中项附近 3 步，
 * 无进行中项取首个未完成项，全完成取末尾 3 步。窗口始终取满并保持原顺序。
 */
export function buildThreadSummaryExecutionPlanWindow(
  steps: readonly ExecutionPlanStep[],
  previewLimit: number = THREAD_SUMMARY_STEP_PREVIEW_LIMIT,
): ThreadSummaryExecutionPlanWindow {
  if (steps.length <= previewLimit) {
    return { steps, hiddenBefore: 0, hiddenAfter: 0 }
  }
  const inProgressIndex = steps.findIndex((step) => step.status === 'in_progress')
  const firstPendingIndex = steps.findIndex((step) => step.status === 'pending')
  const focusIndex =
    inProgressIndex >= 0
      ? inProgressIndex
      : firstPendingIndex >= 0
        ? firstPendingIndex
        : steps.length - THREAD_SUMMARY_STEP_WINDOW_SIZE
  const startIndex = Math.max(0, Math.min(focusIndex, steps.length - THREAD_SUMMARY_STEP_WINDOW_SIZE))
  return {
    steps: steps.slice(startIndex, startIndex + THREAD_SUMMARY_STEP_WINDOW_SIZE),
    hiddenBefore: startIndex,
    hiddenAfter: steps.length - startIndex - THREAD_SUMMARY_STEP_WINDOW_SIZE,
  }
}

/**
 * 浏览器分区：当前聊天创建或控制的、仍打开的内置标签。来源聊天与控制聊天
 * 都能展示同一关联标签，各聊天内部按 tab ID 去重，按既有 order 排序。
 */
export function collectThreadSummaryBrowserTabs(
  tabs: readonly DesktopBrowserState[],
  sessionId: string | null,
): ThreadSummaryBrowserTab[] {
  if (!sessionId) return []
  const byTabId = new Map<string, ThreadSummaryBrowserTab & { order: number }>()
  for (const tab of tabs) {
    if (!tab.tabId || !tab.open) continue
    if (tab.sourceThreadId !== sessionId && tab.controlThreadId !== sessionId) continue
    if (byTabId.has(tab.tabId)) continue
    byTabId.set(tab.tabId, {
      tabId: tab.tabId,
      title: tab.title || domainFromURL(tab.url) || '内置浏览器标签',
      domain: domainFromURL(tab.url),
      state: browserTabState(tab),
      panel: tab.panel ?? 'right',
      order: tab.order ?? Number.POSITIVE_INFINITY,
    })
  }
  return [...byTabId.values()]
    .sort((left, right) => left.order - right.order || left.tabId.localeCompare(right.tabId))
    .map(({ order: _order, ...tab }) => tab)
}

function browserTabState(tab: DesktopBrowserState): ThreadSummaryBrowserTabState {
  if (tab.error) return 'error'
  if (tab.loading) return 'loading'
  if (tab.busy) return 'busy'
  if (tab.state === 'suspended') return 'suspended'
  return 'idle'
}

function domainFromURL(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

const SOURCE_ATTACHMENT_PREVIEW_LIMIT = 3

/**
 * 来源分区：已提交附件、上下文引用、结构化 citation、已完成回复中的链接与
 * 实际调用的网页搜索/集成工具。草稿与未使用的插件不经过 canonical 投影，
 * 天然不会进入该列表。
 */
export function collectThreadSummarySources(input: {
  attachments: readonly Attachment[]
  contextReferences: readonly LocalContextReference[]
  tools: readonly ToolItem[]
  sourceLinks: readonly { label: string; url: string }[]
}): ThreadSummarySourceEntry[] {
  const byIdentity = new Map<string, ThreadSummarySourceEntry>()
  const add = (entry: ThreadSummarySourceEntry): void => {
    if (byIdentity.has(entry.identity)) return
    byIdentity.set(entry.identity, entry)
  }

  for (const attachment of input.attachments) {
    add({
      kind: 'attachment',
      identity: `attachment:${attachment.id}`,
      label: attachment.name,
      attachment,
    })
  }
  for (const reference of input.contextReferences) {
    add({
      kind: 'reference',
      identity: `reference:${reference.id}`,
      label: reference.name,
      reference,
    })
  }

  const orderedTools = [...input.tools].sort((left, right) => left.createdAt - right.createdAt)
  for (const tool of orderedTools) {
    for (const block of tool.resultBlocks ?? []) {
      if (block.type !== 'citation') continue
      add({
        kind: 'link',
        identity: `link:${block.url}`,
        label: block.title?.trim() || linkLabelFromURL(block.url),
        url: block.url,
      })
    }
  }
  for (const link of input.sourceLinks) {
    add({
      kind: 'link',
      identity: `link:${link.url}`,
      label: link.label || linkLabelFromURL(link.url),
      url: link.url,
    })
  }

  for (const tool of orderedTools) {
    const activity = tool.activity
    if (!activity) continue
    // 网页搜索与具名集成都按稳定身份去重；缺身份的集成保留单次调用本身。
    if (activity.type === 'web_search') {
      add({
        kind: 'tool',
        identity: 'tool:web-search',
        label: '网页搜索',
        toolKind: 'web-search',
        source: null,
      })
    } else if (activity.type === 'integration') {
      add({
        kind: 'tool',
        identity: activity.source ? `tool:integration:${activity.source}` : `tool:${tool.callID}`,
        label: activity.source || '集成工具调用',
        toolKind: 'integration',
        source: activity.source ?? null,
      })
    }
  }

  return [...byIdentity.values()]
}

export function previewThreadSummarySources(
  sources: readonly ThreadSummarySourceEntry[],
  limit: number = SOURCE_ATTACHMENT_PREVIEW_LIMIT,
): ThreadSummarySourcePreview {
  const safeLimit = Math.max(0, Math.floor(limit))
  return {
    items: sources.slice(0, safeLimit),
    totalCount: sources.length,
  }
}

const TEXT_ARTIFACT_MEDIA_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/yaml',
  'application/xhtml+xml',
])

export function threadSummaryArtifactPreviewKind(mimeType: string): ThreadSummaryArtifactPreviewKind {
  const mime = mimeType.toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('text/')) return 'text'
  if (TEXT_ARTIFACT_MEDIA_TYPES.has(mime)) return 'text'
  if (mime.endsWith('+xml') || mime.endsWith('+json')) return 'text'
  return 'binary'
}

export const THREAD_SUMMARY_ARTIFACT_PREVIEW_LIMIT = 6

/** 产物分区：工具结果中明确声明的 Artifact，按 artifact ID 去重、最近优先。 */
export function collectThreadSummaryArtifacts(
  tools: readonly ToolItem[],
): ThreadSummaryArtifact[] {
  const byArtifactId = new Map<string, ThreadSummaryArtifact>()
  const orderedTools = [...tools].sort((left, right) => right.createdAt - left.createdAt)
  for (const tool of orderedTools) {
    for (const block of tool.resultBlocks ?? []) {
      if (block.type !== 'artifact') continue
      if (byArtifactId.has(block.artifactId)) continue
      byArtifactId.set(block.artifactId, {
        artifactId: block.artifactId,
        name: block.name,
        mimeType: block.mimeType,
        sizeBytes: block.size ?? null,
        previewKind: threadSummaryArtifactPreviewKind(block.mimeType),
      })
    }
  }
  return [...byArtifactId.values()]
}

export const THREAD_SUMMARY_AGENT_PREVIEW_LIMIT = 6

export function previewThreadSummaryAgents(
  agents: readonly ThreadSummaryAgent[],
  limit: number = THREAD_SUMMARY_AGENT_PREVIEW_LIMIT,
): { items: ThreadSummaryAgent[]; totalCount: number } {
  const safeLimit = Math.max(0, Math.floor(limit))
  return {
    items: agents.slice(0, safeLimit),
    totalCount: agents.length,
  }
}

function linkLabelFromURL(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/$/u, '')
    return path ? `${parsed.hostname}${path}` : parsed.hostname
  } catch {
    return url
  }
}
