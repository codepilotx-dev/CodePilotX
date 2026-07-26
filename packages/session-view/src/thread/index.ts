import type {
  AgentExecution,
  ApprovalRequest,
  Input,
  Item,
  QuestionChoice,
  SubagentProjection,
  SubagentRun,
  SubagentTask,
  Thread,
  ThreadSettings,
  ThreadSnapshot,
  Turn,
} from "@codepilotx/shared/thread"
import { decodeApprovalPolicy } from "@codepilotx/shared/thread"

type AgentNotification = {
  jsonrpc: "2.0"
  id?: string | number
  method: string
  params: Record<string, unknown>
}

export interface ThreadViewOptions {
  agentId?: string
  runId?: string
  turnId?: string
}

interface ThreadTimelineRowBase {
  id: string
  turnId: string
  agentId: string
  createdAt: number
}

export interface ThreadTextRow extends ThreadTimelineRowBase {
  kind: "text"
  item: Extract<Item, { type: "text" }>
}

export interface ThreadReasoningRow extends ThreadTimelineRowBase {
  kind: "reasoning"
  item: Extract<Item, { type: "reasoning" }>
}

export interface ThreadActivityRow extends ThreadTimelineRowBase {
  kind: "activity"
  item: Extract<Item, { type: "activity" }>
}

export interface ThreadToolRow extends ThreadTimelineRowBase {
  kind: "tool"
  item: Extract<Item, { type: "tool" }>
}

export interface ThreadPlanRow extends ThreadTimelineRowBase {
  kind: "plan"
  item: Extract<Item, { type: "plan" }>
}

export interface ThreadExecutionPlanRow extends ThreadTimelineRowBase {
  kind: "execution-plan"
  item: Extract<Item, { type: "execution-plan" }>
}

export interface ThreadQuestionRow extends ThreadTimelineRowBase {
  kind: "question"
  item: Extract<Item, { type: "question" }>
}

export interface ThreadPatchRow extends ThreadTimelineRowBase {
  kind: "patch"
  item: Extract<Item, { type: "patch" }>
}

export interface ThreadSubagentRow extends ThreadTimelineRowBase {
  kind: "subagent"
  item: Extract<Item, { type: "subagent" }>
}

export type ThreadTimelineRow =
  | ThreadTextRow
  | ThreadReasoningRow
  | ThreadActivityRow
  | ThreadToolRow
  | ThreadPlanRow
  | ThreadExecutionPlanRow
  | ThreadQuestionRow
  | ThreadPatchRow
  | ThreadSubagentRow

export type ThreadBlocker =
  | { kind: "approval"; id: string; createdAt: number; approval: ApprovalRequest }
  | { kind: "question"; id: string; createdAt: number; question: Extract<Item, { type: "question" }> }

export interface ThreadView {
  rows: ThreadTimelineRow[]
  blockers: ThreadBlocker[]
  blocked: boolean
  pendingApprovals: ApprovalRequest[]
  pendingQuestions: Array<Extract<Item, { type: "question" }>>
}

export function createThreadView(
  snapshot: ThreadSnapshot,
  options: ThreadViewOptions = {},
): ThreadView {
  const runAgentIds = options.runId
    ? new Set(snapshot.agents
        .filter((agent) => agent.subagentRunId === options.runId)
        .map((agent) => agent.id))
    : null
  const matchesScope = (turnId: string, agentId: string) =>
    (!options.turnId || turnId === options.turnId)
    && (!options.agentId || agentId === options.agentId)
    && (!runAgentIds || runAgentIds.has(agentId))

  const rows = snapshot.items
    .filter((item) => matchesScope(item.turnId, item.agentId))
    .map(itemRow)

  const pendingApprovals = snapshot.approvals
    .filter((approval) => approval.status === "pending" && matchesScope(approval.turnId, approval.agentId))
    .sort(compareCreated)
  const pendingQuestions = snapshot.items
    .filter((item): item is Extract<Item, { type: "question" }> =>
      item.type === "question"
      && item.status === "pending"
      && matchesScope(item.turnId, item.agentId))
    .sort(compareCreated)
  const blockers: ThreadBlocker[] = [
    ...pendingApprovals.map((approval): ThreadBlocker => ({
      kind: "approval",
      id: `approval:${approval.id}`,
      approval,
      createdAt: approval.createdAt,
    })),
    ...pendingQuestions.map((question): ThreadBlocker => ({
      kind: "question",
      id: `question:${question.id}`,
      question,
      createdAt: question.createdAt,
    })),
  ].sort(compareCreated)

  return {
    rows: rows.sort(compareCreated),
    blockers,
    blocked: blockers.length > 0,
    pendingApprovals,
    pendingQuestions,
  }
}

export function createThreadTimelineRows(
  snapshot: ThreadSnapshot,
  options: ThreadViewOptions = {},
): ThreadTimelineRow[] {
  return createThreadView(snapshot, options).rows
}

export function applyThreadEvent(
  snapshot: ThreadSnapshot,
  notification: AgentNotification,
): ThreadSnapshot {
  const params = record(notification.params)
  if (notification.method === "thread/snapshot") {
    const candidate = record(params.snapshot)
    if (isThreadSnapshot(candidate)) return candidate
    return isThreadSnapshot(params) ? params : snapshot
  }

  if (notification.method === "thread/updated") {
    const patch = record(params.patch)
    return {
      ...snapshot,
      thread: {
        ...snapshot.thread,
        ...threadPatch(patch),
        updatedAt: numberValue(params.updatedAt) ?? snapshot.thread.updatedAt,
      },
    }
  }

  if (notification.method === "thread/settings/updated") {
    const settings = params.settings
    return isThreadSettings(settings)
      ? { ...snapshot, thread: { ...snapshot.thread, settings } }
      : snapshot
  }

  if (notification.method === "agent/upserted") {
    const agent = normalizeAgent(params.agent)
    return agent ? { ...snapshot, agents: upsert(snapshot.agents, agent) } : snapshot
  }

  if (
    notification.method === "subagent/created"
    || notification.method === "subagent/updated"
    || notification.method === "subagent/workspaceUpdated"
  ) {
    return applySubagentEvent(snapshot, params)
  }

  if (notification.method === "item/started" || notification.method === "item/completed") {
    const item = normalizeItem(params.item)
    return item ? { ...snapshot, items: upsert(snapshot.items, item) } : snapshot
  }

  if (notification.method === "approval/requested") {
    const approval = approvalFromParams(snapshot, params)
    return approval ? { ...snapshot, approvals: upsert(snapshot.approvals, approval) } : snapshot
  }

  if (notification.method === "question/requested") {
    const question = questionFromParams(snapshot, params)
    return question ? { ...snapshot, items: upsert(snapshot.items, question) } : snapshot
  }

  if (notification.method === "serverRequest/resolved") {
    return resolveServerRequest(snapshot, params)
  }

  if (notification.method === "queue/updated") {
    const input = inputFromParams(snapshot, params)
    return input ? { ...snapshot, inputs: upsert(snapshot.inputs, input) } : snapshot
  }

  if (notification.method === "turn/plan/updated") {
    const item = normalizeItem(params.item)
    return item?.type === "execution-plan"
      ? { ...snapshot, items: upsert(snapshot.items, item) }
      : snapshot
  }

  if (
    notification.method === "tool/callStarted"
    || notification.method === "tool/callCompleted"
  ) {
    return applyToolEvent(snapshot, notification.method, params)
  }

  if (isDeltaMethod(notification.method)) {
    return applyItemDelta(snapshot, notification.method, params)
  }

  const turnStatus = statusForTurnEvent(notification.method, params)
  if (turnStatus) {
    const turnId = stringValue(params.turnId) ?? stringValue(params.turnID)
    if (!turnId) return snapshot
    const turns = snapshot.turns.map((turn) => turn.id === turnId
      ? updateTurnFromEvent(turn, turnStatus, params)
      : turn)
    return { ...snapshot, turns }
  }

  return snapshot
}

function applySubagentEvent(
  snapshot: ThreadSnapshot,
  params: Record<string, unknown>,
): ThreadSnapshot {
  const direct = subagentProjectionFromParams(params)
  const taskId = direct?.task.id
    ?? stringValue(params.taskId)
    ?? stringValue(params.subagentTaskId)
  const existing = taskId
    ? snapshot.subagents.find((candidate) => candidate.task.id === taskId)
    : undefined
  const workspace = params.workspace
  const projection = direct ?? (existing && isSubagentWorkspace(workspace)
    ? {
        task: { ...existing.task, workspace, updatedAt: numberValue(params.updatedAt) ?? existing.task.updatedAt },
        currentRun: existing.currentRun,
      }
    : null)
  if (!projection) return snapshot
  const run = projection.currentRun
  const items = snapshot.items.map((item): Item =>
    item.type === "subagent" && item.subagentTaskId === projection.task.id
      ? {
          ...item,
          runId: run?.id ?? item.runId,
          childThreadId: projection.task.childThreadId,
          displayName: projection.task.displayName,
          profile: projection.task.profile,
          task: projection.task.task,
          status: run?.status ?? item.status,
          queueReason: run ? run.queueReason : item.queueReason,
          result: run ? run.result : item.result,
        }
      : item)
  return {
    ...snapshot,
    subagents: upsertProjection(snapshot.subagents, projection),
    items,
  }
}

function applyToolEvent(
  snapshot: ThreadSnapshot,
  method: "tool/callStarted" | "tool/callCompleted",
  params: Record<string, unknown>,
): ThreadSnapshot {
  const itemId = stringValue(params.itemId) ?? stringValue(params.itemID) ?? stringValue(params.id)
  const callID = stringValue(params.callID) ?? stringValue(params.toolCallID)
  let changed = false
  const items = snapshot.items.map((item): Item => {
    if (item.type !== "tool") return item
    if (itemId ? item.id !== itemId : callID && item.callID !== callID) return item
    if (!itemId && !callID) return item
    changed = true
    if (method === "tool/callStarted") {
      return {
        ...item,
        state: "running",
        startedAt: numberValue(params.startedAt) ?? item.startedAt,
      }
    }
    return {
      ...item,
      state: params.error ? "error" : "completed",
      output: stringValue(params.output) ?? item.output,
      error: stringValue(params.error) ?? item.error,
      finishedAt: numberValue(params.finishedAt) ?? item.finishedAt,
      durationMs: numberValue(params.durationMs) ?? item.durationMs,
    }
  })
  return changed ? { ...snapshot, items } : snapshot
}

function itemRow(item: Item): ThreadTimelineRow {
  const base = {
    id: `${item.type}:${item.id}`,
    turnId: item.turnId,
    agentId: item.agentId,
    createdAt: item.createdAt,
  }
  switch (item.type) {
    case "text": return { ...base, kind: "text", item }
    case "reasoning": return { ...base, kind: "reasoning", item }
    case "activity": return { ...base, kind: "activity", item }
    case "tool": return { ...base, kind: "tool", item }
    case "plan": return { ...base, kind: "plan", item }
    case "execution-plan": return { ...base, kind: "execution-plan", item }
    case "question": return { ...base, kind: "question", item }
    case "patch": return { ...base, kind: "patch", item }
    case "subagent": return { ...base, kind: "subagent", item }
  }
}

function applyItemDelta(
  snapshot: ThreadSnapshot,
  method: AgentNotification["method"],
  params: Record<string, unknown>,
): ThreadSnapshot {
  const itemId = stringValue(params.itemId)
    ?? stringValue(params.itemID)
    ?? stringValue(params.id)
    ?? stringValue(params.callID)
  if (!itemId) return snapshot
  const delta = stringValue(params.delta)
    ?? stringValue(params.text)
    ?? stringValue(params.output)
    ?? stringValue(params.error)
  if (delta === undefined) return snapshot
  let changed = false
  const items = snapshot.items.map((item): Item => {
    if (item.id !== itemId) return item
    if ((item.type === "text" || item.type === "reasoning") && item.status !== "streaming") return item
    if (item.type === "tool" && item.state !== "running") return item
    if (item.type === "plan" && item.status !== "streaming") return item
    if (method === "item/agentMessage/delta" && item.type === "text") {
      changed = true
      return { ...item, text: `${item.text}${delta}`, status: "streaming" }
    }
    if (method.startsWith("reasoning/") && item.type === "reasoning") {
      changed = true
      return { ...item, text: `${item.text}${delta}`, status: "streaming" }
    }
    if (method === "plan/delta" && item.type === "plan") {
      changed = true
      return { ...item, markdown: `${item.markdown}${delta}`, status: "streaming" }
    }
    if (method === "tool/outputDelta" && item.type === "tool") {
      changed = true
      return { ...item, output: `${item.output ?? ""}${delta}`, state: "running" }
    }
    if (method === "tool/error" && item.type === "tool") {
      changed = true
      return { ...item, error: delta, state: "error" }
    }
    return item
  })
  return changed ? { ...snapshot, items } : snapshot
}

function resolveServerRequest(
  snapshot: ThreadSnapshot,
  params: Record<string, unknown>,
): ThreadSnapshot {
  const id = stringValue(params.id) ?? stringValue(params.itemId)
  if (!id) return snapshot
  const kind = stringValue(params.kind)
  if (kind === "approval") {
    const decision = stringValue(params.decision)
    return {
      ...snapshot,
      approvals: snapshot.approvals.map((approval) => approval.id === id
        ? { ...approval, status: decision === "allow" ? "allowed" : "denied" }
        : approval),
    }
  }
  if (kind === "question") {
    const ignored = params.ignored === true
    return {
      ...snapshot,
      items: snapshot.items.map((item): Item => item.type === "question" && item.id === id
        ? {
            ...item,
            status: ignored ? "ignored" : "answered",
            answer: ignored ? null : answerText(params.answer),
          }
        : item),
    }
  }
  return snapshot
}

function approvalFromParams(
  snapshot: ThreadSnapshot,
  params: Record<string, unknown>,
): ApprovalRequest | null {
  const id = stringValue(params.interactionId) ?? stringValue(params.id)
  const threadId = stringValue(params.threadId) ?? snapshot.thread.id
  const turnId = stringValue(params.turnId) ?? stringValue(params.turnID)
  const toolCallID = stringValue(params.toolCallId) ?? stringValue(params.toolCallID) ?? stringValue(params.itemId)
  const tool = stringValue(params.tool) ?? "tool"
  const item = snapshot.items.find((candidate) => candidate.id === toolCallID)
  const agentId = stringValue(params.agentId) ?? stringValue(params.agentID) ?? item?.agentId
  if (!id || !turnId || !toolCallID || !agentId) return null
  const input = record(params.input)
  const requested = record(params.requestedPermissions)
  return {
    id,
    threadId,
    turnId,
    agentId,
    toolCallID,
    tool,
    command: stringValue(input.command) ?? null,
    cwd: stringValue(input.cwd) ?? null,
    paths: stringArray(params.paths),
    requestedPermissions: {
      readPaths: stringArray(requested.readPaths),
      writePaths: stringArray(requested.writePaths),
      networkDomains: stringArray(requested.networkDomains),
    },
    review: isShellReview(params.review) ? params.review : null,
    risk: riskValue(params.risk),
    reason: stringValue(params.reason) ?? "需要用户确认",
    status: "pending",
    createdAt: numberValue(params.createdAt) ?? item?.createdAt ?? snapshot.thread.updatedAt,
  }
}

function questionFromParams(
  snapshot: ThreadSnapshot,
  params: Record<string, unknown>,
): Extract<Item, { type: "question" }> | null {
  const id = stringValue(params.interactionId) ?? stringValue(params.id)
  const turnId = stringValue(params.turnId) ?? stringValue(params.turnID)
  const agentId = stringValue(params.agentId) ?? stringValue(params.agentID)
  if (!id || !turnId || !agentId) return null
  const firstQuestion = Array.isArray(params.questions) ? record(params.questions[0]) : {}
  const rawOptions = Array.isArray(firstQuestion.choices)
    ? firstQuestion.choices
    : Array.isArray(params.options)
      ? params.options
      : []
  const choices = rawOptions.map((choice, index): QuestionChoice => {
    const option = record(choice)
    const label = stringValue(option.label) ?? stringValue(choice) ?? `选项 ${index + 1}`
    return {
      id: stringValue(option.id) ?? String(index),
      label,
      ...(stringValue(option.description) ? { description: stringValue(option.description) } : {}),
      recommended: option.recommended === true || index === 0,
    }
  })
  return {
    id,
    messageID: stringValue(params.messageID) ?? turnId,
    turnId,
    agentId,
    type: "question",
    prompt: stringValue(firstQuestion.prompt) ?? stringValue(params.question) ?? stringValue(params.prompt) ?? "需要你的确认",
    choices,
    status: "pending",
    answer: null,
    createdAt: numberValue(params.createdAt) ?? snapshot.thread.updatedAt,
  }
}

function inputFromParams(snapshot: ThreadSnapshot, params: Record<string, unknown>): Input | null {
  const source = record(params.input)
  const id = stringValue(params.inputID) ?? stringValue(params.inputId) ?? stringValue(source.id)
  const turnId = stringValue(params.turnId) ?? stringValue(params.turnID) ?? stringValue(source.turnId)
  if (!id || !turnId || typeof source.content !== "string") return null
  const existing = snapshot.inputs.find((input) => input.id === id)
  if (existing) {
    const action = stringValue(params.action)
    return { ...existing, state: action === "steer-consumed" ? "merged" : existing.state }
  }
  if (!isModelRef(source.model) || !isPermissionConfig(source.permissionConfig)) return null
  const action = stringValue(params.action)
  return {
    id,
    threadId: snapshot.thread.id,
    turnId,
    content: source.content,
    delivery: source.strategy === "guide"
      ? "steer"
      : source.strategy === "queue"
        ? "follow-up"
        : "start",
    mode: source.taskMode === "plan" || source.mode === "plan" ? "plan" : "chat",
    model: source.model,
    permissionConfig: source.permissionConfig,
    state: action === "steer-consumed" ? "merged" : "active",
    createdAt: numberValue(params.createdAt) ?? snapshot.thread.updatedAt,
  }
}

function updateTurnFromEvent(
  turn: Turn,
  status: Turn["status"],
  params: Record<string, unknown>,
): Turn {
  const startedAt = numberValue(params.startedAt)
  const finishedAt = numberValue(params.finishedAt)
  return {
    ...turn,
    status,
    startedAt: startedAt ?? turn.startedAt,
    finishedAt: finishedAt ?? turn.finishedAt,
    error: status === "failed" ? stringValue(params.message) ?? turn.error : turn.error,
  }
}

function statusForTurnEvent(
  method: AgentNotification["method"],
  params: Record<string, unknown>,
): Turn["status"] | null {
  if (method === "turn/queued") return "queued"
  if (method === "turn/started") return "running"
  if (method === "turn/completed") return "completed"
  if (method === "turn/failed") return "failed"
  if (method === "turn/interrupted") return "interrupted"
  if (method !== "turn/statusChanged") return null
  return turnStatusValue(params.status) ?? turnStatusValue(params.state)
}

function normalizeAgent(value: unknown): AgentExecution | null {
  const source = record(value)
  const id = stringValue(source.id)
  const threadId = stringValue(source.threadId) ?? stringValue(source.threadID)
  const turnId = stringValue(source.turnId) ?? stringValue(source.turnID)
  const sessionId = stringValue(source.sessionId) ?? stringValue(source.sessionID)
  if (!id || !threadId || !turnId || !sessionId || !isModelRef(source.model)) return null
  return {
    id,
    threadId,
    turnId,
    parentAgentId: stringValue(source.parentAgentId) ?? stringValue(source.parentAgentID) ?? null,
    profile: stringValue(source.profile) ?? "agent",
    task: stringValue(source.task) ?? "",
    model: source.model,
    sessionId,
    depth: numberValue(source.depth) ?? 0,
    status: agentStatusValue(source.status),
    error: stringValue(source.error) ?? null,
    subagentRunId: stringValue(source.subagentRunId) ?? stringValue(source.subagentRunID) ?? null,
    runSequence: numberValue(source.runSequence) ?? 0,
    createdAt: numberValue(source.createdAt) ?? 0,
    updatedAt: numberValue(source.updatedAt) ?? numberValue(source.createdAt) ?? 0,
  }
}

function normalizeItem(value: unknown): Item | null {
  const source = record(value)
  const id = stringValue(source.id)
  const type = stringValue(source.type)
  const turnId = stringValue(source.turnId) ?? stringValue(source.turnID)
  const agentId = stringValue(source.agentId) ?? stringValue(source.agentID)
  if (!id || !turnId || !agentId || !isItemType(type)) return null
  if ("messageID" in source && "createdAt" in source) return source as unknown as Item
  return null
}

function threadPatch(patch: Record<string, unknown>): Partial<Thread> {
  const projectID = patch.projectID
  const normalizedProjectID = typeof projectID === "string" || projectID === null
    ? projectID as Thread["projectID"]
    : undefined
  return {
    ...(typeof patch.title === "string" ? { title: patch.title } : {}),
    ...(normalizedProjectID !== undefined
      ? { projectID: normalizedProjectID }
      : {}),
  }
}

function isDeltaMethod(method: AgentNotification["method"]): boolean {
  return method === "item/agentMessage/delta"
    || method === "reasoning/textDelta"
    || method === "reasoning/summaryPartAdded"
    || method === "reasoning/summaryTextDelta"
    || method === "plan/delta"
    || method === "tool/outputDelta"
    || method === "tool/error"
}

function upsert<T extends { id: string }>(items: readonly T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}

function upsertProjection(
  projections: readonly SubagentProjection[],
  projection: SubagentProjection,
): SubagentProjection[] {
  const index = projections.findIndex((candidate) => candidate.task.id === projection.task.id)
  if (index < 0) return [...projections, projection]
  const next = [...projections]
  next[index] = projection
  return next
}

function subagentProjectionFromParams(params: Record<string, unknown>): SubagentProjection | null {
  const task = params.task
  const run = params.run ?? record(task).currentRun
  if (!isSubagentTask(task)) return null
  const currentRun = isSubagentRun(run) ? run : null
  return {
    task: { ...task, currentRun },
    currentRun,
  }
}

function compareCreated(
  left: { id: string; createdAt: number },
  right: { id: string; createdAt: number },
): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function answerText(value: unknown): string | null {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return null
  return JSON.stringify(value)
}

function riskValue(value: unknown): ApprovalRequest["risk"] {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : "low"
}

function agentStatusValue(value: unknown): AgentExecution["status"] {
  const normalized = typeof value === "string" ? value.replaceAll("_", "-") : "queued"
  return normalized === "running"
    || normalized === "waiting-question"
    || normalized === "waiting-permission"
    || normalized === "completed"
    || normalized === "failed"
    || normalized === "interrupted"
    || normalized === "cancelled"
    ? normalized
    : "queued"
}

function turnStatusValue(value: unknown): Turn["status"] | null {
  const normalized = typeof value === "string" ? value.replaceAll("_", "-") : ""
  return normalized === "queued"
    || normalized === "running"
    || normalized === "waiting-permission"
    || normalized === "waiting-question"
    || normalized === "completed"
    || normalized === "failed"
    || normalized === "stopped"
    || normalized === "interrupted"
    || normalized === "cancelled"
    ? normalized
    : null
}

function isThreadSnapshot(value: Record<string, unknown>): value is unknown & ThreadSnapshot {
  return typeof record(value.thread).id === "string"
    && Array.isArray(value.turns)
    && Array.isArray(value.agents)
    && Array.isArray(value.subagents)
    && Array.isArray(value.items)
    && Array.isArray(value.approvals)
}

function isSubagentWorkspace(value: unknown): value is SubagentTask["workspace"] {
  const source = record(value)
  return (source.mode === "shared" || source.mode === "worktree")
    && (source.state === "ready"
      || source.state === "preparing"
      || source.state === "conflict"
      || source.state === "applied"
      || source.state === "discarded")
    && (typeof source.rootPath === "string" || source.rootPath === null)
    && (typeof source.baselineRef === "string" || source.baselineRef === null)
}

function isThreadSettings(value: unknown): value is ThreadSettings {
  const source = record(value)
  return (source.taskMode === "chat" || source.taskMode === "plan")
    && isPermissionConfig(source.permissionConfig)
}

function isPermissionConfig(value: unknown): value is Input["permissionConfig"] {
  const source = record(value)
  if (!(source.sandboxMode === "read-only" || source.sandboxMode === "workspace-write" || source.sandboxMode === "danger-full-access")) return false
  if (!(source.approvalsReviewer === "user" || source.approvalsReviewer === "auto_review")) return false
  try { decodeApprovalPolicy(source.approvalPolicy); return true } catch { return false }
}

function isModelRef(value: unknown): value is Input["model"] {
  const source = record(value)
  return typeof source.providerID === "string" && typeof source.id === "string"
}

function isItemType(value: string | undefined): value is Item["type"] {
  return value === "text"
    || value === "reasoning"
    || value === "activity"
    || value === "tool"
    || value === "plan"
    || value === "execution-plan"
    || value === "question"
    || value === "patch"
    || value === "subagent"
}

function isSubagentTask(value: unknown): value is SubagentTask {
  const source = record(value)
  return typeof source.id === "string"
    && typeof source.parentThreadId === "string"
    && typeof source.parentTurnId === "string"
    && typeof source.parentAgentId === "string"
    && typeof source.childThreadId === "string"
    && typeof source.displayName === "string"
    && typeof source.task === "string"
    && typeof source.createdAt === "number"
    && typeof source.updatedAt === "number"
}

function isSubagentRun(value: unknown): value is SubagentRun {
  const source = record(value)
  return typeof source.id === "string"
    && typeof source.taskId === "string"
    && typeof source.generation === "number"
    && typeof source.status === "string"
    && typeof source.createdAt === "number"
    && typeof source.updatedAt === "number"
}

function isShellReview(value: unknown): value is NonNullable<ApprovalRequest["review"]> {
  const source = record(value)
  return (source.decision === "allow" || source.decision === "ask" || source.decision === "deny")
    && (source.risk === "low" || source.risk === "medium" || source.risk === "high" || source.risk === "critical")
    && (source.confidence === "low" || source.confidence === "medium" || source.confidence === "high")
    && Array.isArray(source.categories)
    && typeof source.requestedScopeValid === "boolean"
    && typeof source.reason === "string"
}
