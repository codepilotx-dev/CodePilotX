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

import { WorkspaceRepositoryDatabase } from "./workspace-repository"

export class ReviewRepositoryDatabase extends WorkspaceRepositoryDatabase {
  listReviewComments(input: { threadId: string; projectId: string; sourceKey: string }) {
      if (this.threadProjectID(input.threadId) !== input.projectId) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "Thread 与 Review 项目不匹配", 409)
      }
      const rows = this.sqlite.query(`
        SELECT id, thread_id, project_id, source_key, path, side, line, hunk_id,
               revision, body, status, github_comment_id, github_thread_id,
               created_at, updated_at
        FROM review_comments
        WHERE thread_id = ? AND project_id = ? AND source_key = ?
        ORDER BY created_at, id
      `).all(input.threadId, input.projectId, input.sourceKey) as Parameters<WorkspaceRepositoryDatabase["mapReviewComment"]>[0][]
      return rows.map((row) => this.mapReviewComment(row))
    }

  saveReviewComment(input: {
      id?: string | undefined
      threadId: string
      projectId: string
      sourceKey: string
      path: string
      side: "old" | "new"
      line: number
      hunkId: string | null
      revision: string
      body: string
      githubCommentId?: string | undefined
      githubThreadId?: string | undefined
    }) {
      if (this.threadProjectID(input.threadId) !== input.projectId) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "Thread 与 Review 项目不匹配", 409)
      }
      const body = input.body.trim()
      if (!body) throw new AgentError("INVALID_REQUEST", "Review 评论不能为空", 400)
      const timestamp = now()
      const id = input.id ?? crypto.randomUUID()
      const existing = this.sqlite.query("SELECT thread_id, project_id, created_at FROM review_comments WHERE id = ?").get(id) as {
        thread_id: string
        project_id: string
        created_at: number
      } | null
      if (existing && (existing.thread_id !== input.threadId || existing.project_id !== input.projectId)) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "不能修改其他 Thread 或项目的 Review 评论", 409)
      }
      this.sqlite.query(`
        INSERT INTO review_comments (
          id, thread_id, project_id, source_key, path, side, line, hunk_id,
          revision, body, status, github_comment_id, github_thread_id,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_key = excluded.source_key,
          path = excluded.path,
          side = excluded.side,
          line = excluded.line,
          hunk_id = excluded.hunk_id,
          revision = excluded.revision,
          body = excluded.body,
          github_comment_id = COALESCE(excluded.github_comment_id, review_comments.github_comment_id),
          github_thread_id = COALESCE(excluded.github_thread_id, review_comments.github_thread_id),
          updated_at = excluded.updated_at
      `).run(
        id,
        input.threadId,
        input.projectId,
        input.sourceKey,
        input.path,
        input.side,
        input.line,
        input.hunkId,
        input.revision,
        body,
        input.githubCommentId ?? null,
        input.githubThreadId ?? null,
        existing?.created_at ?? timestamp,
        timestamp,
      )
      return this.reviewComment(id)!
    }

  private reviewComment(id: string) {
      const row = this.sqlite.query(`
        SELECT id, thread_id, project_id, source_key, path, side, line, hunk_id,
               revision, body, status, github_comment_id, github_thread_id,
               created_at, updated_at
        FROM review_comments WHERE id = ?
      `).get(id) as Parameters<WorkspaceRepositoryDatabase["mapReviewComment"]>[0] | null
      return row ? this.mapReviewComment(row) : null
    }

  resolveReviewComment(input: { id: string; threadId: string; projectId: string }) {
      const comment = this.reviewComment(input.id)
      if (!comment) throw new AgentError("REVIEW_COMMENT_NOT_FOUND", "Review 评论不存在", 404)
      if (comment.threadId !== input.threadId || comment.projectId !== input.projectId) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "不能修改其他 Thread 或项目的 Review 评论", 409)
      }
      this.sqlite.query("UPDATE review_comments SET status = 'resolved', updated_at = ? WHERE id = ?").run(now(), input.id)
      return this.reviewComment(input.id)!
    }

  deleteReviewComment(input: { id: string; threadId: string; projectId: string }) {
      const comment = this.reviewComment(input.id)
      if (!comment) throw new AgentError("REVIEW_COMMENT_NOT_FOUND", "Review 评论不存在", 404)
      if (comment.threadId !== input.threadId || comment.projectId !== input.projectId) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "不能删除其他 Thread 或项目的 Review 评论", 409)
      }
      this.sqlite.query("DELETE FROM review_comments WHERE id = ?").run(input.id)
    }

  saveTurnGitSnapshot(input: {
      threadId: string
      turnId: string
      projectId: string
      repositoryRoot: string
      beforeTree?: string | null
      afterTree?: string | null
    }) {
      if (this.threadProjectID(input.threadId) !== input.projectId) {
        throw new AgentError("PROJECT_SCOPE_MISMATCH", "Thread 与 Git 快照项目不匹配", 409)
      }
      const timestamp = now()
      this.sqlite.query(`
        INSERT INTO turn_git_snapshots (
          thread_id, turn_id, project_id, repository_root,
          before_tree, after_tree, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, turn_id) DO UPDATE SET
          repository_root = excluded.repository_root,
          before_tree = COALESCE(excluded.before_tree, turn_git_snapshots.before_tree),
          after_tree = COALESCE(excluded.after_tree, turn_git_snapshots.after_tree),
          updated_at = excluded.updated_at
      `).run(
        input.threadId,
        input.turnId,
        input.projectId,
        input.repositoryRoot,
        input.beforeTree ?? null,
        input.afterTree ?? null,
        timestamp,
        timestamp,
      )
    }

  getTurnGitSnapshot(threadId: string, turnId: string) {
      const row = this.sqlite.query(`
        SELECT thread_id, turn_id, project_id, repository_root, before_tree,
               after_tree, created_at, updated_at
        FROM turn_git_snapshots WHERE thread_id = ? AND turn_id = ?
      `).get(threadId, turnId) as {
        thread_id: string
        turn_id: string
        project_id: string
        repository_root: string
        before_tree: string | null
        after_tree: string | null
        created_at: number
        updated_at: number
      } | null
      return row ? {
        threadId: row.thread_id,
        turnId: row.turn_id,
        projectId: row.project_id,
        repositoryRoot: row.repository_root,
        beforeTree: row.before_tree,
        afterTree: row.after_tree,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } : null
    }
}

export type ReviewRepository = ReviewRepositoryDatabase
export const reviewRepository = (database: ReviewRepositoryDatabase): ReviewRepository => database
