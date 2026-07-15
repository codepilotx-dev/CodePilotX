import { Database } from "bun:sqlite"
import { copyFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { basename, dirname, extname, resolve } from "node:path"
import { Effect } from "effect"
import { DEFAULT_PERMISSION_CONFIG, type ThreadSettings, type ThreadSettingsPatch } from "@codepilotx/shared/thread"
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
  state: "waiting_question" | "waiting_plan_confirmation" | "waiting_subagents" | "ready"
  payload: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
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

type SqlValue = string | number | boolean | Uint8Array | null

const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T
const now = () => Date.now()
const previewText = (value: string, limit = 180) => value.replace(/\s+/g, " ").trim().slice(0, limit) || null
export const SCHEMA_VERSION = 6

type PermissionColumns = {
  sandbox_mode: PermissionConfig["sandboxMode"]
  approval_policy: PermissionConfig["approvalPolicy"]
  approvals_reviewer: PermissionConfig["approvalsReviewer"]
}

type ThreadSettingsColumns = PermissionColumns & {
  task_mode: TaskMode
}

const permissionConfigFromRow = (row: PermissionColumns): PermissionConfig => ({
  sandboxMode: row.sandbox_mode,
  approvalPolicy: row.approval_policy,
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

const legacyPermissionMode = (config: PermissionConfig) => {
  if (config.sandboxMode === "danger-full-access" && config.approvalPolicy === "never" && config.approvalsReviewer === "auto_review") return "full"
  if (config.sandboxMode === "workspace-write" && config.approvalPolicy === "on-request" && config.approvalsReviewer === "auto_review") return "review"
  if (config.sandboxMode === "workspace-write" && config.approvalPolicy === "on-request" && config.approvalsReviewer === "user") return "ask"
  throw new Error("Unsupported permission configuration")
}

const legacyBackupPath = (path: string) => {
  const extension = extname(path) || ".sqlite"
  const stem = extension ? path.slice(0, -extension.length) : path
  return `${stem}.legacy-v1-${new Date().toISOString().replace(/[:.]/g, "-")}${extension}`
}

const versionBackupPath = (path: string, version: number) => {
  const extension = extname(path) || ".sqlite"
  const stem = extension ? path.slice(0, -extension.length) : path
  return `${stem}.pre-v${version}-${new Date().toISOString().replace(/[:.]/g, "-")}${extension}`
}

const prepareDatabase = (path: string) => {
  if (!existsSync(path)) return
  const probe = new Database(path, { create: false, strict: true })
  let legacy = false
  let version = 0
  try {
    const tables = new Set((probe.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
    legacy = ["sessions", "runs", "parts"].some((name) => tables.has(name))
    version = (probe.query("PRAGMA user_version").get() as { user_version: number }).user_version
    if (legacy || (version > 0 && version < SCHEMA_VERSION)) probe.exec("PRAGMA wal_checkpoint(TRUNCATE)")
  } finally {
    probe.close()
  }
  if (legacy) {
    const backup = legacyBackupPath(path)
    renameSync(path, backup)
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${backup}${suffix}`)
    }
    return
  }
  if (version > 0 && version < SCHEMA_VERSION) copyFileSync(path, versionBackupPath(path, SCHEMA_VERSION))
}

export class AgentDatabase {
  readonly sqlite: Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    prepareDatabase(path)
    this.sqlite = new Database(path, { create: true, strict: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA foreign_keys = ON")
    this.sqlite.exec("PRAGMA busy_timeout = 5000")
    this.migrate()
    this.recoverInterruptedTurns()
  }

  close() {
    this.sqlite.close()
  }

  private migrate() {
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
        permission_mode TEXT NOT NULL,
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
        permission_mode TEXT NOT NULL,
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
    this.sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS agent_executions_run_sequence_unique ON agent_executions(subagent_run_id, run_sequence) WHERE subagent_run_id IS NOT NULL")
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
          permission_mode TEXT NOT NULL,
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
          permission_mode TEXT NOT NULL,
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
    this.sqlite.transaction(() => {
      this.sqlite.query(`UPDATE turns SET status = 'interrupted', finished_at = ?, updated_at = ? WHERE status IN ('running', 'waiting_permission') OR (status = 'waiting_question' AND NOT EXISTS (SELECT 1 FROM question_requests AS q LEFT JOIN agent_checkpoints AS c ON c.turn_id = q.turn_id AND c.state = 'waiting_question' WHERE q.turn_id = turns.id AND q.status = 'pending' AND (c.turn_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)))`).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE agent_executions SET status = 'interrupted', updated_at = ? WHERE status IN ('running', 'waiting_permission') OR (status = 'waiting_question' AND turn_id IN (SELECT id FROM turns WHERE status = 'interrupted'))`).run(timestamp)
      this.sqlite.query(`UPDATE items SET status = 'interrupted', updated_at = ? WHERE status IN ('pending', 'running') AND type <> 'subagent' AND NOT (type = 'question' AND id IN (SELECT id FROM question_requests WHERE status = 'pending' AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL OR turn_id IN (SELECT turn_id FROM agent_checkpoints WHERE state = 'waiting_question'))))`).run(timestamp)
      this.sqlite.query(`UPDATE approval_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'`).run(timestamp)
      this.sqlite.query(`UPDATE question_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND turn_id IN (SELECT id FROM turns WHERE status <> 'waiting_question')`).run(timestamp)
      this.sqlite.query(`UPDATE subagent_runs SET status = 'interrupted', error = COALESCE(error, 'Agent 重启时运行被中断'), finished_at = ?, updated_at = ? WHERE status IN ('preparing', 'running', 'steering', 'waiting_permission')`).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE subagent_tasks SET status = 'interrupted', updated_at = ? WHERE current_run_id IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
      this.sqlite.query(`UPDATE items SET status = 'interrupted', data = json_set(data, '$.status', 'interrupted', '$.queueReason', NULL), updated_at = ? WHERE type = 'subagent' AND json_extract(data, '$.runId') IN (SELECT id FROM subagent_runs WHERE status = 'interrupted')`).run(timestamp)
      this.sqlite.query(`DELETE FROM workspace_writer_leases WHERE run_id NOT IN (SELECT id FROM subagent_runs WHERE status IN ('preparing', 'running', 'steering', 'waiting_question', 'waiting_permission'))`)
    })()
  }

  transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work)()
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
      && settings.permissionConfig.approvalPolicy === existing.permissionConfig.approvalPolicy
      && settings.permissionConfig.approvalsReviewer === existing.permissionConfig.approvalsReviewer
    if (unchanged) return { settings, event: null }
    this.sqlite.query(`
      UPDATE threads
      SET task_mode = ?, sandbox_mode = ?, approval_policy = ?, approvals_reviewer = ?
      WHERE id = ?
    `).run(
      settings.taskMode,
      settings.permissionConfig.sandboxMode,
      settings.permissionConfig.approvalPolicy,
      settings.permissionConfig.approvalsReviewer,
      threadID,
    )
    const event = this.insertEvent(threadID, null, "thread/settings/updated", { threadId: threadID, settings })
    return { settings, event }
  }

  updateThreadSettings(threadID: string, patch: ThreadSettingsPatch) {
    return this.transaction(() => this.syncThreadSettings(threadID, patch))
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
        settings.permissionConfig.approvalPolicy,
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

  createTurn(threadID: string, input: SubmitMessage, status: TurnStatus = "queued") {
    const turnID = crypto.randomUUID()
    const agentID = crypto.randomUUID()
    const inputID = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      const settingsUpdate = this.syncThreadSettings(threadID, {
        taskMode: input.taskMode,
        permissionConfig: input.permissionConfig,
      })
      this.sqlite.query(`INSERT INTO turns (id, thread_id, root_agent_id, status, mode, permission_mode, sandbox_mode, approval_policy, approvals_reviewer, model_ref, strategy, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(
        turnID,
        threadID,
        agentID,
        status,
        input.taskMode,
        legacyPermissionMode(input.permissionConfig),
        input.permissionConfig.sandboxMode,
        input.permissionConfig.approvalPolicy,
        input.permissionConfig.approvalsReviewer,
        stringify(input.model),
        input.strategy,
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
      this.sqlite.query(`INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, permission_mode, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        inputID,
        threadID,
        turnID,
        input.content,
        stringify(input.model),
        legacyPermissionMode(input.permissionConfig),
        input.permissionConfig.sandboxMode,
        input.permissionConfig.approvalPolicy,
        input.permissionConfig.approvalsReviewer,
        input.strategy,
        input.taskMode,
        status === "queued" ? "queued" : "active",
        timestamp,
      )
      this.appendUserMessage({ id: inputID, threadID, turnID, content: input.content, createdAt: timestamp })
      const method = status === "queued" ? "turn/queued" : "turn/started"
      const event = this.insertEvent(threadID, turnID, method, { turnId: turnID, inputID, input, createdAt: timestamp })
      const agentEvent = this.insertEvent(threadID, turnID, "agent/upserted", { agent: this.getAgentExecution(agentID) })
      return { turnID, agentID, inputID, settingsEvent: settingsUpdate.event, event, agentEvent }
    })
  }

  appendGuide(threadID: string, turnID: string, input: SubmitMessage) {
    const id = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      const settingsUpdate = this.syncThreadSettings(threadID, {
        taskMode: input.taskMode,
        permissionConfig: input.permissionConfig,
      })
      this.sqlite.query(`INSERT INTO inputs (id, thread_id, turn_id, content, model_ref, permission_mode, sandbox_mode, approval_policy, approvals_reviewer, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'guide', ?, 'mailbox', ?)`).run(
        id,
        threadID,
        turnID,
        input.content,
        stringify(input.model),
        legacyPermissionMode(input.permissionConfig),
        input.permissionConfig.sandboxMode,
        input.permissionConfig.approvalPolicy,
        input.permissionConfig.approvalsReviewer,
        input.taskMode,
        timestamp,
      )
      this.appendUserMessage({ id, threadID, turnID, content: input.content, createdAt: timestamp })
      const event = this.insertEvent(threadID, turnID, "queue/updated", { turnId: turnID, inputID: id, input, action: "guide-appended", createdAt: timestamp })
      return { inputID: id, settingsEvent: settingsUpdate.event, event }
    })
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
      return this.getAgentExecution(turn.root_agent_id)
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

  nextQueuedTurn(threadID: string) {
    return this.sqlite.query("SELECT id FROM turns WHERE thread_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1").get(threadID) as { id: string } | null
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

}
