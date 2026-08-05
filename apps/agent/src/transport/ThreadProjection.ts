import type {
  ApprovalRequest,
  AgentExecution,
  Attachment,
  Input,
  Item,
  Message,
  SubagentProjection,
  Thread,
  ThreadListItem,
  ThreadSnapshot,
  ThreadTurnBundle,
  Turn,
} from "@codepilotx/shared/thread"
import { decodeApprovalPolicy } from "@codepilotx/shared/thread"
import type { EventEnvelope, Item as StoredItem } from "../domain"
import type { AgentDatabase } from "../storage/database/AgentDatabase"
import { SubagentRepository } from "../subagent/SubagentRepository"

const parse = <T>(value: string): T => JSON.parse(value) as T

const turnStatus = (status: string): Turn["status"] => {
  if (status === "waiting_permission") return "waiting-permission"
  if (status === "waiting_question") return "waiting-question"
  if (status === "waiting_subagents") return "waiting-subagents"
  if (status === "interrupted") return "interrupted"
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "cancelled") return status
  return "stopped"
}

const inputState = (status: string): Input["state"] => {
  if (status === "queued") return "queued"
  if (status === "mailbox" || status === "consumed") return "merged"
  if (status === "cancelled") return "cancelled"
  if (status === "completed") return "completed"
  return "active"
}

const inputDelivery = (strategy: string | number | null | undefined): Input["delivery"] =>
  strategy === "guide" ? "steer" : strategy === "queue" ? "follow-up" : "start"

const asText = (value: unknown) => typeof value === "string" ? value : value == null ? null : JSON.stringify(value, null, 2)
const modelUsage = (value: unknown): Extract<Item, { type: "text" }>["usage"] => {
  if (!value || typeof value !== "object") return undefined
  const usage = value as Record<string, unknown>
  if (
    typeof usage.provider !== "string"
    || typeof usage.model !== "string"
    || typeof usage.contextWindow !== "number"
    || !Number.isFinite(usage.contextWindow)
  ) return undefined
  const token = (key: string) => {
    const current = usage[key]
    return typeof current === "number" && Number.isFinite(current)
      ? Math.max(0, Math.trunc(current))
      : 0
  }
  return {
    provider: usage.provider,
    model: usage.model,
    contextWindow: Math.max(1, Math.trunc(usage.contextWindow)),
    input: token("input"),
    output: token("output"),
    cacheRead: token("cacheRead"),
    cacheWrite: token("cacheWrite"),
    reasoning: token("reasoning"),
  }
}
const activityCommandStatus = (value: unknown): "success" | "running" | "error" | "interrupted" | undefined => value === "success" || value === "running" || value === "error" || value === "interrupted" ? value : undefined
const toolLeaf = (tool: string) => tool.toLowerCase().split(".").at(-1) ?? tool.toLowerCase()
const isFileMutationTool = (tool: string) => ["edit", "write", "apply_patch"].includes(toolLeaf(tool))
const activityCommands = (value: unknown): Extract<Item, { type: "activity" }>["commands"] => {
  if (!Array.isArray(value)) return undefined
  const commands = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const item = entry as Record<string, unknown>
    if (typeof item.command !== "string" || typeof item.output !== "string") return []
    const status = activityCommandStatus(item.status)
    return [{
      command: item.command,
      output: item.output,
      ...(status ? { status } : {}),
      ...(typeof item.truncated === "boolean" ? { truncated: item.truncated } : {}),
    }]
  })
  return commands.length ? commands : undefined
}

type ThreadRow = {
  id: string
  title: string
  project_id: string | null
  git_branch: string | null
  task_mode: Thread["settings"]["taskMode"]
  sandbox_mode: Thread["settings"]["permissionConfig"]["sandboxMode"]
  approval_policy: string
  approvals_reviewer: Thread["settings"]["permissionConfig"]["approvalsReviewer"]
  created_at: number
  updated_at: number
}

type HistoryCursor = { v: 1; createdAt: number; id: string }

const encodeHistoryCursor = (cursor: HistoryCursor) => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")

const decodeHistoryCursor = (value: string): HistoryCursor => {
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<HistoryCursor>
    if (cursor.v !== 1 || !Number.isSafeInteger(cursor.createdAt) || typeof cursor.id !== "string" || !cursor.id) throw new Error("invalid cursor")
    return cursor as HistoryCursor
  } catch {
    throw new InvalidThreadHistoryCursorError()
  }
}

export class InvalidThreadHistoryCursorError extends Error {
  constructor() {
    super("Turn 历史游标无效")
    this.name = "InvalidThreadHistoryCursorError"
  }
}

export type ThreadHistoryPage = {
  thread: Thread
  subagents: SubagentProjection[]
  turns: ThreadTurnBundle[]
  queue: {
    version: number
    pauseReason: "interrupted" | "turn_failed" | null
    turns: Turn[]
    inputs: Input[]
  }
  olderCursor: string | null
  hasOlder: boolean
}

export class ThreadProjection {
  private readonly subagents: SubagentRepository

  constructor(private readonly db: AgentDatabase) {
    this.subagents = new SubagentRepository(db)
  }

  private projectInput(row: Record<string, string | number | null>): Input {
    const attachmentIds = (this.db.sqlite.query(
      "SELECT id FROM input_attachments WHERE input_id = ? ORDER BY created_at, id",
    ).all(String(row.id)) as Array<{ id: string }>).map(({ id }) => id)
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      content: String(row.content),
      delivery: inputDelivery(row.strategy),
      mode: String(row.task_mode) as Input["mode"],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input["permissionConfig"]["sandboxMode"],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(row.approvals_reviewer) as Input["permissionConfig"]["approvalsReviewer"],
      },
      attachmentIds,
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }
  }

  private projectTurn(row: Record<string, string | number | null>, inputs: Input[], status = String(row.status)): Turn {
    const startedAt = row.started_at == null ? null : Number(row.started_at)
    const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      sourceInputID: inputs[0]?.id ?? "",
      status: turnStatus(status),
      mode: String(row.mode) as Turn["mode"],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Turn["permissionConfig"]["sandboxMode"],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(row.approvals_reviewer) as Turn["permissionConfig"]["approvalsReviewer"],
      },
      rootAgentId: String(row.root_agent_id),
      mergedInputIDs: inputs.slice(1).map((input) => input.id),
      queuePosition: row.queue_position == null ? null : Number(row.queue_position),
      startedAt,
      finishedAt,
      elapsedSeconds: startedAt == null ? 0 : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
      error: null,
    }
  }

  private lifecyclePayload(event: EventEnvelope, source: Record<string, unknown>): Record<string, unknown> | null {
    if (!event.method.startsWith("turn/") || !["turn/queued", "turn/started", "turn/completed", "turn/failed", "turn/interrupted"].includes(event.method)) return null
    const turnID = event.turnId ?? (typeof source.turnId === "string" ? source.turnId : null)
    if (!turnID) return null
    const turnRow = this.db.sqlite.query(`
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns WHERE id = ?
    `).get(turnID) as Record<string, string | number | null> | null
    if (!turnRow) return null
    const inputRows = this.db.sqlite.query(`
      SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy,
        approvals_reviewer, strategy, task_mode, status, created_at
      FROM inputs WHERE turn_id = ? ORDER BY created_at, id
    `).all(turnID) as Array<Record<string, string | number | null>>
    const inputs = inputRows.map((row) => this.projectInput(row))
    const eventStatus = event.method === "turn/queued"
      ? "queued"
      : event.method === "turn/started"
        ? "running"
        : event.method === "turn/completed"
          ? "completed"
          : event.method === "turn/failed"
            ? "failed"
            : "interrupted"
    const turn = this.projectTurn(turnRow, inputs, eventStatus)
    if (event.method === "turn/queued" || event.method === "turn/started") {
      const input = inputs[0]
      return input ? { turn, input } : null
    }
    if (event.method === "turn/failed") {
      const rawError = source.error && typeof source.error === "object" ? source.error as Record<string, unknown> : null
      return {
        turn,
        error: {
          code: typeof rawError?.code === "string" ? rawError.code : "TURN_FAILED",
          message: typeof rawError?.message === "string" ? rawError.message : typeof source.message === "string" ? source.message : "Agent turn failed",
          retryable: typeof rawError?.retryable === "boolean" ? rawError.retryable : false,
        },
      }
    }
    if (event.method === "turn/interrupted") {
      const checkpointVersion = typeof source.checkpointVersion === "number" ? source.checkpointVersion : undefined
      return {
        turn,
        reason: typeof source.reason === "string" && source.reason ? source.reason : "interrupted",
        recoveryAvailable: checkpointVersion !== undefined,
        ...(checkpointVersion === undefined ? {} : { checkpointVersion }),
      }
    }
    return { turn }
  }

  snapshot(threadId: string): ThreadSnapshot | null {
    const thread = this.db.sqlite.query("SELECT id, title, project_id, git_branch, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?").get(threadId) as
      | { id: string; title: string; project_id: string | null; git_branch: string | null; task_mode: ThreadSnapshot["thread"]["settings"]["taskMode"]; sandbox_mode: ThreadSnapshot["thread"]["settings"]["permissionConfig"]["sandboxMode"]; approval_policy: string; approvals_reviewer: ThreadSnapshot["thread"]["settings"]["permissionConfig"]["approvalsReviewer"]; created_at: number; updated_at: number }
      | null
    if (!thread) return null
    const threadWorkspace = this.db.threadWorkspace(threadId)
    const attachmentRows = this.db.sqlite.query("SELECT id, input_id FROM input_attachments WHERE thread_id = ? AND input_id IS NOT NULL ORDER BY created_at, id").all(threadId) as Array<{ id: string; input_id: string }>
    const attachmentIDsByInput = new Map<string, string[]>()
    for (const attachment of attachmentRows) attachmentIDsByInput.set(attachment.input_id, [...(attachmentIDsByInput.get(attachment.input_id) ?? []), attachment.id])
    const inputs = (this.db.sqlite.query("SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at FROM inputs WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row): Input => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      content: String(row.content),
      delivery: inputDelivery(row.strategy),
      mode: String(row.task_mode) as Input["mode"],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input["permissionConfig"]["sandboxMode"],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(row.approvals_reviewer) as Input["permissionConfig"]["approvalsReviewer"],
      },
      attachmentIds: attachmentIDsByInput.get(String(row.id)) ?? [],
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }))
    const turns = (this.db.sqlite.query("SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at FROM turns WHERE thread_id = ? ORDER BY CASE WHEN status = 'queued' THEN 1 ELSE 0 END, CASE WHEN status = 'queued' THEN queue_position END, created_at, id").all(threadId) as Array<Record<string, string | number | null>>).map((row): Turn => {
      const turnInputs = inputs.filter((input) => input.turnId === row.id)
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        sourceInputID: turnInputs[0]?.id ?? "",
        status: turnStatus(String(row.status)),
        mode: String(row.mode) as Turn["mode"],
        model: parse(String(row.model_ref)),
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as Turn["permissionConfig"]["sandboxMode"],
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: String(row.approvals_reviewer) as Turn["permissionConfig"]["approvalsReviewer"],
        },
        rootAgentId: String(row.root_agent_id),
        mergedInputIDs: turnInputs.slice(1).map((input) => input.id),
        queuePosition: row.queue_position == null ? null : Number(row.queue_position),
        startedAt,
        finishedAt,
        elapsedSeconds: startedAt == null ? 0 : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
        error: null,
      }
    })
    const agents = (this.db.sqlite.query("SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at FROM agent_executions WHERE thread_id = ? ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row): AgentExecution => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      parentAgentId: row.parent_agent_id == null ? null : String(row.parent_agent_id),
      profile: String(row.profile),
      task: String(row.task),
      model: parse(String(row.model_ref)),
      sessionId: String(row.session_id),
      depth: Number(row.depth),
      subagentRunId: row.subagent_run_id == null ? null : String(row.subagent_run_id),
      runSequence: Number(row.run_sequence ?? 0),
      status: String(row.status).replaceAll("_", "-") as AgentExecution["status"],
      error: row.error == null ? null : String(row.error),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
    const messages = (this.db.sqlite.query("SELECT id, thread_id, turn_id, role, created_at FROM messages WHERE thread_id = ? ORDER BY ordinal, created_at, id").all(threadId) as Array<Record<string, string | number | null>>).map((row): Message => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id ? String(row.turn_id) : null,
      role: String(row.role) as Message["role"],
      createdAt: Number(row.created_at),
    }))
    const items = (this.db.sqlite.query("SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE thread_id = ? ORDER BY ordinal, created_at, id").all(threadId) as Array<Record<string, string | number | null>>)
      .map((row) => this.item({
        id: String(row.id),
        turnID: String(row.turn_id),
        agentID: String(row.agent_id),
        type: String(row.type) as StoredItem["type"],
        status: String(row.status) as StoredItem["status"],
        data: parse(String(row.data)),
        ...(row.ordinal == null ? {} : { ordinal: Number(row.ordinal) }),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }))
      .filter((item): item is Item => item !== null)
    const approvals = (this.db.sqlite.query("SELECT id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, review_payload, created_at FROM approval_requests WHERE thread_id = ? AND status <> 'preparing' ORDER BY created_at").all(threadId) as Array<Record<string, string | number | null>>).map((row) => this.approval(row))
    return {
      thread: {
        id: thread.id,
        title: thread.title,
        projectID: thread.project_id,
        gitBranch: thread.git_branch,
        ...(threadWorkspace ? { workspace: threadWorkspace } : {}),
        settings: {
          taskMode: thread.task_mode,
          permissionConfig: {
            sandboxMode: thread.sandbox_mode,
            approvalPolicy: decodeApprovalPolicy(thread.approval_policy),
            approvalsReviewer: thread.approvals_reviewer,
          },
        },
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
      },
      turns,
      agents,
      subagents: this.subagents.projectionForThread(threadId),
      inputs,
      messages,
      items,
      approvals,
      queue: this.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null },
    }
  }

  historyPage(threadId: string, params: { before?: string; limit?: number } = {}): ThreadHistoryPage | null {
    const thread = this.db.sqlite.query("SELECT id, title, project_id, git_branch, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?").get(threadId) as ThreadRow | null
    if (!thread) return null
    const limit = Math.min(50, Math.max(1, params.limit ?? 10))
    const cursor = params.before ? decodeHistoryCursor(params.before) : null
    const turnRows = this.db.sqlite.query(`
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns
      WHERE thread_id = ? AND status <> 'queued'
        ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(...(cursor
      ? [threadId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1]
      : [threadId, limit + 1])) as Array<Record<string, string | number | null>>
    const hasOlder = turnRows.length > limit
    const selectedTurnRows = turnRows.slice(0, limit)
    const selectedTurnIDs = selectedTurnRows.map((row) => String(row.id))

    const queueTurnRows = this.db.sqlite.query(`
      SELECT id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy,
        approvals_reviewer, model_ref, queue_position, started_at, finished_at, created_at
      FROM turns
      WHERE thread_id = ? AND status = 'queued'
      ORDER BY queue_position, created_at, id
    `).all(threadId) as Array<Record<string, string | number | null>>
    const queueTurnIDs = queueTurnRows.map((row) => String(row.id))
    const allTurnIDs = [...selectedTurnIDs, ...queueTurnIDs]
    const placeholders = allTurnIDs.map(() => "?").join(",")

    const inputRows = allTurnIDs.length
      ? this.db.sqlite.query(`SELECT id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at FROM inputs WHERE turn_id IN (${placeholders}) ORDER BY created_at, id`).all(...allTurnIDs) as Array<Record<string, string | number | null>>
      : []
    const inputIDs = inputRows.map((row) => String(row.id))
    const inputPlaceholders = inputIDs.map(() => "?").join(",")
    const attachmentRows = inputIDs.length
      ? this.db.sqlite.query(`SELECT id, input_id, kind, name, media_type, size_bytes, sha256, created_at FROM input_attachments WHERE input_id IN (${inputPlaceholders}) ORDER BY created_at, id`).all(...inputIDs) as Array<Record<string, string | number | null>>
      : []
    const attachmentIDsByInput = new Map<string, string[]>()
    const attachmentsByInput = new Map<string, Attachment[]>()
    for (const row of attachmentRows) {
      const inputID = String(row.input_id)
      attachmentIDsByInput.set(inputID, [...(attachmentIDsByInput.get(inputID) ?? []), String(row.id)])
      attachmentsByInput.set(inputID, [...(attachmentsByInput.get(inputID) ?? []), {
        id: String(row.id),
        kind: String(row.kind) as Attachment["kind"],
        name: String(row.name),
        mediaType: String(row.media_type),
        sizeBytes: Number(row.size_bytes),
        sha256: String(row.sha256),
        createdAt: Number(row.created_at),
      }])
    }
    const inputs = inputRows.map((row): Input => ({
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: row.turn_id == null ? null : String(row.turn_id),
      content: String(row.content),
      delivery: inputDelivery(row.strategy),
      mode: String(row.task_mode) as Input["mode"],
      model: parse(String(row.model_ref)),
      permissionConfig: {
        sandboxMode: String(row.sandbox_mode) as Input["permissionConfig"]["sandboxMode"],
        approvalPolicy: decodeApprovalPolicy(row.approval_policy),
        approvalsReviewer: String(row.approvals_reviewer) as Input["permissionConfig"]["approvalsReviewer"],
      },
      attachmentIds: attachmentIDsByInput.get(String(row.id)) ?? [],
      state: inputState(String(row.status)),
      createdAt: Number(row.created_at),
    }))
    const inputsByTurn = new Map<string, Input[]>()
    for (const input of inputs) {
      if (!input.turnId) continue
      inputsByTurn.set(input.turnId, [...(inputsByTurn.get(input.turnId) ?? []), input])
    }
    const mapTurn = (row: Record<string, string | number | null>): Turn => {
      const turnInputs = inputsByTurn.get(String(row.id)) ?? []
      const startedAt = row.started_at == null ? null : Number(row.started_at)
      const finishedAt = row.finished_at == null ? null : Number(row.finished_at)
      return {
        id: String(row.id),
        threadId: String(row.thread_id),
        sourceInputID: turnInputs[0]?.id ?? "",
        status: turnStatus(String(row.status)),
        mode: String(row.mode) as Turn["mode"],
        model: parse(String(row.model_ref)),
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as Turn["permissionConfig"]["sandboxMode"],
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: String(row.approvals_reviewer) as Turn["permissionConfig"]["approvalsReviewer"],
        },
        rootAgentId: String(row.root_agent_id),
        mergedInputIDs: turnInputs.slice(1).map((input) => input.id),
        queuePosition: row.queue_position == null ? null : Number(row.queue_position),
        startedAt,
        finishedAt,
        elapsedSeconds: startedAt == null ? 0 : Math.max(0, Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000)),
        error: null,
      }
    }

    const selectedPlaceholders = selectedTurnIDs.map(() => "?").join(",")
    const agentRows = selectedTurnIDs.length
      ? this.db.sqlite.query(`SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, subagent_run_id, run_sequence, status, error, created_at, updated_at FROM agent_executions WHERE turn_id IN (${selectedPlaceholders}) ORDER BY created_at, id`).all(...selectedTurnIDs) as Array<Record<string, string | number | null>>
      : []
    const agents = agentRows.map((row): AgentExecution => ({
      id: String(row.id), threadId: String(row.thread_id), turnId: String(row.turn_id),
      parentAgentId: row.parent_agent_id == null ? null : String(row.parent_agent_id),
      profile: String(row.profile), task: String(row.task), model: parse(String(row.model_ref)), sessionId: String(row.session_id),
      depth: Number(row.depth), subagentRunId: row.subagent_run_id == null ? null : String(row.subagent_run_id),
      runSequence: Number(row.run_sequence ?? 0), status: String(row.status).replaceAll("_", "-") as AgentExecution["status"],
      error: row.error == null ? null : String(row.error), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }))
    const messageRows = selectedTurnIDs.length
      ? this.db.sqlite.query(`SELECT id, thread_id, turn_id, role, created_at FROM messages WHERE turn_id IN (${selectedPlaceholders}) ORDER BY ordinal, created_at, id`).all(...selectedTurnIDs) as Array<Record<string, string | number | null>>
      : []
    const messages = messageRows.map((row): Message => ({
      id: String(row.id), threadId: String(row.thread_id), turnId: row.turn_id == null ? null : String(row.turn_id),
      role: String(row.role) as Message["role"], createdAt: Number(row.created_at),
    }))
    const itemRows = selectedTurnIDs.length
      ? this.db.sqlite.query(`SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE turn_id IN (${selectedPlaceholders}) ORDER BY turn_id, ordinal, created_at, id`).all(...selectedTurnIDs) as Array<Record<string, string | number | null>>
      : []
    const items = itemRows.map((row) => this.item({
      id: String(row.id), turnID: String(row.turn_id), agentID: String(row.agent_id), type: String(row.type) as StoredItem["type"],
      status: String(row.status) as StoredItem["status"], data: parse(String(row.data)), ...(row.ordinal == null ? {} : { ordinal: Number(row.ordinal) }), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    })).filter((item): item is Item => item !== null)
    const approvalRows = selectedTurnIDs.length
      ? this.db.sqlite.query(`SELECT id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, reply, request_payload, review_payload, created_at FROM approval_requests WHERE turn_id IN (${selectedPlaceholders}) AND status <> 'preparing' ORDER BY created_at, id`).all(...selectedTurnIDs) as Array<Record<string, string | number | null>>
      : []
    const approvals = approvalRows.map((row) => this.approval(row))

    const bundles = selectedTurnRows.slice().reverse().map((row): ThreadTurnBundle => {
      const turnId = String(row.id)
      const turnInputs = inputsByTurn.get(turnId) ?? []
      return {
        turn: mapTurn(row),
        inputs: turnInputs,
        messages: messages.filter((message) => message.turnId === turnId),
        agents: agents.filter((agent) => agent.turnId === turnId),
        items: items.filter((item) => item.turnId === turnId),
        approvals: approvals.filter((approval) => approval.turnId === turnId),
        attachments: turnInputs.flatMap((input) => attachmentsByInput.get(input.id) ?? []),
      }
    })
    const workspace = this.db.threadWorkspace(threadId)
    const oldest = selectedTurnRows.at(-1)
    const queueMetadata = this.db.queueStateMeta(threadId) ?? { version: 0, pauseReason: null }
    return {
      thread: {
        id: thread.id, title: thread.title, projectID: thread.project_id, gitBranch: thread.git_branch, ...(workspace ? { workspace } : {}),
        settings: {
          taskMode: thread.task_mode,
          permissionConfig: { sandboxMode: thread.sandbox_mode, approvalPolicy: decodeApprovalPolicy(thread.approval_policy), approvalsReviewer: thread.approvals_reviewer },
        },
        createdAt: thread.created_at, updatedAt: thread.updated_at,
      },
      subagents: this.subagents.projectionForThread(threadId),
      turns: bundles,
      queue: { ...queueMetadata, turns: queueTurnRows.map(mapTurn), inputs: inputs.filter((input) => input.turnId != null && queueTurnIDs.includes(input.turnId)) },
      olderCursor: hasOlder && oldest ? encodeHistoryCursor({ v: 1, createdAt: Number(oldest.created_at), id: String(oldest.id) }) : null,
      hasOlder,
    }
  }

  list(params: { projectID?: string; archived?: boolean; limit?: number } = {}) {
    const where: string[] = [
      "t.kind = 'main'",
      "(t.archived_at IS NULL OR t.archived_at <> -1)",
      `NOT EXISTS (
        SELECT 1
        FROM thread_forks AS pending_fork
        JOIN thread_handoff_operations AS pending_handoff
          ON pending_handoff.operation_id = pending_fork.operation_id
        WHERE pending_fork.target_thread_id = t.id
          AND pending_handoff.status <> 'completed'
      )`,
    ]
    const values: Array<string | number | null> = []
    if (params.projectID !== undefined) {
      where.push("t.project_id = ?")
      values.push(params.projectID)
    }
    if (params.archived !== undefined) {
      where.push(params.archived ? "t.archived_at IS NOT NULL" : "t.archived_at IS NULL")
    }
    const sql = `
      SELECT t.id, t.project_id, t.git_branch, t.title, t.preview, t.first_user_message, t.message_count,
        t.archived_at, t.task_mode, t.sandbox_mode, t.approval_policy, t.approvals_reviewer, t.created_at, t.updated_at,
        read_state.unread_at,
        (SELECT status FROM turns AS u WHERE u.thread_id = t.id
          ORDER BY CASE WHEN u.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents') THEN 0 ELSE 1 END,
            u.created_at DESC LIMIT 1) AS latest_turn_status,
        EXISTS (
          SELECT 1
          FROM turns AS plan_turn
          WHERE plan_turn.thread_id = t.id
            AND plan_turn.status = 'completed'
            AND plan_turn.id = (
              SELECT u.id FROM turns AS u WHERE u.thread_id = t.id
              ORDER BY CASE WHEN u.status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents') THEN 0 ELSE 1 END,
                u.created_at DESC LIMIT 1
            )
            AND EXISTS (
              SELECT 1 FROM items AS plan_item
              WHERE plan_item.turn_id = plan_turn.id
                AND plan_item.type = 'plan'
                AND plan_item.status NOT IN ('pending', 'running', 'interrupted')
            )
        ) AS pending_plan_approval
      FROM threads AS t
      LEFT JOIN thread_read_state AS read_state ON read_state.thread_id = t.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ?
    `
    values.push(params.limit ?? 100)
    const rows = this.db.sqlite.query(sql).all(...values) as Array<Record<string, string | number | null>>
    return rows.map((row): ThreadListItem => {
      const id = String(row.id)
      const workspace = this.db.threadWorkspace(id)
      return {
      id,
      projectID: row.project_id == null ? null : String(row.project_id),
      gitBranch: row.git_branch == null ? null : String(row.git_branch),
      ...(workspace ? { workspace } : {}),
      title: String(row.title),
      preview: row.preview == null ? null : String(row.preview),
      firstUserMessage: row.first_user_message == null ? null : String(row.first_user_message),
      messageCount: Number(row.message_count ?? 0),
      latestTurnStatus: row.latest_turn_status == null ? null : turnStatus(String(row.latest_turn_status)),
      archivedAt: row.archived_at == null ? null : Number(row.archived_at),
      unreadAt: row.unread_at == null ? null : Number(row.unread_at),
      pendingPlanApproval: Number(row.pending_plan_approval) === 1,
      settings: {
        taskMode: String(row.task_mode) as ThreadListItem["settings"]["taskMode"],
        permissionConfig: {
          sandboxMode: String(row.sandbox_mode) as ThreadListItem["settings"]["permissionConfig"]["sandboxMode"],
          approvalPolicy: decodeApprovalPolicy(row.approval_policy),
          approvalsReviewer: String(row.approvals_reviewer) as ThreadListItem["settings"]["permissionConfig"]["approvalsReviewer"],
        },
      },
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }})
  }

  item(item: StoredItem): Item | null {
    const messageID = item.turnID
    const agentId = item.agentID
    const order = item.ordinal === undefined ? {} : { ordinal: item.ordinal }
    const status = item.status === "running" || item.status === "pending" ? "streaming" : item.status === "interrupted" ? "interrupted" : "completed"
    if (item.type === "reasoning") return { id: item.id, messageID, turnId: item.turnID, agentId, type: "reasoning", text: asText(item.data.text) ?? "", status, ...order, createdAt: item.createdAt }
    if (item.type === "text" || (item.type === "activity" && typeof item.data.text === "string")) {
      const usage = modelUsage(item.data.usage)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: "text",
        placement: item.data.placement === "process" ? "process" : "result",
        text: asText(item.data.text) ?? "",
        status,
        ...(usage ? { usage } : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === "activity") {
      const activity = ["context-compression", "file-edit", "build", "notice"].includes(String(item.data.activity)) ? item.data.activity as "context-compression" | "file-edit" | "build" | "notice" : "notice"
      const commands = activityCommands(item.data.commands)
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "activity", activity, title: asText(item.data.title) ?? "执行活动", ...(typeof item.data.detail === "string" ? { detail: item.data.detail } : {}), ...(commands ? { commands } : {}), status: item.status === "error" ? "error" : item.status === "interrupted" ? "interrupted" : item.status === "completed" ? "completed" : "running", ...order, createdAt: item.createdAt }
    }
    if (item.type === "tool") {
      const toolName = asText(item.data.tool ?? item.data.toolName) ?? "tool"
      const input = item.data.input ?? item.data.inputText ?? null
      const terminal = item.status === "completed" || item.status === "error" || item.status === "interrupted"
      const callID = asText(item.data.callID) ?? item.id
      const execution = item.status === "completed" && isFileMutationTool(toolName)
        ? this.db.getAgentExecution(item.agentID)
        : null
      const mutationDiffPaths = execution
        ? this.db.repositories.turnPatches.diffPathsForToolCall(execution.threadID, callID)
        : []
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "tool", callID, tool: toolName, title: asText(item.data.title) ?? `运行了 ${toolName}`, state: item.status === "pending" ? "pending" : item.status === "running" ? "running" : item.status === "error" ? "error" : item.status === "interrupted" ? "interrupted" : "completed", input, command: asText(item.data.command), output: asText(item.data.output), error: asText(item.data.error), startedAt: typeof item.data.startedAt === "number" ? item.data.startedAt : item.createdAt, finishedAt: typeof item.data.finishedAt === "number" ? item.data.finishedAt : terminal ? item.updatedAt : null, durationMs: typeof item.data.durationMs === "number" ? item.data.durationMs : terminal ? item.updatedAt - item.createdAt : null, ...(mutationDiffPaths.length ? { mutationDiffPaths } : {}), ...order, createdAt: item.createdAt }
    }
    if (item.type === "plan") return { id: item.id, messageID, turnId: item.turnID, agentId, type: "plan", title: asText(item.data.title) ?? "实施计划", markdown: asText(item.data.markdown ?? item.data.text) ?? "", status, ...order, createdAt: item.createdAt }
    if (item.type === "execution-plan") {
      const steps = Array.isArray(item.data.steps)
        ? item.data.steps.flatMap((raw) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
          const step = raw as Record<string, unknown>
          const text = asText(step.step)?.trim()
          const stepStatus = String(step.status)
          if (!text || !["pending", "in_progress", "completed"].includes(stepStatus)) return []
          return [{ step: text, status: stepStatus as "pending" | "in_progress" | "completed" }]
        })
        : []
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: "execution-plan",
        ...(typeof item.data.explanation === "string" ? { explanation: item.data.explanation } : {}),
        steps,
        status,
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === "question") {
      const options = Array.isArray(item.data.options) ? item.data.options.filter((value): value is string => typeof value === "string") : []
      return { id: item.id, messageID, turnId: item.turnID, agentId, type: "question", prompt: asText(item.data.question) ?? "需要你的选择", choices: options.map((label, index) => ({ id: String(index), label, recommended: index === 0 })), status: item.status === "pending" ? "pending" : item.status === "interrupted" ? "cancelled" : "answered", answer: asText(item.data.answer), ...order, createdAt: item.createdAt }
    }
    if (item.type === "patch") {
      const patchState = this.db.repositories.turnPatches.getByTurn(item.turnID)
      return {
        id: item.id,
        messageID,
        turnId: item.turnID,
        agentId,
        type: "patch",
        files: Array.isArray(item.data.files) ? item.data.files as Extract<Item, { type: "patch" }>["files"] : [],
        totalAdditions: Number(item.data.totalAdditions ?? item.data.additions ?? 0),
        totalDeletions: Number(item.data.totalDeletions ?? item.data.deletions ?? 0),
        ...(patchState
          ? patchState.evidenceComplete ? { reversible: true } : {}
          : item.data.reversible === true ? { reversible: true } : {}),
        ...(patchState
          ? { applyState: patchState.applyState }
          : item.data.applyState === "applied" || item.data.applyState === "undone"
            ? { applyState: item.data.applyState }
            : {}),
        ...(patchState
          ? { actionVersion: patchState.actionVersion }
          : typeof item.data.actionVersion === "number"
            ? { actionVersion: item.data.actionVersion }
            : {}),
        ...order,
        createdAt: item.createdAt,
      }
    }
    if (item.type === "subagent") {
      const rawStatus = String(item.data.status).replaceAll("_", "-")
      const subagentStatus = ["queued", "preparing", "running", "steering", "waiting-question", "waiting-permission", "completed", "failed", "stopped", "interrupted"].includes(rawStatus)
        ? rawStatus as Extract<Item, { type: "subagent" }>["status"]
        : "interrupted"
      const rawQueueReason = item.data.queueReason == null ? null : String(item.data.queueReason).replaceAll("_", "-")
      const queueReason = rawQueueReason === "parent-limit" || rawQueueReason === "global-limit" || rawQueueReason === "workspace-writer" ? rawQueueReason : null
      return {
        id: item.id, messageID, turnId: item.turnID, agentId, type: "subagent",
        subagentTaskId: String(item.data.subagentTaskId), runId: String(item.data.runId), childThreadId: String(item.data.childThreadId),
        displayName: String(item.data.displayName), profile: String(item.data.profile) as Extract<Item, { type: "subagent" }>["profile"],
        task: String(item.data.task), status: subagentStatus, queueReason,
        result: item.data.result && typeof item.data.result === "object" ? item.data.result as Extract<Item, { type: "subagent" }>["result"] : null,
        ...order, createdAt: item.createdAt,
      }
    }
    return null
  }

  approval(row: Record<string, string | number | null>): ApprovalRequest {
    const tool = this.db.sqlite.query("SELECT tool_name, input FROM tool_calls WHERE id = ?").get(String(row.tool_call_id)) as { tool_name: string; input: string } | null
    const input = tool ? parse<Record<string, unknown>>(tool.input) : {}
    const request = typeof row.request_payload === "string" ? parse<Record<string, unknown>>(row.request_payload) : {}
    const requestKind = request.kind
    const rawPermissions = request.requestedPermissions
    const permissions = rawPermissions && typeof rawPermissions === "object" && !Array.isArray(rawPermissions) ? rawPermissions as Record<string, unknown> : {}
    const list = (name: string) => Array.isArray(permissions[name]) ? permissions[name].filter((value): value is string => typeof value === "string") : []
    // 动态权限请求把读路径、写路径和网络域名纳入可展示范围；普通审批保持原状。
    const paths = requestKind === "permission"
      ? [...list("readPaths"), ...list("writePaths"), ...list("networkDomains")]
      : [input.path, input.cwd].filter((value): value is string => typeof value === "string")
    const command = typeof input.command === "string" ? input.command : null
    const rawRequestedScope = request.requestedScope
    const rawAllowedScopes = request.allowedScopes
    const permissionGrant = requestKind === "permission"
      && (rawRequestedScope === "tool-call" || rawRequestedScope === "turn" || rawRequestedScope === "session")
      && Array.isArray(rawAllowedScopes)
      && rawAllowedScopes.length > 0
      && rawAllowedScopes.every((scope) => scope === "tool-call" || scope === "turn" || scope === "session")
      ? {
          requestedScope: rawRequestedScope as "tool-call" | "turn" | "session",
          allowedScopes: rawAllowedScopes as Array<"tool-call" | "turn" | "session">,
        }
      : undefined
    const review = typeof row.review_payload === "string" ? parse<ApprovalRequest["review"]>(row.review_payload) : null
    return {
      id: String(row.id),
      threadId: String(row.thread_id),
      turnId: String(row.turn_id),
      agentId: String(row.agent_id),
      toolCallID: String(row.tool_call_id),
      tool: tool?.tool_name ?? "tool",
      command,
      cwd: typeof input.cwd === "string" ? input.cwd : null,
      paths,
      requestedPermissions: {
        readPaths: list("readPaths"),
        writePaths: list("writePaths"),
        networkDomains: list("networkDomains"),
      },
      review,
      risk: String(row.risk) as ApprovalRequest["risk"],
      reason: String(row.reason),
      status: row.status === "pending" ? "pending" : row.status === "cancelled" ? "cancelled" : row.reply === "allow" ? "allowed" : "denied",
      createdAt: Number(row.created_at),
      ...(permissionGrant ? { permissionGrant } : {}),
    }
  }

  notification(event: EventEnvelope) {
    const source = event.params && typeof event.params === "object"
      ? event.params as Record<string, unknown>
      : {}
    const storedItem = source.item && typeof source.item === "object"
      ? source.item as Partial<StoredItem>
      : null
    const item = storedItem
      && typeof storedItem.id === "string"
      && typeof storedItem.turnID === "string"
      && typeof storedItem.agentID === "string"
      && typeof storedItem.type === "string"
      && typeof storedItem.status === "string"
      && storedItem.data
      && typeof storedItem.data === "object"
      && typeof storedItem.createdAt === "number"
      && typeof storedItem.updatedAt === "number"
      ? this.item(storedItem as StoredItem)
      : source.item
    const lifecyclePayload = this.lifecyclePayload(event, source)
    const params = {
      ...(lifecyclePayload ?? source),
      ...(event.threadId === null ? {} : { threadId: event.threadId }),
      ...(event.turnId === null ? {} : { turnId: event.turnId }),
      ...(item === undefined ? {} : { item }),
    }
    return {
      id: event.id,
      threadId: event.threadId,
      notification: {
        jsonrpc: "2.0" as const,
        method: event.method as never,
        params,
      },
      createdAt: event.createdAt,
    }
  }

}
