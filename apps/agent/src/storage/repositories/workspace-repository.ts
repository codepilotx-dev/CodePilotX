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
  | { kind: "project"; projectID: string; workspaceRoot: string; cwd: string; outputDirectory: null }
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

import { CredentialRepositoryDatabase } from "./credential-repository"

export abstract class WorkspaceRepositoryDatabase extends CredentialRepositoryDatabase {
  setSetting(key: string, value: unknown) {
      this.profileSqlite.query(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, stringify(value), now())
    }

  getSetting<T>(key: string): T | null {
      const row = this.profileSqlite.query("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null
      return row ? parse<T>(row.value) : null
    }

  run(sql: string, ...params: SqlValue[]) {
      return this.sqlite.query(sql).run(...params)
    }

  private mapProject(row: { id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number }): StoredProject {
      return {
        id: row.id,
        name: row.name,
        rootPath: row.root_path,
        lastOpenedAt: row.last_opened_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        settings: this.getProjectSettings(row.id),
      }
    }

  protected requireProject(projectID: string) {
      const project = this.getProject(projectID)
      if (!project) throw new Error(`项目 ${projectID} 不存在`)
      return project
    }

  createProject(input: { rootPath: string; name?: string }) {
      const rootPath = resolve(input.rootPath)
      const timestamp = now()
      const existing = this.profileSqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects WHERE root_path = ?").get(rootPath) as { id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number } | null
      if (existing) {
        this.profileSqlite.query("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, existing.id)
        return this.getProject(existing.id)!
      }
      const id = crypto.randomUUID()
      const name = input.name?.trim() || basename(rootPath) || rootPath
      this.profileSqlite.transaction(() => {
        this.profileSqlite.query("INSERT INTO projects (id, name, root_path, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, rootPath, timestamp, timestamp, timestamp)
        this.profileSqlite.query("INSERT INTO project_settings (project_id, default_model, updated_at) VALUES (?, NULL, ?)").run(id, timestamp)
      })()
      return this.getProject(id)!
    }

  listProjects() {
      const rows = this.profileSqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects ORDER BY last_opened_at DESC, created_at DESC").all() as Array<{ id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number }>
      return rows.map((row) => this.mapProject(row))
    }

  getProject(projectID: string) {
      const row = this.profileSqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects WHERE id = ?").get(projectID) as { id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number } | null
      return row ? this.mapProject(row) : null
    }

  touchProject(projectID: string) {
      this.requireProject(projectID)
      const timestamp = now()
      this.profileSqlite.query("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, projectID)
      return this.getProject(projectID)!
    }

  getProjectSettings(projectID: string): ProjectModelSettings {
      const row = this.profileSqlite.query("SELECT default_model FROM project_settings WHERE project_id = ?").get(projectID) as { default_model: string | null } | null
      return {
        defaultModel: row?.default_model ? parse<ModelRef>(row.default_model) : null,
      }
    }

  saveProjectSettings(projectID: string, settings: ProjectModelSettings) {
      this.requireProject(projectID)
      const timestamp = now()
      this.profileSqlite.query(`INSERT INTO project_settings (project_id, default_model, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET default_model = excluded.default_model, updated_at = excluded.updated_at`).run(
        projectID,
        settings.defaultModel ? stringify(settings.defaultModel) : null,
        timestamp,
      )
      return this.getProjectSettings(projectID)
    }

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

  saveInteractionOperation(input: {
      operationID: string
      interactionID: string
      response: Record<string, unknown>
      result: Record<string, unknown>
    }) {
      const existing = this.interactionOperation(input.operationID)
      if (existing) return existing
      this.sqlite.query(`
        INSERT INTO interaction_operations (
          operation_id, interaction_id, response, result, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(input.operationID, input.interactionID, stringify(input.response), stringify(input.result), now())
      return this.interactionOperation(input.operationID)!
    }

  resolveProjectModel(projectID: string, globalDefault: ModelRef | null) {
      const settings = this.getProjectSettings(projectID)
      return settings.defaultModel ?? globalDefault
    }

  threadProjectID(threadID: string) {
      const row = this.sqlite.query("SELECT project_id FROM threads WHERE id = ?").get(threadID) as { project_id: string | null } | null
      if (!row) return null
      return row.project_id
    }

  threadWorkspace(threadID: string): StoredThreadWorkspace | null {
      const row = this.sqlite.query(`
        SELECT project_id, workspace_kind, workspace_root, workspace_cwd, output_directory
        FROM threads WHERE id = ?
      `).get(threadID) as {
        project_id: string | null
        workspace_kind: string
        workspace_root: string | null
        workspace_cwd: string | null
        output_directory: string | null
      } | null
      if (!row || row.workspace_kind === "legacy") return null
      if (row.workspace_kind === "project" && row.project_id) {
        const project = this.getProject(row.project_id)
        if (!project) throw new AgentError("PROJECT_NOT_FOUND", `Thread ${threadID} 绑定的项目不存在`, 404)
        return { kind: "project", projectID: row.project_id, workspaceRoot: project.rootPath, cwd: project.rootPath, outputDirectory: null }
      }
      if (
        row.workspace_kind === "projectless" &&
        row.project_id === null &&
        row.workspace_root &&
        row.workspace_cwd &&
        row.output_directory
      ) {
        return {
          kind: "projectless",
          projectID: null,
          workspaceRoot: row.workspace_root,
          cwd: row.workspace_cwd,
          outputDirectory: row.output_directory,
        }
      }
      throw new AgentError("WORKSPACE_INVALID", `Thread ${threadID} 的工作区描述无效`, 500)
    }

  threadForCreateOperation(operationID: string) {
      const row = this.sqlite.query(`
        SELECT id, create_request_hash FROM threads WHERE create_operation_id = ?
      `).get(operationID) as { id: string; create_request_hash: string | null } | null
      return row ? { threadID: row.id, requestHash: row.create_request_hash } : null
    }

  setThreadProject(threadID: string, projectID: string | null) {
      if (projectID) this.requireProject(projectID)
      const result = this.sqlite.query(`UPDATE threads
        SET project_id = ?, workspace_kind = ?, workspace_root = NULL, workspace_cwd = NULL,
          output_directory = NULL, updated_at = ?
        WHERE id = ?`).run(projectID, projectID ? "project" : "legacy", now(), threadID)
      if (result.changes === 0) throw new Error(`Thread ${threadID} 不存在`)
    }

  setThreadWorkspace(threadID: string, workspace: CreateThreadInput["workspace"]) {
      if (workspace.kind === "project") {
        this.setThreadProject(threadID, workspace.projectID)
        return this.threadWorkspace(threadID)
      }
      const workspaceRoot = resolve(workspace.workspaceRoot)
      const cwd = resolve(workspace.cwd)
      const outputDirectory = resolve(workspace.outputDirectory)
      if (!containedPath(workspaceRoot, cwd) || !containedPath(workspaceRoot, outputDirectory)) {
        throw new AgentError("WORKSPACE_INVALID", "无项目会话的 cwd 和输出目录必须位于工作区根目录内", 400)
      }
      const result = this.sqlite.query(`UPDATE threads
        SET project_id = NULL, workspace_kind = 'projectless', workspace_root = ?, workspace_cwd = ?,
          output_directory = ?, updated_at = ?
        WHERE id = ?`).run(workspaceRoot, cwd, outputDirectory, now(), threadID)
      if (result.changes === 0) throw new Error(`Thread ${threadID} 不存在`)
      return this.threadWorkspace(threadID)
    }

  mapReviewComment(row: {
      id: string
      thread_id: string
      project_id: string
      source_key: string
      path: string
      side: "old" | "new"
      line: number
      hunk_id: string | null
      revision: string
      body: string
      status: "open" | "resolved"
      github_comment_id: string | null
      github_thread_id: string | null
      created_at: number
      updated_at: number
    }): ReviewComment {
      return {
        id: row.id,
        threadId: row.thread_id,
        projectId: row.project_id,
        sourceKey: row.source_key,
        path: row.path,
        side: row.side,
        line: row.line,
        hunkId: row.hunk_id,
        revision: row.revision,
        body: row.body,
        status: row.status,
        githubCommentId: row.github_comment_id,
        githubThreadId: row.github_thread_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }
    }
}

export type WorkspaceRepository = WorkspaceRepositoryDatabase
export const workspaceRepository = (database: WorkspaceRepositoryDatabase): WorkspaceRepository => database
