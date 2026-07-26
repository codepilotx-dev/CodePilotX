import { Database } from "bun:sqlite"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { Effect } from "effect"
import { DEFAULT_PERMISSION_CONFIG, decodeApprovalPolicy, encodeApprovalPolicy, type ThreadSettings, type ThreadSettingsPatch } from "@codepilotx/shared/thread"
import { AgentError } from "../../domain"
import type { ReviewComment } from "@codepilotx/agent-protocol"
import type {
  EventEnvelope,
  AgentExecution,
  Item,
  ModelRef,
  PermissionConfig,
  SendStrategy,
  SubmitMessage,
  TaskMode,
  ThreadSnapshot,
  ToolInvocation,
  TurnStatus,
} from "../../domain"

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
}

export type StoredEncryptedCredential = {
  id: string
  integrationID: string
  kind: "api-key" | "oauth"
  methodID: string | null
  label: string
  keySuffix: string | null
  fingerprint: string | null
  enabled: boolean
  priority: number
  ciphertext: string
  nonce: string
  keyVersion: number
  createdAt: number
  updatedAt: number
}

export type CredentialHealthStatus = "untested" | "healthy" | "auth-failed" | "rate-limited" | "error"
export type CredentialErrorCategory = "authentication" | "rate-limit" | "network" | "unknown"

export type StoredCredentialHealth = {
  credentialID: string
  status: CredentialHealthStatus
  lastTestedAt: number | null
  lastUsedAt: number | null
  lastErrorCategory: CredentialErrorCategory | null
  cooldownUntil: number | null
  updatedAt: number
}

export type StoredProject = {
  id: string
  name: string
  rootPath: string
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
  settings: ProjectModelSettings
}

export type AgentTurnCheckpoint = {
  agentID: string
  turnID: string
  threadID: string
  state: "waiting_question" | "waiting_hook_trust" | "waiting_plan_confirmation" | "waiting_subagents" | "ready"
  payload: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
}

export type SideEffectRecoveryPayload = {
  kind: "side-effect-prompt-recovery"
  attemptOrdinal: number
  completed: Array<{ toolCallID: string; tool: string; summary: string }>
  error: string
}

export type ResumableQuestion = {
  id: string
  threadID: string
  turnID: string
  toolCallID: string | null
  payload: Record<string, unknown>
  payloadVersion: number
  createdAt: number
}

export type ApprovalCheckpointPayload = {
  kind: "tool-approval"
  invocation: ToolInvocation
  invocationHash: string
  permissionSnapshot: PermissionConfig
  sandbox: Record<string, unknown>
  reviewer: PermissionConfig["approvalsReviewer"]
  review: Record<string, unknown>
  runState?: string
  interruption?: unknown
  resolution?: { decision: "allow" | "deny"; feedback?: string; resolvedAt: number }
  claimedAt?: number
}

export type StoredApprovalCheckpoint = {
  approvalID: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  status: "preparing" | "pending" | "resolved" | "claimed" | "cancelled"
  decision: "allow" | "deny" | null
  risk: string
  reason: string
  payload: ApprovalCheckpointPayload
  version: number
  createdAt: number
  updatedAt: number
}

export type SandboxEscalation = {
  token: string
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  invocation: ToolInvocation
  invocationHash: string
  failure: string
  status: "awaiting_request" | "claimed" | "completed" | "cancelled"
  createdAt: number
}

export type HookTrustRequest = {
  id: string
  threadID: string | null
  turnID: string | null
  workspacePath: string
  configPath: string
  configHash: string
  status: "pending" | "allowed" | "blocked"
  auditSummary: Record<string, unknown>
  createdAt: number
  resolvedAt: number | null
}

type SqlValue = string | number | boolean | Uint8Array | null

const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T
const now = () => Date.now()
const previewText = (value: string, limit = 180) => value.replace(/\s+/g, " ").trim().slice(0, limit) || null
const containedPath = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}
export type QueuePauseReason = "interrupted" | "turn_failed" | null
export type QueueMutationMeta = { operationID: string; expectedVersion?: number }

export type StoredThreadWorkspace =
  | { kind: "project"; projectID: string; cwd: string; runtimeWorkspaceRoots: Array<{ folderId: string; path: string; role: "primary" | "secondary" }>; instructionSources: string[]; outputDirectory: null }
  | { kind: "projectless"; projectID: null; workspaceRoot: string; cwd: string; outputDirectory: string }

export type CreateThreadInput = {
  id?: string
  title?: string | undefined
  settings?: ThreadSettings | undefined
  workspace:
    | { kind: "project"; projectID: string }
    | { kind: "projectless"; workspaceRoot: string; cwd: string; outputDirectory: string }
  operationID?: string | undefined
  requestHash?: string | undefined
}

export type CreatedThreadRecord = {
  id: string
  title: string
  projectID: string | null
  workspace: StoredThreadWorkspace | null
  settings: ThreadSettings
  createdAt: number
  updatedAt: number
  event: EventEnvelope
}

type PermissionColumns = {
  sandbox_mode: PermissionConfig["sandboxMode"]
  approval_policy: string
  approvals_reviewer: PermissionConfig["approvalsReviewer"]
}

type ThreadSettingsColumns = PermissionColumns & {
  task_mode: TaskMode
}

const permissionConfigFromRow = (row: PermissionColumns): PermissionConfig => ({
  sandboxMode: row.sandbox_mode,
  approvalPolicy: decodeApprovalPolicy(row.approval_policy),
  approvalsReviewer: row.approvals_reviewer,
})

const threadSettingsFromRow = (row: ThreadSettingsColumns): ThreadSettings => ({
  taskMode: row.task_mode,
  permissionConfig: permissionConfigFromRow(row),
})

const defaultThreadSettings = (): ThreadSettings => ({
  taskMode: "chat",
  permissionConfig: { ...DEFAULT_PERMISSION_CONFIG },
})

import { ThreadRepositoryDatabase } from "./thread-repository"

export abstract class ExecutionRepositoryDatabase extends ThreadRepositoryDatabase {
  createTurn(threadID: string, input: SubmitMessage, status: TurnStatus = "queued", ids: { inputID?: string } = {}) {
      const turnID = crypto.randomUUID()
      const agentID = crypto.randomUUID()
      const inputID = ids.inputID ?? crypto.randomUUID()
      const timestamp = now()
      return this.transaction(() => {
        const queuePosition = status === "queued"
          ? (this.sqlite.query("SELECT COALESCE(MAX(queue_position), 0) AS position FROM turns WHERE thread_id = ? AND status = 'queued'").get(threadID) as { position: number }).position + 1
          : null
        const settingsUpdate = this.syncThreadSettings(threadID, {
          taskMode: input.taskMode,
          permissionConfig: input.permissionConfig,
        })
        this.sqlite.query(`INSERT INTO turns (id, thread_id, root_agent_id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, strategy, queue_position, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(
          turnID,
          threadID,
          agentID,
          status,
          input.taskMode,
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          stringify(input.model),
          input.strategy,
          queuePosition,
          timestamp,
          timestamp,
        )
        this.sqlite.query(`INSERT INTO agent_executions (id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, status, error, created_at, updated_at) VALUES (?, ?, ?, NULL, 'main', ?, ?, ?, 0, ?, NULL, ?, ?)`).run(
          agentID,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          `${threadID}:main`,
          status,
          timestamp,
          timestamp,
        )
        this.sqlite.query(`INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          inputID,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          input.strategy,
          input.taskMode,
          status === "queued" ? "queued" : "active",
          timestamp,
        )
        this.appendUserMessage({ id: inputID, threadID, turnID, content: input.content, createdAt: timestamp })
        const method = status === "queued" ? "turn/queued" : "turn/started"
        const event = this.insertEvent(threadID, turnID, method, { turnId: turnID, inputID, input, createdAt: timestamp })
        if (status === "queued") this.sqlite.query("UPDATE threads SET queue_version = queue_version + 1 WHERE id = ?").run(threadID)
        const agentEvent = this.insertEvent(threadID, turnID, "agent/upserted", { agent: this.getAgentExecution(agentID) })
        return { turnID, agentID, inputID, settingsEvent: settingsUpdate.event, event, agentEvent }
      })
    }

  appendGuide(threadID: string, turnID: string, input: SubmitMessage, inputID?: string) {
      const id = inputID ?? crypto.randomUUID()
      const timestamp = now()
      return this.transaction(() => {
        const settingsUpdate = this.syncThreadSettings(threadID, {
          taskMode: input.taskMode,
          permissionConfig: input.permissionConfig,
        })
        this.sqlite.query(`INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'guide', ?, 'mailbox', ?)`).run(
          id,
          threadID,
          turnID,
          input.content,
          stringify(input.model),
          input.permissionConfig.sandboxMode,
          encodeApprovalPolicy(input.permissionConfig.approvalPolicy),
          input.permissionConfig.approvalsReviewer,
          input.taskMode,
          timestamp,
        )
        this.appendUserMessage({ id, threadID, turnID, content: input.content, createdAt: timestamp })
        const event = this.insertEvent(threadID, turnID, "queue/updated", { turnId: turnID, inputID: id, input, action: "guide-appended", createdAt: timestamp })
        return { inputID: id, settingsEvent: settingsUpdate.event, event }
      })
    }

  inputAdmission(inputID: string) {
      return this.sqlite.query(`
        SELECT id, thread_id, turn_id, content, strategy
        FROM inputs WHERE id = ?
      `).get(inputID) as {
        id: string
        thread_id: string
        turn_id: string
        content: string
        strategy: string
      } | null
    }

  takeGuideMailbox(turnID: string) {
      return this.transaction(() => {
        const rows = this.sqlite.query("SELECT id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, task_mode FROM inputs WHERE turn_id = ? AND status = 'mailbox' ORDER BY created_at").all(turnID) as Array<{
          id: string
          content: string
          model_ref: string
          task_mode: TaskMode
        } & PermissionColumns>
        if (rows.length) {
          const placeholders = rows.map(() => "?").join(",")
          this.sqlite.query(`UPDATE inputs SET status = 'consumed' WHERE id IN (${placeholders})`).run(...rows.map((row) => row.id))
        }
        return rows.map((row) => ({ id: row.id, content: row.content, model: parse<ModelRef>(row.model_ref), permissionConfig: permissionConfigFromRow(row), taskMode: row.task_mode }))
      })
    }

  claimTurnExecution(turnID: string) {
      const timestamp = now()
      return this.transaction(() => {
        const turn = this.sqlite.query("SELECT root_agent_id FROM turns WHERE id = ? AND status = 'queued'").get(turnID) as { root_agent_id: string } | null
        if (!turn) return null
        const claimed = this.sqlite.query(`UPDATE agent_executions SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'`).run(timestamp, turn.root_agent_id)
        if (claimed.changes === 0) return null
        const started = this.sqlite.query(`UPDATE turns SET status = 'running', started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'queued'`).run(timestamp, timestamp, turnID)
        if (started.changes === 0) throw new Error(`Turn ${turnID} claim 失败`)
        this.sqlite.query(`UPDATE inputs SET status = 'active' WHERE turn_id = ? AND status = 'queued'`).run(turnID)
        this.sqlite.query("UPDATE threads SET queue_version = queue_version + 1 WHERE id = (SELECT thread_id FROM turns WHERE id = ?)").run(turnID)
        return this.getAgentExecution(turn.root_agent_id)
      })
    }

  startTurnExecution(turnID: string, input: SubmitMessage & { id: string }) {
      const timestamp = now()
      return this.transaction(() => {
        const row = this.sqlite.query("SELECT thread_id, root_agent_id FROM turns WHERE id = ? AND status = 'queued'").get(turnID) as { thread_id: string; root_agent_id: string } | null
        if (!row) return null
        const claimed = this.sqlite.query("UPDATE agent_executions SET status = 'running', error = NULL, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, row.root_agent_id)
        if (claimed.changes === 0) return null
        const started = this.sqlite.query("UPDATE turns SET status = 'running', started_at = COALESCE(started_at, ?), finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'queued'").run(timestamp, timestamp, turnID)
        if (started.changes === 0) throw new Error(`Turn ${turnID} claim 失败`)
        this.sqlite.query("UPDATE inputs SET status = 'active' WHERE turn_id = ? AND status = 'queued'").run(turnID)
        this.sqlite.query("UPDATE threads SET queue_version = queue_version + 1 WHERE id = ?").run(row.thread_id)
        const agent = this.getAgentExecution(row.root_agent_id)!
        const events = [
          this.insertEvent(row.thread_id, turnID, "agent/upserted", { agent }),
          this.insertEvent(row.thread_id, turnID, "turn/started", { turnId: turnID, rootAgentId: agent.id, startedAt: timestamp, input }),
        ]
        return { agent, events }
      })
    }

  finalizeTurn(input: {
      threadID: string
      turnID: string
      agentID: string
      status: "completed" | "failed" | "interrupted"
      message?: string
      pauseReason?: Exclude<QueuePauseReason, null>
    }) {
      const timestamp = now()
      return this.transaction(() => {
        this.deleteAgentTurnCheckpoint(input.turnID)
        this.updateTurnStatus(input.turnID, input.status)
        const agent = this.updateAgentStatus(input.agentID, input.status, input.message ?? null)
        if (input.status === "interrupted") {
          this.sqlite.query("UPDATE items SET status = 'interrupted', updated_at = ? WHERE turn_id = ? AND status IN ('pending', 'running')").run(timestamp, input.turnID)
          this.sqlite.query("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status IN ('preparing', 'pending', 'resolved', 'claimed')").run(timestamp, input.turnID)
          this.sqlite.query("UPDATE question_requests SET status = 'cancelled', answer = COALESCE(answer, '__stopped__'), resolved_at = ? WHERE turn_id = ? AND status IN ('pending', 'resolved', 'resuming')").run(timestamp, input.turnID)
        }
        const events: EventEnvelope[] = [
          this.insertEvent(input.threadID, input.turnID, "agent/upserted", { agent }),
          this.insertEvent(input.threadID, input.turnID, `turn/${input.status}`, {
            turnId: input.turnID,
            rootAgentId: input.agentID,
            ...(input.message ? { message: input.message } : {}),
            finishedAt: timestamp,
          }),
        ]
        if (input.pauseReason && this.sqlite.query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1").get(input.threadID)) {
          const current = this.queueStateMeta(input.threadID)
          if (current?.pauseReason !== input.pauseReason) {
            this.sqlite.query("UPDATE threads SET queue_pause_reason = ?, queue_version = queue_version + 1, updated_at = ? WHERE id = ?").run(input.pauseReason, timestamp, input.threadID)
            const next = this.queueStateMeta(input.threadID)!
            events.push(this.insertEvent(input.threadID, null, "queue/updated", { threadId: input.threadID, version: next.version, pauseReason: next.pauseReason, action: "queue/pause" }))
          }
        }
        return { agent, events }
      })
    }

  requeueTurnForSteer(turnID: string) {
      const timestamp = now()
      return this.transaction(() => {
        const row = this.sqlite.query("SELECT thread_id, root_agent_id FROM turns WHERE id = ? AND status = 'running'").get(turnID) as { thread_id: string; root_agent_id: string } | null
        if (!row) return null
        this.sqlite.query("UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ?").run(timestamp, turnID)
        this.sqlite.query("UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?").run(timestamp, row.root_agent_id)
        return { threadID: row.thread_id, agent: this.getAgentExecution(row.root_agent_id)! }
      })
    }

  updateTurnStatus(turnID: string, status: TurnStatus) {
      const timestamp = now()
      const terminal = ["completed", "failed", "interrupted", "cancelled"].includes(status)
      this.sqlite.query(`UPDATE turns SET status = ?, finished_at = CASE WHEN ? THEN ? WHEN ? THEN NULL ELSE finished_at END, updated_at = ? WHERE id = ?`).run(status, terminal ? 1 : 0, timestamp, status === "queued" ? 1 : 0, timestamp, turnID)
      if (terminal) this.sqlite.query("UPDATE inputs SET status = 'completed' WHERE turn_id = ? AND status = 'active'").run(turnID)
    }

  getAgentExecution(agentID: string): AgentExecution | null {
      const row = this.sqlite.query("SELECT id, thread_id, turn_id, parent_agent_id, profile, task, model_ref, session_id, depth, status, error, subagent_run_id, run_sequence, created_at, updated_at FROM agent_executions WHERE id = ?").get(agentID) as Record<string, string | number | null> | null
      return row ? {
        id: String(row.id),
        threadID: String(row.thread_id),
        turnID: String(row.turn_id),
        parentAgentID: row.parent_agent_id == null ? null : String(row.parent_agent_id),
        profile: String(row.profile),
        task: String(row.task),
        model: parse<ModelRef>(String(row.model_ref)),
        sessionID: String(row.session_id),
        depth: Number(row.depth),
        status: String(row.status) as AgentExecution["status"],
        error: row.error == null ? null : String(row.error),
        subagentRunID: row.subagent_run_id == null ? null : String(row.subagent_run_id),
        runSequence: Number(row.run_sequence ?? 0),
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      } : null
    }

  agentForTurn(turnID: string) {
      const row = this.sqlite.query("SELECT root_agent_id FROM turns WHERE id = ?").get(turnID) as { root_agent_id: string | null } | null
      return row?.root_agent_id ? this.getAgentExecution(row.root_agent_id) : null
    }

  updateAgentStatus(agentID: string, status: AgentExecution["status"], error: string | null = null) {
      const result = this.sqlite.query("UPDATE agent_executions SET status = ?, error = ?, updated_at = ? WHERE id = ?").run(status, error, now(), agentID)
      if (result.changes === 0) throw new Error(`Agent ${agentID} 不存在`)
      return this.getAgentExecution(agentID)!
    }

  upsertToolCall(invocation: ToolInvocation, status: "running" | "completed" | "error" | "interrupted", output: unknown = null, error: string | null = null, startedAt = now()) {
      const finishedAt = status === "running" ? null : now()
      this.sqlite.query(`INSERT INTO tool_calls (id, thread_id, turn_id, agent_id, tool_name, input, output, status, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET output = excluded.output, status = excluded.status, finished_at = excluded.finished_at, error = excluded.error`).run(
        invocation.id,
        invocation.threadID,
        invocation.turnID,
        invocation.agentID,
        invocation.name,
        stringify(invocation.input),
        output == null ? null : stringify(output),
        status,
        startedAt,
        finishedAt,
        error,
      )
    }

  completedToolCall(toolCallID: string) {
      const row = this.sqlite.query("SELECT tool_name, input, output FROM tool_calls WHERE id = ? AND status = 'completed'").get(toolCallID) as { tool_name: string; input: string; output: string | null } | null
      return row ? { name: row.tool_name, input: parse<Record<string, unknown>>(row.input), output: row.output == null ? null : parse<unknown>(row.output) } : null
    }

  nextQueuedTurn(threadID: string) {
      const state = this.queueStateMeta(threadID)
      if (!state || state.pauseReason) return null
      return this.sqlite.query("SELECT id FROM turns WHERE thread_id = ? AND status = 'queued' ORDER BY queue_position, created_at, id LIMIT 1").get(threadID) as { id: string } | null
    }

  queueStateMeta(threadID: string) {
      const row = this.sqlite.query("SELECT queue_version, queue_pause_reason FROM threads WHERE id = ?").get(threadID) as { queue_version: number; queue_pause_reason: QueuePauseReason } | null
      return row ? { version: row.queue_version, pauseReason: row.queue_pause_reason } : null
    }

  hasGuideMailbox(turnID: string) {
      return Boolean(this.sqlite.query("SELECT 1 FROM inputs WHERE turn_id = ? AND status = 'mailbox' LIMIT 1").get(turnID))
    }

  queuedInput(inputID: string) {
      return this.sqlite.query(`
        SELECT i.id, i.thread_id, i.turn_id, i.content, i.model_ref, i.sandbox_mode, i.approval_policy,
          i.approvals_reviewer, i.strategy, i.task_mode, t.queue_position
        FROM inputs AS i JOIN turns AS t ON t.id = i.turn_id
        WHERE i.id = ? AND i.status = 'queued' AND t.status = 'queued'
      `).get(inputID) as ({ id: string; thread_id: string; turn_id: string; content: string; model_ref: string; strategy: SendStrategy; task_mode: TaskMode; queue_position: number | null } & PermissionColumns) | null
    }

  private eventByID(id: number): EventEnvelope | null {
      const row = this.sqlite.query("SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id = ?").get(id) as { id: number; thread_id: string | null; turn_id: string | null; method: string; params: string; created_at: number } | null
      return row ? { id: row.id, threadId: row.thread_id, turnId: row.turn_id, method: row.method, params: parse(row.params), createdAt: row.created_at } : null
    }

  lookupQueueOperation(threadID: string, method: string, operationID: string) {
      const existing = this.sqlite.query("SELECT thread_id, method, event_id FROM queue_operations WHERE operation_id = ?").get(operationID) as { thread_id: string; method: string; event_id: number | null } | null
      if (!existing) return null
      if (existing.thread_id !== threadID || existing.method !== method) throw new AgentError("OPERATION_ID_CONFLICT", "operationId 已用于其他队列操作", 409)
      return { duplicate: true as const, event: existing.event_id == null ? null : this.eventByID(existing.event_id), details: {}, ...this.queueStateMeta(threadID)! }
    }

  private mutateQueue<T extends Record<string, unknown>>(threadID: string, method: string, meta: QueueMutationMeta, mutate: () => T) {
      return this.transaction(() => {
        const state = this.queueStateMeta(threadID)
        if (!state) throw new AgentError("THREAD_NOT_FOUND", "Thread 不存在", 404)
        const existing = this.sqlite.query("SELECT thread_id, method, event_id FROM queue_operations WHERE operation_id = ?").get(meta.operationID) as { thread_id: string; method: string; event_id: number | null } | null
        if (existing) {
          if (existing.thread_id !== threadID || existing.method !== method) throw new AgentError("OPERATION_ID_CONFLICT", "operationId 已用于其他队列操作", 409)
          return { duplicate: true as const, event: existing.event_id == null ? null : this.eventByID(existing.event_id), details: {} as T, ...this.queueStateMeta(threadID)! }
        }
        if (meta.expectedVersion !== undefined && meta.expectedVersion !== state.version) {
          throw new AgentError("QUEUE_VERSION_CONFLICT", "队列版本已变化，请刷新后重试", 409, { expectedVersion: meta.expectedVersion, actualVersion: state.version })
        }
        const details = mutate()
        this.sqlite.query("UPDATE threads SET queue_version = queue_version + 1, updated_at = ? WHERE id = ?").run(now(), threadID)
        const next = this.queueStateMeta(threadID)!
        const event = this.insertEvent(threadID, null, "queue/updated", { threadId: threadID, version: next.version, pauseReason: next.pauseReason, action: method, ...details })
        this.sqlite.query("INSERT INTO queue_operations (operation_id, thread_id, method, event_id, created_at) VALUES (?, ?, ?, ?, ?)").run(meta.operationID, threadID, method, event.id, now())
        return { duplicate: false as const, event, details, ...next }
      })
    }

  updateQueuedInput(threadID: string, inputID: string, content: string, meta: QueueMutationMeta) {
      return this.mutateQueue(threadID, "queue/update", meta, () => {
        const input = this.queuedInput(inputID)
        if (!input || input.thread_id !== threadID) throw new AgentError("QUEUED_INPUT_NOT_FOUND", "排队消息不存在或已开始执行", 409)
        const timestamp = now()
        this.sqlite.query("UPDATE inputs SET content = ? WHERE id = ?").run(content, inputID)
        this.sqlite.query("UPDATE messages SET content = ? WHERE id = ?").run(content, inputID)
        this.sqlite.query("UPDATE threads SET preview = (SELECT substr(content, 1, 180) FROM messages WHERE thread_id = ? ORDER BY ordinal DESC, created_at DESC, id DESC LIMIT 1) WHERE id = ?").run(threadID, threadID)
        this.sqlite.query("UPDATE agent_executions SET task = ?, updated_at = ? WHERE turn_id = ?").run(content, timestamp, input.turn_id)
        this.sqlite.query("UPDATE turns SET updated_at = ? WHERE id = ?").run(timestamp, input.turn_id)
        return { inputId: inputID, turnId: input.turn_id }
      })
    }

  removeQueuedInput(threadID: string, inputID: string, meta: QueueMutationMeta) {
      return this.mutateQueue(threadID, "queue/remove", meta, () => {
        const input = this.queuedInput(inputID)
        if (!input || input.thread_id !== threadID) throw new AgentError("QUEUED_INPUT_NOT_FOUND", "排队消息不存在或已开始执行", 409)
        const timestamp = now()
        this.sqlite.query("UPDATE inputs SET status = 'cancelled' WHERE id = ?").run(inputID)
        this.sqlite.query("UPDATE turns SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, input.turn_id)
        this.sqlite.query("UPDATE agent_executions SET status = 'cancelled', updated_at = ? WHERE turn_id = ?").run(timestamp, input.turn_id)
        this.sqlite.query("DELETE FROM messages WHERE id = ?").run(inputID)
        if (!this.sqlite.query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1").get(threadID)) {
          this.sqlite.query("UPDATE threads SET queue_pause_reason = NULL WHERE id = ?").run(threadID)
        }
        this.sqlite.query(`UPDATE threads SET
          message_count = (SELECT COUNT(*) FROM messages WHERE thread_id = ?),
          first_user_message = (SELECT content FROM messages WHERE thread_id = ? AND role = 'user' ORDER BY ordinal, created_at, id LIMIT 1),
          preview = (SELECT substr(content, 1, 180) FROM messages WHERE thread_id = ? ORDER BY ordinal DESC, created_at DESC, id DESC LIMIT 1)
          WHERE id = ?`).run(threadID, threadID, threadID, threadID)
        return { inputId: inputID, turnId: input.turn_id }
      })
    }

  reorderQueuedInputs(threadID: string, inputIDs: readonly string[], meta: QueueMutationMeta) {
      return this.mutateQueue(threadID, "queue/reorder", meta, () => {
        if (new Set(inputIDs).size !== inputIDs.length) throw new AgentError("QUEUE_ORDER_INVALID", "队列顺序包含重复 inputId", 409)
        const queued = this.sqlite.query(`SELECT i.id FROM inputs AS i JOIN turns AS t ON t.id = i.turn_id WHERE i.thread_id = ? AND i.status = 'queued' AND t.status = 'queued' ORDER BY t.queue_position, t.created_at, t.id`).all(threadID) as Array<{ id: string }>
        const current = queued.map((row) => row.id)
        if (current.length !== inputIDs.length || current.some((id) => !inputIDs.includes(id))) throw new AgentError("QUEUE_ORDER_CONFLICT", "排序必须包含当前线程全部排队消息", 409, { current })
        inputIDs.forEach((inputID, index) => this.sqlite.query("UPDATE turns SET queue_position = ?, updated_at = ? WHERE id = (SELECT turn_id FROM inputs WHERE id = ?)").run(index + 1, now(), inputID))
        return { inputIds: [...inputIDs] }
      })
    }

  steerQueuedInput(threadID: string, inputID: string, meta: QueueMutationMeta) {
      return this.mutateQueue(threadID, "queue/steer", meta, () => {
        const input = this.queuedInput(inputID)
        if (!input || input.thread_id !== threadID) throw new AgentError("QUEUED_INPUT_NOT_FOUND", "排队消息不存在或已开始执行", 409)
        const active = this.activeTurn(threadID)
        if (!active) {
          this.sqlite.query("UPDATE threads SET queue_pause_reason = NULL WHERE id = ?").run(threadID)
          this.sqlite.query("UPDATE turns SET queue_position = 0, updated_at = ? WHERE id = ?").run(now(), input.turn_id)
          return { inputId: inputID, turnId: input.turn_id, disposition: "started" }
        }
        this.sqlite.query("UPDATE inputs SET turn_id = ?, strategy = 'guide', status = 'mailbox' WHERE id = ?").run(active.id, inputID)
        this.sqlite.query("UPDATE messages SET turn_id = ? WHERE id = ?").run(active.id, inputID)
        this.sqlite.query("DELETE FROM turns WHERE id = ?").run(input.turn_id)
        return { inputId: inputID, turnId: active.id, disposition: "guide" }
      })
    }

  resumeQueue(threadID: string, meta: QueueMutationMeta) {
      return this.mutateQueue(threadID, "queue/resume", meta, () => {
        this.sqlite.query("UPDATE threads SET queue_pause_reason = NULL WHERE id = ?").run(threadID)
        return { resumed: true }
      })
    }

  pauseQueue(threadID: string, reason: Exclude<QueuePauseReason, null>) {
      return this.transaction(() => {
        if (!this.sqlite.query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1").get(threadID)) return null
        const current = this.queueStateMeta(threadID)
        if (!current || current.pauseReason === reason) return null
        this.sqlite.query("UPDATE threads SET queue_pause_reason = ?, queue_version = queue_version + 1, updated_at = ? WHERE id = ?").run(reason, now(), threadID)
        const next = this.queueStateMeta(threadID)!
        return this.insertEvent(threadID, null, "queue/updated", { threadId: threadID, version: next.version, pauseReason: next.pauseReason, action: "queue/pause" })
      })
    }

  getTurnInput(turnID: string) {
      const row = this.sqlite.query("SELECT id, content, model_ref, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode FROM inputs WHERE turn_id = ? ORDER BY created_at LIMIT 1").get(turnID) as
        | ({ id: string; content: string; model_ref: string; strategy: SendStrategy; task_mode: TaskMode } & PermissionColumns)
        | null
      if (!row) return null
      return { id: row.id, content: row.content, model: parse(row.model_ref), permissionConfig: permissionConfigFromRow(row), strategy: row.strategy, taskMode: row.task_mode } as SubmitMessage & { id: string }
    }

  saveAgentTurnCheckpoint(input: Omit<AgentTurnCheckpoint, "createdAt" | "updatedAt">) {
      const timestamp = now()
      this.sqlite.query(`INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
        input.agentID,
        input.turnID,
        input.threadID,
        input.state,
        stringify(input.payload),
        input.version,
        timestamp,
        timestamp,
      )
      return this.getAgentTurnCheckpoint(input.turnID)!
    }

  getAgentTurnCheckpoint(turnID: string): AgentTurnCheckpoint | null {
      const row = this.sqlite.query("SELECT agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at FROM agent_checkpoints WHERE turn_id = ?").get(turnID) as {
        agent_id: string
        turn_id: string
        thread_id: string
        state: AgentTurnCheckpoint["state"]
        payload: string
        version: number
        created_at: number
        updated_at: number
      } | null
      return row ? {
        agentID: row.agent_id,
        turnID: row.turn_id,
        threadID: row.thread_id,
        state: row.state,
        payload: parse<Record<string, unknown>>(row.payload),
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } : null
    }

  interruptForSideEffectRecovery(input: { threadID: string; turnID: string; agentID: string; payload: SideEffectRecoveryPayload }) {
      const timestamp = now()
      const events: EventEnvelope[] = []
      const checkpoint = this.transaction(() => {
        this.sqlite.query(`INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'ready', ?, 1, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
          input.agentID, input.turnID, input.threadID, stringify(input.payload), timestamp, timestamp,
        )
        this.updateTurnStatus(input.turnID, "interrupted")
        this.updateAgentStatus(input.agentID, "interrupted", "模型上下文超限；已保存副作用恢复证据")
        events.push(this.insertEvent(input.threadID, input.turnID, "agent/upserted", { agent: this.getAgentExecution(input.agentID) }))
        events.push(this.insertEvent(input.threadID, input.turnID, "turn/interrupted", {
          turnId: input.turnID,
          rootAgentId: input.agentID,
          reason: "side-effect-prompt-recovery",
          completedSideEffects: input.payload.completed,
          finishedAt: timestamp,
        }))
        events.push(this.insertEvent(input.threadID, input.turnID, "context/recoveryRequired", {
          turnId: input.turnID,
          agentId: input.agentID,
          attemptOrdinal: input.payload.attemptOrdinal,
          completedSideEffects: input.payload.completed,
          createdAt: timestamp,
        }))
        return this.getAgentTurnCheckpoint(input.turnID)!
      })
      return { checkpoint, events }
    }

  queueSideEffectRecovery(turnID: string) {
      const checkpoint = this.getAgentTurnCheckpoint(turnID)
      if (checkpoint?.state !== "ready" || checkpoint.payload.kind !== "side-effect-prompt-recovery") return false
      return this.transaction(() => {
        const turn = this.sqlite.query("UPDATE turns SET status = 'queued', finished_at = NULL, updated_at = ? WHERE id = ? AND status = 'interrupted'").run(now(), turnID)
        if (turn.changes !== 1) return false
        this.sqlite.query("UPDATE agent_executions SET status = 'queued', error = NULL, updated_at = ? WHERE id = ? AND status = 'interrupted'").run(now(), checkpoint.agentID)
        return true
      })
    }

  deleteAgentTurnCheckpoint(turnID: string) {
      this.sqlite.query("DELETE FROM agent_checkpoints WHERE turn_id = ?").run(turnID)
    }

  currentPlan(turnID: string) {
      const row = this.sqlite.query("SELECT data FROM items WHERE turn_id = ? AND type = 'plan' ORDER BY created_at DESC LIMIT 1").get(turnID) as { data: string } | null
      if (!row) return null
      const data = parse<Record<string, unknown>>(row.data)
      return typeof data.markdown === "string" ? data.markdown : null
    }

  setCurrentPlanState(turnID: string, state: "confirmed" | "rejected") {
      const row = this.sqlite.query("SELECT id, thread_id, agent_id, data, created_at FROM items WHERE turn_id = ? AND type = 'plan' ORDER BY created_at DESC LIMIT 1").get(turnID) as { id: string; thread_id: string; agent_id: string; data: string; created_at: number } | null
      if (!row) return null
      const item: Item = {
        id: row.id,
        turnID,
        agentID: row.agent_id,
        type: "plan",
        status: "completed",
        data: { ...parse<Record<string, unknown>>(row.data), state },
        createdAt: row.created_at,
        updatedAt: now(),
      }
      this.upsertItem(row.thread_id, item)
      return item
    }

  upsertItem(threadID: string, item: Item) {
      const existing = this.sqlite.query("SELECT ordinal FROM items WHERE id = ?").get(item.id) as { ordinal: number } | null
      const ordinal = item.ordinal ?? existing?.ordinal ?? Number(
        (this.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM items WHERE turn_id = ?").get(item.turnID) as { ordinal: number }).ordinal,
      )
      this.sqlite.query(`INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`).run(
        item.id,
        threadID,
        item.turnID,
        item.agentID,
        item.type,
        item.status,
        stringify(item.data),
        ordinal,
        item.createdAt,
        item.updatedAt,
      )
    }

  upsertItemWithEvent(threadID: string, item: Item, method: string, params?: unknown | ((item: Item) => unknown)) {
      return this.transaction(() => {
        this.upsertItem(threadID, item)
        const persisted = this.getItem(item.id) ?? item
        return {
          item: persisted,
          event: this.insertEvent(threadID, item.turnID, method, typeof params === "function" ? params(persisted) : params ?? { item: persisted }),
        }
      })
    }

  getItem(itemID: string) {
      const row = this.sqlite.query("SELECT id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at FROM items WHERE id = ?").get(itemID) as
        | { id: string; turn_id: string; agent_id: string; type: Item["type"]; status: Item["status"]; data: string; ordinal: number; created_at: number; updated_at: number }
        | null
      return row ? { id: row.id, turnID: row.turn_id, agentID: row.agent_id, type: row.type, status: row.status, data: parse<Record<string, unknown>>(row.data), ordinal: row.ordinal, createdAt: row.created_at, updatedAt: row.updated_at } satisfies Item : null
    }

  insertEvent(threadId: string | null, turnId: string | null, method: string, params: unknown): EventEnvelope {
      const createdAt = now()
      const result = this.sqlite.query("INSERT INTO events (thread_id, turn_id, method, params, created_at) VALUES (?, ?, ?, ?, ?)").run(threadId, turnId, method, stringify(params), createdAt)
      return { id: Number(result.lastInsertRowid), threadId, turnId, method, params, createdAt }
    }

  eventsAfter(after: number, threadID?: string, limit = 1000): EventEnvelope[] {
      const rows = threadID
        ? this.sqlite.query("SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id > ? AND (thread_id = ? OR thread_id IS NULL) ORDER BY id LIMIT ?").all(after, threadID, limit)
        : this.sqlite.query("SELECT id, thread_id, turn_id, method, params, created_at FROM events WHERE id > ? ORDER BY id LIMIT ?").all(after, limit)
      return (rows as Array<{ id: number; thread_id: string | null; turn_id: string | null; method: string; params: string; created_at: number }>).map((row) => ({
        id: row.id,
        threadId: row.thread_id,
        turnId: row.turn_id,
        method: row.method,
        params: parse(row.params),
        createdAt: row.created_at,
      }))
    }

  effect<T>(operation: () => T) {
      return Effect.try({ try: operation, catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)) })
    }
}

export type ExecutionRepository = ExecutionRepositoryDatabase
export const executionRepository = (database: ExecutionRepositoryDatabase): ExecutionRepository => database
