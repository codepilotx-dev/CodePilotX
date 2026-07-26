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
  gitBranch: string | null
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

import { RepositoryCore } from "./repository-core"

export abstract class ThreadRepositoryDatabase extends RepositoryCore {
  getThreadSettings(threadID: string): ThreadSettings | null {
      const row = this.sqlite.query("SELECT task_mode, sandbox_mode, approval_policy, approvals_reviewer FROM threads WHERE id = ?").get(threadID) as ThreadSettingsColumns | null
      return row ? threadSettingsFromRow(row) : null
    }

  protected syncThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
      const existing = this.getThreadSettings(threadID)
      if (!existing) throw new Error("Thread not found")
      const settings: ThreadSettings = {
        taskMode: patch.taskMode ?? existing.taskMode,
        permissionConfig: patch.permissionConfig ?? existing.permissionConfig,
      }
      const unchanged = settings.taskMode === existing.taskMode
        && settings.permissionConfig.sandboxMode === existing.permissionConfig.sandboxMode
        && encodeApprovalPolicy(settings.permissionConfig.approvalPolicy) === encodeApprovalPolicy(existing.permissionConfig.approvalPolicy)
        && settings.permissionConfig.approvalsReviewer === existing.permissionConfig.approvalsReviewer
      if (unchanged) return { settings, event: null }
      this.sqlite.query(`
        UPDATE threads
        SET task_mode = ?, sandbox_mode = ?, approval_policy = ?, approvals_reviewer = ?
        WHERE id = ?
      `).run(
        settings.taskMode,
        settings.permissionConfig.sandboxMode,
        encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
        settings.permissionConfig.approvalsReviewer,
        threadID,
      )
      const event = this.insertEvent(threadID, null, "thread/settings/updated", { threadId: threadID, settings })
      return { settings, event }
    }

  updateThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
      return this.transaction(() => this.syncThreadSettings(threadID, patch))
    }

  getThreadPromptSettings<T extends Record<string, unknown> = Record<string, unknown>>(threadID: string): T | null {
      const row = this.sqlite.query("SELECT prompt_settings FROM threads WHERE id = ?").get(threadID) as { prompt_settings: string } | null
      return row ? parse<T>(row.prompt_settings) : null
    }

  saveThreadPromptSettings<T extends Record<string, unknown>>(threadID: string, settings: T) {
      return this.transaction(() => {
        const timestamp = now()
        const updated = this.sqlite.query("UPDATE threads SET prompt_settings = ?, updated_at = ? WHERE id = ?").run(stringify(settings), timestamp, threadID)
        if (!updated.changes) throw new Error(`Thread ${threadID} 不存在`)
        const event = this.insertEvent(threadID, null, "thread/prompt-settings/updated", { threadId: threadID, updatedAt: timestamp })
        return { settings, event }
      })
    }

  createThread(input: CreateThreadInput): CreatedThreadRecord

  createThread(title?: string, projectID?: string, initialSettings?: ThreadSettings): CreatedThreadRecord

  createThread(
      inputOrTitle: CreateThreadInput | string = "新对话",
      legacyProjectID?: string,
      legacySettings?: ThreadSettings,
    ) {
      const input: CreateThreadInput | null = typeof inputOrTitle === "object" ? inputOrTitle : null
      const id = input?.id ?? crypto.randomUUID()
      const title = input?.title ?? (typeof inputOrTitle === "string" ? inputOrTitle : "新对话")
      const initialSettings = input?.settings ?? legacySettings
      const workspace = input?.workspace ?? (legacyProjectID
        ? { kind: "project" as const, projectID: legacyProjectID }
        : null)
      return this.insertThread({
        id,
        title,
        workspace,
        ...(initialSettings ? { initialSettings } : {}),
        ...(input?.operationID ? { operationID: input.operationID } : {}),
        ...(input?.requestHash ? { requestHash: input.requestHash } : {}),
      })
    }

  private insertThread(input: {
      id: string
      title: string
      initialSettings?: ThreadSettings
      workspace: CreateThreadInput["workspace"] | null
      operationID?: string
      requestHash?: string
    }): CreatedThreadRecord {
      const { id, title, initialSettings } = input
      const timestamp = now()
      const settings = initialSettings ?? defaultThreadSettings()
      let projectID: string | null = null
      let workspaceKind: "project" | "projectless" | "legacy" = "legacy"
      let workspaceRoot: string | null = null
      let workspaceCwd: string | null = null
      let workspaceRoots: string | null = null
      let instructionSources: string | null = null
      let outputDirectory: string | null = null
      if (input.workspace?.kind === "project") {
        const project = this.requireProject(input.workspace.projectID)
        projectID = input.workspace.projectID
        workspaceKind = "project"
        workspaceCwd = project.rootPath
        workspaceRoots = stringify(project.folders.map(({ id: folderId, path, role }) => ({
          folderId,
          path,
          role,
        })))
        instructionSources = "[]"
      } else if (input.workspace?.kind === "projectless") {
        workspaceRoot = resolve(input.workspace.workspaceRoot)
        workspaceCwd = resolve(input.workspace.cwd)
        outputDirectory = resolve(input.workspace.outputDirectory)
        if (!containedPath(workspaceRoot, workspaceCwd) || !containedPath(workspaceRoot, outputDirectory)) {
          throw new AgentError("WORKSPACE_INVALID", "无项目会话的 cwd 和输出目录必须位于工作区根目录内", 400)
        }
        workspaceKind = "projectless"
      }
      return this.transaction(() => {
        this.sqlite.query(`INSERT INTO threads (
          id, title, project_id, workspace_kind, workspace_root, workspace_cwd,
          workspace_roots, instruction_sources, output_directory,
          create_operation_id, create_request_hash,
          task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ).run(
          id,
          title,
          projectID,
          workspaceKind,
          workspaceRoot,
          workspaceCwd,
          workspaceRoots,
          instructionSources,
          outputDirectory,
          input.operationID ?? null,
          input.requestHash ?? null,
          settings.taskMode,
          settings.permissionConfig.sandboxMode,
          encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
          settings.permissionConfig.approvalsReviewer,
          timestamp,
          timestamp,
        )
        const persistedWorkspace = this.threadWorkspace(id)
        const event = this.insertEvent(id, null, "thread/created", { thread: {
          id, title, projectID, gitBranch: null,
          ...(persistedWorkspace ? { workspace: persistedWorkspace } : {}),
          settings, createdAt: timestamp, updatedAt: timestamp,
        } })
        return { id, title, projectID, gitBranch: null, workspace: persistedWorkspace, settings, createdAt: timestamp, updatedAt: timestamp, event }
      })
    }

  getThread(threadID: string): ThreadSnapshot | null {
      const thread = this.sqlite.query("SELECT id, title, git_branch, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?").get(threadID) as
        | ({ id: string; title: string; git_branch: string | null; created_at: number; updated_at: number } & ThreadSettingsColumns)
        | null
      if (!thread) return null
      const turns = this.sqlite.query("SELECT id, root_agent_id, status, mode, started_at, finished_at FROM turns WHERE thread_id = ? ORDER BY created_at").all(threadID) as Array<{
        id: string
        root_agent_id: string
        status: TurnStatus
        mode: TaskMode
        started_at: number | null
        finished_at: number | null
      }>
      const items = this.sqlite.query("SELECT id, turn_id, agent_id, type, status, data, created_at, updated_at FROM items WHERE thread_id = ? ORDER BY created_at").all(threadID) as Array<{
        id: string
        turn_id: string
        agent_id: string
        type: Item["type"]
        status: Item["status"]
        data: string
        created_at: number
        updated_at: number
      }>
      return {
        id: thread.id,
        title: thread.title,
        gitBranch: thread.git_branch,
        settings: threadSettingsFromRow(thread),
        createdAt: thread.created_at,
        updatedAt: thread.updated_at,
        turns: turns.map((turn) => ({
          id: turn.id,
          rootAgentID: turn.root_agent_id,
          status: turn.status,
          mode: turn.mode,
          startedAt: turn.started_at,
          finishedAt: turn.finished_at,
          items: items.filter((item) => item.turn_id === turn.id).map((item) => ({
            id: item.id,
            turnID: item.turn_id,
            agentID: item.agent_id,
            type: item.type,
            status: item.status,
            data: parse<Record<string, unknown>>(item.data),
            createdAt: item.created_at,
            updatedAt: item.updated_at,
          })),
        })),
        agents: turns.flatMap((turn) => {
          const agent = this.getAgentExecution(turn.root_agent_id)
          return agent ? [agent] : []
        }),
      }
    }

  updateThreadGitBranch(threadID: string, gitBranch: string): boolean {
      const normalized = gitBranch.trim()
      if (!normalized) return false
      const result = this.sqlite.query(`
        UPDATE threads
        SET git_branch = ?
        WHERE id = ? AND (git_branch IS NULL OR git_branch <> ?)
      `).run(normalized, threadID, normalized)
      return result.changes > 0
    }

  activeTurn(threadID: string) {
      return this.sqlite.query(`SELECT id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref FROM turns WHERE thread_id = ? AND status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_subagents') ORDER BY created_at DESC LIMIT 1`).get(threadID) as
        | ({ id: string; status: TurnStatus; mode: TaskMode; model_ref: string } & PermissionColumns)
        | null
    }
}

export type ThreadRepository = ThreadRepositoryDatabase
export const threadRepository = (database: ThreadRepositoryDatabase): ThreadRepository => database
