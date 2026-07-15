import type {
  AgentNotification,
  ApprovalRequest,
  Input,
  Item,
  PermissionConfig,
  Project,
  QuestionItem,
  ThreadListItem,
  ThreadSnapshot,
  Turn,
} from '@codepilotx/shared/thread'
import { collaborationModeFromPlanModeActive } from '../shims/core/agent/codepilotxSessionContract.js'
import type {
  DesktopAgentEvent,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionEvent,
  DesktopSessionListItem,
  DesktopSessionSnapshot,
  DesktopSessionStatus,
  DesktopToolLogEntry,
  DesktopWorkspace,
} from '../../shared/types.js'

export const AGENT_QUESTION_REQUEST_ID_PREFIX = 'question:'
export const AGENT_PLAN_REQUEST_ID_PREFIX = 'plan:'

export function agentQuestionRequestId(questionId: string): string {
  return `${AGENT_QUESTION_REQUEST_ID_PREFIX}${questionId}`
}

export function agentQuestionIdFromRequestId(requestId: string): string | null {
  return requestId.startsWith(AGENT_QUESTION_REQUEST_ID_PREFIX)
    ? requestId.slice(AGENT_QUESTION_REQUEST_ID_PREFIX.length)
    : null
}

export function agentPlanRequestId(turnId: string): string {
  return `${AGENT_PLAN_REQUEST_ID_PREFIX}${turnId}`
}

export function agentPlanRunIdFromRequestId(requestId: string): string | null {
  return requestId.startsWith(AGENT_PLAN_REQUEST_ID_PREFIX)
    ? requestId.slice(AGENT_PLAN_REQUEST_ID_PREFIX.length)
    : null
}

export function desktopPermissionModeToPermissionConfig(
  mode: DesktopPermissionMode | undefined,
): PermissionConfig {
  if (mode === 'auto-review') return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
  if (mode === 'full-access') return { sandboxMode: 'danger-full-access', approvalPolicy: 'never', approvalsReviewer: 'auto_review' }
  return { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' }
}

export function agentTurnStatusToDesktopStatus(
  status: Turn['status'] | ThreadListItem['latestTurnStatus'] | null | undefined,
): DesktopSessionStatus {
  if (!status) return 'idle'
  if (status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status.startsWith('waiting-')) return 'waiting'
  if (status === 'completed') return 'done'
  if (status === 'failed') return 'error'
  if (status === 'interrupted' || status === 'stopped') return 'interrupted'
  return 'idle'
}

export function agentThreadListItemToDesktop(
  thread: ThreadListItem,
  project?: Project | null,
): DesktopSessionListItem {
  const workspace = projectToDesktopWorkspace(project, thread.projectID)
  const planModeActive = thread.settings.taskMode === 'plan'
  return {
    id: thread.id,
    sessionName: thread.title || null,
    aiTitle: null,
    firstPrompt: thread.firstUserMessage ?? thread.preview,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    standalone: !project,
    archivedAt: isoOrNull(thread.archivedAt),
    permissionMode: permissionModeToDesktop(thread.settings.permissionConfig),
    collaborationMode: collaborationModeFromPlanModeActive(planModeActive),
    planModeActive,
    model: null,
    reviewModel: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: agentTurnStatusToDesktopStatus(thread.latestTurnStatus),
    lastMessageAt: isoOrNull(thread.updatedAt),
    createdAt: iso(thread.createdAt),
  }
}

export function agentThreadListItemToDesktopSnapshot(
  thread: ThreadListItem,
  project?: Project | null,
): DesktopSessionSnapshot {
  const item = agentThreadListItemToDesktop(thread, project)
  return {
    item,
    workspace: projectToDesktopWorkspace(project, thread.projectID),
    settings: {
      permissionMode: item.permissionMode,
      collaborationMode: item.collaborationMode,
      planModeActive: item.planModeActive,
      thinkingMode: 'default',
      sessionName: item.sessionName ?? undefined,
      additionalDirectories: [],
    },
    view: { messages: [], toolLog: [], pendingPermissions: [], contextUsage: null },
    events: [],
    eventModelVersion: 1,
    workflowEvents: [],
    reviewComments: [],
    updatedAt: item.lastMessageAt ?? item.createdAt,
  }
}

export function agentThreadSnapshotToDesktop(
  snapshot: ThreadSnapshot,
  project?: Project | null,
): DesktopSessionSnapshot {
  const latestTurn = snapshot.turns.at(-1) ?? null
  const latestInput = snapshot.inputs.at(-1) ?? null
  const workspace = projectToDesktopWorkspace(project, snapshot.thread.projectID)
  const planModeActive = snapshot.thread.settings.taskMode === 'plan'
  const events = snapshotEvents(snapshot)
  const item: DesktopSessionListItem = {
    id: snapshot.thread.id,
    sessionName: snapshot.thread.title || null,
    aiTitle: null,
    firstPrompt: snapshot.inputs[0]?.content ?? null,
    workspaceName: workspace.name,
    workspacePath: workspace.path,
    standalone: !project,
    permissionMode: permissionModeToDesktop(snapshot.thread.settings.permissionConfig),
    collaborationMode: collaborationModeFromPlanModeActive(planModeActive),
    planModeActive,
    model: latestTurn?.model.id ?? latestInput?.model.id ?? null,
    reviewModel: null,
    thinkingMode: 'default',
    hasSystemPrompt: false,
    hasAppendSystemPrompt: false,
    additionalDirectoryCount: 0,
    status: agentTurnStatusToDesktopStatus(latestTurn?.status),
    lastMessageAt: iso(snapshot.thread.updatedAt),
    createdAt: iso(snapshot.thread.createdAt),
  }
  return {
    item,
    workspace,
    settings: {
      permissionMode: item.permissionMode,
      collaborationMode: item.collaborationMode,
      planModeActive,
      providerID: latestTurn?.model.providerID ?? latestInput?.model.providerID,
      model: latestTurn?.model.id ?? latestInput?.model.id,
      thinkingMode: 'default',
      sessionName: item.sessionName ?? undefined,
      additionalDirectories: [],
    },
    view: {
      messages: events
        .filter(event => event.type === 'message' || event.type === 'assistant_delta')
        .map(event => ({
          id: event.id,
          role: event.role ?? 'system',
          text: event.content ?? '',
          createdAt: event.createdAt,
          streaming: event.type === 'assistant_delta',
          metadata: event.metadata,
        })),
      toolLog: snapshot.items.flatMap(itemToToolLog),
      pendingPermissions: pendingPermissionRequests(events),
      contextUsage: null,
    },
    events,
    eventModelVersion: 1,
    workflowEvents: [],
    reviewComments: [],
    updatedAt: iso(snapshot.thread.updatedAt),
  }
}

export function agentEventsFromNotification(
  notification: AgentNotification,
): DesktopAgentEvent[] {
  if (notification.method === 'heartbeat') return []
  const params = record(notification.params)
  const threadId = stringValue(params.threadId)
  if (!threadId) return []
  const createdAt = iso(eventTime(params))
  const base = { sessionId: threadId, createdAt }

  if (notification.method === 'turn/completed') return [{ ...base, type: 'done' }]
  if (notification.method === 'turn/failed') {
    return [{ ...base, type: 'error', message: stringValue(params.message) || 'Agent turn failed' }]
  }
  if (notification.method === 'turn/interrupted') {
    return [{ ...base, type: 'status', status: 'interrupted' }]
  }
  if (notification.method === 'turn/queued') return [{ ...base, type: 'status', status: 'queued' }]
  if (notification.method === 'turn/started') return [{ ...base, type: 'status', status: 'running' }]
  if (notification.method === 'turn/statusChanged') {
    const status = statusFromNotification(params)
    return status ? [{ ...base, type: 'status', status }] : []
  }
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    return isItem(params.item) ? itemToAgentEvents(threadId, params.item) : []
  }
  if (notification.method === 'item/agentMessage/delta') {
    return [{ ...base, type: 'partial_message', role: 'assistant', text: stringValue(params.delta) }]
  }
  if (
    notification.method === 'reasoning/textDelta'
    || notification.method === 'reasoning/summaryTextDelta'
  ) {
    return [{ ...base, type: 'partial_message', role: 'assistant', text: stringValue(params.delta), metadata: { kind: 'reasoning' } }]
  }
  if (notification.method === 'plan/delta' || notification.method === 'plan/ready') {
    return [{
      ...base,
      type: 'proposed_plan',
      text: stringValue(params.delta) || stringValue(params.plan),
      streaming: notification.method === 'plan/delta',
    }]
  }
  if (notification.method === 'tool/callStarted') {
    return [{ ...base, type: 'tool_start', toolName: stringValue(params.tool), toolUseId: stringValue(params.itemId) || stringValue(params.callID), summary: stringValue(params.title) }]
  }
  if (notification.method === 'tool/outputDelta') {
    return [{ ...base, type: 'tool_result', toolName: stringValue(params.tool), toolUseId: stringValue(params.itemId) || stringValue(params.callID), summary: stringValue(params.delta) }]
  }
  if (notification.method === 'tool/callCompleted' || notification.method === 'tool/error') {
    return [{ ...base, type: 'tool_result', toolName: stringValue(params.tool), toolUseId: stringValue(params.itemId) || stringValue(params.callID), summary: stringValue(params.output) || stringValue(params.message), isError: notification.method === 'tool/error' }]
  }
  if (notification.method === 'approval/requested') {
    return [{ ...base, type: 'permission_request', request: approvalParamsToRequest(params) }]
  }
  if (notification.method === 'question/requested') {
    return [{ ...base, type: 'permission_request', request: questionParamsToRequest(params) }]
  }
  return []
}

function snapshotEvents(snapshot: ThreadSnapshot): DesktopSessionEvent[] {
  const inputEvents = snapshot.inputs
    .filter(input => input.state !== 'cancelled')
    .map(inputToSessionEvent)
  const itemEvents = snapshot.items.flatMap(item => itemToSessionEvents(snapshot.thread.id, item))
  const approvalEvents = snapshot.approvals
    .filter(approval => approval.status === 'pending')
    .map(approval => ({
      id: approval.id,
      sessionId: snapshot.thread.id,
      type: 'permission_request',
      content: approval.reason,
      createdAt: iso(approval.createdAt),
      metadata: { request: approvalToRequest(approval), agentId: approval.agentId },
    }))
  return [...inputEvents, ...itemEvents, ...approvalEvents]
    .sort((left, right) => timestampOf(left.createdAt) - timestampOf(right.createdAt))
}

function inputToSessionEvent(input: Input): DesktopSessionEvent {
  return {
    id: input.id,
    sessionId: input.threadId,
    type: 'message',
    role: 'user',
    content: input.content,
    createdAt: iso(input.createdAt),
    metadata: { inputID: input.id, turnId: input.turnId, state: input.state, strategy: input.strategy },
  }
}

function itemToSessionEvents(threadId: string, item: Item): DesktopSessionEvent[] {
  if (item.type === 'text' || item.type === 'reasoning') {
    if (!item.text.trim()) return []
    return [{
      id: item.id,
      sessionId: threadId,
      type: item.status === 'streaming' ? 'assistant_delta' : 'message',
      role: 'assistant',
      content: item.text,
      createdAt: iso(item.createdAt),
      metadata: { itemId: item.id, turnId: item.turnId, agentId: item.agentId, ...(item.type === 'reasoning' ? { kind: 'reasoning' } : {}) },
    }]
  }
  if (item.type === 'tool') return toolToSessionEvents(threadId, item)
  if (item.type === 'activity') return activityToSessionEvents(threadId, item)
  if (item.type === 'plan') {
    const events: DesktopSessionEvent[] = [{
      id: item.id,
      sessionId: threadId,
      type: 'proposed_plan',
      role: 'assistant',
      content: item.markdown,
      createdAt: iso(item.createdAt),
      metadata: { itemId: item.id, turnId: item.turnId, agentId: item.agentId, title: item.title, state: item.state, version: item.version, streaming: item.state === 'draft' },
    }]
    if (item.state === 'awaiting-confirmation') {
      events.push({
        id: `${item.id}:permission`,
        sessionId: threadId,
        type: 'permission_request',
        content: '确认计划',
        createdAt: iso(item.createdAt),
        metadata: { request: planToRequest(item), agentId: item.agentId },
      })
    }
    return events
  }
  if (item.type === 'question' && item.status === 'pending') {
    return [{
      id: item.id,
      sessionId: threadId,
      type: 'permission_request',
      content: item.prompt,
      createdAt: iso(item.createdAt),
      metadata: { request: questionToRequest(item), agentId: item.agentId },
    }]
  }
  if (item.type === 'patch') {
    return [{
      id: item.id,
      sessionId: threadId,
      type: 'file_patch',
      content: `已编辑 ${item.files.length} 个文件`,
      createdAt: iso(item.createdAt),
      metadata: { files: item.files, patch: item.files.map(file => file.patch).filter(Boolean).join('\n'), additions: item.totalAdditions, deletions: item.totalDeletions, turnScoped: true, agentId: item.agentId },
    }]
  }
  return []
}

function toolToSessionEvents(threadId: string, item: Extract<Item, { type: 'tool' }>): DesktopSessionEvent[] {
  const events: DesktopSessionEvent[] = [{
    id: `${item.id}:call`, sessionId: threadId, type: 'tool_call', content: item.command ?? item.title,
    createdAt: iso(item.startedAt ?? item.createdAt),
    metadata: { toolName: item.tool, toolUseId: item.callID, input: item.input, command: item.command, agentId: item.agentId },
  }]
  if (item.state === 'waiting-permission') {
    events.push({ id: `${item.id}:permission`, sessionId: threadId, type: 'permission_request', content: item.title, createdAt: iso(item.createdAt), metadata: { request: toolToRequest(item), agentId: item.agentId } })
  }
  if (!['pending', 'running', 'waiting-permission'].includes(item.state)) {
    events.push({
      id: `${item.id}:result`, sessionId: threadId, type: 'tool_result', content: item.error ?? item.output ?? item.title,
      createdAt: iso(item.finishedAt ?? item.createdAt),
      metadata: { toolName: item.tool, toolUseId: item.callID, isError: item.state === 'error', output: item.output, error: item.error, agentId: item.agentId },
    })
  }
  return events
}

function activityToSessionEvents(threadId: string, item: Extract<Item, { type: 'activity' }>): DesktopSessionEvent[] {
  return (item.commands ?? []).flatMap((command, index) => {
    const toolUseId = `${item.id}:${index}`
    const events: DesktopSessionEvent[] = [{ id: `${toolUseId}:call`, sessionId: threadId, type: 'tool_call', content: command.command, createdAt: iso(item.createdAt), metadata: { toolName: item.activity === 'build' ? 'Shell' : item.title, toolUseId, activity: item.activity, title: item.title, agentId: item.agentId } }]
    if (command.status !== 'running') events.push({ id: `${toolUseId}:result`, sessionId: threadId, type: 'tool_result', content: command.output, createdAt: iso(item.createdAt), metadata: { toolUseId, isError: command.status === 'error', truncated: command.truncated, agentId: item.agentId } })
    return events
  })
}

function itemToAgentEvents(threadId: string, item: Item): DesktopAgentEvent[] {
  const createdAt = iso(item.createdAt)
  if (item.type === 'text' || item.type === 'reasoning') {
    return [{ type: item.status === 'streaming' ? 'partial_message' : 'message', sessionId: threadId, role: 'assistant', text: item.text, createdAt, ...(item.type === 'reasoning' ? { metadata: { kind: 'reasoning' } } : {}) }]
  }
  if (item.type === 'tool') {
    const start = { type: 'tool_start', sessionId: threadId, toolName: item.tool, toolUseId: item.callID, summary: item.title, createdAt: iso(item.startedAt ?? item.createdAt) }
    if (['pending', 'running', 'waiting-permission'].includes(item.state)) return [start]
    return [start, { type: 'tool_result', sessionId: threadId, toolName: item.tool, toolUseId: item.callID, summary: item.error ?? item.output ?? item.title, isError: item.state === 'error', createdAt: iso(item.finishedAt ?? item.createdAt) }]
  }
  if (item.type === 'plan') return [{ type: 'proposed_plan', sessionId: threadId, text: item.markdown, streaming: item.state === 'draft', createdAt }]
  if (item.type === 'patch') return item.files.map(file => ({ type: 'diff', sessionId: threadId, filePath: file.path, patch: file.patch ?? '', createdAt, metadata: { additions: file.additions, deletions: file.deletions, turnScoped: true } }))
  if (item.type === 'question' && item.status === 'pending') return [{ type: 'permission_request', sessionId: threadId, request: questionToRequest(item), createdAt }]
  return []
}

function itemToToolLog(item: Item): DesktopToolLogEntry[] {
  if (item.type === 'activity') {
    return (item.commands ?? []).flatMap((command, index) => [
      { id: `${item.id}:${index}:start`, kind: 'start', toolName: item.activity === 'build' ? 'Shell' : item.title, summary: command.command, createdAt: iso(item.createdAt) },
      ...(command.status === 'running' ? [] : [{ id: `${item.id}:${index}:result`, kind: 'result', toolName: item.title, summary: command.output, output: command.output, isError: command.status === 'error', createdAt: iso(item.createdAt) }]),
    ])
  }
  if (item.type !== 'tool') return []
  return [
    { id: `${item.id}:start`, kind: 'start', toolName: item.tool, summary: item.title, input: item.input, createdAt: iso(item.startedAt ?? item.createdAt) },
    ...(['pending', 'running', 'waiting-permission'].includes(item.state) ? [] : [{ id: `${item.id}:result`, kind: 'result', toolName: item.tool, summary: item.error ?? item.output ?? item.title, output: item.output, error: item.error ?? undefined, isError: item.state === 'error', createdAt: iso(item.finishedAt ?? item.createdAt) }]),
  ]
}

function planToRequest(item: Extract<Item, { type: 'plan' }>): DesktopPermissionRequest {
  return { requestId: agentPlanRequestId(item.turnId), toolName: 'ExitPlanMode', toolUseId: item.id, input: { plan: item.markdown }, description: '确认计划', requestKind: 'tool' }
}

function toolToRequest(item: Extract<Item, { type: 'tool' }>): DesktopPermissionRequest {
  return { requestId: item.id, toolName: item.tool, toolUseId: item.callID, input: record(item.input), description: item.title, requestKind: item.command ? 'shell-command' : 'tool' }
}

function approvalToRequest(approval: ApprovalRequest): DesktopPermissionRequest {
  return { requestId: approval.id, toolName: approval.tool, toolUseId: approval.toolCallID, input: { command: approval.command, paths: approval.paths, risk: approval.risk }, description: approval.reason, requestKind: approval.command ? 'shell-command' : 'tool' }
}

function approvalParamsToRequest(params: Record<string, unknown>): DesktopPermissionRequest {
  return {
    requestId: stringValue(params.id),
    toolName: stringValue(params.tool) || 'tool',
    toolUseId: stringValue(params.toolCallID) || stringValue(params.itemId),
    input: record(params.input),
    description: stringValue(params.reason) || '需要批准工具调用',
    requestKind: typeof record(params.input).command === 'string' ? 'shell-command' : 'tool',
  }
}

function questionToRequest(question: QuestionItem): DesktopPermissionRequest {
  const options = questionOptions(question.choices)
  return { requestId: agentQuestionRequestId(question.id), toolName: 'AskUserQuestion', toolUseId: question.id, input: { question: question.prompt, header: '问题', options, questions: [{ id: question.id, question: question.prompt, header: '问题', options }], answer: question.answer }, description: question.prompt, requestKind: 'tool' }
}

function questionParamsToRequest(params: Record<string, unknown>): DesktopPermissionRequest {
  const id = stringValue(params.id)
  const question = stringValue(params.question) || '需要你的确认'
  const options = Array.isArray(params.options)
    ? questionOptions(params.options.map((value, index) => ({ id: String(index), label: String(value), recommended: index === 0 })))
    : questionOptions([])
  return { requestId: agentQuestionRequestId(id), toolName: 'AskUserQuestion', toolUseId: id, input: { question, header: '问题', options, questions: [{ id, question, header: '问题', options }] }, description: question, requestKind: 'tool' }
}

function questionOptions(choices: ReadonlyArray<{ label: string; description?: string; recommended: boolean }>) {
  if (choices.length >= 2) return choices.map(choice => ({ label: choice.recommended && !choice.label.includes('(Recommended)') ? `${choice.label} (Recommended)` : choice.label, description: choice.description ?? choice.label }))
  return [{ label: '继续 (Recommended)', description: '提交回答并继续执行。' }, { label: '忽略', description: '跳过这个问题。' }]
}

function pendingPermissionRequests(events: DesktopSessionEvent[]): DesktopPermissionRequest[] {
  return events.filter(event => event.type === 'permission_request').map(event => event.metadata?.request).filter((request): request is DesktopPermissionRequest => Boolean(request))
}

function statusFromNotification(params: Record<string, unknown>): DesktopSessionStatus | null {
  const status = stringValue(params.status)
  if (status) return agentTurnStatusToDesktopStatus(status as Turn['status'])
  const state = stringValue(params.state)
  if (state === 'provider-error') return 'error'
  if (state) return 'running'
  return null
}

function isItem(value: unknown): value is Item {
  const item = record(value)
  return typeof item.id === 'string' && typeof item.turnId === 'string' && typeof item.agentId === 'string' && typeof item.type === 'string'
}

function eventTime(params: Record<string, unknown>): number {
  if (typeof params.createdAt === 'number') return params.createdAt
  const item = record(params.item)
  if (typeof item.createdAt === 'number') return item.createdAt
  if (typeof params.finishedAt === 'number') return params.finishedAt
  return Date.now()
}

function permissionModeToDesktop(config: PermissionConfig | undefined): DesktopPermissionMode {
  if (config?.sandboxMode === 'danger-full-access') return 'full-access'
  if (config?.approvalsReviewer === 'auto_review') return 'auto-review'
  return 'default'
}

export function projectToDesktopWorkspace(project: Project | null | undefined, projectID: string | null): DesktopWorkspace {
  if (project) return { path: project.rootPath, name: project.name, branchName: null }
  return { path: '', name: projectID ? `Project ${projectID}` : '未选择工作区', branchName: null }
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function iso(value: number): string {
  return new Date(value).toISOString()
}

function isoOrNull(value: number | null | undefined): string | null {
  return value == null ? null : iso(value)
}

function timestampOf(value: string | undefined): number {
  return value ? Date.parse(value) || 0 : 0
}
