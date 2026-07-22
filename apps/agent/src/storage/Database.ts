import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { Effect } from "effect"
import { DEFAULT_PERMISSION_CONFIG, decodeApprovalPolicy, encodeApprovalPolicy, type ThreadSettings, type ThreadSettingsPatch } from "@codepilotx/shared/thread"
import { AgentError } from "../domain"
import { EventManifest, type EventType, type ReviewComment } from "@codepilotx/agent-protocol"
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
} from "../domain"

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
}

export type StoredEncryptedCredential = {
  id: string
  integrationID: string
  methodID: string | null
  label: string
  ciphertext: string
  nonce: string
  keyVersion: number
  createdAt: number
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
  resolution?: { decision: "allow" | "deny"; resolvedAt: number }
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
export const SCHEMA_VERSION = 14
/**
 * Persistence compatibility boundary. Bumping this value permanently removes
 * the SQLite database and its sidecars before a new schema is created. Epochs
 * are intentionally not migrations: durable run state from different agent
 * runtimes must never be replayed or copied forward.
 */
export const DATA_EPOCH = 1

export type QueuePauseReason = "interrupted" | "turn_failed" | null
export type QueueMutationMeta = { operationID: string; expectedVersion?: number }

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

const liveEventMethods = (Object.keys(EventManifest) as EventType[])
  .filter((method) => EventManifest[method].durability === "live")
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`

const prepareDatabase = (path: string) => {
  if (!existsSync(path)) return true
  const probe = new Database(path, { create: false, strict: true })
  let epoch = 0
  try {
    epoch = (probe.query("PRAGMA application_id").get() as { application_id: number }).application_id
    if (epoch !== DATA_EPOCH) probe.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    probe.close()
  }
  if (epoch === DATA_EPOCH) return true

  // Do not retain backups: an epoch mismatch means the whole persistence model
  // is unsafe to replay. This also covers a valid-looking schema version from
  // an older runtime, which schema-only checks cannot distinguish.
  for (const target of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) rmSync(target, { force: true })
  return true
}

export class AgentDatabase {
  readonly sqlite: Database
  private transactionDepth = 0
  private transactionCommitCallbacks: Array<() => void> = []
  private transactionRollbackCallbacks: Array<() => void> = []

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    const finalizeV13 = prepareDatabase(path)
    this.sqlite = new Database(path, { create: true, strict: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA foreign_keys = ON")
    this.sqlite.exec("PRAGMA busy_timeout = 5000")
    this.migrate(finalizeV13)
    this.sqlite.exec(`PRAGMA application_id = ${DATA_EPOCH}`)
    this.recoverInterruptedTurns()
  }

  close() {
    this.sqlite.close()
  }

  private migrate(finalizeV13 = true) {
    const currentVersion = (this.sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version
    const legacyViews = [
      "sessions",
      "runs",
      "inputs_legacy",
      "messages_legacy",
      "parts",
      "permission_requests",
      "questions",
      "run_stages",
      "agent_run_checkpoints",
      "agent_session_items",
    ]
    const existingViews = new Set((this.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'view'").all() as Array<{ name: string }>).map((row) => row.name))
    for (const name of legacyViews) {
      if (existingViews.has(name)) this.sqlite.exec(`DROP VIEW "${name}"`)
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'main',
        parent_thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
        task_mode TEXT NOT NULL DEFAULT 'chat',
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
        approval_policy TEXT NOT NULL DEFAULT 'on-request',
        approvals_reviewer TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        root_agent_id TEXT,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
        approval_policy TEXT NOT NULL DEFAULT 'on-request',
        approvals_reviewer TEXT NOT NULL DEFAULT 'user',
        model_ref TEXT NOT NULL,
        strategy TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS turns_thread_status ON turns(thread_id, status, created_at);
      CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,
        parent_agent_id TEXT REFERENCES agent_executions(id) ON DELETE CASCADE,
        profile TEXT NOT NULL,
        task TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        session_id TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        subagent_run_id TEXT,
        run_sequence INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_executions_thread_updated ON agent_executions(thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS inputs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
        approval_policy TEXT NOT NULL DEFAULT 'on-request',
        approvals_reviewer TEXT NOT NULL DEFAULT 'user',
        strategy TEXT NOT NULL,
        task_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS items_turn_created ON items(turn_id, created_at);
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        status TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        risk TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        reply TEXT,
        request_payload TEXT NOT NULL DEFAULT '{"version":1}',
        review_payload TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS question_requests (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        tool_call_id TEXT,
        payload TEXT NOT NULL,
        payload_version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        answer TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        files TEXT NOT NULL,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        turn_id TEXT,
        method TEXT NOT NULL,
        params TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_thread_id ON events(thread_id, id);
      CREATE TABLE IF NOT EXISTS provider_settings (
        provider_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY,
        integration_id TEXT NOT NULL UNIQUE,
        method_id TEXT,
        label TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        nonce TEXT NOT NULL,
        key_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS credentials_integration ON credentials(integration_id);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS projects_last_opened ON projects(last_opened_at DESC);
      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        default_model TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_checkpoints (
        agent_id TEXT PRIMARY KEY REFERENCES agent_executions(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        payload TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_checkpoints_thread ON agent_checkpoints(thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_thread_items (
        thread_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, ordinal)
      );
    `)
    if (!this.columns("threads").includes("project_id")) {
      this.sqlite.exec("ALTER TABLE threads ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL")
      this.sqlite.exec("CREATE INDEX IF NOT EXISTS threads_project_updated ON threads(project_id, updated_at DESC)")
    }
    this.addColumn("threads", "archived_at", "INTEGER")
    this.addColumn("threads", "preview", "TEXT")
    this.addColumn("threads", "first_user_message", "TEXT")
    this.addColumn("threads", "message_count", "INTEGER NOT NULL DEFAULT 0")
    this.addColumn("messages", "ordinal", "INTEGER")
    this.backfillMessageOrdinals()
    this.backfillThreadHistoryMetadata()
    this.sqlite.exec("CREATE INDEX IF NOT EXISTS threads_project_archive_updated ON threads(project_id, archived_at, updated_at DESC, id DESC)")
    this.sqlite.exec("CREATE INDEX IF NOT EXISTS messages_session_ordinal ON messages(thread_id, ordinal, id)")
    if (currentVersion > 0 && currentVersion < 5) {
      this.addColumn("turns", "current_stage", "TEXT")
      this.addColumn("turns", "can_continue_from_plan", "INTEGER NOT NULL DEFAULT 0")
    }
    this.addColumn("question_requests", "tool_call_id", "TEXT")
    this.addColumn("question_requests", "payload_version", "INTEGER NOT NULL DEFAULT 1")
    this.addColumn("events", "turn_id", "TEXT")
    if (currentVersion === 0) {
      this.migrateSubagentsV6()
    } else {
      if (currentVersion < 3) this.migratePermissionsV3()
      if (currentVersion < 4) this.migrateThreadSettingsV4()
      if (currentVersion < 5) this.migrateAgentExecutionsV5()
      if (currentVersion < 6) this.migrateSubagentsV6()
    }
    if (currentVersion < 7) this.migrateContextV7()
    if (currentVersion < 8) this.migrateContextV8()
    if (currentVersion < 9) this.migrateHookTrustV9()
    if (currentVersion < 10) this.migrateQueueV10()
    if (currentVersion < 11) this.migrateReviewV11()
    if (currentVersion < 12) this.migrateInteractionV12()
    if (currentVersion < 13 && finalizeV13) this.migrateEventsV13()
    if (currentVersion < 14) this.migratePiSessionsV14()
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS hook_trust_waiters (
      request_id TEXT NOT NULL REFERENCES hook_trust_requests(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (request_id, agent_id)
    )`)
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS sandbox_escalations (
      token TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
      tool_call_id TEXT NOT NULL,
      invocation TEXT NOT NULL,
      invocation_hash TEXT NOT NULL DEFAULT '',
      failure TEXT NOT NULL,
      status TEXT NOT NULL,
      output TEXT,
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      completed_at INTEGER
    ); CREATE INDEX IF NOT EXISTS sandbox_escalations_turn_status ON sandbox_escalations(turn_id, status, created_at);`)
    this.addColumn("sandbox_escalations", "invocation_hash", "TEXT NOT NULL DEFAULT ''")
    this.sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_run_sequence_unique ON agent_executions(subagent_run_id, run_sequence) WHERE subagent_run_id IS NOT NULL")
  }

  private migrateEventsV13() {
    this.transaction(() => {
      if (liveEventMethods.length) this.sqlite.exec(`DELETE FROM events WHERE method IN (${liveEventMethods.map(sqlString).join(",")})`)
      this.sqlite.exec("PRAGMA user_version = 13")
    })
  }

  private migratePiSessionsV14() {
    this.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS pi_sessions (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          leaf_id TEXT,
          name TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS pi_sessions_thread_agent
          ON pi_sessions(thread_id, agent_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS pi_session_entries (
          session_id TEXT NOT NULL REFERENCES pi_sessions(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          id TEXT NOT NULL,
          parent_id TEXT,
          type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (session_id, sequence),
          UNIQUE (session_id, id)
        );
        CREATE INDEX IF NOT EXISTS pi_session_entries_type
          ON pi_session_entries(session_id, type, sequence);
        PRAGMA user_version = 14;
      `)
    })
  }

  private migrateQueueV10() {
    this.transaction(() => {
      this.addColumn("threads", "queue_version", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("threads", "queue_pause_reason", "TEXT")
      this.addColumn("turns", "queue_position", "INTEGER")
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS queue_operations (
          operation_id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          method TEXT NOT NULL,
          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS turns_queue_position ON turns(thread_id, status, queue_position, created_at);
      `)
      const threads = this.sqlite.query("SELECT DISTINCT thread_id FROM turns WHERE status = 'queued'").all() as Array<{ thread_id: string }>
      for (const thread of threads) {
        const turns = this.sqlite.query("SELECT id FROM turns WHERE thread_id = ? AND status = 'queued' ORDER BY created_at, id").all(thread.thread_id) as Array<{ id: string }>
        turns.forEach((turn, index) => this.sqlite.query("UPDATE turns SET queue_position = ? WHERE id = ?").run(index + 1, turn.id))
      }
      this.sqlite.exec("PRAGMA user_version = 10")
    })
  }

  private migrateReviewV11() {
    this.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS review_comments (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          source_key TEXT NOT NULL,
          path TEXT NOT NULL,
          side TEXT NOT NULL CHECK(side IN ('old', 'new')),
          line INTEGER NOT NULL CHECK(line > 0),
          hunk_id TEXT,
          revision TEXT NOT NULL,
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
          github_comment_id TEXT,
          github_thread_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS review_comments_scope
          ON review_comments(thread_id, project_id, source_key, updated_at);
        CREATE TABLE IF NOT EXISTS turn_git_snapshots (
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          repository_root TEXT NOT NULL,
          before_tree TEXT,
          after_tree TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (thread_id, turn_id)
        );
        CREATE INDEX IF NOT EXISTS turn_git_snapshots_project
          ON turn_git_snapshots(project_id, updated_at DESC);
        PRAGMA user_version = 11;
      `)
    })
  }

  private migrateInteractionV12() {
    this.transaction(() => {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS interaction_operations (
          operation_id TEXT PRIMARY KEY,
          interaction_id TEXT NOT NULL,
          response TEXT NOT NULL,
          result TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS interaction_operations_interaction
          ON interaction_operations(interaction_id, created_at);
        PRAGMA user_version = 12;
      `)
    })
  }

  private migrateContextV7() {
    this.transaction(() => {
      this.addColumn("threads", "prompt_settings", "TEXT NOT NULL DEFAULT '{}'")
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS prompt_session_state (
          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          baseline_version INTEGER NOT NULL DEFAULT 1,
          prompt_version TEXT NOT NULL,
          base_hash TEXT NOT NULL,
          context_hash TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          fragments TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS agent_compactions (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          baseline_version INTEGER NOT NULL,
          before_count INTEGER NOT NULL,
          after_count INTEGER NOT NULL,
          summary TEXT NOT NULL,
          replacement_history TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS agent_compactions_thread ON agent_compactions(thread_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS guardian_review_sessions (
          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          cache_key TEXT NOT NULL,
          history_version INTEGER NOT NULL DEFAULT 1,
          evidence_cursor INTEGER NOT NULL DEFAULT 0,
          history TEXT NOT NULL DEFAULT '[]',
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS hook_runs (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          tool_call_id TEXT,
          event TEXT NOT NULL,
          hook_id TEXT NOT NULL,
          status TEXT NOT NULL,
          input TEXT NOT NULL,
          output TEXT,
          error TEXT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS hook_runs_thread ON hook_runs(thread_id, started_at DESC);
        CREATE TABLE IF NOT EXISTS memory_jobs (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
          project_key TEXT,
          status TEXT NOT NULL,
          payload TEXT NOT NULL,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS memory_jobs_status ON memory_jobs(status, created_at);
        CREATE TABLE IF NOT EXISTS memory_entries (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          project_key TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
          content_hash TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(scope, project_key, content_hash)
        );
        CREATE INDEX IF NOT EXISTS memory_entries_scope ON memory_entries(scope, project_key, updated_at DESC);
        CREATE TABLE IF NOT EXISTS approval_checkpoints (
          approval_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          payload TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version = 7;
      `)
    })
  }

  private migrateContextV8() {
    this.transaction(() => {
      this.addColumn("prompt_session_state", "context_window_tokens", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("prompt_session_state", "usage_tokens", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("prompt_session_state", "usage_source", "TEXT NOT NULL DEFAULT 'estimated'")
      this.addColumn("prompt_session_state", "usage_sample_id", "TEXT")
      this.addColumn("prompt_session_state", "needs_compaction", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("agent_compactions", "before_tokens", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("agent_compactions", "after_tokens", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("agent_compactions", "target_tokens", "INTEGER NOT NULL DEFAULT 0")
      this.addColumn("agent_compactions", "usage_sample_id", "TEXT")
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS context_usage_samples (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          session_id TEXT,
          context_fingerprint TEXT NOT NULL,
          context_window_tokens INTEGER NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS context_usage_samples_lookup
          ON context_usage_samples(thread_id, context_fingerprint, source, created_at DESC);
        PRAGMA user_version = 8;
      `)
    })
  }

  private migrateHookTrustV9() {
    this.transaction(() => {
      this.addColumn("hook_runs", "command", "TEXT")
      this.addColumn("hook_runs", "cwd", "TEXT")
      this.addColumn("hook_runs", "evidence_summary", "TEXT")
      if (this.columns("turns").includes("permission_mode")) this.sqlite.exec("ALTER TABLE turns DROP COLUMN permission_mode")
      if (this.columns("inputs").includes("permission_mode")) this.sqlite.exec("ALTER TABLE inputs DROP COLUMN permission_mode")
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS hook_trust_decisions (
          workspace_path TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          config_path TEXT NOT NULL,
          decision TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_path, config_hash)
        );
        CREATE TABLE IF NOT EXISTS hook_trust_requests (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          workspace_path TEXT NOT NULL,
          config_path TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          status TEXT NOT NULL,
          audit_summary TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS hook_trust_requests_pending
          ON hook_trust_requests(workspace_path, config_hash) WHERE status = 'pending';
        CREATE TABLE IF NOT EXISTS hook_trust_waiters (
          request_id TEXT NOT NULL REFERENCES hook_trust_requests(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (request_id, agent_id)
        );
        PRAGMA user_version = 9;
      `)
    })
  }

  private migrateSubagentsV6() {
    this.transaction(() => {
      this.addColumn("threads", "kind", "TEXT NOT NULL DEFAULT 'main'")
      this.addColumn("threads", "parent_thread_id", "TEXT REFERENCES threads(id) ON DELETE CASCADE")
      this.addColumn("agent_executions", "subagent_run_id", "TEXT")
      this.addColumn("agent_executions", "run_sequence", "INTEGER NOT NULL DEFAULT 0")
      this.sqlite.exec(`
        CREATE INDEX IF NOT EXISTS threads_parent_kind ON threads(parent_thread_id, kind, updated_at DESC);
        CREATE INDEX IF NOT EXISTS agent_executions_subagent_run ON agent_executions(subagent_run_id, run_sequence);
        CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_run_sequence_unique ON agent_executions(subagent_run_id, run_sequence) WHERE subagent_run_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS subagent_tasks (
          id TEXT PRIMARY KEY,
          parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          parent_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          parent_agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          child_thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
          display_name TEXT NOT NULL,
          profile TEXT NOT NULL,
          task TEXT NOT NULL,
          permission_ceiling TEXT NOT NULL,
          workspace_mode TEXT NOT NULL,
          workspace_state TEXT NOT NULL DEFAULT '{}',
          current_run_id TEXT,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS subagent_tasks_parent_updated ON subagent_tasks(parent_thread_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS subagent_runs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,
          generation INTEGER NOT NULL,
          status TEXT NOT NULL,
          queue_reason TEXT,
          model_ref TEXT NOT NULL,
          permission_config TEXT NOT NULL,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          updated_at INTEGER NOT NULL,
          UNIQUE(task_id, generation)
        );
        CREATE INDEX IF NOT EXISTS subagent_runs_status_created ON subagent_runs(status, created_at);
        CREATE TABLE IF NOT EXISTS subagent_controls (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,
          run_id TEXT REFERENCES subagent_runs(id) ON DELETE CASCADE,
          action TEXT NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL,
          result TEXT,
          error TEXT,
          created_at INTEGER NOT NULL,
          applied_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS subagent_controls_pending ON subagent_controls(run_id, status, created_at);
        CREATE TABLE IF NOT EXISTS workspace_writer_leases (
          workspace_key TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES subagent_runs(id) ON DELETE CASCADE,
          acquired_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS input_attachments (
          id TEXT PRIMARY KEY,
          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,
          input_id TEXT REFERENCES inputs(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          media_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          storage_path TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          bound_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS input_attachments_thread ON input_attachments(thread_id, created_at);
        PRAGMA user_version = 6;
      `)
    })
  }

  private migratePermissionsV3() {
    this.transaction(() => {
      const invalidTurns = this.sqlite.query("SELECT COUNT(*) AS count FROM turns WHERE permission_mode NOT IN ('ask', 'review', 'full')").get() as { count: number }
      const invalidInputs = this.sqlite.query("SELECT COUNT(*) AS count FROM inputs WHERE permission_mode NOT IN ('ask', 'review', 'full')").get() as { count: number }
      if (invalidTurns.count || invalidInputs.count) throw new Error("Cannot migrate unknown legacy permission mode")
      for (const table of ["turns", "inputs"]) {
        this.addColumn(table, "sandbox_mode", "TEXT NOT NULL DEFAULT 'workspace-write'")
        this.addColumn(table, "approval_policy", "TEXT NOT NULL DEFAULT 'on-request'")
        this.addColumn(table, "approvals_reviewer", "TEXT NOT NULL DEFAULT 'user'")
        this.sqlite.exec(`
          UPDATE ${table}
          SET sandbox_mode = CASE permission_mode WHEN 'full' THEN 'danger-full-access' ELSE 'workspace-write' END,
              approval_policy = CASE permission_mode WHEN 'full' THEN 'never' ELSE 'on-request' END,
              approvals_reviewer = CASE permission_mode WHEN 'review' THEN 'auto_review' WHEN 'full' THEN 'auto_review' ELSE 'user' END
        `)
      }
      this.addColumn("approval_requests", "request_payload", "TEXT NOT NULL DEFAULT '{\"version\":1}'")
      this.addColumn("approval_requests", "review_payload", "TEXT")
      this.sqlite.exec("PRAGMA user_version = 3")
    })
  }

  private migrateThreadSettingsV4() {
    this.transaction(() => {
      this.addColumn("threads", "task_mode", "TEXT NOT NULL DEFAULT 'chat'")
      this.addColumn("threads", "sandbox_mode", "TEXT NOT NULL DEFAULT 'workspace-write'")
      this.addColumn("threads", "approval_policy", "TEXT NOT NULL DEFAULT 'on-request'")
      this.addColumn("threads", "approvals_reviewer", "TEXT NOT NULL DEFAULT 'user'")
      this.sqlite.exec(`
        UPDATE threads
        SET task_mode = COALESCE((
              SELECT i.task_mode FROM inputs AS i
              WHERE i.thread_id = threads.id
              ORDER BY i.created_at DESC, i.id DESC LIMIT 1
            ), 'chat'),
            sandbox_mode = COALESCE((
              SELECT i.sandbox_mode FROM inputs AS i
              WHERE i.thread_id = threads.id
              ORDER BY i.created_at DESC, i.id DESC LIMIT 1
            ), 'workspace-write'),
            approval_policy = COALESCE((
              SELECT i.approval_policy FROM inputs AS i
              WHERE i.thread_id = threads.id
              ORDER BY i.created_at DESC, i.id DESC LIMIT 1
            ), 'on-request'),
            approvals_reviewer = COALESCE((
              SELECT i.approvals_reviewer FROM inputs AS i
              WHERE i.thread_id = threads.id
              ORDER BY i.created_at DESC, i.id DESC LIMIT 1
            ), 'user')
      `)
      this.sqlite.exec("PRAGMA user_version = 4")
    })
  }

  private migrateAgentExecutionsV5() {
    this.transaction(() => {
      this.sqlite.exec(`
        DROP TABLE IF EXISTS agent_checkpoints;
        DROP TABLE IF EXISTS agent_turn_checkpoints;
        DROP TABLE IF EXISTS turn_stages;
        DROP TABLE IF EXISTS proposals;
        DROP TABLE IF EXISTS agent_thread_items;
        DROP TABLE IF EXISTS approval_requests;
        DROP TABLE IF EXISTS question_requests;
        DROP TABLE IF EXISTS patches;
        DROP TABLE IF EXISTS tool_calls;
        DROP TABLE IF EXISTS items;
        DROP TABLE IF EXISTS messages;
        DROP TABLE IF EXISTS inputs;
        DROP TABLE IF EXISTS events;
        DROP TABLE IF EXISTS agent_executions;
        DROP TABLE IF EXISTS turns;
        DROP TABLE IF EXISTS threads;

        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
          task_mode TEXT NOT NULL DEFAULT 'chat',
          sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
          approval_policy TEXT NOT NULL DEFAULT 'on-request',
          approvals_reviewer TEXT NOT NULL DEFAULT 'user',
          archived_at INTEGER,
          preview TEXT,
          first_user_message TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX threads_project_archive_updated ON threads(project_id, archived_at, updated_at DESC, id DESC);

        CREATE TABLE turns (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          root_agent_id TEXT,
          status TEXT NOT NULL,
          mode TEXT NOT NULL,
          sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
          approval_policy TEXT NOT NULL DEFAULT 'on-request',
          approvals_reviewer TEXT NOT NULL DEFAULT 'user',
          model_ref TEXT NOT NULL,
          strategy TEXT NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX turns_thread_status ON turns(thread_id, status, created_at);

        CREATE TABLE agent_executions (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,
          parent_agent_id TEXT REFERENCES agent_executions(id) ON DELETE CASCADE,
          profile TEXT NOT NULL,
          task TEXT NOT NULL,
          model_ref TEXT NOT NULL,
          session_id TEXT NOT NULL,
          depth INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX agent_executions_thread_updated ON agent_executions(thread_id, updated_at DESC);

        CREATE TABLE inputs (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          content TEXT NOT NULL,
          model_ref TEXT NOT NULL,
          sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',
          approval_policy TEXT NOT NULL DEFAULT 'on-request',
          approvals_reviewer TEXT NOT NULL DEFAULT 'user',
          strategy TEXT NOT NULL,
          task_mode TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          ordinal INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX messages_session_ordinal ON messages(thread_id, ordinal, id);

        CREATE TABLE items (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX items_turn_created ON items(turn_id, created_at);
        CREATE TABLE tool_calls (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          input TEXT NOT NULL,
          output TEXT,
          status TEXT NOT NULL,
          started_at INTEGER,
          finished_at INTEGER,
          error TEXT
        );
        CREATE TABLE approval_requests (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          tool_call_id TEXT NOT NULL,
          risk TEXT NOT NULL,
          reason TEXT NOT NULL,
          status TEXT NOT NULL,
          reply TEXT,
          request_payload TEXT NOT NULL DEFAULT '{"version":1}',
          review_payload TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE TABLE question_requests (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          tool_call_id TEXT,
          payload TEXT NOT NULL,
          payload_version INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL,
          answer TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE TABLE patches (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
          files TEXT NOT NULL,
          additions INTEGER NOT NULL DEFAULT 0,
          deletions INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE agent_checkpoints (
          agent_id TEXT PRIMARY KEY REFERENCES agent_executions(id) ON DELETE CASCADE,
          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          state TEXT NOT NULL,
          payload TEXT NOT NULL,
          version INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX agent_checkpoints_thread ON agent_checkpoints(thread_id, updated_at DESC);
        CREATE TABLE agent_thread_items (
          thread_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (thread_id, ordinal)
        );
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT,
          turn_id TEXT,
          method TEXT NOT NULL,
          params TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX events_thread_id ON events(thread_id, id);

        CREATE TABLE project_settings_v5 (
          project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          default_model TEXT,
          updated_at INTEGER NOT NULL
        );
        INSERT INTO project_settings_v5 (project_id, default_model, updated_at)
          SELECT project_id, default_model, updated_at FROM project_settings;
        DROP TABLE project_settings;
        ALTER TABLE project_settings_v5 RENAME TO project_settings;
        PRAGMA user_version = 5;
      `)
    })
  }

  private backfillMessageOrdinals() {
    const rows = this.sqlite.query("SELECT id, thread_id FROM messages WHERE ordinal IS NULL ORDER BY thread_id, created_at, id").all() as Array<{ id: string; thread_id: string }>
    if (!rows.length) return
    this.transaction(() => {
      let currentThread: string | null = null
      let ordinal = -1
      for (const row of rows) {
        if (row.thread_id !== currentThread) {
          currentThread = row.thread_id
          const max = this.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) AS ordinal FROM messages WHERE thread_id = ? AND ordinal IS NOT NULL").get(row.thread_id) as { ordinal: number }
          ordinal = max.ordinal
        }
        ordinal += 1
        this.sqlite.query("UPDATE messages SET ordinal = ? WHERE id = ?").run(ordinal, row.id)
      }
    })
  }

  private backfillThreadHistoryMetadata() {
    const rows = this.sqlite.query(`
      SELECT s.id,
        (SELECT COUNT(*) FROM messages AS m WHERE m.thread_id = s.id) AS message_count,
        (SELECT m.content FROM messages AS m WHERE m.thread_id = s.id AND m.role = 'user' ORDER BY m.ordinal, m.created_at, m.id LIMIT 1) AS first_user_message,
        (SELECT m.content FROM messages AS m WHERE m.thread_id = s.id ORDER BY m.ordinal DESC, m.created_at DESC, m.id DESC LIMIT 1) AS preview
      FROM threads AS s
      WHERE s.message_count = 0 OR s.first_user_message IS NULL OR s.preview IS NULL
    `).all() as Array<{ id: string; message_count: number; first_user_message: string | null; preview: string | null }>
    if (!rows.length) return
    this.transaction(() => {
      for (const row of rows) {
        this.sqlite.query(`
          UPDATE threads
          SET message_count = ?,
            first_user_message = COALESCE(first_user_message, ?),
            preview = COALESCE(preview, ?)
          WHERE id = ?
        `).run(row.message_count, row.first_user_message, row.preview ? previewText(row.preview) : null, row.id)
      }
    })
  }

  private columns(table: string) {
    return (this.sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
  }

  private addColumn(table: string, column: string, definition: string) {
    if (!this.columns(table).includes(column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  private recoverInterruptedTurns() {
    const timestamp = now()
    const invalidApprovals = this.sqlite.query(`
      SELECT r.id, r.thread_id, r.turn_id, r.agent_id, r.tool_call_id
      FROM approval_requests AS r
      LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id
      WHERE r.status = 'preparing' OR (r.status = 'pending'
        AND (
          c.approval_id IS NULL OR c.version <> 1
          OR json_type(c.payload, '$.runState') <> 'text'
          OR json_type(c.payload, '$.interruption') IS NULL
        ))
    `).all() as Array<{ id: string; thread_id: string; turn_id: string; agent_id: string; tool_call_id: string }>
    this.sqlite.transaction(() => {
      for (const approval of invalidApprovals) {
        this.insertEvent(approval.thread_id, approval.turn_id, "approval/cancelled", { id: approval.id, turnId: approval.turn_id, itemId: approval.tool_call_id, reason: "审批缺少完整且可恢复的 SDK checkpoint，已安全取消" })
      }
      this.sqlite.query(`UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'preparing' OR id IN (SELECT r.id FROM approval_requests AS r LEFT JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.status = 'pending' AND (c.approval_id IS NULL OR c.version <> 1 OR json_type(c.payload, '$.runState') <> 'text' OR json_type(c.payload, '$.interruption') IS NULL))`).run(timestamp)
      this.sqlite.query(`UPDATE turns SET status = 'interrupted', finished_at = ?, updated_at = ? WHERE status = 'running' OR (status = 'waiting_permission' AND NOT EXISTS (SELECT 1 FROM approval_requests AS r JOIN approval_checkpoints AS c ON c.approval_id = r.id WHERE r.turn_id = turns.id AND r.status = 'pending' AND c.version = 1 AND json_type(c.payload, '$.runState') = 'text' AND json_type(c.payload, '$.interruption') IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM hook_trust_waiters AS w JOIN hook_trust_requests AS h ON h.id = w.request_id JOIN agent_checkpoints AS c ON c.turn_id = w.turn_id AND c.state = 'waiting_hook_trust' WHERE w.turn_id = turns.id AND h.status = 'pending')) OR (status = 'waiting_question' AND NOT EXISTS (SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question' WHERE q.turn_id = turns.id AND q.status = 'pending' AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)))`).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE agent_executions SET status = 'interrupted', updated_at = ? WHERE status = 'running' OR (status = 'waiting_permission' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted')) OR (status = 'waiting_question' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted'))`).run(timestamp)
      this.sqlite.query(`UPDATE items SET status = 'interrupted', updated_at = ? WHERE status IN ('pending', 'running') AND type <> 'subagent' AND NOT (type = 'question' AND id IN (SELECT id FROM question_requests WHERE status = 'pending' AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))))`).run(timestamp)
      this.sqlite.query(`UPDATE question_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND turn_id IN (SELECT id FROM turns WHERE status <> 'waiting_question')`).run(timestamp)
      this.sqlite.query(`UPDATE subagent_runs SET status = 'queued', queue_reason = NULL, updated_at = ? WHERE status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'queued' AND a.status = 'queued' AND a.subagent_run_id IS NOT NULL)`).run(timestamp)
      this.sqlite.query(`UPDATE subagent_tasks SET status = 'queued', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'queued')`).run(timestamp)
      this.sqlite.query(`UPDATE items SET status = 'pending', data = json_set(data, '$.status', 'queued', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'queued')`).run(timestamp)
      this.sqlite.query(`UPDATE subagent_runs SET status = 'interrupted', error = COALESCE(error, 'Agent 重启时运行被中断'), finished_at = ?, updated_at = ? WHERE status IN ('preparing', 'running', 'steering') OR (status = 'waiting_permission' AND id IN (SELECT a.subagent_run_id FROM agent_executions AS a JOIN turns AS t ON t.id = a.turn_id WHERE t.status = 'interrupted' AND a.subagent_run_id IS NOT NULL))`).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE threads SET queue_pause_reason = 'interrupted', queue_version = queue_version + 1, updated_at = ?
        WHERE kind = 'main' AND EXISTS (SELECT 1 FROM turns AS q WHERE q.thread_id = threads.id AND q.status = 'queued')
          AND EXISTS (SELECT 1 FROM turns AS stopped WHERE stopped.thread_id = threads.id AND stopped.status = 'interrupted' AND stopped.finished_at = ?)`
      ).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE subagent_tasks SET status = 'interrupted', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
      this.sqlite.query(`UPDATE items SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
      this.sqlite.query(`DELETE FROM workspace_writer_leases WHERE run_id NOT IN (SELECT id FROM subagent_runs WHERE status IN ('preparing', 'running', 'steering', 'waiting_question', 'waiting_permission'))`)
      this.sqlite.query(`UPDATE memory_jobs SET status = 'queued', started_at = NULL, updated_at = ? WHERE status = 'running'`).run(timestamp)
      // A process crash after claim is observationally ambiguous: the host
      // command may already have started. Cancel instead of risking a replay.
      this.sqlite.query(`UPDATE sandbox_escalations SET status = 'cancelled', completed_at = ? WHERE status = 'claimed'`).run(timestamp)
    })()
  }

  transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) return work()
    this.transactionDepth = 1
    this.transactionCommitCallbacks = []
    this.transactionRollbackCallbacks = []
    try {
      const result = this.sqlite.transaction(work)()
      const callbacks = this.transactionCommitCallbacks
      this.transactionDepth = 0
      this.transactionCommitCallbacks = []
      this.transactionRollbackCallbacks = []
      for (const callback of callbacks) callback()
      return result
    } catch (cause) {
      const callbacks = this.transactionRollbackCallbacks
      this.transactionDepth = 0
      this.transactionCommitCallbacks = []
      this.transactionRollbackCallbacks = []
      for (const callback of callbacks) callback()
      throw cause
    }
  }

  onTransactionCommit(callback: () => void) {
    if (this.transactionDepth === 0) callback()
    else this.transactionCommitCallbacks.push(callback)
  }

  onTransactionRollback(callback: () => void) {
    if (this.transactionDepth > 0) this.transactionRollbackCallbacks.push(callback)
  }

  private appendUserMessage(input: { id: string; threadID: string; turnID: string; content: string; createdAt: number }) {
    const row = this.sqlite.query("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM messages WHERE thread_id = ?").get(input.threadID) as { ordinal: number }
    const preview = previewText(input.content)
    this.sqlite.query(`INSERT INTO messages (id, thread_id, turn_id, role, content, created_at, ordinal) VALUES (?, ?, ?, 'user', ?, ?, ?)`).run(
      input.id,
      input.threadID,
      input.turnID,
      input.content,
      input.createdAt,
      row.ordinal,
    )
    this.sqlite.query(`
      UPDATE threads
      SET updated_at = ?,
        message_count = message_count + 1,
        first_user_message = COALESCE(first_user_message, ?),
        preview = COALESCE(?, preview)
      WHERE id = ?
    `).run(input.createdAt, input.content, preview, input.threadID)
  }

  getThreadSettings(threadID: string): ThreadSettings | null {
    const row = this.sqlite.query("SELECT task_mode, sandbox_mode, approval_policy, approvals_reviewer FROM threads WHERE id = ?").get(threadID) as ThreadSettingsColumns | null
    return row ? threadSettingsFromRow(row) : null
  }

  private syncThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
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

  createThread(title = "新对话", projectID?: string, initialSettings?: ThreadSettings) {
    const id = crypto.randomUUID()
    const timestamp = now()
    const settings = initialSettings ?? defaultThreadSettings()
    return this.transaction(() => {
      if (projectID) this.requireProject(projectID)
      this.sqlite.query("INSERT INTO threads (id, title, project_id, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        id,
        title,
        projectID ?? null,
        settings.taskMode,
        settings.permissionConfig.sandboxMode,
        encodeApprovalPolicy(settings.permissionConfig.approvalPolicy),
        settings.permissionConfig.approvalsReviewer,
        timestamp,
        timestamp,
      )
      const event = this.insertEvent(id, null, "thread/created", { id, title, projectID: projectID ?? null, settings, createdAt: timestamp, updatedAt: timestamp })
      return { id, title, projectID: projectID ?? null, settings, createdAt: timestamp, updatedAt: timestamp, event }
    })
  }

  getThread(threadID: string): ThreadSnapshot | null {
    const thread = this.sqlite.query("SELECT id, title, task_mode, sandbox_mode, approval_policy, approvals_reviewer, created_at, updated_at FROM threads WHERE id = ?").get(threadID) as
      | ({ id: string; title: string; created_at: number; updated_at: number } & ThreadSettingsColumns)
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

  activeTurn(threadID: string) {
    return this.sqlite.query(`SELECT id, status, mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref FROM turns WHERE thread_id = ? AND status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_plan_confirmation', 'waiting_subagents') ORDER BY created_at DESC LIMIT 1`).get(threadID) as
      | ({ id: string; status: TurnStatus; mode: TaskMode; model_ref: string } & PermissionColumns)
      | null
  }

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
      events.push(this.insertEvent(payload.invocation.threadID, row.turn_id, "approval/requested", requestedParams))
    })
    return { checkpoint: this.getApprovalCheckpoint(approvalID)!, events }
  }

  resolveApprovalCheckpoint(approvalID: string, decision: "allow" | "deny"):
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
      this.sqlite.query("UPDATE approval_checkpoints SET payload = ?, updated_at = ? WHERE approval_id = ?").run(stringify({ ...checkpoint.payload, resolution: { decision, resolvedAt: timestamp } }), timestamp, approvalID)
      this.updateTurnStatus(request.turn_id, "queued")
      this.updateAgentStatus(request.agent_id, "queued")
      events.push(this.insertEvent(request.thread_id, request.turn_id, "agent/upserted", { agent: this.getAgentExecution(request.agent_id) }))
      events.push(this.insertEvent(request.thread_id, request.turn_id, "serverRequest/resolved", { id: approvalID, turnId: request.turn_id, kind: "approval", decision }))
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
    const row = this.sqlite.query("SELECT decision FROM hook_trust_decisions WHERE workspace_path = ? AND config_hash = ?").get(workspacePath, configHash) as { decision: "allow" | "block" } | null
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

  resolveHookTrustRequest(id: string, decision: "allow" | "block") {
    return this.transaction(() => {
      const request = this.getHookTrustRequest(id)
      if (!request) return { state: "missing" as const, request: null, events: [], resumed: [] }
      if (request.status !== "pending") return { state: "resolved" as const, request, events: [], resumed: [] }
      const timestamp = now()
      this.sqlite.query("UPDATE hook_trust_requests SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(decision === "allow" ? "allowed" : "blocked", timestamp, id)
      this.sqlite.query(`INSERT INTO hook_trust_decisions (workspace_path, config_hash, config_path, decision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_path, config_hash) DO UPDATE SET config_path = excluded.config_path, decision = excluded.decision, updated_at = excluded.updated_at`).run(
        request.workspacePath, request.configHash, request.configPath, decision, timestamp, timestamp,
      )
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

  createResumableQuestion(input: Omit<ResumableQuestion, "id" | "createdAt"> & { agentID: string; id?: string; createdAt?: number; checkpoint: Omit<AgentTurnCheckpoint, "agentID" | "turnID" | "threadID" | "state" | "createdAt" | "updatedAt"> }) {
    const id = input.id ?? crypto.randomUUID()
    const createdAt = input.createdAt ?? now()
    this.transaction(() => {
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
      this.upsertItem(input.threadID, { id, turnID: input.turnID, agentID: input.agentID, type: "question", status: "pending", data: input.payload, createdAt, updatedAt: createdAt })
    })
    return { id, threadID: input.threadID, turnID: input.turnID, toolCallID: input.toolCallID, payload: input.payload, payloadVersion: input.payloadVersion, createdAt } satisfies ResumableQuestion
  }

  resolveResumableQuestion(id: string, answer: unknown, ignored = false) {
    const row = this.sqlite.query("SELECT thread_id, turn_id, status FROM question_requests WHERE id = ?").get(id) as { thread_id: string; turn_id: string; status: string } | null
    if (!row || row.status !== "pending") return null
    const timestamp = now()
    this.transaction(() => {
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
    })
    return { threadID: row.thread_id, turnID: row.turn_id }
  }

  waitForPlanConfirmation(input: Omit<AgentTurnCheckpoint, "state" | "createdAt" | "updatedAt">) {
    return this.transaction(() => {
      const checkpoint = this.saveAgentTurnCheckpoint({ ...input, state: "waiting_plan_confirmation" })
      this.updateTurnStatus(input.turnID, "waiting_plan_confirmation")
      this.updateAgentStatus(input.agentID, "waiting_confirmation")
      return checkpoint
    })
  }

  decidePlan(turnID: string, decision: "continue" | "reject") {
    const row = this.sqlite.query("SELECT thread_id, root_agent_id, status FROM turns WHERE id = ?").get(turnID) as { thread_id: string; root_agent_id: string; status: string } | null
    if (!row) return null
    if (row.status !== "waiting_plan_confirmation") return null
    const nextStatus: TurnStatus = decision === "continue" ? "queued" : "cancelled"
    this.transaction(() => {
      this.updateTurnStatus(turnID, nextStatus)
      this.updateAgentStatus(row.root_agent_id, decision === "continue" ? "queued" : "cancelled")
      const checkpoint = this.getAgentTurnCheckpoint(turnID)
      if (checkpoint && decision === "continue") this.saveAgentTurnCheckpoint({
        ...checkpoint,
        state: "ready",
        payload: { ...checkpoint.payload, planDecision: decision },
      })
      if (decision === "reject") this.deleteAgentTurnCheckpoint(turnID)
      this.setCurrentPlanState(turnID, decision === "continue" ? "confirmed" : "rejected")
    })
    return { threadID: row.thread_id, turnID, status: nextStatus, decision }
  }

  upsertItem(threadID: string, item: Item) {
    this.sqlite.query(`INSERT INTO items (id, thread_id, turn_id, agent_id, type, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`).run(
      item.id,
      threadID,
      item.turnID,
      item.agentID,
      item.type,
      item.status,
      stringify(item.data),
      item.createdAt,
      item.updatedAt,
    )
  }

  upsertItemWithEvent(threadID: string, item: Item, method: string, params?: unknown) {
    return this.transaction(() => {
      this.upsertItem(threadID, item)
      const persisted = this.getItem(item.id) ?? item
      return {
        item: persisted,
        event: this.insertEvent(threadID, item.turnID, method, params ?? { item: persisted }),
      }
    })
  }

  getItem(itemID: string) {
    const row = this.sqlite.query("SELECT id, turn_id, agent_id, type, status, data, created_at, updated_at FROM items WHERE id = ?").get(itemID) as
      | { id: string; turn_id: string; agent_id: string; type: Item["type"]; status: Item["status"]; data: string; created_at: number; updated_at: number }
      | null
    return row ? { id: row.id, turnID: row.turn_id, agentID: row.agent_id, type: row.type, status: row.status, data: parse<Record<string, unknown>>(row.data), createdAt: row.created_at, updatedAt: row.updated_at } satisfies Item : null
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

  setProviderSettings(providerID: string, value: unknown) {
    this.sqlite.query(`INSERT INTO provider_settings (provider_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`).run(providerID, stringify(value), now())
  }

  providerSettings<T = unknown>() {
    const rows = this.sqlite.query("SELECT provider_id, payload FROM provider_settings").all() as Array<{ provider_id: string; payload: string }>
    return new Map(rows.map((row) => [row.provider_id, parse<T>(row.payload)]))
  }

  credentialCount() {
    const row = this.sqlite.query("SELECT COUNT(*) AS count FROM credentials").get() as { count: number }
    return row.count
  }

  listEncryptedCredentials(): StoredEncryptedCredential[] {
    const rows = this.sqlite.query(
      "SELECT id, integration_id, method_id, label, ciphertext, nonce, key_version, created_at, updated_at FROM credentials ORDER BY created_at, id",
    ).all() as Array<{
      id: string
      integration_id: string
      method_id: string | null
      label: string
      ciphertext: string
      nonce: string
      key_version: number
      created_at: number
      updated_at: number
    }>
    return rows.map((row) => ({
      id: row.id,
      integrationID: row.integration_id,
      methodID: row.method_id,
      label: row.label,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  }

  encryptedCredential(integrationID: string) {
    return this.listEncryptedCredentials().find((item) => item.integrationID === integrationID) ?? null
  }

  upsertEncryptedCredential(input: Omit<StoredEncryptedCredential, "createdAt" | "updatedAt">) {
    const timestamp = now()
    this.sqlite.query(`
      INSERT INTO credentials (id, integration_id, method_id, label, ciphertext, nonce, key_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(integration_id) DO UPDATE SET
        id = excluded.id,
        method_id = excluded.method_id,
        label = excluded.label,
        ciphertext = excluded.ciphertext,
        nonce = excluded.nonce,
        key_version = excluded.key_version,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.integrationID,
      input.methodID,
      input.label,
      input.ciphertext,
      input.nonce,
      input.keyVersion,
      timestamp,
      timestamp,
    )
    return this.encryptedCredential(input.integrationID)!
  }

  removeEncryptedCredential(integrationID: string) {
    return this.sqlite.query("DELETE FROM credentials WHERE integration_id = ?").run(integrationID).changes > 0
  }

  setSetting(key: string, value: unknown) {
    this.sqlite.query(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, stringify(value), now())
  }

  getSetting<T>(key: string): T | null {
    const row = this.sqlite.query("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null
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

  private requireProject(projectID: string) {
    const project = this.getProject(projectID)
    if (!project) throw new Error(`项目 ${projectID} 不存在`)
    return project
  }

  createProject(input: { rootPath: string; name?: string }) {
    const rootPath = resolve(input.rootPath)
    const timestamp = now()
    const existing = this.sqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects WHERE root_path = ?").get(rootPath) as { id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number } | null
    if (existing) {
      this.sqlite.query("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, existing.id)
      return this.getProject(existing.id)!
    }
    const id = crypto.randomUUID()
    const name = input.name?.trim() || basename(rootPath) || rootPath
    this.transaction(() => {
      this.sqlite.query("INSERT INTO projects (id, name, root_path, created_at, updated_at, last_opened_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, rootPath, timestamp, timestamp, timestamp)
      this.sqlite.query("INSERT INTO project_settings (project_id, default_model, updated_at) VALUES (?, NULL, ?)").run(id, timestamp)
    })
    return this.getProject(id)!
  }

  listProjects() {
    const rows = this.sqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects ORDER BY last_opened_at DESC, created_at DESC").all() as Array<{ id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number }>
    return rows.map((row) => this.mapProject(row))
  }

  getProject(projectID: string) {
    const row = this.sqlite.query("SELECT id, name, root_path, last_opened_at, created_at, updated_at FROM projects WHERE id = ?").get(projectID) as { id: string; name: string; root_path: string; last_opened_at: number; created_at: number; updated_at: number } | null
    return row ? this.mapProject(row) : null
  }

  touchProject(projectID: string) {
    this.requireProject(projectID)
    const timestamp = now()
    this.sqlite.query("UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, projectID)
    return this.getProject(projectID)!
  }

  getProjectSettings(projectID: string): ProjectModelSettings {
    const row = this.sqlite.query("SELECT default_model FROM project_settings WHERE project_id = ?").get(projectID) as { default_model: string | null } | null
    return {
      defaultModel: row?.default_model ? parse<ModelRef>(row.default_model) : null,
    }
  }

  saveProjectSettings(projectID: string, settings: ProjectModelSettings) {
    this.requireProject(projectID)
    const timestamp = now()
    this.sqlite.query(`INSERT INTO project_settings (project_id, default_model, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET default_model = excluded.default_model, updated_at = excluded.updated_at`).run(
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

  setThreadProject(threadID: string, projectID: string | null) {
    if (projectID) this.requireProject(projectID)
    const result = this.sqlite.query("UPDATE threads SET project_id = ?, updated_at = ? WHERE id = ?").run(projectID, now(), threadID)
    if (result.changes === 0) throw new Error(`Thread ${threadID} 不存在`)
  }

  private mapReviewComment(row: {
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
    `).all(input.threadId, input.projectId, input.sourceKey) as Parameters<AgentDatabase["mapReviewComment"]>[0][]
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
    `).get(id) as Parameters<AgentDatabase["mapReviewComment"]>[0] | null
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
