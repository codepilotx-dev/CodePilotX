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
  instructions: string
  version: number
}

export type StoredProjectFolder = {
  id: string
  name: string
  path: string
  role: "primary" | "secondary"
  availability: "available" | "missing"
  order: number
  createdAt: number
  updatedAt: number
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
  primaryFolderId: string
  folders: StoredProjectFolder[]
  removedAt: number | null
  /** Internal compatibility alias for the primary folder. */
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
  | {
      kind: "project"
      projectID: string
      cwd: string
      runtimeWorkspaceRoots: Array<{ folderId: string; path: string; role: "primary" | "secondary" }>
      instructionSources: string[]
      outputDirectory: null
    }
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

import { ProjectRepositoryDatabase } from "./project-repository"

export abstract class WorkspaceRepositoryDatabase extends ProjectRepositoryDatabase {
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

  threadProjectID(threadID: string) {
      const row = this.sqlite.query("SELECT project_id FROM threads WHERE id = ?").get(threadID) as { project_id: string | null } | null
      if (!row) return null
      return row.project_id
    }

  threadWorkspace(threadID: string): StoredThreadWorkspace | null {
      const row = this.sqlite.query(`
        SELECT project_id, workspace_kind, workspace_root, workspace_cwd,
          workspace_roots, instruction_sources, output_directory
        FROM threads WHERE id = ?
      `).get(threadID) as {
        project_id: string | null
        workspace_kind: string
        workspace_root: string | null
        workspace_cwd: string | null
        workspace_roots: string | null
        instruction_sources: string | null
        output_directory: string | null
      } | null
      if (!row || row.workspace_kind === "legacy") return null
      if (row.workspace_kind === "project" && row.project_id) {
        const project = this.getProject(row.project_id)
        if (!project) throw new AgentError("PROJECT_NOT_FOUND", `Thread ${threadID} 绑定的项目不存在`, 404)
        const runtimeWorkspaceRoots = row.workspace_roots
          ? parse<Array<{ folderId: string; path: string; role: "primary" | "secondary" }>>(row.workspace_roots)
          : project.folders.map(({ id: folderId, path, role }) => ({ folderId, path, role }))
        return {
          kind: "project",
          projectID: row.project_id,
          cwd: row.workspace_cwd ?? project.rootPath,
          runtimeWorkspaceRoots,
          instructionSources: row.instruction_sources ? parse<string[]>(row.instruction_sources) : [],
          outputDirectory: null,
        }
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
      const project = projectID ? this.requireProject(projectID) : null
      const result = this.sqlite.query(`UPDATE threads
        SET project_id = ?, workspace_kind = ?, workspace_root = NULL, workspace_cwd = ?,
          workspace_roots = ?, instruction_sources = ?, output_directory = NULL, updated_at = ?
        WHERE id = ?`).run(
          projectID,
          projectID ? "project" : "legacy",
          project?.rootPath ?? null,
          project ? stringify(project.folders.map(({ id: folderId, path, role }) => ({ folderId, path, role }))) : null,
          project ? "[]" : null,
          now(),
          threadID,
        )
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
          workspace_roots = NULL, instruction_sources = NULL, output_directory = ?, updated_at = ?
        WHERE id = ?`).run(workspaceRoot, cwd, outputDirectory, now(), threadID)
      if (result.changes === 0) throw new Error(`Thread ${threadID} 不存在`)
      return this.threadWorkspace(threadID)
    }

  refreshThreadProjectContext(input: {
    threadID: string
    runtimeWorkspaceRoots: Array<{ folderId: string; path: string; role: "primary" | "secondary" }>
    instructionSources: string[]
  }) {
      const result = this.sqlite.query(`
        UPDATE threads
        SET workspace_roots = ?, instruction_sources = ?, updated_at = ?
        WHERE id = ? AND workspace_kind = 'project'
      `).run(
        stringify(input.runtimeWorkspaceRoots),
        stringify(input.instructionSources),
        now(),
        input.threadID,
      )
      if (result.changes === 0) {
        throw new AgentError("THREAD_NOT_FOUND", "项目任务不存在", 404)
      }
      return this.threadWorkspace(input.threadID)
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
