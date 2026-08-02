import { randomUUID } from "node:crypto"
import { AgentError } from "../domain"
import { SqlitePiSessionRepo, type SqlitePiSessionMetadata } from "../storage/SqlitePiSession"
import type { AgentDatabase } from "../storage/database/AgentDatabase"

type Scalar = string | number | bigint | Uint8Array | null
type Row = Record<string, Scalar>

export type ThreadForkResult = {
  sourceThreadID: string
  targetThreadID: string
  threadIDs: ReadonlyMap<string, string>
  turnIDs: ReadonlyMap<string, string>
  agentIDs: ReadonlyMap<string, string>
}

export type ThreadForkOptions = {
  operationID: string
  targetThreadID?: string
  targetWorkspace: {
    cwd: string
    roots: string
    gitBranch: string
  }
}

const TERMINAL_TURN_STATES = new Set(["completed", "failed", "interrupted", "stopped"])
const TERMINAL_AGENT_STATES = new Set(["completed", "failed", "interrupted", "stopped"])

const replaceIDs = (value: unknown, ids: ReadonlyMap<string, string>): unknown => {
  if (typeof value === "string") return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((entry) => replaceIDs(entry, ids))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceIDs(entry, ids)]))
  }
  return value
}

const replaceJson = (value: Scalar, ids: ReadonlyMap<string, string>) => {
  if (typeof value !== "string") return value
  try {
    return JSON.stringify(replaceIDs(JSON.parse(value), ids))
  } catch {
    return value
  }
}

/**
 * Copies durable, completed conversation state to a new task. Runtime state is
 * deliberately excluded: events/outbox, queue operations, interactions and
 * checkpoints are reconstructed by the target task instead of being cloned.
 */
export class ThreadForkRepository {
  private readonly sessions: Pick<SqlitePiSessionRepo, "fork">
  private readonly inFlight = new Map<string, { requestKey: string; promise: Promise<ThreadForkResult> }>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly nextID: () => string = randomUUID,
    sessions?: Pick<SqlitePiSessionRepo, "fork">,
  ) {
    this.sessions = sessions ?? new SqlitePiSessionRepo(db)
  }

  assertForkable(sourceThreadID: string) {
    const source = this.db.sqlite.query("SELECT id, kind FROM threads WHERE id = ?").get(sourceThreadID) as { id: string; kind: string } | null
    if (!source) throw new AgentError("THREAD_NOT_FOUND", "源任务不存在", 404)
    if (source.kind !== "main" && source.kind !== "subagent") {
      throw new AgentError("HISTORY_UNSUPPORTED", "源任务包含不支持迁移的历史实体", 409)
    }

    const blockingTurn = this.db.sqlite.query("SELECT status FROM turns WHERE thread_id = ? AND status NOT IN ('completed', 'failed', 'interrupted', 'stopped') LIMIT 1").get(sourceThreadID) as { status: string } | null
    if (blockingTurn) {
      if (blockingTurn.status === "queued") throw new AgentError("QUEUE_NOT_EMPTY", "源任务仍有排队消息", 409)
      throw new AgentError("SOURCE_ACTIVE", "源任务仍在运行", 409)
    }
    const pendingApproval = this.db.sqlite.query("SELECT 1 FROM approval_requests WHERE thread_id = ? AND status IN ('preparing', 'pending', 'resolved', 'claimed') LIMIT 1").get(sourceThreadID)
    const pendingQuestion = this.db.sqlite.query("SELECT 1 FROM question_requests WHERE thread_id = ? AND status IN ('pending', 'resolved', 'resuming') LIMIT 1").get(sourceThreadID)
    const checkpoint = this.db.sqlite.query("SELECT 1 FROM agent_checkpoints WHERE thread_id = ? LIMIT 1").get(sourceThreadID)
    if (pendingApproval || pendingQuestion || checkpoint) throw new AgentError("PENDING_INTERACTION", "源任务存在待处理交互", 409)

    const incompleteChild = this.db.sqlite.query("SELECT 1 FROM subagent_tasks WHERE parent_thread_id = ? AND status <> 'completed' LIMIT 1").get(sourceThreadID)
    if (incompleteChild) throw new AgentError("SOURCE_ACTIVE", "源任务仍有未完成的子任务", 409)
    return source
  }

  fork(sourceThreadID: string, options: ThreadForkOptions): Promise<ThreadForkResult> {
    const requestKey = JSON.stringify({ sourceThreadID, targetThreadID: options.targetThreadID, targetWorkspace: options.targetWorkspace })
    const existing = this.inFlight.get(options.operationID)
    if (existing) {
      if (existing.requestKey !== requestKey) throw new AgentError("CONFLICT", "Handoff operationId 已绑定其他 fork 请求", 409)
      return existing.promise
    }
    const owned = this.forkOwned(sourceThreadID, options)
    const tracked = owned.finally(() => {
      if (this.inFlight.get(options.operationID)?.promise === tracked) this.inFlight.delete(options.operationID)
    })
    this.inFlight.set(options.operationID, { requestKey, promise: tracked })
    return tracked
  }

  private async forkOwned(sourceThreadID: string, options: ThreadForkOptions): Promise<ThreadForkResult> {
    this.assertForkable(sourceThreadID)
    let targetRootID = options.targetThreadID ?? this.nextID()
    const existing = this.db.sqlite.query("SELECT target_thread_id FROM thread_forks WHERE operation_id = ?").get(options.operationID) as { target_thread_id: string } | null
    if (existing) {
      if (existing.target_thread_id !== targetRootID && options.targetThreadID) throw new AgentError("CONFLICT", "Handoff operationId 已绑定其他目标任务", 409)
      const committed = this.db.sqlite.query("SELECT target_thread_id FROM thread_handoff_operations WHERE operation_id = ?").get(options.operationID) as { target_thread_id: string | null } | null
      if (committed?.target_thread_id === existing.target_thread_id) {
        return {
          sourceThreadID,
          targetThreadID: existing.target_thread_id,
          threadIDs: new Map([[sourceThreadID, existing.target_thread_id]]),
          turnIDs: new Map(),
          agentIDs: new Map(),
        }
      }
      // A marker without an operation target means the process stopped before
      // the fork became complete. Remove the complete hidden subtree and retry
      // with the same root identity; partial Pi sessions cascade with it.
      this.rollback(options.operationID)
      targetRootID = existing.target_thread_id
    }

    const maps = this.allocateMappings(sourceThreadID, targetRootID)
    const piForks: Array<{ source: SqlitePiSessionMetadata; targetSessionID: string; targetThreadID: string; targetAgentID: string }> = []
    try {
      this.db.transaction(() => {
        this.copyThreads(sourceThreadID, options, maps.threadIDs)
        this.copyConversationRows(maps, piForks)
        this.db.sqlite.query("INSERT INTO thread_forks (target_thread_id, source_thread_id, operation_id, created_at) VALUES (?, ?, ?, ?)").run(targetRootID, sourceThreadID, options.operationID, Date.now())
      })
      for (const entry of piForks) {
        await this.sessions.fork(entry.source, {
          id: entry.targetSessionID,
          threadID: entry.targetThreadID,
          agentID: entry.targetAgentID,
        })
      }
      this.db.transaction(() => {
        this.db.sqlite.query("UPDATE review_comments SET thread_id = ?, updated_at = ? WHERE thread_id = ?").run(targetRootID, Date.now(), sourceThreadID)
      })
    } catch (cause) {
      this.rollback(options.operationID)
      if (cause instanceof AgentError) throw cause
      throw new AgentError("HISTORY_UNSUPPORTED", "任务历史无法完整迁移", 409)
    }
    return { sourceThreadID, targetThreadID: targetRootID, ...maps }
  }

  rollback(operationID: string) {
    const marker = this.db.sqlite.query("SELECT source_thread_id, target_thread_id FROM thread_forks WHERE operation_id = ?").get(operationID) as { source_thread_id: string; target_thread_id: string } | null
    const legacyTarget = marker ? null : this.db.sqlite.query("SELECT id FROM threads WHERE create_operation_id = ?").get(operationID) as { id: string } | null
    const operation = marker ? null : this.db.sqlite.query("SELECT source_thread_id FROM thread_handoff_operations WHERE operation_id = ?").get(operationID) as { source_thread_id: string } | null
    const fork = marker ?? (legacyTarget && operation ? { source_thread_id: operation.source_thread_id, target_thread_id: legacyTarget.id } : null)
    if (!fork) return
    this.db.transaction(() => {
      this.db.sqlite.query("UPDATE review_comments SET thread_id = ?, updated_at = ? WHERE thread_id = ?").run(fork.source_thread_id, Date.now(), fork.target_thread_id)
      this.db.sqlite.query("DELETE FROM threads WHERE id = ?").run(fork.target_thread_id)
    })
  }

  private allocateMappings(sourceRootID: string, targetRootID: string) {
    const threadIDs = new Map<string, string>([[sourceRootID, targetRootID]])
    const visit = (sourceThreadID: string) => {
      const children = this.db.sqlite.query("SELECT child_thread_id FROM subagent_tasks WHERE parent_thread_id = ? AND status = 'completed' ORDER BY created_at, id").all(sourceThreadID) as Array<{ child_thread_id: string }>
      for (const child of children) {
        this.assertForkable(child.child_thread_id)
        threadIDs.set(child.child_thread_id, this.nextID())
        visit(child.child_thread_id)
      }
    }
    visit(sourceRootID)
    const turnIDs = new Map<string, string>()
    const agentIDs = new Map<string, string>()
    const inputIDs = new Map<string, string>()
    const itemIDs = new Map<string, string>()
    const toolCallIDs = new Map<string, string>()
    const taskIDs = new Map<string, string>()
    const runIDs = new Map<string, string>()
    for (const sourceThreadID of threadIDs.keys()) {
      for (const row of this.rows("turns", "thread_id", sourceThreadID)) turnIDs.set(String(row.id), this.nextID())
      for (const row of this.rows("agent_executions", "thread_id", sourceThreadID)) agentIDs.set(String(row.id), this.nextID())
      for (const row of this.rows("inputs", "thread_id", sourceThreadID)) inputIDs.set(String(row.id), this.nextID())
      for (const row of this.rows("items", "thread_id", sourceThreadID)) itemIDs.set(String(row.id), this.nextID())
      for (const row of this.rows("tool_calls", "thread_id", sourceThreadID)) toolCallIDs.set(String(row.id), this.nextID())
      for (const row of this.rows("subagent_tasks", "parent_thread_id", sourceThreadID)) taskIDs.set(String(row.id), this.nextID())
    }
    for (const taskID of taskIDs.keys()) for (const row of this.rows("subagent_runs", "task_id", taskID)) runIDs.set(String(row.id), this.nextID())
    return { threadIDs, turnIDs, agentIDs, inputIDs, itemIDs, toolCallIDs, taskIDs, runIDs }
  }

  private copyThreads(sourceRootID: string, options: ThreadForkOptions, threadIDs: ReadonlyMap<string, string>) {
    for (const [sourceID, targetID] of threadIDs) {
      const row = this.row("threads", "id", sourceID)
      if (!row) throw new AgentError("THREAD_NOT_FOUND", "源任务不存在", 404)
      row.id = targetID
      row.parent_thread_id = row.parent_thread_id ? threadIDs.get(String(row.parent_thread_id)) ?? null : null
      row.archived_at = -1 // hidden until the client-transfer acknowledgement
      row.create_operation_id = sourceID === sourceRootID ? options.operationID : null
      row.create_request_hash = null
      if (row.workspace_kind === "project") {
        row.workspace_cwd = options.targetWorkspace.cwd
        row.workspace_roots = options.targetWorkspace.roots
      }
      row.git_branch = options.targetWorkspace.gitBranch
      row.queue_version = 0
      row.queue_pause_reason = null
      row.updated_at = Date.now()
      this.insert("threads", row)
    }
  }

  private copyConversationRows(
    maps: ReturnType<ThreadForkRepository["allocateMappings"]>,
    piForks: Array<{ source: SqlitePiSessionMetadata; targetSessionID: string; targetThreadID: string; targetAgentID: string }>,
  ) {
    const allIDs = new Map<string, string>([
      ...maps.threadIDs,
      ...maps.turnIDs,
      ...maps.agentIDs,
      ...maps.inputIDs,
      ...maps.itemIDs,
      ...maps.toolCallIDs,
      ...maps.taskIDs,
      ...maps.runIDs,
    ])
    const sessionIDs = new Map<string, string>()
    for (const [sourceThreadID, targetThreadID] of maps.threadIDs) {
      for (const source of this.rows("turns", "thread_id", sourceThreadID)) {
        if (!TERMINAL_TURN_STATES.has(String(source.status))) throw new AgentError("HISTORY_UNSUPPORTED", "源任务包含未终结 Turn", 409)
        this.insert("turns", this.remapRow(source, allIDs, { id: maps.turnIDs, thread_id: maps.threadIDs, root_agent_id: maps.agentIDs }))
      }
      for (const source of this.rows("inputs", "thread_id", sourceThreadID)) this.insert("inputs", this.remapRow(source, allIDs, { id: maps.inputIDs, thread_id: maps.threadIDs, turn_id: maps.turnIDs }))
      for (const source of this.rows("messages", "thread_id", sourceThreadID)) this.insert("messages", this.remapRow({ ...source, id: this.nextID() }, allIDs, { thread_id: maps.threadIDs, turn_id: maps.turnIDs }))
      for (const source of this.rows("agent_executions", "thread_id", sourceThreadID)) {
        if (!TERMINAL_AGENT_STATES.has(String(source.status))) throw new AgentError("HISTORY_UNSUPPORTED", "源任务包含未终结 Agent execution", 409)
        const sourceSessionID = String(source.session_id)
        const targetSessionID = this.nextID()
        sessionIDs.set(sourceSessionID, targetSessionID)
        const targetAgentID = maps.agentIDs.get(String(source.id))!
        const row = this.remapRow(source, allIDs, { id: maps.agentIDs, thread_id: maps.threadIDs, turn_id: maps.turnIDs, parent_agent_id: maps.agentIDs, subagent_run_id: maps.runIDs })
        row.session_id = targetSessionID
        this.insert("agent_executions", row)
        const session = this.db.sqlite.query("SELECT id, thread_id, agent_id, created_at FROM pi_sessions WHERE id = ?").get(sourceSessionID) as { id: string; thread_id: string; agent_id: string; created_at: number } | null
        if (session) piForks.push({ source: { id: session.id, threadID: session.thread_id, agentID: session.agent_id, createdAt: new Date(session.created_at).toISOString() }, targetSessionID, targetThreadID, targetAgentID })
      }
      for (const source of this.rows("items", "thread_id", sourceThreadID)) this.insert("items", this.remapRow(source, allIDs, { id: maps.itemIDs, thread_id: maps.threadIDs, turn_id: maps.turnIDs, agent_id: maps.agentIDs }))
      for (const source of this.rows("tool_calls", "thread_id", sourceThreadID)) this.insert("tool_calls", this.remapRow(source, allIDs, { id: maps.toolCallIDs, thread_id: maps.threadIDs, turn_id: maps.turnIDs, agent_id: maps.agentIDs }))
      for (const source of this.rows("patches", "thread_id", sourceThreadID)) this.insert("patches", this.remapRow({ ...source, id: this.nextID() }, allIDs, { thread_id: maps.threadIDs, turn_id: maps.turnIDs, agent_id: maps.agentIDs }))
      for (const source of this.rows("agent_compactions", "thread_id", sourceThreadID)) this.insert("agent_compactions", this.remapRow({ ...source, id: this.nextID() }, allIDs, { thread_id: maps.threadIDs, turn_id: maps.turnIDs }))
      for (const source of this.rows("input_attachments", "thread_id", sourceThreadID)) this.insert("input_attachments", this.remapRow({ ...source, id: this.nextID() }, allIDs, { thread_id: maps.threadIDs, input_id: maps.inputIDs }))
      for (const source of this.rows("turn_patch_sets", "thread_id", sourceThreadID)) this.insert("turn_patch_sets", this.remapRow(source, allIDs, { turn_id: maps.turnIDs, thread_id: maps.threadIDs, item_id: maps.itemIDs }))
      for (const [sourceTaskID, targetTaskID] of maps.taskIDs) {
        const task = this.row("subagent_tasks", "id", sourceTaskID)
        if (!task || task.parent_thread_id !== sourceThreadID) continue
        this.insert("subagent_tasks", this.remapRow(task, allIDs, { id: maps.taskIDs, parent_thread_id: maps.threadIDs, parent_turn_id: maps.turnIDs, parent_agent_id: maps.agentIDs, child_thread_id: maps.threadIDs, current_run_id: maps.runIDs }))
        for (const run of this.rows("subagent_runs", "task_id", sourceTaskID)) this.insert("subagent_runs", this.remapRow(run, allIDs, { id: maps.runIDs, task_id: maps.taskIDs }))
      }
    }
    for (const [sourceTurnID, targetTurnID] of maps.turnIDs) {
      for (const source of this.rows("turn_patch_batches", "turn_id", sourceTurnID)) this.insert("turn_patch_batches", this.remapRow(source, allIDs, { turn_id: maps.turnIDs, tool_call_id: maps.toolCallIDs }))
      for (const source of this.rows("turn_patch_operations", "turn_id", sourceTurnID)) this.insert("turn_patch_operations", this.remapRow({ ...source, operation_id: this.nextID() }, allIDs, { turn_id: maps.turnIDs }))
      void targetTurnID
    }
  }

  private remapRow(source: Row, allIDs: ReadonlyMap<string, string>, fields: Record<string, ReadonlyMap<string, string>>) {
    const result = { ...source }
    for (const [field, mapping] of Object.entries(fields)) {
      if (result[field] != null) result[field] = mapping.get(String(result[field])) ?? result[field]
    }
    for (const field of ["data", "input", "output", "files", "result", "replacement_history", "workspace_state"]) {
      if (field in result) result[field] = replaceJson(result[field]!, allIDs)
    }
    return result
  }

  private rows(table: string, field: string, value: string): Row[] {
    return this.db.sqlite.query(`SELECT * FROM ${table} WHERE ${field} = ? ORDER BY rowid`).all(value) as Row[]
  }

  private row(table: string, field: string, value: string): Row | null {
    return this.db.sqlite.query(`SELECT * FROM ${table} WHERE ${field} = ?`).get(value) as Row | null
  }

  private insert(table: string, row: Row) {
    const columns = Object.keys(row)
    this.db.sqlite.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((column) => row[column]!))
  }
}
