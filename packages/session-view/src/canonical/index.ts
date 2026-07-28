import type {
  AgentExecution,
  ApprovalRequest,
  Attachment,
  Input,
  Item,
  Message,
  QuestionChoice,
  SubagentProjection,
  Thread,
  ThreadSnapshot,
  Turn,
} from "@codepilotx/shared/thread"

/** Structural subset of agent-protocol's EventEnvelope consumed by the reducer. */
export type ThreadEventEnvelopeLike = {
  eventId: string
  streamId: string
  type: string
  threadId?: string
  turnId?: string
  occurredAt: number
  payload: any
} & (
  | { durability: "durable"; sequence: number; afterSequence?: never }
  | { durability: "live"; sequence: null; afterSequence: number }
)

export interface ThreadStreamPosition {
  streamId: string
  sequence: number
}

export interface ThreadTurnBundle {
  turn: Turn
  inputs: ReadonlyArray<Input>
  messages: ReadonlyArray<Message>
  agents: ReadonlyArray<AgentExecution>
  items: ReadonlyArray<Item>
  approvals: ReadonlyArray<ApprovalRequest>
  attachments?: ReadonlyArray<Attachment>
}

/**
 * Renderer-facing history page. This intentionally mirrors the protocol page
 * without importing its result type, so the projection package stays usable
 * while the RPC contract is introduced independently.
 */
export interface CanonicalThreadPage {
  thread: Thread
  subagents: ReadonlyArray<SubagentProjection>
  turns: ReadonlyArray<ThreadTurnBundle>
  queue?: {
    version: number
    pauseReason: "interrupted" | "turn_failed" | null
    turns: ReadonlyArray<Turn>
    inputs: ReadonlyArray<Input>
  }
  olderCursor: string | null
  hasOlder: boolean
  streamPosition: ThreadStreamPosition
}

export type ThreadHistoryPageLike = CanonicalThreadPage

export interface CanonicalQueueState {
  version: number
  pauseReason: "interrupted" | "turn_failed" | null
  turnIds: string[]
  inputIds: string[]
}

export interface CanonicalThreadState {
  thread: Thread
  turnOrder: string[]
  turnsById: Map<string, Turn>
  inputsById: Map<string, Input>
  messagesById: Map<string, Message>
  agentsById: Map<string, AgentExecution>
  itemsById: Map<string, Item>
  approvalsById: Map<string, ApprovalRequest>
  attachmentsById: Map<string, Attachment>
  subagentsByTaskId: Map<string, SubagentProjection>
  queue: CanonicalQueueState
  history: {
    olderCursor: string | null
    hasOlder: boolean
    loadingOlder: boolean
    generation: number
  }
  stream: {
    streamId: string
    appliedSequence: number
    appliedEventIds: Set<string>
  }
}

export type ThreadConversationScope =
  | { type: "main" }
  | { type: "subagent"; runId: string }

export interface VisibleTurnEntry {
  id: string
  turn: Turn
  userInputs: Input[]
  agents: AgentExecution[]
  items: Item[]
  approvals: ApprovalRequest[]
  attachments: Attachment[]
}

export type RenderItem = Item

export type RenderContentBlock =
  | { kind: "assistant"; id: string; items: Array<Extract<Item, { type: "text" }>> }
  | { kind: "process"; id: string; items: RenderItem[] }
  | { kind: "plan"; id: string; item: Extract<Item, { type: "plan" }> }
  | { kind: "execution-plan"; id: string; item: Extract<Item, { type: "execution-plan" }> }
  | { kind: "patch"; id: string; item: Extract<Item, { type: "patch" }> }
  | { kind: "post"; id: string; item: RenderItem }

export type RenderBlocker =
  | { kind: "approval"; id: string; createdAt: number; approval: ApprovalRequest }
  | { kind: "question"; id: string; createdAt: number; question: Extract<Item, { type: "question" }> }

export interface RenderTurnEntry extends VisibleTurnEntry {
  userItems: Input[]
  processItems: RenderItem[]
  assistantResultItems: Array<Extract<Item, { type: "text" }>>
  postAssistantItems: RenderItem[]
  patchItems: Array<Extract<Item, { type: "patch" }>>
  planItem: Extract<Item, { type: "plan" }> | null
  executionPlanItems: Array<Extract<Item, { type: "execution-plan" }>>
  contentBlocks: RenderContentBlock[]
  blockers: RenderBlocker[]
  systemItems: RenderItem[]
}

export function pageFromThreadSnapshot(
  snapshot: ThreadSnapshot,
  streamPosition: ThreadStreamPosition = { streamId: "snapshot", sequence: 0 },
): CanonicalThreadPage {
  return {
    thread: snapshot.thread,
    subagents: [...snapshot.subagents],
    turns: snapshot.turns.map((turn) => ({
      turn,
      inputs: snapshot.inputs.filter((input) => input.turnId === turn.id),
      messages: snapshot.messages.filter((message) => message.turnId === turn.id),
      agents: snapshot.agents.filter((agent) => agent.turnId === turn.id),
      items: snapshot.items.filter((item) => item.turnId === turn.id),
      approvals: snapshot.approvals.filter((approval) => approval.turnId === turn.id),
      attachments: [],
    })),
    queue: snapshot.queue ? {
      version: snapshot.queue.version,
      pauseReason: snapshot.queue.pauseReason,
      turns: snapshot.turns.filter((turn) => turn.status === "queued"),
      inputs: snapshot.inputs.filter((input) => input.state === "queued"),
    } : undefined,
    olderCursor: null,
    hasOlder: false,
    streamPosition,
  }
}

export function createCanonicalThreadState(page: CanonicalThreadPage): CanonicalThreadState {
  return hydrateLatestThreadPage(emptyState(page.thread), page)
}

export function hydrateLatestThreadPage(
  _state: CanonicalThreadState,
  page: CanonicalThreadPage,
): CanonicalThreadState {
  const next = emptyState(page.thread)
  mergePageEntities(next, page, "replace")
  next.subagentsByTaskId = mapBy(page.subagents, (projection) => projection.task.id)
  next.history = {
    olderCursor: page.olderCursor,
    hasOlder: page.hasOlder,
    loadingOlder: false,
    generation: _state.history.generation + 1,
  }
  next.stream = {
    streamId: page.streamPosition.streamId,
    appliedSequence: page.streamPosition.sequence,
    appliedEventIds: new Set(),
  }
  return next
}

export function prependOlderThreadPage(
  state: CanonicalThreadState,
  page: CanonicalThreadPage,
): CanonicalThreadState {
  if (page.thread.id !== state.thread.id) return state
  const next = cloneState(state)
  mergePageEntities(next, page, "prepend")
  for (const projection of page.subagents) {
    next.subagentsByTaskId.set(projection.task.id, projection)
  }
  next.history = {
    ...next.history,
    olderCursor: page.olderCursor,
    hasOlder: page.hasOlder,
    loadingOlder: false,
  }
  // An older page must never move the live stream cursor backwards.
  if (page.streamPosition.streamId === next.stream.streamId) {
    next.stream.appliedSequence = Math.max(next.stream.appliedSequence, page.streamPosition.sequence)
  }
  return next
}

export function applyThreadEnvelope(
  state: CanonicalThreadState,
  envelope: ThreadEventEnvelopeLike,
): CanonicalThreadState {
  return applyThreadEnvelopes(state, [envelope])
}

export function applyThreadEnvelopes(
  state: CanonicalThreadState,
  envelopes: readonly ThreadEventEnvelopeLike[],
): CanonicalThreadState {
  let next: CanonicalThreadState | null = null

  for (const envelope of envelopes) {
    const current = next ?? state
    if (envelope.threadId && envelope.threadId !== current.thread.id) continue
    if (envelope.streamId !== current.stream.streamId) continue
    if (envelope.durability === "durable" && envelope.sequence <= current.stream.appliedSequence) continue
    if (envelope.durability === "live") {
      if (envelope.afterSequence < current.stream.appliedSequence) continue
      if (current.stream.appliedEventIds.has(envelope.eventId)) continue
    }

    next ??= cloneState(state)
    if (envelope.durability === "durable") {
      next.stream.appliedSequence = envelope.sequence
    } else {
      rememberLiveEvent(next.stream.appliedEventIds, envelope.eventId)
    }
    applyEnvelopePayload(next, envelope)
  }

  return next ?? state
}

export function selectVisibleTurnEntries(
  state: CanonicalThreadState,
  scope: ThreadConversationScope = { type: "main" },
): VisibleTurnEntry[] {
  const runAgentIds = scope.type === "subagent"
    ? new Set([...state.agentsById.values()]
        .filter((agent) => agent.subagentRunId === scope.runId)
        .map((agent) => agent.id))
    : null

  const entries: VisibleTurnEntry[] = []
  for (const turnId of state.turnOrder) {
    const turn = state.turnsById.get(turnId)
    if (!turn || state.queue.turnIds.includes(turnId)) continue
    const agents = sortedValues(state.agentsById, (agent) => agent.turnId === turnId && (!runAgentIds || runAgentIds.has(agent.id)))
    const agentIds = new Set(agents.map((agent) => agent.id))
    const items = sortedValues(state.itemsById, (item) => item.turnId === turnId && (!runAgentIds || agentIds.has(item.agentId))).sort(compareOrdinal)
    const approvals = sortedValues(state.approvalsById, (approval) => approval.turnId === turnId && (!runAgentIds || agentIds.has(approval.agentId)))
    const attachmentIds = new Set(
      sortedValues(state.inputsById, (input) => input.turnId === turnId)
        .flatMap((input) => input.attachmentIds ?? []),
    )
    if (runAgentIds && agents.length === 0 && items.length === 0 && approvals.length === 0) continue
    entries.push({
      id: turn.id,
      turn,
      userInputs: sortedValues(state.inputsById, (input) => input.turnId === turnId),
      agents,
      items,
      approvals,
      attachments: [...attachmentIds]
        .map((attachmentId) => state.attachmentsById.get(attachmentId))
        .filter((attachment): attachment is Attachment => attachment !== undefined),
    })
  }
  return entries
}

export function selectRenderTurnEntries(
  state: CanonicalThreadState,
  scope: ThreadConversationScope = { type: "main" },
): RenderTurnEntry[] {
  return selectVisibleTurnEntries(state, scope).map((entry) => {
    const processItems: Item[] = []
    const assistantResultItems: Array<Extract<Item, { type: "text" }>> = []
    const postAssistantItems: Item[] = []
    const patchItems: Array<Extract<Item, { type: "patch" }>> = []
    const executionPlanItems: Array<Extract<Item, { type: "execution-plan" }>> = []
    const contentBlocks: RenderContentBlock[] = []
    let planItem: Extract<Item, { type: "plan" }> | null = null
    const lastProcessItemIndex = findLastProcessItemIndex(entry.items)
    const assistantResultIndex = findAssistantResultIndex(entry.items, lastProcessItemIndex)

    for (const [itemIndex, item] of entry.items.entries()) {
      if (item.type === "text") {
        if (!item.text.trim()) continue
        if (itemIndex === assistantResultIndex) {
          assistantResultItems.push(item)
          const previous = contentBlocks.at(-1)
          if (previous?.kind === "assistant") previous.items.push(item)
          else contentBlocks.push({ kind: "assistant", id: `assistant:${item.id}`, items: [item] })
        } else {
          processItems.push(item)
          appendProcessBlock(contentBlocks, item)
        }
      } else if (item.type === "patch") {
        patchItems.push(item)
        contentBlocks.push({ kind: "patch", id: `patch:${item.id}`, item })
      } else if (item.type === "plan") {
        planItem = item
        contentBlocks.push({ kind: "plan", id: `plan:${item.id}`, item })
      } else if (item.type === "execution-plan") {
        executionPlanItems.push(item)
        contentBlocks.push({ kind: "execution-plan", id: `execution-plan:${item.id}`, item })
      } else if (item.type === "question" && item.status !== "pending") {
        postAssistantItems.push(item)
        contentBlocks.push({ kind: "post", id: `post:${item.id}`, item })
      } else if (item.type !== "question") {
        processItems.push(item)
        appendProcessBlock(contentBlocks, item)
      }
    }

    const blockers: RenderBlocker[] = [
      ...entry.approvals
        .filter((approval) => approval.status === "pending")
        .map((approval): RenderBlocker => ({ kind: "approval", id: `approval:${approval.id}`, createdAt: approval.createdAt, approval })),
      ...entry.items
        .filter((item): item is Extract<Item, { type: "question" }> => item.type === "question" && item.status === "pending")
        .map((question): RenderBlocker => ({ kind: "question", id: `question:${question.id}`, createdAt: question.createdAt, question })),
    ].sort(compareCreated)

    return {
      ...entry,
      userItems: entry.userInputs,
      processItems,
      assistantResultItems,
      postAssistantItems,
      patchItems,
      planItem,
      executionPlanItems,
      contentBlocks,
      blockers,
      systemItems: [],
    }
  })
}

function findLastProcessItemIndex(items: readonly Item[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (item.type === "text") {
      if (item.placement === "process" && item.text.trim()) return index
      continue
    }
    if (
      item.type !== "patch"
      && item.type !== "plan"
      && item.type !== "execution-plan"
      && item.type !== "question"
    ) {
      return index
    }
  }
  return -1
}

function findAssistantResultIndex(items: readonly Item[], lastProcessItemIndex: number): number {
  for (let index = items.length - 1; index > lastProcessItemIndex; index -= 1) {
    const item = items[index]
    if (
      item?.type === "text"
      && item.placement === "result"
      && item.text.trim()
    ) {
      return index
    }
  }
  return -1
}

function appendProcessBlock(blocks: RenderContentBlock[], item: RenderItem): void {
  const previous = blocks.at(-1)
  if (previous?.kind === "process") previous.items.push(item)
  else blocks.push({ kind: "process", id: `process:${item.id}`, items: [item] })
}

function applyEnvelopePayload(state: CanonicalThreadState, envelope: ThreadEventEnvelopeLike): void {
  const payload = envelope.payload
  switch (envelope.type) {
    case "thread/created":
    case "thread/updated":
      state.thread = payload.thread
      return
    case "thread/settings/updated":
      state.thread = { ...state.thread, settings: payload.settings }
      return
    case "turn/queued":
      upsertTurn(state, payload.turn)
      state.inputsById.set(payload.input.id, payload.input)
      if (!state.queue.turnIds.includes(payload.turn.id)) state.queue.turnIds.push(payload.turn.id)
      return
    case "turn/started":
      upsertTurn(state, payload.turn)
      state.inputsById.set(payload.input.id, payload.input)
      state.queue.turnIds = state.queue.turnIds.filter((id) => id !== payload.turn.id)
      return
    case "turn/completed":
    case "turn/failed":
    case "turn/interrupted":
      upsertTurn(state, payload.turn)
      state.queue.turnIds = state.queue.turnIds.filter((id) => id !== payload.turn.id)
      return
    case "turn/statusChanged": {
      const turn = state.turnsById.get(payload.turnId)
      if (turn) state.turnsById.set(turn.id, { ...turn, status: payload.status })
      return
    }
    case "agent/upserted":
      state.agentsById.set(payload.agent.id, payload.agent)
      return
    case "subagent/created":
    case "subagent/updated":
    case "subagent/workspaceUpdated":
      state.subagentsByTaskId.set(payload.projection.task.id, payload.projection)
      reconcileSubagentItems(state, payload.projection)
      return
    case "item/started":
    case "item/completed":
      state.itemsById.set(payload.item.id, payload.item)
      return
    case "item/agentMessage/delta":
      appendItemDelta(state, payload.itemId, payload.delta, "text", payload, envelope.occurredAt)
      return
    case "reasoning/textDelta":
    case "reasoning/summaryTextDelta":
      appendItemDelta(state, payload.itemId, payload.delta, "reasoning", payload, envelope.occurredAt)
      return
    case "reasoning/summaryPartAdded":
      return
    case "plan/delta":
      appendItemDelta(state, payload.itemId, payload.delta, "plan", payload, envelope.occurredAt)
      return
    case "turn/plan/updated":
      state.itemsById.set(payload.item.id, payload.item)
      return
    case "tool/callStarted":
    case "tool/callCompleted":
    case "tool/error":
      state.itemsById.set(payload.item.id, payload.item)
      return
    case "tool/outputDelta":
      appendItemDelta(state, payload.itemId, payload.delta, "tool", payload, envelope.occurredAt)
      return
    case "approval/requested":
      state.approvalsById.set(payload.interactionId, approvalFromPayload(payload))
      return
    case "approval/cancelled": {
      const approval = state.approvalsById.get(payload.interactionId)
      if (approval) state.approvalsById.set(approval.id, { ...approval, status: "cancelled" })
      return
    }
    case "question/requested":
      for (const item of questionsFromPayload(payload)) state.itemsById.set(item.id, item)
      return
    case "interaction/resolved":
      // The v4 event deliberately carries only the safe response payload. It does
      // not contain an interaction identifier, so the canonical snapshot remains
      // the source of truth for the resolved item during reconciliation.
      return
    case "queue/updated":
      applyQueueUpdate(state, payload)
      return
    default:
      return
  }
}

function appendItemDelta(
  state: CanonicalThreadState,
  itemId: string,
  delta: string,
  kind: "text" | "reasoning" | "plan" | "tool",
  identity: { turnId: string; agentId: string },
  occurredAt: number,
): void {
  const existing = state.itemsById.get(itemId)
  if (!existing) {
    const base = { id: itemId, messageID: itemId, turnId: identity.turnId, agentId: identity.agentId, createdAt: occurredAt }
    if (kind === "text") state.itemsById.set(itemId, { ...base, type: "text", placement: "result", text: delta, status: "streaming" })
    else if (kind === "reasoning") state.itemsById.set(itemId, { ...base, type: "reasoning", text: delta, status: "streaming" })
    else if (kind === "plan") state.itemsById.set(itemId, { ...base, type: "plan", title: "计划", markdown: delta, status: "streaming" })
    return
  }
  if ((existing.type === "text" || existing.type === "reasoning") && existing.status !== "streaming") return
  if (existing.type === "tool" && existing.state !== "running") return
  if (existing.type === "plan" && existing.status !== "streaming") return
  if (kind === "text" && existing.type === "text") state.itemsById.set(itemId, { ...existing, text: existing.text + delta, status: "streaming" })
  else if (kind === "reasoning" && existing.type === "reasoning") state.itemsById.set(itemId, { ...existing, text: existing.text + delta, status: "streaming" })
  else if (kind === "plan" && existing.type === "plan") state.itemsById.set(itemId, { ...existing, markdown: existing.markdown + delta, status: "streaming" })
  else if (kind === "tool" && existing.type === "tool") state.itemsById.set(itemId, { ...existing, output: (existing.output ?? "") + delta, state: "running" })
}

function approvalFromPayload(payload: {
  interactionId: string
  threadId: string
  turnId: string
  agentId: string
  toolCallId: string
  tool: string
  command?: string
  cwd?: string
  affectedPaths?: readonly { path: string; operation: "create" | "update" }[]
  reviewSummary?: {
    fileCount: number
    hunkCount: number
    additions: number
    deletions: number
  }
  requestedPermissions: ApprovalRequest["requestedPermissions"]
  risk: ApprovalRequest["risk"]
  reason: string
  createdAt: number
}): ApprovalRequest {
  const affectedPaths = payload.affectedPaths === undefined
    ? undefined
    : payload.affectedPaths.map((affected) => ({ ...affected }))
  return {
    id: payload.interactionId,
    threadId: payload.threadId,
    turnId: payload.turnId,
    agentId: payload.agentId,
    toolCallID: payload.toolCallId,
    tool: payload.tool,
    command: payload.command ?? null,
    cwd: payload.cwd ?? null,
    paths: affectedPaths
      ? affectedPaths.map(({ path }) => path)
      : [...(payload.requestedPermissions.writePaths ?? []), ...(payload.requestedPermissions.readPaths ?? [])],
    ...(affectedPaths ? { affectedPaths } : {}),
    ...(payload.reviewSummary ? { reviewSummary: { ...payload.reviewSummary } } : {}),
    requestedPermissions: payload.requestedPermissions,
    review: null,
    risk: payload.risk,
    reason: payload.reason,
    status: "pending",
    createdAt: payload.createdAt,
  }
}

function questionsFromPayload(payload: {
  interactionId: string
  turnId: string
  agentId: string
  questions: Array<{ id: string; prompt: string; choices: readonly QuestionChoice[] }>
  createdAt: number
}): Array<Extract<Item, { type: "question" }>> {
  return payload.questions.map((question, index) => ({
    id: payload.questions.length === 1 ? payload.interactionId : `${payload.interactionId}:${question.id}`,
    messageID: payload.interactionId,
    turnId: payload.turnId,
    agentId: payload.agentId,
    type: "question",
    prompt: question.prompt,
    choices: [...question.choices],
    status: "pending",
    answer: null,
    createdAt: payload.createdAt + index,
  }))
}

function applyQueueUpdate(state: CanonicalThreadState, payload: {
  turns?: readonly Turn[]
  inputs?: readonly Input[]
  version?: number
  pauseReason?: "interrupted" | "turn_failed" | null
}): void {
  if (payload.turns) {
    state.queue.turnIds = payload.turns.map((turn) => turn.id)
    for (const turn of payload.turns) upsertTurn(state, turn)
  }
  if (payload.inputs) {
    state.queue.inputIds = payload.inputs.map((input) => input.id)
    for (const input of payload.inputs) state.inputsById.set(input.id, input)
  }
  if (payload.version !== undefined) state.queue.version = payload.version
  if (payload.pauseReason !== undefined) state.queue.pauseReason = payload.pauseReason
}

function reconcileSubagentItems(state: CanonicalThreadState, projection: SubagentProjection): void {
  for (const [id, item] of state.itemsById) {
    if (item.type !== "subagent" || item.subagentTaskId !== projection.task.id) continue
    const run = projection.currentRun
    state.itemsById.set(id, {
      ...item,
      runId: run?.id ?? item.runId,
      childThreadId: projection.task.childThreadId,
      displayName: projection.task.displayName,
      profile: projection.task.profile,
      task: projection.task.task,
      status: run?.status ?? item.status,
      queueReason: run?.queueReason ?? item.queueReason,
      result: run?.result ?? item.result,
    })
  }
}

function mergePageEntities(state: CanonicalThreadState, page: CanonicalThreadPage, mode: "replace" | "prepend"): void {
  const pageTurnIds: string[] = []
  for (const bundle of page.turns) {
    pageTurnIds.push(bundle.turn.id)
    state.turnsById.set(bundle.turn.id, bundle.turn)
    for (const input of bundle.inputs) state.inputsById.set(input.id, input)
    for (const message of bundle.messages) state.messagesById.set(message.id, message)
    for (const agent of bundle.agents) state.agentsById.set(agent.id, agent)
    for (const item of bundle.items) state.itemsById.set(item.id, item)
    for (const approval of bundle.approvals) state.approvalsById.set(approval.id, approval)
    for (const attachment of bundle.attachments ?? []) state.attachmentsById.set(attachment.id, attachment)
  }
  state.turnOrder = mode === "replace"
    ? unique(pageTurnIds)
    : unique([...pageTurnIds, ...state.turnOrder])
  if (page.queue) {
    state.queue = {
      version: page.queue.version,
      pauseReason: page.queue.pauseReason,
      turnIds: page.queue.turns.map((turn) => turn.id),
      inputIds: page.queue.inputs.map((input) => input.id),
    }
    for (const turn of page.queue.turns) state.turnsById.set(turn.id, turn)
    for (const input of page.queue.inputs) state.inputsById.set(input.id, input)
  }
}

function upsertTurn(state: CanonicalThreadState, turn: Turn): void {
  state.turnsById.set(turn.id, turn)
  if (!state.turnOrder.includes(turn.id)) state.turnOrder.push(turn.id)
}

function emptyState(thread: Thread): CanonicalThreadState {
  return {
    thread,
    turnOrder: [],
    turnsById: new Map(),
    inputsById: new Map(),
    messagesById: new Map(),
    agentsById: new Map(),
    itemsById: new Map(),
    approvalsById: new Map(),
    attachmentsById: new Map(),
    subagentsByTaskId: new Map(),
    queue: { version: 0, pauseReason: null, turnIds: [], inputIds: [] },
    history: { olderCursor: null, hasOlder: false, loadingOlder: false, generation: 0 },
    stream: { streamId: "", appliedSequence: 0, appliedEventIds: new Set() },
  }
}

function cloneState(state: CanonicalThreadState): CanonicalThreadState {
  return {
    ...state,
    turnsById: new Map(state.turnsById),
    inputsById: new Map(state.inputsById),
    messagesById: new Map(state.messagesById),
    agentsById: new Map(state.agentsById),
    itemsById: new Map(state.itemsById),
    approvalsById: new Map(state.approvalsById),
    attachmentsById: new Map(state.attachmentsById),
    subagentsByTaskId: new Map(state.subagentsByTaskId),
    queue: { ...state.queue, turnIds: [...state.queue.turnIds], inputIds: [...state.queue.inputIds] },
    history: { ...state.history },
    stream: { ...state.stream, appliedEventIds: new Set(state.stream.appliedEventIds) },
  }
}

const MAX_RECENT_LIVE_EVENT_IDS = 2_048

function rememberLiveEvent(eventIds: Set<string>, eventId: string): void {
  eventIds.add(eventId)
  while (eventIds.size > MAX_RECENT_LIVE_EVENT_IDS) {
    const oldestEventId = eventIds.values().next().value
    if (oldestEventId === undefined) break
    eventIds.delete(oldestEventId)
  }
}

function mapBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T> {
  return new Map(values.map((value) => [key(value), value]))
}

function sortedValues<T extends { id: string; createdAt: number }>(map: Map<string, T>, predicate: (value: T) => boolean): T[] {
  return [...map.values()].filter(predicate).sort(compareCreated)
}

function compareCreated(left: { id: string; createdAt: number }, right: { id: string; createdAt: number }): number {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id)
}

function compareOrdinal(left: Item, right: Item): number {
  if (left.ordinal !== undefined && right.ordinal !== undefined && left.ordinal !== right.ordinal) {
    return left.ordinal - right.ordinal
  }
  return compareCreated(left, right)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
