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

import { InteractionRepositoryDatabase } from "./interaction-repository"

export abstract class SubagentRepositoryDatabase extends InteractionRepositoryDatabase {
  checkpointSubagentWait(input: {
    agentID: string
    turnID: string
    threadID: string
    state: string
    interruption: unknown
    runIDs: string[]
    mode: "all" | "any"
  }) {
    return this.transaction(() => {
      this.saveAgentTurnCheckpoint({
        agentID: input.agentID,
        turnID: input.turnID,
        threadID: input.threadID,
        state: "waiting_subagents",
        payload: {
          kind: "subagent-wait",
          state: input.state,
          interruption: input.interruption,
          runIDs: input.runIDs,
          mode: input.mode,
        },
        version: 1,
      })
      this.updateTurnStatus(input.turnID, "waiting_subagents")
      const agent = this.updateAgentStatus(input.agentID, "waiting_subagents")
      const events = [
        this.insertEvent(input.threadID, input.turnID, "agent/upserted", { agent }),
        this.insertEvent(input.threadID, input.turnID, "turn/statusChanged", {
          turnId: input.turnID,
          rootAgentId: input.agentID,
          status: "waiting-subagents",
          runIds: input.runIDs,
          mode: input.mode,
        }),
      ]
      return { agent, events }
    })
  }

  resumeSatisfiedSubagentWaits() {
    return this.transaction(() => {
      const rows = this.sqlite.query(`
        SELECT agent_id, turn_id, thread_id, payload
        FROM agent_checkpoints
        WHERE state = 'waiting_subagents'
      `).all() as Array<{ agent_id: string; turn_id: string; thread_id: string; payload: string }>
      const resumed: Array<{ agentID: string; turnID: string; threadID: string; events: EventEnvelope[] }> = []
      for (const row of rows) {
        const payload = parse<Record<string, unknown>>(row.payload)
        const runIDs = Array.isArray(payload.runIDs) ? payload.runIDs.filter((value): value is string => typeof value === "string") : []
        const mode = payload.mode === "any" ? "any" : "all"
        if (runIDs.length === 0) continue
        const placeholders = runIDs.map(() => "?").join(",")
        const states = this.sqlite.query(`SELECT id, status FROM subagent_runs WHERE id IN (${placeholders})`).all(...runIDs) as Array<{ id: string; status: string }>
        if (states.length !== runIDs.length) continue
        const terminal = new Set(["completed", "failed", "stopped", "interrupted"])
        const satisfied = mode === "all"
          ? states.every((run) => terminal.has(run.status))
          : states.some((run) => terminal.has(run.status))
        if (!satisfied) continue
        const timestamp = now()
        const claimed = this.sqlite.query(`
          UPDATE agent_checkpoints
          SET state = 'ready', payload = json_set(payload, '$.kind', 'subagent-wait'), updated_at = ?
          WHERE agent_id = ? AND state = 'waiting_subagents'
        `).run(timestamp, row.agent_id)
        if (claimed.changes !== 1) continue
        this.updateTurnStatus(row.turn_id, "queued")
        const agent = this.updateAgentStatus(row.agent_id, "queued")
        resumed.push({
          agentID: row.agent_id,
          turnID: row.turn_id,
          threadID: row.thread_id,
          events: [
            this.insertEvent(row.thread_id, row.turn_id, "agent/upserted", { agent }),
            this.insertEvent(row.thread_id, row.turn_id, "turn/statusChanged", {
              turnId: row.turn_id,
              status: "queued",
              resumedFrom: "waiting-subagents",
            }),
          ],
        })
      }
      return resumed
    })
  }

  recoverInterruptedSubagents(timestamp: number) {
    this.sqlite.query("UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'queued' AND a.status = 'queued' AND a.subagent_run_id IS NOT NULL)").run(timestamp)
    this.sqlite.query("UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'queued')").run(timestamp)
    this.sqlite.query("UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'queued')").run(timestamp)
    this.sqlite.query("UPDATE subagent_runs SET status = 'interrupted', error = COALESCE(error, 'Agent 重启时运行被中断'), finished_at = ?, updated_at = ? WHERE status IN ('preparing', 'running', 'steering') OR (status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'interrupted' AND a.subagent_run_id IS NOT NULL))").run(timestamp, timestamp)
    this.sqlite.query("UPDATE subagent_tasks SET status = 'interrupted', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')").run(timestamp)
    this.sqlite.query("UPDATE items SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')").run(timestamp)
    this.sqlite.query("DELETE FROM workspace_writer_leases WHERE run_id NOT IN (SELECT id FROM subagent_runs WHERE status IN ('preparing', 'running', 'steering', 'waiting_question', 'waiting_permission'))").run()
  }

}

export type SubagentRepositoryContract = SubagentRepositoryDatabase
export const subagentRepositoryDatabase = (database: SubagentRepositoryDatabase): SubagentRepositoryContract => database
