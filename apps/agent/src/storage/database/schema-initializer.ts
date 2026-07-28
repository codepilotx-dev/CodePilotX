import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { resolve } from "node:path"

import {
  PROFILE_APPLICATION_ID,
  PROFILE_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from "./schema"

export const FINAL_SCHEMA = [
  "CREATE TABLE agent_checkpoints (\n        agent_id TEXT PRIMARY KEY REFERENCES agent_executions(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        state TEXT NOT NULL,\n        payload TEXT NOT NULL,\n        version INTEGER NOT NULL,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE agent_compactions (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          baseline_version INTEGER NOT NULL,\n          before_count INTEGER NOT NULL,\n          after_count INTEGER NOT NULL,\n          summary TEXT NOT NULL,\n          replacement_history TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        , before_tokens INTEGER NOT NULL DEFAULT 0, after_tokens INTEGER NOT NULL DEFAULT 0, target_tokens INTEGER NOT NULL DEFAULT 0, usage_sample_id TEXT)",
  "CREATE TABLE agent_executions (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,\n        parent_agent_id TEXT REFERENCES agent_executions(id) ON DELETE CASCADE,\n        profile TEXT NOT NULL,\n        task TEXT NOT NULL,\n        model_ref TEXT NOT NULL,\n        session_id TEXT NOT NULL,\n        depth INTEGER NOT NULL DEFAULT 0,\n        subagent_run_id TEXT,\n        run_sequence INTEGER NOT NULL DEFAULT 0,\n        status TEXT NOT NULL,\n        error TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE app_settings (\n        key TEXT PRIMARY KEY,\n        value TEXT NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE approval_checkpoints (\n          approval_id TEXT PRIMARY KEY REFERENCES approval_requests(id) ON DELETE CASCADE,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          payload TEXT NOT NULL,\n          version INTEGER NOT NULL DEFAULT 1,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE approval_requests (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_call_id TEXT NOT NULL,\n        risk TEXT NOT NULL,\n        reason TEXT NOT NULL,\n        status TEXT NOT NULL,\n        reply TEXT,\n        request_payload TEXT NOT NULL DEFAULT '{\"version\":1}',\n        review_payload TEXT,\n        created_at INTEGER NOT NULL,\n        resolved_at INTEGER\n      )",
  "CREATE TABLE context_usage_samples (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          session_id TEXT,\n          context_fingerprint TEXT NOT NULL,\n          context_window_tokens INTEGER NOT NULL,\n          input_tokens INTEGER NOT NULL,\n          output_tokens INTEGER NOT NULL DEFAULT 0,\n          source TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        )",
  "CREATE TABLE credential_health (\n          credential_id TEXT PRIMARY KEY REFERENCES credentials(id) ON DELETE CASCADE,\n          status TEXT NOT NULL CHECK (status IN ('untested', 'healthy', 'auth-failed', 'rate-limited', 'error')),\n          last_tested_at INTEGER,\n          last_used_at INTEGER,\n          last_error_category TEXT,\n          cooldown_until INTEGER,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE credentials (\n          id TEXT PRIMARY KEY,\n          integration_id TEXT NOT NULL,\n          kind TEXT NOT NULL CHECK (kind IN ('api-key', 'oauth')),\n          method_id TEXT,\n          label TEXT NOT NULL,\n          key_suffix TEXT,\n          fingerprint TEXT,\n          enabled INTEGER NOT NULL DEFAULT 1,\n          priority INTEGER NOT NULL DEFAULT 0,\n          ciphertext TEXT NOT NULL,\n          nonce TEXT NOT NULL,\n          key_version INTEGER NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE events (\n        id INTEGER PRIMARY KEY AUTOINCREMENT,\n        thread_id TEXT,\n        turn_id TEXT,\n        method TEXT NOT NULL,\n        params TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      )",
  "CREATE TABLE guardian_review_sessions (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          cache_key TEXT NOT NULL,\n          history_version INTEGER NOT NULL DEFAULT 1,\n          evidence_cursor INTEGER NOT NULL DEFAULT 0,\n          history TEXT NOT NULL DEFAULT '[]',\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE hook_runs (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          tool_call_id TEXT,\n          event TEXT NOT NULL,\n          hook_id TEXT NOT NULL,\n          status TEXT NOT NULL,\n          input TEXT NOT NULL,\n          output TEXT,\n          error TEXT,\n          started_at INTEGER NOT NULL,\n          finished_at INTEGER\n        , command TEXT, cwd TEXT, evidence_summary TEXT)",
  "CREATE TABLE hook_trust_decisions (\n          workspace_path TEXT NOT NULL,\n          config_hash TEXT NOT NULL,\n          config_path TEXT NOT NULL,\n          decision TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          PRIMARY KEY (workspace_path, config_hash)\n        )",
  "CREATE TABLE hook_trust_requests (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n          workspace_path TEXT NOT NULL,\n          config_path TEXT NOT NULL,\n          config_hash TEXT NOT NULL,\n          status TEXT NOT NULL,\n          audit_summary TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          resolved_at INTEGER\n        )",
  "CREATE TABLE hook_trust_waiters (\n          request_id TEXT NOT NULL REFERENCES hook_trust_requests(id) ON DELETE CASCADE,\n          agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY (request_id, agent_id)\n        )",
  "CREATE TABLE input_attachments (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n          input_id TEXT REFERENCES inputs(id) ON DELETE CASCADE,\n          kind TEXT NOT NULL,\n          name TEXT NOT NULL,\n          media_type TEXT NOT NULL,\n          size_bytes INTEGER NOT NULL,\n          sha256 TEXT NOT NULL,\n          storage_path TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          bound_at INTEGER\n        )",
  "CREATE TABLE inputs (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n        content TEXT NOT NULL,\n        model_ref TEXT NOT NULL,\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        strategy TEXT NOT NULL,\n        task_mode TEXT NOT NULL,\n        status TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      )",
  "CREATE TABLE integration_credential_bindings (\n          integration_id TEXT PRIMARY KEY,\n          credential_id TEXT NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE interaction_operations (\n          operation_id TEXT PRIMARY KEY,\n          interaction_id TEXT NOT NULL,\n          response TEXT NOT NULL,\n          result TEXT NOT NULL,\n          created_at INTEGER NOT NULL\n        )",
  "CREATE TABLE items (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n        agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n        type TEXT NOT NULL,\n        status TEXT NOT NULL,\n        data TEXT NOT NULL,\n        ordinal INTEGER NOT NULL,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE memory_entries (\n          id TEXT PRIMARY KEY,\n          scope TEXT NOT NULL,\n          project_key TEXT NOT NULL DEFAULT '',\n          content TEXT NOT NULL,\n          source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          content_hash TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(scope, project_key, content_hash)\n        )",
  "CREATE TABLE memory_jobs (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,\n          project_key TEXT,\n          status TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          started_at INTEGER,\n          finished_at INTEGER,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE messages (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,\n        role TEXT NOT NULL,\n        content TEXT NOT NULL,\n        created_at INTEGER NOT NULL\n      , ordinal INTEGER)",
  "CREATE TABLE patches (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        files TEXT NOT NULL,\n        additions INTEGER NOT NULL DEFAULT 0,\n        deletions INTEGER NOT NULL DEFAULT 0,\n        created_at INTEGER NOT NULL\n      )",
  "CREATE TABLE \"pi_session_entries\" (\n          session_id TEXT NOT NULL REFERENCES \"pi_sessions\"(id) ON DELETE CASCADE,\n          sequence INTEGER NOT NULL,\n          id TEXT NOT NULL,\n          parent_id TEXT,\n          type TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          PRIMARY KEY (session_id, sequence),\n          UNIQUE (session_id, id)\n        )",
  "CREATE TABLE \"pi_sessions\" (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          agent_id TEXT NOT NULL,\n          leaf_id TEXT,\n          name TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE project_settings (\n        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,\n        default_model TEXT,\n        instructions TEXT NOT NULL DEFAULT '',\n        version INTEGER NOT NULL DEFAULT 1,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE projects (\n        id TEXT PRIMARY KEY,\n        name TEXT NOT NULL,\n        removed_at INTEGER,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        last_opened_at INTEGER NOT NULL\n      )",
  "CREATE TABLE project_folders (\n        id TEXT PRIMARY KEY,\n        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n        path TEXT NOT NULL,\n        path_key TEXT NOT NULL,\n        role TEXT NOT NULL CHECK(role IN ('primary', 'secondary')),\n        sort_order INTEGER NOT NULL DEFAULT 0,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        UNIQUE(project_id, path_key)\n      )",
  "CREATE TABLE project_sources (\n        id TEXT PRIMARY KEY,\n        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n        storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed', 'workspace-file')),\n        content_kind TEXT NOT NULL CHECK(content_kind IN ('text', 'image')),\n        name TEXT NOT NULL,\n        media_type TEXT,\n        size_bytes INTEGER,\n        sha256 TEXT,\n        storage_path TEXT,\n        folder_id TEXT REFERENCES project_folders(id) ON DELETE CASCADE,\n        relative_path TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL,\n        CHECK((storage_kind = 'managed' AND media_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND storage_path IS NOT NULL AND folder_id IS NULL AND relative_path IS NULL) OR (storage_kind = 'workspace-file' AND folder_id IS NOT NULL AND relative_path IS NOT NULL AND storage_path IS NULL))\n      )",
  "CREATE TABLE project_operations (\n        operation_id TEXT PRIMARY KEY,\n        project_id TEXT,\n        method TEXT NOT NULL,\n        request_hash TEXT NOT NULL,\n        status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),\n        result TEXT,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE prompt_session_state (\n          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,\n          baseline_version INTEGER NOT NULL DEFAULT 1,\n          prompt_version TEXT NOT NULL,\n          base_hash TEXT NOT NULL,\n          context_hash TEXT NOT NULL,\n          cache_key TEXT NOT NULL,\n          fragments TEXT NOT NULL DEFAULT '[]',\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        , context_window_tokens INTEGER NOT NULL DEFAULT 0, usage_tokens INTEGER NOT NULL DEFAULT 0, usage_source TEXT NOT NULL DEFAULT 'estimated', usage_sample_id TEXT, needs_compaction INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE provider_settings (\n        provider_id TEXT PRIMARY KEY,\n        payload TEXT NOT NULL,\n        updated_at INTEGER NOT NULL\n      )",
  "CREATE TABLE question_requests (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_call_id TEXT,\n        payload TEXT NOT NULL,\n        payload_version INTEGER NOT NULL DEFAULT 1,\n        status TEXT NOT NULL,\n        answer TEXT,\n        created_at INTEGER NOT NULL,\n        resolved_at INTEGER\n      )",
  "CREATE TABLE queue_operations (\n          operation_id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          method TEXT NOT NULL,\n          event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,\n          created_at INTEGER NOT NULL\n        )",
  "CREATE TABLE review_comments (\n          id TEXT PRIMARY KEY,\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n          source_key TEXT NOT NULL,\n          path TEXT NOT NULL,\n          side TEXT NOT NULL CHECK(side IN ('old', 'new')),\n          line INTEGER NOT NULL CHECK(line > 0),\n          hunk_id TEXT,\n          revision TEXT NOT NULL,\n          body TEXT NOT NULL,\n          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),\n          github_comment_id TEXT,\n          github_thread_id TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE sandbox_escalations (\n      token TEXT PRIMARY KEY,\n      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n      agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n      tool_call_id TEXT NOT NULL,\n      invocation TEXT NOT NULL,\n      invocation_hash TEXT NOT NULL DEFAULT '',\n      failure TEXT NOT NULL,\n      status TEXT NOT NULL,\n      output TEXT,\n      created_at INTEGER NOT NULL,\n      claimed_at INTEGER,\n      completed_at INTEGER\n    )",
  "CREATE TABLE subagent_controls (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          run_id TEXT REFERENCES subagent_runs(id) ON DELETE CASCADE,\n          action TEXT NOT NULL,\n          payload TEXT NOT NULL,\n          status TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          applied_at INTEGER\n        )",
  "CREATE TABLE subagent_runs (\n          id TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          generation INTEGER NOT NULL,\n          status TEXT NOT NULL,\n          queue_reason TEXT,\n          model_ref TEXT NOT NULL,\n          permission_config TEXT NOT NULL,\n          result TEXT,\n          error TEXT,\n          created_at INTEGER NOT NULL,\n          started_at INTEGER,\n          finished_at INTEGER,\n          updated_at INTEGER NOT NULL,\n          UNIQUE(task_id, generation)\n        )",
  "CREATE TABLE subagent_tasks (\n          id TEXT PRIMARY KEY,\n          parent_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          parent_turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          parent_agent_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,\n          child_thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,\n          display_name TEXT NOT NULL,\n          profile TEXT NOT NULL,\n          task TEXT NOT NULL,\n          permission_ceiling TEXT NOT NULL,\n          workspace_mode TEXT NOT NULL,\n          workspace_state TEXT NOT NULL DEFAULT '{}',\n          current_run_id TEXT,\n          status TEXT NOT NULL,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL\n        )",
  "CREATE TABLE threads (\n        id TEXT PRIMARY KEY,\n        title TEXT NOT NULL,\n        kind TEXT NOT NULL DEFAULT 'main',\n        parent_thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,\n        task_mode TEXT NOT NULL DEFAULT 'chat',\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      , project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, workspace_kind TEXT NOT NULL DEFAULT 'legacy', workspace_root TEXT, workspace_cwd TEXT, workspace_roots TEXT, instruction_sources TEXT, output_directory TEXT, create_operation_id TEXT, create_request_hash TEXT, archived_at INTEGER, preview TEXT, first_user_message TEXT, message_count INTEGER NOT NULL DEFAULT 0, prompt_settings TEXT NOT NULL DEFAULT '{}', queue_version INTEGER NOT NULL DEFAULT 0, queue_pause_reason TEXT, git_branch TEXT)",
  "CREATE TABLE tool_calls (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL,\n        turn_id TEXT NOT NULL,\n        agent_id TEXT NOT NULL,\n        tool_name TEXT NOT NULL,\n        input TEXT NOT NULL,\n        output TEXT,\n        status TEXT NOT NULL,\n        started_at INTEGER,\n        finished_at INTEGER,\n        error TEXT\n      )",
  "CREATE TABLE turn_git_snapshots (\n          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n          turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,\n          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n          repository_root TEXT NOT NULL,\n          before_tree TEXT,\n          after_tree TEXT,\n          created_at INTEGER NOT NULL,\n          updated_at INTEGER NOT NULL,\n          PRIMARY KEY (thread_id, turn_id)\n        )",
  "CREATE TABLE turns (\n        id TEXT PRIMARY KEY,\n        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,\n        root_agent_id TEXT,\n        status TEXT NOT NULL,\n        mode TEXT NOT NULL,\n        sandbox_mode TEXT NOT NULL DEFAULT 'workspace-write',\n        approval_policy TEXT NOT NULL DEFAULT 'on-request',\n        approvals_reviewer TEXT NOT NULL DEFAULT 'user',\n        model_ref TEXT NOT NULL,\n        strategy TEXT NOT NULL,\n        started_at INTEGER,\n        finished_at INTEGER,\n        created_at INTEGER NOT NULL,\n        updated_at INTEGER NOT NULL\n      , queue_position INTEGER)",
  "CREATE TABLE workspace_writer_leases (\n          workspace_key TEXT PRIMARY KEY,\n          task_id TEXT NOT NULL REFERENCES subagent_tasks(id) ON DELETE CASCADE,\n          run_id TEXT NOT NULL REFERENCES subagent_runs(id) ON DELETE CASCADE,\n          acquired_at INTEGER NOT NULL\n        )",
  "CREATE INDEX agent_checkpoints_thread ON agent_checkpoints(thread_id, updated_at DESC)",
  "CREATE INDEX agent_compactions_thread ON agent_compactions(thread_id, created_at DESC)",
  "CREATE UNIQUE INDEX agent_executions_run_sequence_unique ON agent_executions(subagent_run_id, run_sequence) WHERE subagent_run_id IS NOT NULL",
  "CREATE INDEX agent_executions_subagent_run ON agent_executions(subagent_run_id, run_sequence)",
  "CREATE INDEX agent_executions_thread_updated ON agent_executions(thread_id, updated_at DESC)",
  "CREATE INDEX context_usage_samples_lookup\n          ON context_usage_samples(thread_id, context_fingerprint, source, created_at DESC)",
  "CREATE UNIQUE INDEX credentials_api_key_fingerprint ON credentials(integration_id, fingerprint)\n          WHERE kind = 'api-key' AND fingerprint IS NOT NULL",
  "CREATE INDEX credentials_integration_priority ON credentials(integration_id, kind, priority, created_at)",
  "CREATE INDEX events_thread_id ON events(thread_id, id)",
  "CREATE INDEX hook_runs_thread ON hook_runs(thread_id, started_at DESC)",
  "CREATE UNIQUE INDEX hook_trust_requests_pending\n          ON hook_trust_requests(workspace_path, config_hash) WHERE status = 'pending'",
  "CREATE INDEX input_attachments_thread ON input_attachments(thread_id, created_at)",
  "CREATE INDEX interaction_operations_interaction\n          ON interaction_operations(interaction_id, created_at)",
  "CREATE INDEX items_turn_created ON items(turn_id, created_at)",
  "CREATE UNIQUE INDEX items_turn_ordinal_unique ON items(turn_id, ordinal)",
  "CREATE INDEX memory_entries_scope ON memory_entries(scope, project_key, updated_at DESC)",
  "CREATE INDEX memory_jobs_status ON memory_jobs(status, created_at)",
  "CREATE INDEX messages_session_ordinal ON messages(thread_id, ordinal, id)",
  "CREATE INDEX pi_session_entries_type\n          ON pi_session_entries(session_id, type, sequence)",
  "CREATE INDEX pi_sessions_thread_agent\n          ON pi_sessions(thread_id, agent_id, updated_at DESC)",
  "CREATE INDEX projects_last_opened ON projects(last_opened_at DESC)",
  "CREATE UNIQUE INDEX project_one_primary ON project_folders(project_id) WHERE role = 'primary'",
  "CREATE INDEX project_folders_project_order ON project_folders(project_id, role, sort_order, created_at)",
  "CREATE INDEX project_folders_path_key ON project_folders(path_key)",
  "CREATE INDEX project_sources_project_created ON project_sources(project_id, created_at, id)",
  "CREATE INDEX project_operations_status ON project_operations(status, created_at)",
  "CREATE INDEX review_comments_scope\n          ON review_comments(thread_id, project_id, source_key, updated_at)",
  "CREATE INDEX sandbox_escalations_turn_status ON sandbox_escalations(turn_id, status, created_at)",
  "CREATE INDEX subagent_controls_pending ON subagent_controls(run_id, status, created_at)",
  "CREATE INDEX subagent_runs_status_created ON subagent_runs(status, created_at)",
  "CREATE INDEX subagent_tasks_parent_updated ON subagent_tasks(parent_thread_id, updated_at DESC)",
  "CREATE UNIQUE INDEX threads_create_operation_unique\n          ON threads(create_operation_id) WHERE create_operation_id IS NOT NULL",
  "CREATE INDEX threads_parent_kind ON threads(parent_thread_id, kind, updated_at DESC)",
  "CREATE INDEX threads_project_archive_updated ON threads(project_id, archived_at, updated_at DESC, id DESC)",
  "CREATE INDEX threads_project_updated ON threads(project_id, updated_at DESC)",
  "CREATE INDEX turn_git_snapshots_project\n          ON turn_git_snapshots(project_id, updated_at DESC)",
  "CREATE INDEX turns_queue_position ON turns(thread_id, status, queue_position, created_at)",
  "CREATE INDEX turns_thread_history ON turns(thread_id, created_at DESC, id DESC)",
  "CREATE INDEX turns_thread_status ON turns(thread_id, status, created_at)",
  "CREATE TRIGGER threads_workspace_insert_valid\n        BEFORE INSERT ON threads\n        WHEN NOT (\n          (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL\n            AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL\n            AND NEW.output_directory IS NULL)\n          OR\n          (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL AND NEW.output_directory IS NOT NULL)\n          OR\n          (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL AND NEW.output_directory IS NULL)\n        )\n        BEGIN\n          SELECT RAISE(ABORT, 'invalid thread workspace descriptor');\n        END",
  "CREATE TRIGGER threads_workspace_update_valid\n        BEFORE UPDATE OF project_id, workspace_kind, workspace_root, workspace_cwd, workspace_roots, instruction_sources, output_directory ON threads\n        WHEN NOT (\n          (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL\n            AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL\n            AND NEW.output_directory IS NULL)\n          OR\n          (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL AND NEW.output_directory IS NOT NULL)\n          OR\n          (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL\n            AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL AND NEW.output_directory IS NULL)\n        )\n        BEGIN\n          SELECT RAISE(ABORT, 'invalid thread workspace descriptor');\n        END"
] as const

const PROFILE_TABLES = new Set([
  "app_settings",
  "projects",
  "project_settings",
  "project_folders",
  "project_sources",
  "project_operations",
  "provider_settings",
  "credentials",
  "credential_health",
  "integration_credential_bindings",
  "hook_trust_decisions",
  "memory_entries",
])

const objectName = (statement: string) => {
  const match = statement.match(/^CREATE (?:UNIQUE )?(?:TABLE|INDEX|TRIGGER)\s+(?:IF NOT EXISTS\s+)?(?:"([^"]+)"|([^\s(]+))/)
  return match?.[1] ?? match?.[2] ?? ""
}

const tableName = (statement: string) => {
  const match = statement.match(/^CREATE TABLE\s+(?:"([^"]+)"|([^\s(]+))/)
  return match?.[1] ?? match?.[2] ?? null
}

const indexTable = (statement: string) => {
  const match = statement.match(/\sON\s+(?:"([^"]+)"|([^\s(]+))/)
  return match?.[1] ?? match?.[2] ?? null
}

type RecoverableEventItem = {
  id: string
  turnID: string
  agentID: string
  type: string
  status: string
  data: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

const recoverableEventItem = (value: unknown, fallbackTurnID: string | null, eventCreatedAt: number): RecoverableEventItem | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === "string" ? item.id : null
  const turnID = typeof item.turnID === "string"
    ? item.turnID
    : typeof item.turnId === "string"
      ? item.turnId
      : fallbackTurnID
  const agentID = typeof item.agentID === "string"
    ? item.agentID
    : typeof item.agentId === "string"
      ? item.agentId
      : null
  const type = typeof item.type === "string" ? item.type : null
  if (!id || !turnID || !agentID || !type) return null
  const data = item.data && typeof item.data === "object" && !Array.isArray(item.data)
    ? item.data as Record<string, unknown>
    : type === "text"
      ? {
          placement: item.placement === "process" ? "process" : "result",
          text: typeof item.text === "string" ? item.text : "",
        }
      : {}
  return {
    id,
    turnID,
    agentID,
    type,
    status: typeof item.status === "string" ? item.status : type === "tool" ? "completed" : "completed",
    data,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : eventCreatedAt,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : eventCreatedAt,
  }
}

const migrateHistory18To19 = (sqlite: Database) => {
  sqlite.exec("ALTER TABLE items ADD COLUMN ordinal INTEGER")
  const eventRows = sqlite.query(`
    SELECT id, thread_id, turn_id, method, params, created_at
    FROM events
    WHERE method IN ('item/started', 'item/completed', 'tool/callStarted')
    ORDER BY id
  `).all() as Array<{
    id: number
    thread_id: string | null
    turn_id: string | null
    method: string
    params: string
    created_at: number
  }>
  const textSnapshots = new Map<string, Array<{ eventID: number; threadID: string; item: RecoverableEventItem }>>()

  for (const row of eventRows) {
    let params: Record<string, unknown>
    try {
      const parsed = JSON.parse(row.params)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue
      params = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const item = recoverableEventItem(params.item, row.turn_id, row.created_at)
    if (!item || item.type !== "text" || row.method !== "item/completed" || !row.thread_id) continue
    const text = typeof item.data.text === "string" ? item.data.text : ""
    if (!text.trim()) continue
    const key = `${item.turnID}\u0000${item.id}`
    textSnapshots.set(key, [...(textSnapshots.get(key) ?? []), { eventID: row.id, threadID: row.thread_id, item }])
  }

  for (const snapshots of textSnapshots.values()) {
    if (snapshots.length < 2) continue
    const originalID = snapshots[0]!.item.id
    const original = sqlite.query("SELECT type, data FROM items WHERE id = ?").get(originalID) as { type: string; data: string } | null
    let originalText: string | null = null
    try {
      const data = original ? JSON.parse(original.data) as Record<string, unknown> : null
      originalText = typeof data?.text === "string" ? data.text : null
    } catch {
      originalText = null
    }
    const fullyReplaced = original?.type === "text"
      && originalText !== null
      && snapshots.some((snapshot) => snapshot.item.data.text === originalText)
    if (fullyReplaced) sqlite.query("DELETE FROM items WHERE id = ?").run(originalID)
    for (const snapshot of snapshots) {
      const item = snapshot.item
      const recoveredID = `${item.id}:history:${snapshot.eventID}`
      sqlite.query(`
        INSERT OR IGNORE INTO items
          (id, thread_id, turn_id, agent_id, type, status, data, ordinal, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'text', ?, ?, NULL, ?, ?)
      `).run(
        recoveredID,
        snapshot.threadID,
        item.turnID,
        item.agentID,
        item.status,
        JSON.stringify(item.data),
        item.createdAt,
        item.updatedAt,
      )
    }
  }

  const turns = sqlite.query("SELECT DISTINCT turn_id FROM items ORDER BY turn_id").all() as Array<{ turn_id: string }>
  for (const { turn_id: turnID } of turns) {
    const rows = sqlite.query(`
      SELECT id, type, created_at
      FROM items
      WHERE turn_id = ?
      ORDER BY created_at, id
    `).all(turnID) as Array<{ id: string; type: string; created_at: number }>
    rows.sort((left, right) => {
      const created = left.created_at - right.created_at
      if (created !== 0) return created
      const priority = (type: string) => type === "text" ? 0 : type === "reasoning" ? 1 : type === "tool" ? 2 : 3
      return priority(left.type) - priority(right.type) || left.id.localeCompare(right.id)
    })
    rows.forEach((row, ordinal) => {
      sqlite.query("UPDATE items SET ordinal = ? WHERE id = ?").run(ordinal, row.id)
    })
  }
  sqlite.exec("CREATE UNIQUE INDEX items_turn_ordinal_unique ON items(turn_id, ordinal)")
}

const migrateHistory19To20 = (sqlite: Database) => {
  sqlite.exec("ALTER TABLE threads ADD COLUMN git_branch TEXT")
}

const legacyProjectMemoryKey = (workspacePath: string) =>
  createHash("sha256")
    .update(workspacePath.replaceAll("\\", "/").replace(/\/$/, "").toLocaleLowerCase("en-US"))
    .digest("hex")

const projectPathKey = (workspacePath: string) => {
  const normalized = resolve(workspacePath).replaceAll("\\", "/").replace(/\/+$/, "")
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized
}

const migrateProfile2To3 = (sqlite: Database) => {
  const projects = sqlite.query(`
    SELECT id, name, root_path, created_at, updated_at, last_opened_at
    FROM projects
  `).all() as Array<{
    id: string
    name: string
    root_path: string
    created_at: number
    updated_at: number
    last_opened_at: number
  }>
  const settings = sqlite.query(`
    SELECT project_id, default_model, updated_at FROM project_settings
  `).all() as Array<{ project_id: string; default_model: string | null; updated_at: number }>

  sqlite.exec("ALTER TABLE project_settings RENAME TO project_settings_v2")
  sqlite.exec("ALTER TABLE projects RENAME TO projects_v2")
  sqlite.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      removed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );
    CREATE TABLE project_settings (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      default_model TEXT,
      instructions TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE project_folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      path_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('primary', 'secondary')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(project_id, path_key)
    );
    CREATE TABLE project_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      storage_kind TEXT NOT NULL CHECK(storage_kind IN ('managed', 'workspace-file')),
      content_kind TEXT NOT NULL CHECK(content_kind IN ('text', 'image')),
      name TEXT NOT NULL,
      media_type TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      storage_path TEXT,
      folder_id TEXT REFERENCES project_folders(id) ON DELETE CASCADE,
      relative_path TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK((storage_kind = 'managed' AND media_type IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND storage_path IS NOT NULL AND folder_id IS NULL AND relative_path IS NULL) OR (storage_kind = 'workspace-file' AND folder_id IS NOT NULL AND relative_path IS NOT NULL AND storage_path IS NULL))
    );
    CREATE TABLE project_operations (
      operation_id TEXT PRIMARY KEY,
      project_id TEXT,
      method TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),
      result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
  for (const project of projects) {
    sqlite.query(`
      INSERT INTO projects (id, name, removed_at, created_at, updated_at, last_opened_at)
      VALUES (?, ?, NULL, ?, ?, ?)
    `).run(project.id, project.name, project.created_at, project.updated_at, project.last_opened_at)
    sqlite.query(`
      INSERT INTO project_folders (
        id, project_id, path, path_key, role, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'primary', 0, ?, ?)
    `).run(
      crypto.randomUUID(),
      project.id,
      resolve(project.root_path),
      projectPathKey(project.root_path),
      project.created_at,
      project.updated_at,
    )
    sqlite.query(`
      UPDATE memory_entries SET project_key = ?
      WHERE scope = 'project' AND project_key = ?
    `).run(`project:${project.id}`, legacyProjectMemoryKey(project.root_path))
  }
  for (const setting of settings) {
    sqlite.query(`
      INSERT INTO project_settings (
        project_id, default_model, instructions, version, updated_at
      ) VALUES (?, ?, '', 1, ?)
    `).run(setting.project_id, setting.default_model, setting.updated_at)
  }
  sqlite.exec(`
    DROP TABLE project_settings_v2;
    DROP TABLE projects_v2;
    CREATE INDEX projects_last_opened ON projects(last_opened_at DESC);
    CREATE UNIQUE INDEX project_one_primary ON project_folders(project_id) WHERE role = 'primary';
    CREATE INDEX project_folders_project_order ON project_folders(project_id, role, sort_order, created_at);
    CREATE INDEX project_folders_path_key ON project_folders(path_key);
    CREATE INDEX project_sources_project_created ON project_sources(project_id, created_at, id);
    CREATE INDEX project_operations_status ON project_operations(status, created_at);
  `)
}

const migrateHistory20To21 = (sqlite: Database) => {
  sqlite.exec(`
    DROP TRIGGER IF EXISTS threads_workspace_insert_valid;
    DROP TRIGGER IF EXISTS threads_workspace_update_valid;
    ALTER TABLE threads ADD COLUMN workspace_roots TEXT;
    ALTER TABLE threads ADD COLUMN instruction_sources TEXT;
    CREATE TRIGGER threads_workspace_insert_valid
      BEFORE INSERT ON threads
      WHEN NOT (
        (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL
          AND NEW.output_directory IS NULL)
        OR
        (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.output_directory IS NOT NULL)
        OR
        (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL
          AND NEW.output_directory IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid thread workspace descriptor');
      END;
    CREATE TRIGGER threads_workspace_update_valid
      BEFORE UPDATE OF project_id, workspace_kind, workspace_root, workspace_cwd,
        workspace_roots, instruction_sources, output_directory ON threads
      WHEN NOT (
        (NEW.workspace_kind = 'project' AND NEW.project_id IS NOT NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.workspace_roots IS NOT NULL AND NEW.instruction_sources IS NOT NULL
          AND NEW.output_directory IS NULL)
        OR
        (NEW.workspace_kind = 'projectless' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NOT NULL AND NEW.workspace_cwd IS NOT NULL
          AND NEW.output_directory IS NOT NULL)
        OR
        (NEW.workspace_kind = 'legacy' AND NEW.project_id IS NULL
          AND NEW.workspace_root IS NULL AND NEW.workspace_cwd IS NULL
          AND NEW.output_directory IS NULL)
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid thread workspace descriptor');
      END;
  `)
}

const migrateHistory21To22 = (sqlite: Database) => {
  sqlite.exec(`
    UPDATE threads
    SET updated_at = COALESCE(
      (
        SELECT MAX(messages.created_at)
        FROM messages
        WHERE messages.thread_id = threads.id
      ),
      threads.created_at
    )
    WHERE threads.kind = 'main'
      AND EXISTS (
        SELECT 1
        FROM events
        WHERE events.thread_id = threads.id
          AND events.method = 'thread/updated'
          AND json_valid(events.params)
          AND json_type(events.params, '$.patch.title') IS NOT NULL
          AND json_type(events.params, '$.patch.archived') IS NULL
          AND CAST(json_extract(events.params, '$.updatedAt') AS INTEGER) = threads.updated_at
      )
  `)
}

export const backfillProjectThreadWorkspaces = (history: Database, profile: Database) => {
  const projects = profile.query("SELECT id FROM projects").all() as Array<{ id: string }>
  for (const { id } of projects) {
    const folders = profile.query(`
      SELECT id, path, role
      FROM project_folders
      WHERE project_id = ?
      ORDER BY CASE role WHEN 'primary' THEN 0 ELSE 1 END, sort_order, created_at, id
    `).all(id) as Array<{ id: string; path: string; role: "primary" | "secondary" }>
    const primary = folders.find((folder) => folder.role === "primary")
    if (!primary) continue
    const roots = JSON.stringify(folders.map((folder) => ({
      folderId: folder.id,
      path: folder.path,
      role: folder.role,
    })))
    history.query(`
      UPDATE threads
      SET workspace_cwd = COALESCE(workspace_cwd, ?),
        workspace_roots = COALESCE(workspace_roots, ?),
        instruction_sources = COALESCE(instruction_sources, '[]')
      WHERE project_id = ? AND workspace_kind = 'project'
    `).run(primary.path, roots, id)
    history.query(`
      UPDATE memory_jobs SET project_key = ?
      WHERE project_key = ?
    `).run(`project:${id}`, legacyProjectMemoryKey(primary.path))
  }
}

export const PROFILE_SCHEMA = FINAL_SCHEMA
  .filter((statement) => {
    const table = tableName(statement) ?? indexTable(statement)
    return table !== null && PROFILE_TABLES.has(table)
  })
  .map((statement) => statement.replace(
    "source_thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL",
    "source_thread_id TEXT",
  ))

export const HISTORY_SCHEMA = FINAL_SCHEMA
  .filter((statement) => {
    const table = tableName(statement) ?? indexTable(statement)
    return table === null || !PROFILE_TABLES.has(table)
  })
  .map((statement) => statement
    .replaceAll(" REFERENCES projects(id) ON DELETE SET NULL", "")
    .replaceAll(" REFERENCES projects(id) ON DELETE CASCADE", ""))

class SchemaInitializer {
  constructor(
    readonly sqlite: Database,
    readonly kind: "history" | "profile",
  ) {}

  initialize() {
    const expectedVersion = this.kind === "history"
      ? SCHEMA_VERSION
      : PROFILE_SCHEMA_VERSION
    const currentVersion = (this.sqlite.query("PRAGMA user_version").get() as { user_version: number }).user_version
    if (currentVersion === expectedVersion) return
    if (currentVersion > expectedVersion) {
      // Schema 21/profile 3 are forward-compatible baselines. A patched older
      // client uses only its known tables and columns, leaving future additive
      // storage untouched and preserving the newer user_version.
      return
    }
    if (currentVersion !== 0) {
      this.migrate(currentVersion, expectedVersion)
      return
    }

    this.sqlite.transaction(() => {
      const schema = this.kind === "history" ? HISTORY_SCHEMA : PROFILE_SCHEMA
      this.sqlite.exec(schema.join(";\n"))
      this.sqlite.exec(`PRAGMA user_version = ${expectedVersion}`)
      if (this.kind === "profile") {
        this.sqlite.exec(`PRAGMA application_id = ${PROFILE_APPLICATION_ID}`)
      }
    })()
  }

  private migrate(from: number, target: number) {
    const migrations: Record<number, () => void> = this.kind === "history"
      ? {
          // prepareStorage rebuilds former mixed v17 databases. Keep the
          // sequential registry entry for already-split prerelease stores.
          17: () => undefined,
          18: () => migrateHistory18To19(this.sqlite),
          19: () => migrateHistory19To20(this.sqlite),
          20: () => migrateHistory20To21(this.sqlite),
          21: () => migrateHistory21To22(this.sqlite),
        }
      : {
          // v2 moves durable preferences to config.toml. The file migration
          // runs after both profile/config paths are available in bootstrap.
          1: () => undefined,
          2: () => migrateProfile2To3(this.sqlite),
        }
    let version = from
    while (version < target) {
      const migration = migrations[version]
      if (!migration) throw new Error(`${this.kind} 数据库缺少 ${version} → ${version + 1} 迁移`)
      const rebuildsProfileProjects = this.kind === "profile" && version === 2
      if (rebuildsProfileProjects) this.sqlite.exec("PRAGMA foreign_keys = OFF")
      try {
        this.sqlite.transaction(() => {
          migration()
          this.sqlite.exec(`PRAGMA user_version = ${version + 1}`)
        })()
      } finally {
        if (rebuildsProfileProjects) this.sqlite.exec("PRAGMA foreign_keys = ON")
      }
      version += 1
    }
  }
}

export const initializeSchema = (
  sqlite: Database,
  kind: "history" | "profile" = "history",
) => new SchemaInitializer(sqlite, kind).initialize()
