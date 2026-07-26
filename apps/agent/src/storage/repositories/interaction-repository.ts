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
  StoredInputDelivery,
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
  state: "waiting_question" | "waiting_hook_trust" | "waiting_subagents" | "ready"
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
export type InteractionOperationInput = {
  operationID: string
  interactionID: string
  response: Record<string, unknown>
  result: Record<string, unknown>
}

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

import { ExecutionRepositoryDatabase } from "./execution-repository"

export abstract class InteractionRepositoryDatabase extends ExecutionRepositoryDatabase {
  interactionOperation(operationID: string) {
      const row = this.sqlite.query("SELECT interaction_id, response, result FROM interaction_operations WHERE operation_id = ?").get(operationID) as {
        interaction_id: string
        response: string
        result: string
      } | null
      return row ? {
        interactionID: row.interaction_id,
        response: parse<Record<string, unknown>>(row.response),
        result: parse<Record<string, unknown>>(row.result),
      } : null
    }

  saveInteractionOperation(input: InteractionOperationInput) {
      const existing = this.interactionOperation(input.operationID)
      if (existing) return existing
      this.sqlite.query(`
        INSERT INTO interaction_operations (
          operation_id, interaction_id, response, result, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(input.operationID, input.interactionID, stringify(input.response), stringify(input.result), now())
      return this.interactionOperation(input.operationID)!
    }

  persistApprovalCheckpoint(input: {
      approvalID: string
      invocation: ToolInvocation
      risk: string
      reason: string
      requestPayload: Record<string, unknown>
      reviewPayload: Record<string, unknown> | null
      checkpoint: ApprovalCheckpointPayload
      version: number
      createdAt?: number
    }) {
      const timestamp = input.createdAt ?? now()
      this.transaction(() => {
        this.sqlite.query(`INSERT INTO approval_requests (id, thread_id, turn_id, agent_id, tool_call_id, risk, reason, status, request_payload, review_payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?, ?)`).run(
          input.approvalID, input.invocation.threadID, input.invocation.turnID, input.invocation.agentID, input.invocation.id,
          input.risk, input.reason, stringify(input.requestPayload), input.reviewPayload ? stringify(input.reviewPayload) : null, timestamp,
        )
        this.sqlite.query(`INSERT INTO approval_checkpoints (approval_id, thread_id, turn_id, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          input.approvalID, input.invocation.threadID, input.invocation.turnID, stringify(input.checkpoint), input.version, timestamp, timestamp,
        )
      })
      return this.getApprovalCheckpoint(input.approvalID)!
    }

  getApprovalCheckpoint(approvalID: string): StoredApprovalCheckpoint | null {
      const row = this.sqlite.query(`SELECT r.id, r.thread_id, r.turn_id, r.agent_id, r.tool_call_id, r.status, r.reply, r.risk, r.reason, r.created_at, c.payload, c.version, c.updated_at FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.id = ?`).get(approvalID) as {
        id: string; thread_id: string; turn_id: string; agent_id: string; tool_call_id: string; status: StoredApprovalCheckpoint["status"]
        reply: "allow" | "deny" | null; risk: string; reason: string; created_at: number; payload: string; version: number; updated_at: number
      } | null
      if (!row) return null
      return { approvalID: row.id, threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id, toolCallID: row.tool_call_id, status: row.status, decision: row.reply, risk: row.risk, reason: row.reason, payload: parse<ApprovalCheckpointPayload>(row.payload), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }
    }

  approvalCheckpointForToolCall(toolCallID: string): StoredApprovalCheckpoint | null {
      const row = this.sqlite.query("SELECT id FROM approval_requests WHERE tool_call_id = ? ORDER BY created_at DESC LIMIT 1").get(toolCallID) as { id: string } | null
      return row ? this.getApprovalCheckpoint(row.id) : null
    }

  updateApprovalCheckpointPayload(approvalID: string, payload: ApprovalCheckpointPayload) {
      const result = this.sqlite.query("UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?").run(stringify(payload), now(), approvalID)
      if (result.changes !== 1) throw new Error(`审批 ${approvalID} checkpoint 不存在`)
      return this.getApprovalCheckpoint(approvalID)!
    }

  activateApprovalCheckpoint(approvalID: string, payload: ApprovalCheckpointPayload, requestedParams: Record<string, unknown>) {
      const row = this.sqlite.query("SELECT turn_id, agent_id, status FROM approval_requests WHERE id = ?").get(approvalID) as { turn_id: string; agent_id: string; status: string } | null
      if (!row) throw new Error(`审批 ${approvalID} 不存在`)
      if (row.status === "pending") return { checkpoint: this.getApprovalCheckpoint(approvalID)!, events: [] as EventEnvelope[] }
      if (row.status !== "preparing") throw new Error(`审批 ${approvalID} 不能从 ${row.status} 激活`)
      const timestamp = now()
      const events: EventEnvelope[] = []
      this.transaction(() => {
        const updated = this.sqlite.query("UPDATE approval_requests SET status = 'pending' WHERE id = ? AND status = 'preparing'").run(approvalID)
        if (updated.changes !== 1) throw new Error(`审批 ${approvalID} 已被并发处理`)
        this.sqlite.query("UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?").run(stringify(payload), timestamp, approvalID)
        this.updateTurnStatus(row.turn_id, "waiting_permission")
        this.updateAgentStatus(row.agent_id, "waiting_permission")
        events.push(this.insertEvent(payload.invocation.threadID, row.turn_id, "agent/upserted", { agent: this.getAgentExecution(row.agent_id) }))
        events.push(this.insertEvent(
          payload.invocation.threadID,
          row.turn_id,
          payload.invocation.name === "request_permissions" ? "permission/requested" : "approval/requested",
          requestedParams,
        ))
      })
      return { checkpoint: this.getApprovalCheckpoint(approvalID)!, events }
    }

  resolveApprovalCheckpoint(
    approvalID: string,
    decision: "allow" | "deny",
    feedback?: string,
    operation?: InteractionOperationInput,
  ):
      | { state: "resolved"; checkpoint: StoredApprovalCheckpoint; events: EventEnvelope[] }
      | { state: "missing" | "not-ready" | "already-resolved"; threadID?: string; turnID?: string; agentID?: string }
      | { state: "invalid-checkpoint"; threadID: string; turnID: string; agentID: string; events: EventEnvelope[] } {
      const request = this.sqlite.query("SELECT thread_id, turn_id, agent_id, status FROM approval_requests WHERE id = ?").get(approvalID) as { thread_id: string; turn_id: string; agent_id: string; status: string } | null
      if (!request) return { state: "missing" }
      if (request.status === "preparing") return { state: "not-ready", threadID: request.thread_id, turnID: request.turn_id, agentID: request.agent_id }
      if (request.status !== "pending") return { state: "already-resolved", threadID: request.thread_id, turnID: request.turn_id, agentID: request.agent_id }
      const checkpoint = this.getApprovalCheckpoint(approvalID)
      if (!checkpoint || checkpoint.version !== 1 || checkpoint.payload.kind !== "tool-approval" || !checkpoint.payload.invocationHash) {
        const invalidated = this.invalidateApprovalCheckpoint(approvalID, "审批缺少可恢复 checkpoint")
        return { state: "invalid-checkpoint", threadID: request.thread_id, turnID: request.turn_id, agentID: request.agent_id, events: invalidated?.events ?? [] }
      }
      const timestamp = now()
      const events: EventEnvelope[] = []
      this.transaction(() => {
        const updated = this.sqlite.query("UPDATE approval_requests SET status = 'resolved', reply = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(decision, timestamp, approvalID)
        if (updated.changes !== 1) throw new Error(`审批 ${approvalID} 已被并发处理`)
        const resolution = { decision, ...(feedback ? { feedback } : {}), resolvedAt: timestamp }
        this.sqlite.query("UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?").run(stringify({ ...checkpoint.payload, resolution }), timestamp, approvalID)
        this.updateTurnStatus(request.turn_id, "queued")
        this.updateAgentStatus(request.agent_id, "queued")
        events.push(this.insertEvent(request.thread_id, request.turn_id, "agent/upserted", { agent: this.getAgentExecution(request.agent_id) }))
        events.push(this.insertEvent(request.thread_id, request.turn_id, "serverRequest/resolved", { id: approvalID, turnId: request.turn_id, kind: "approval", decision }))
        if (operation) this.saveInteractionOperation(operation)
      })
      return { state: "resolved", checkpoint: this.getApprovalCheckpoint(approvalID)!, events }
    }

  claimResolvedApproval(turnID: string): StoredApprovalCheckpoint | null {
      const row = this.sqlite.query(`SELECT r.id FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.turn_id = ? AND r.status = 'resolved' ORDER BY r.resolved_at, r.created_at LIMIT 1`).get(turnID) as { id: string } | null
      if (!row) return null
      const checkpoint = this.getApprovalCheckpoint(row.id)
      if (!checkpoint || !checkpoint.payload.resolution) return null
      const timestamp = now()
      return this.transaction(() => {
        const updated = this.sqlite.query("UPDATE approval_requests SET status = 'claimed' WHERE id = ? AND status = 'resolved'").run(row.id)
        if (updated.changes !== 1) return null
        this.sqlite.query("UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?").run(stringify({ ...checkpoint.payload, claimedAt: timestamp }), timestamp, row.id)
        return this.getApprovalCheckpoint(row.id)
      })
    }

  cancelApprovalsForTurn(turnID: string) {
      const timestamp = now()
      this.sqlite.query("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE turn_id = ? AND status IN ('preparing', 'pending', 'resolved')").run(timestamp, turnID)
    }

  invalidateApprovalCheckpoint(approvalID: string, reason: string) {
      const row = this.sqlite.query("SELECT thread_id, turn_id, agent_id FROM approval_requests WHERE id = ?").get(approvalID) as { thread_id: string; turn_id: string; agent_id: string } | null
      if (!row) return null
      const events: EventEnvelope[] = []
      this.transaction(() => {
        const timestamp = now()
        const updated = this.sqlite.query("UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE id = ? AND status IN ('preparing', 'pending', 'resolved')").run(timestamp, approvalID)
        if (updated.changes !== 1) return
        this.updateTurnStatus(row.turn_id, "interrupted")
        this.updateAgentStatus(row.agent_id, "interrupted", reason)
        events.push(this.insertEvent(row.thread_id, row.turn_id, "approval/cancelled", { id: approvalID, turnId: row.turn_id, reason, cancelledAt: timestamp }))
        events.push(this.insertEvent(row.thread_id, row.turn_id, "agent/upserted", { agent: this.getAgentExecution(row.agent_id) }))
        events.push(this.insertEvent(row.thread_id, row.turn_id, "turn/interrupted", { turnId: row.turn_id, rootAgentId: row.agent_id, reason: "invalid-approval-checkpoint", finishedAt: timestamp }))
      })
      return { events }
    }

  hookTrustDecision(workspacePath: string, configHash: string): "allow" | "block" | null {
      const row = this.profileSqlite.query("SELECT decision FROM hook_trust_decisions WHERE workspace_path = ? AND config_hash = ?").get(workspacePath, configHash) as { decision: "allow" | "block" } | null
      return row?.decision ?? null
    }

  ensureHookTrustRequest(input: Omit<HookTrustRequest, "id" | "status" | "createdAt" | "resolvedAt">) {
      return this.transaction(() => {
        const existing = this.sqlite.query("SELECT id FROM hook_trust_requests WHERE workspace_path = ? AND config_hash = ? AND status = 'pending'").get(input.workspacePath, input.configHash) as { id: string } | null
        const id = existing?.id ?? crypto.randomUUID()
        const createdAt = now()
        let waiterAdded = false
        if (!existing) this.sqlite.query("INSERT INTO hook_trust_requests (id, thread_id, turn_id, workspace_path, config_path, config_hash, status, audit_summary, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)").run(
          id, input.threadID, input.turnID, input.workspacePath, input.configPath, input.configHash, stringify(input.auditSummary), createdAt,
        )
        if (input.threadID && input.turnID) {
          const execution = this.sqlite.query("SELECT id, subagent_run_id FROM agent_executions WHERE turn_id = ?").get(input.turnID) as { id: string; subagent_run_id: string | null } | null
          if (execution) {
            waiterAdded = this.sqlite.query("INSERT OR IGNORE INTO hook_trust_waiters (request_id, agent_id, turn_id, thread_id, created_at) VALUES (?, ?, ?, ?, ?)").run(id, execution.id, input.turnID, input.threadID, createdAt).changes === 1
            this.sqlite.query(`INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'waiting_hook_trust', ?, 1, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
              execution.id, input.turnID, input.threadID, stringify({ kind: "hook-trust", requestID: id }), createdAt, createdAt,
            )
            this.updateTurnStatus(input.turnID, "waiting_permission")
            this.updateAgentStatus(execution.id, "waiting_permission")
            if (execution.subagent_run_id) {
              this.sqlite.query("UPDATE subagent_runs SET status = 'waiting_permission', updated_at = ? WHERE id = ?").run(createdAt, execution.subagent_run_id)
              this.sqlite.query("UPDATE subagent_tasks SET status = 'waiting_permission', updated_at = ? WHERE current_run_id = ?").run(createdAt, execution.subagent_run_id)
              this.sqlite.query(`UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'waiting_permission', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') = ?`).run(createdAt, execution.subagent_run_id)
            }
          }
        }
        const request = this.getHookTrustRequest(id)!
        // Every newly-added waiter gets one durable notification, even when the
        // workspace/hash request was deduplicated against another turn.
        const event = !existing || waiterAdded
          ? this.insertEvent(input.threadID, input.turnID, "hook/trust/requested", { request, reused: Boolean(existing) })
          : null
        return { request, event }
      })
    }

  getHookTrustRequest(id: string): HookTrustRequest | null {
      const row = this.sqlite.query("SELECT id, thread_id, turn_id, workspace_path, config_path, config_hash, status, audit_summary, created_at, resolved_at FROM hook_trust_requests WHERE id = ?").get(id) as Record<string, string | number | null> | null
      return row ? {
        id: String(row.id), threadID: row.thread_id == null ? null : String(row.thread_id), turnID: row.turn_id == null ? null : String(row.turn_id),
        workspacePath: String(row.workspace_path), configPath: String(row.config_path), configHash: String(row.config_hash), status: String(row.status) as HookTrustRequest["status"],
        auditSummary: parse<Record<string, unknown>>(String(row.audit_summary)), createdAt: Number(row.created_at), resolvedAt: row.resolved_at == null ? null : Number(row.resolved_at),
      } : null
    }

  resolveHookTrustRequest(id: string, decision: "allow" | "block", operation?: InteractionOperationInput) {
      const pending = this.getHookTrustRequest(id)
      if (pending?.status === "pending") {
        const timestamp = now()
        this.profileSqlite.query(`INSERT INTO hook_trust_decisions (workspace_path, config_hash, config_path, decision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_path, config_hash) DO UPDATE SET config_path = excluded.config_path, decision = excluded.decision, updated_at = excluded.updated_at`).run(
          pending.workspacePath, pending.configHash, pending.configPath, decision, timestamp, timestamp,
        )
      }
      return this.transaction(() => {
        const request = this.getHookTrustRequest(id)
        if (!request) return { state: "missing" as const, request: null, events: [], resumed: [] }
        if (request.status !== "pending") return { state: "resolved" as const, request, events: [], resumed: [] }
        const timestamp = now()
        this.sqlite.query("UPDATE hook_trust_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(decision === "allow" ? "allowed" : "blocked", timestamp, id)
        const resolved = this.getHookTrustRequest(id)!
        const waiters = this.sqlite.query("SELECT agent_id, turn_id, thread_id FROM hook_trust_waiters WHERE request_id = ?").all(id) as Array<{ agent_id: string; turn_id: string; thread_id: string }>
        const resumed = waiters.map((waiter) => ({ agentID: waiter.agent_id, turnID: waiter.turn_id, threadID: waiter.thread_id }))
        const events = resumed.length ? resumed.map((waiter) => {
          this.updateTurnStatus(waiter.turnID, "queued")
          this.updateAgentStatus(waiter.agentID, "queued")
          this.sqlite.query("DELETE FROM agent_checkpoints WHERE agent_id = ? AND state = 'waiting_hook_trust'").run(waiter.agentID)
          const execution = this.getAgentExecution(waiter.agentID)
          if (execution?.subagentRunID) {
            this.sqlite.query("UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE id = ?").run(timestamp, execution.subagentRunID)
            this.sqlite.query("UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id = ?").run(timestamp, execution.subagentRunID)
            this.sqlite.query(`UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') = ?`).run(timestamp, execution.subagentRunID)
          }
          return this.insertEvent(waiter.threadID, waiter.turnID, "hook/trust/resolved", { request: resolved, decision, resumed: true })
        }) : [this.insertEvent(resolved.threadID, resolved.turnID, "hook/trust/resolved", { request: resolved, decision, resumed: false })]
        if (operation) this.saveInteractionOperation(operation)
        return { state: "resolved" as const, request: resolved, events, resumed }
      })
    }

  createSandboxEscalation(input: Omit<SandboxEscalation, "status" | "createdAt">) {
      const createdAt = now()
      this.sqlite.query("INSERT INTO sandbox_escalations (token, thread_id, turn_id, agent_id, tool_call_id, invocation, invocation_hash, failure, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_request', ?)").run(input.token, input.threadID, input.turnID, input.agentID, input.toolCallID, stringify(input.invocation), input.invocationHash, input.failure, createdAt)
      return { ...input, status: "awaiting_request" as const, createdAt }
    }

  getSandboxEscalation(token: string): SandboxEscalation | null {
      const row = this.sqlite.query("SELECT token, thread_id, turn_id, agent_id, tool_call_id, invocation, invocation_hash, failure, status, created_at FROM sandbox_escalations WHERE token = ?").get(token) as { token: string; thread_id: string; turn_id: string; agent_id: string; tool_call_id: string; invocation: string; invocation_hash: string; failure: string; status: SandboxEscalation["status"]; created_at: number } | null
      return row ? { token: row.token, threadID: row.thread_id, turnID: row.turn_id, agentID: row.agent_id, toolCallID: row.tool_call_id, invocation: parse<ToolInvocation>(row.invocation), invocationHash: row.invocation_hash, failure: row.failure, status: row.status, createdAt: row.created_at } : null
    }

  claimSandboxEscalation(token: string, scope: { threadID: string; turnID: string; agentID: string }) {
      const escalation = this.getSandboxEscalation(token)
      if (!escalation || escalation.threadID !== scope.threadID || escalation.turnID !== scope.turnID || escalation.agentID !== scope.agentID || escalation.status !== "awaiting_request") return null
      const updated = this.sqlite.query("UPDATE sandbox_escalations SET status = 'claimed', claimed_at = ? WHERE token = ? AND status = 'awaiting_request'").run(now(), token)
      return updated.changes === 1 ? { ...escalation, status: "claimed" as const } : null
    }

  completeSandboxEscalation(token: string, output: unknown) {
      this.sqlite.query("UPDATE sandbox_escalations SET status = 'completed', output = ?, completed_at = ? WHERE token = ? AND status = 'claimed'").run(stringify(output), now(), token)
    }

  cancelSandboxEscalation(token: string, reason: string) {
      this.sqlite.query("UPDATE sandbox_escalations SET status = 'cancelled', output = ?, completed_at = ? WHERE token = ? AND status IN ('awaiting_request', 'claimed')").run(stringify({ error: reason }), now(), token)
    }

  createResumableQuestion(input: Omit<ResumableQuestion, "id" | "createdAt"> & { agentID: string; id?: string; createdAt?: number; checkpoint: Omit<AgentTurnCheckpoint, "agentID" | "turnID" | "threadID" | "state" | "createdAt" | "updatedAt"> }) {
      const id = input.id ?? crypto.randomUUID()
      const createdAt = input.createdAt ?? now()
      return this.transaction(() => {
        this.sqlite.query("INSERT INTO question_requests (id, thread_id, turn_id, agent_id, tool_call_id, payload, payload_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)").run(
          id,
          input.threadID,
          input.turnID,
          input.agentID,
          input.toolCallID,
          stringify(input.payload),
          input.payloadVersion,
          createdAt,
        )
        this.sqlite.query(`INSERT INTO agent_checkpoints (agent_id, turn_id, thread_id, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'waiting_question', ?, ?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET turn_id = excluded.turn_id, thread_id = excluded.thread_id, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
          input.agentID,
          input.turnID,
          input.threadID,
          stringify(input.checkpoint.payload),
          input.checkpoint.version,
          createdAt,
          createdAt,
        )
        this.updateTurnStatus(input.turnID, "waiting_question")
        this.updateAgentStatus(input.agentID, "waiting_question")
        const item = { id, turnID: input.turnID, agentID: input.agentID, type: "question" as const, status: "pending" as const, data: input.payload, createdAt, updatedAt: createdAt }
        this.upsertItem(input.threadID, item)
        const question = { id, threadID: input.threadID, turnID: input.turnID, toolCallID: input.toolCallID, payload: input.payload, payloadVersion: input.payloadVersion, createdAt } satisfies ResumableQuestion
        const events = [
          this.insertEvent(input.threadID, input.turnID, "agent/upserted", { agent: this.getAgentExecution(input.agentID) }),
          this.insertEvent(input.threadID, input.turnID, "question/requested", {
            interactionId: id,
            threadId: input.threadID,
            turnId: input.turnID,
            agentId: input.agentID,
            createdAt,
            version: input.payloadVersion,
            kind: "question",
            questions: input.payload.questions,
            ...(typeof input.payload.autoResolutionMs === "number"
              ? { autoResolutionMs: input.payload.autoResolutionMs }
              : {}),
          }),
        ]
        return { question, events }
      })
    }

  resolveResumableQuestion(
    id: string,
    answer: unknown,
    ignored = false,
    operation?: InteractionOperationInput,
  ) {
      const row = this.sqlite.query("SELECT thread_id, turn_id, status FROM question_requests WHERE id = ?").get(id) as { thread_id: string; turn_id: string; status: string } | null
      if (!row || row.status !== "pending") return null
      const timestamp = now()
      return this.transaction(() => {
        const checkpoint = this.getAgentTurnCheckpoint(row.turn_id)
        if (!checkpoint || checkpoint.state !== "waiting_question") throw new Error(`问题 ${id} 没有可恢复 checkpoint`)
        this.sqlite.query("UPDATE question_requests SET status = 'resolved', answer = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(stringify({ value: answer, ignored }), timestamp, id)
        this.saveAgentTurnCheckpoint({
          ...checkpoint,
          state: "ready",
          payload: { ...checkpoint.payload, questionID: id, answer },
        })
        this.updateTurnStatus(row.turn_id, "queued")
        this.updateAgentStatus(checkpoint.agentID, "queued")
        const item = this.getItem(id)
        if (item) this.upsertItem(row.thread_id, { ...item, status: "completed", data: { ...item.data, answer, ignored }, updatedAt: timestamp })
        const events = [
          this.insertEvent(row.thread_id, row.turn_id, "agent/upserted", { agent: this.getAgentExecution(checkpoint.agentID) }),
          this.insertEvent(row.thread_id, row.turn_id, "serverRequest/resolved", { id, turnId: row.turn_id, kind: "question", answer, ignored }),
        ]
        if (operation) this.saveInteractionOperation(operation)
        return { threadID: row.thread_id, turnID: row.turn_id, events }
      })
    }

  completeQuestionResume(id: string) {
      this.sqlite.query("UPDATE question_requests SET status = 'consumed' WHERE id = ? AND status = 'resuming'").run(id)
      this.sqlite.query("DELETE FROM agent_checkpoints WHERE turn_id = (SELECT turn_id FROM question_requests WHERE id = ?)").run(id)
    }

}

export type InteractionRepository = InteractionRepositoryDatabase
export const interactionRepository = (database: InteractionRepositoryDatabase): InteractionRepository => database
