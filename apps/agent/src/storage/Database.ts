import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { basename, dirname, resolve } from "node:path"
import { Effect } from "effect"
import type {
  EventEnvelope,
  ModelRef,
  PermissionMode,
  RunStatus,
  SendStrategy,
  SessionPart,
  SessionSnapshot,
  SubmitMessage,
  TaskMode,
  WorkflowStage,
} from "../domain"

export type ProjectModelSettings = {
  defaultModel: ModelRef | null
  plannerModel: ModelRef | null
  developerModel: ModelRef | null
  reviewerModel: ModelRef | null
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

export type StoredProposal = {
  id: string
  runID: string
  projectID: string
  role: "planner" | "developer" | "reviewer"
  kind: "patch" | "command"
  title: string
  payload: unknown
  review: string | null
  status: "pending" | "reviewed" | "rejected"
  createdAt: number
  updatedAt: number
}

export type AgentRunCheckpoint = {
  runID: string
  sessionID: string
  stage: "planner" | "developer" | "reviewer" | null
  state: "waiting_question" | "waiting_plan_confirmation" | "ready"
  payload: Record<string, unknown>
  version: number
  createdAt: number
  updatedAt: number
}

export type ResumableQuestion = {
  id: string
  sessionID: string
  runID: string
  toolCallID: string | null
  payload: Record<string, unknown>
  payloadVersion: number
  createdAt: number
}

type SqlValue = string | number | boolean | Uint8Array | null

const stringify = (value: unknown) => JSON.stringify(value ?? null)
const parse = <T>(value: string): T => JSON.parse(value) as T
const now = () => Date.now()

export class AgentDatabase {
  readonly sqlite: Database

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.sqlite = new Database(path, { create: true, strict: true })
    this.sqlite.exec("PRAGMA journal_mode = WAL")
    this.sqlite.exec("PRAGMA foreign_keys = ON")
    this.sqlite.exec("PRAGMA busy_timeout = 5000")
    this.migrate()
    this.recoverInterruptedRuns()
  }

  close() {
    this.sqlite.close()
  }

  private migrate() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        mode TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        strategy TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS runs_session_status ON runs(session_id, status, created_at);
      CREATE TABLE IF NOT EXISTS inputs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        strategy TEXT NOT NULL,
        task_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS parts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS parts_run_created ON parts(run_id, created_at);
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT,
        status TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        tool_call_id TEXT NOT NULL,
        risk TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        reply TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        answer TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS patches (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        files TEXT NOT NULL,
        additions INTEGER NOT NULL DEFAULT 0,
        deletions INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_session_id ON events(session_id, id);
      CREATE TABLE IF NOT EXISTS provider_settings (
        provider_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
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
        planner_model TEXT,
        developer_model TEXT,
        reviewer_model TEXT,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        payload TEXT NOT NULL,
        review TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS proposals_run_created ON proposals(run_id, created_at);
      CREATE TABLE IF NOT EXISTS run_stages (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        status TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        error TEXT,
        PRIMARY KEY (run_id, role, attempt)
      );
      CREATE INDEX IF NOT EXISTS run_stages_run_role ON run_stages(run_id, role, attempt DESC);
      CREATE TABLE IF NOT EXISTS agent_run_checkpoints (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        stage TEXT,
        state TEXT NOT NULL,
        payload TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_run_checkpoints_session ON agent_run_checkpoints(session_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS agent_session_items (
        session_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, ordinal)
      );
    `)
    if (!this.columns("sessions").includes("project_id")) {
      this.sqlite.exec("ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL")
      this.sqlite.exec("CREATE INDEX IF NOT EXISTS sessions_project_updated ON sessions(project_id, updated_at DESC)")
    }
    this.addColumn("runs", "current_stage", "TEXT")
    this.addColumn("runs", "can_continue_from_plan", "INTEGER NOT NULL DEFAULT 0")
    this.addColumn("questions", "tool_call_id", "TEXT")
    this.addColumn("questions", "payload_version", "INTEGER NOT NULL DEFAULT 1")
  }

  private columns(table: string) {
    return (this.sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
  }

  private addColumn(table: string, column: string, definition: string) {
    if (!this.columns(table).includes(column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }

  private recoverInterruptedRuns() {
    const timestamp = now()
    this.sqlite.transaction(() => {
      this.sqlite.query(`UPDATE runs SET status = 'interrupted', finished_at = ?, updated_at = ? WHERE status IN ('running', 'waiting_permission') OR (status = 'waiting_question' AND NOT EXISTS (SELECT 1 FROM questions AS q LEFT JOIN agent_run_checkpoints AS c ON c.run_id = q.run_id AND c.state = 'waiting_question' WHERE q.run_id = runs.id AND q.status = 'pending' AND (c.run_id IS NOT NULL OR json_extract(q.payload, '$.checkpoint.state') IS NOT NULL)))`).run(timestamp, timestamp)
      this.sqlite.query(`UPDATE run_stages SET status = 'interrupted', finished_at = ? WHERE status = 'running' AND run_id IN (SELECT id FROM runs WHERE status = 'interrupted')`).run(timestamp)
      this.sqlite.query(`UPDATE parts SET status = 'interrupted', updated_at = ? WHERE status IN ('pending', 'running') AND NOT (type = 'question' AND id IN (SELECT id FROM questions WHERE status = 'pending' AND (json_extract(payload, '$.checkpoint.state') IS NOT NULL OR run_id IN (SELECT run_id FROM agent_run_checkpoints WHERE state = 'waiting_question'))))`).run(timestamp)
      this.sqlite.query(`UPDATE permission_requests SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'`).run(timestamp)
      this.sqlite.query(`UPDATE questions SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND run_id IN (SELECT id FROM runs WHERE status <> 'waiting_question')`).run(timestamp)
    })()
  }

  transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work)()
  }

  createSession(title = "新对话", projectID?: string) {
    const id = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      if (projectID) this.requireProject(projectID)
      this.sqlite.query("INSERT INTO sessions (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, title, projectID ?? null, timestamp, timestamp)
      const event = this.insertEvent(id, "session.created", { id, title, projectID: projectID ?? null, createdAt: timestamp, updatedAt: timestamp })
      return { id, title, projectID: projectID ?? null, createdAt: timestamp, updatedAt: timestamp, event }
    })
  }

  getSession(sessionID: string): SessionSnapshot | null {
    const session = this.sqlite.query("SELECT id, title, created_at, updated_at FROM sessions WHERE id = ?").get(sessionID) as
      | { id: string; title: string; created_at: number; updated_at: number }
      | null
    if (!session) return null
    const runs = this.sqlite.query("SELECT id, status, mode, started_at, finished_at FROM runs WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<{
      id: string
      status: RunStatus
      mode: TaskMode
      started_at: number | null
      finished_at: number | null
    }>
    const parts = this.sqlite.query("SELECT id, run_id, type, status, data, created_at, updated_at FROM parts WHERE session_id = ? ORDER BY created_at").all(sessionID) as Array<{
      id: string
      run_id: string
      type: SessionPart["type"]
      status: SessionPart["status"]
      data: string
      created_at: number
      updated_at: number
    }>
    return {
      id: session.id,
      title: session.title,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        mode: run.mode,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        parts: parts.filter((part) => part.run_id === run.id).map((part) => ({
          id: part.id,
          runID: part.run_id,
          type: part.type,
          status: part.status,
          data: parse<Record<string, unknown>>(part.data),
          createdAt: part.created_at,
          updatedAt: part.updated_at,
        })),
      })),
    }
  }

  activeRun(sessionID: string) {
    return this.sqlite.query(`SELECT id, status, mode, permission_mode, model_ref FROM runs WHERE session_id = ? AND status IN ('running', 'waiting_permission', 'waiting_question', 'waiting_plan_confirmation') ORDER BY created_at DESC LIMIT 1`).get(sessionID) as
      | { id: string; status: RunStatus; mode: TaskMode; permission_mode: PermissionMode; model_ref: string }
      | null
  }

  createRun(sessionID: string, input: SubmitMessage, status: RunStatus = "queued") {
    const runID = crypto.randomUUID()
    const inputID = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      this.sqlite.query(`INSERT INTO runs (id, session_id, status, mode, permission_mode, model_ref, strategy, started_at, finished_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`).run(
        runID,
        sessionID,
        status,
        input.taskMode,
        input.permissionMode,
        stringify(input.model),
        input.strategy,
        timestamp,
        timestamp,
      )
      this.sqlite.query(`INSERT INTO inputs (id, session_id, run_id, content, model_ref, permission_mode, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        inputID,
        sessionID,
        runID,
        input.content,
        stringify(input.model),
        input.permissionMode,
        input.strategy,
        input.taskMode,
        status === "queued" ? "queued" : "active",
        timestamp,
      )
      this.sqlite.query(`INSERT INTO messages (id, session_id, run_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)`).run(inputID, sessionID, runID, input.content, timestamp)
      this.sqlite.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(timestamp, sessionID)
      const event = this.insertEvent(sessionID, status === "queued" ? "run.queued" : "run.started", { runID, inputID, input, createdAt: timestamp })
      return { runID, inputID, event }
    })
  }

  appendGuide(sessionID: string, runID: string, input: SubmitMessage) {
    const id = crypto.randomUUID()
    const timestamp = now()
    return this.transaction(() => {
      this.sqlite.query(`INSERT INTO inputs (id, session_id, run_id, content, model_ref, permission_mode, strategy, task_mode, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'guide', ?, 'mailbox', ?)`).run(
        id,
        sessionID,
        runID,
        input.content,
        stringify(input.model),
        input.permissionMode,
        input.taskMode,
        timestamp,
      )
      this.sqlite.query(`INSERT INTO messages (id, session_id, run_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)`).run(id, sessionID, runID, input.content, timestamp)
      const event = this.insertEvent(sessionID, "run.guide-appended", { runID, inputID: id, input, createdAt: timestamp })
      return { inputID: id, event }
    })
  }

  takeGuideMailbox(runID: string) {
    return this.transaction(() => {
      const rows = this.sqlite.query("SELECT id, content, model_ref, permission_mode, task_mode FROM inputs WHERE run_id = ? AND status = 'mailbox' ORDER BY created_at").all(runID) as Array<{
        id: string
        content: string
        model_ref: string
        permission_mode: PermissionMode
        task_mode: TaskMode
      }>
      if (rows.length) {
        const placeholders = rows.map(() => "?").join(",")
        this.sqlite.query(`UPDATE inputs SET status = 'consumed' WHERE id IN (${placeholders})`).run(...rows.map((row) => row.id))
      }
      return rows.map((row) => ({ id: row.id, content: row.content, model: parse<ModelRef>(row.model_ref), permissionMode: row.permission_mode, taskMode: row.task_mode }))
    })
  }

  startRun(runID: string) {
    const timestamp = now()
    this.sqlite.query(`UPDATE runs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'`).run(timestamp, timestamp, runID)
    this.sqlite.query(`UPDATE inputs SET status = 'active' WHERE run_id = ? AND status = 'queued'`).run(runID)
  }

  updateRunStatus(runID: string, status: RunStatus) {
    const timestamp = now()
    const terminal = ["completed", "failed", "interrupted"].includes(status)
    this.sqlite.query(`UPDATE runs SET status = ?, finished_at = CASE WHEN ? THEN ? ELSE finished_at END, updated_at = ? WHERE id = ?`).run(status, terminal ? 1 : 0, timestamp, timestamp, runID)
    if (terminal) this.sqlite.query("UPDATE inputs SET status = 'completed' WHERE run_id = ? AND status = 'active'").run(runID)
  }

  nextQueuedRun(sessionID: string) {
    return this.sqlite.query("SELECT id FROM runs WHERE session_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1").get(sessionID) as { id: string } | null
  }

  getRunInput(runID: string) {
    const row = this.sqlite.query("SELECT content, model_ref, permission_mode, strategy, task_mode FROM inputs WHERE run_id = ? ORDER BY created_at LIMIT 1").get(runID) as
      | { content: string; model_ref: string; permission_mode: PermissionMode; strategy: SendStrategy; task_mode: TaskMode }
      | null
    if (!row) return null
    return { content: row.content, model: parse(row.model_ref), permissionMode: row.permission_mode, strategy: row.strategy, taskMode: row.task_mode } as SubmitMessage
  }

  listRunStages(runID: string): WorkflowStage[] {
    const rows = this.sqlite.query("SELECT run_id, role, attempt, status, model_ref, started_at, finished_at, error FROM run_stages WHERE run_id = ? ORDER BY role, attempt").all(runID) as Array<{
      run_id: string
      role: WorkflowStage["role"]
      attempt: number
      status: WorkflowStage["status"]
      model_ref: string
      started_at: number | null
      finished_at: number | null
      error: string | null
    }>
    return rows.map((row) => ({
      runID: row.run_id,
      role: row.role,
      attempt: row.attempt,
      status: row.status,
      model: parse<ModelRef>(row.model_ref),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    }))
  }

  upsertRunStage(stage: WorkflowStage) {
    this.sqlite.query(`INSERT INTO run_stages (run_id, role, attempt, status, model_ref, started_at, finished_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, role, attempt) DO UPDATE SET status = excluded.status, model_ref = excluded.model_ref, started_at = excluded.started_at, finished_at = excluded.finished_at, error = excluded.error`).run(
      stage.runID,
      stage.role,
      stage.attempt,
      stage.status,
      stringify(stage.model),
      stage.startedAt,
      stage.finishedAt,
      stage.error,
    )
  }

  setRunWorkflowState(runID: string, input: { status: RunStatus; currentStage: WorkflowStage["role"] | null; canContinueFromPlan: boolean }) {
    const timestamp = now()
    const terminal = ["completed", "failed", "interrupted"].includes(input.status)
    const result = this.sqlite.query(`UPDATE runs SET status = ?, current_stage = ?, can_continue_from_plan = ?, finished_at = CASE WHEN ? THEN ? ELSE finished_at END, updated_at = ? WHERE id = ?`).run(
      input.status,
      input.currentStage,
      input.canContinueFromPlan ? 1 : 0,
      terminal ? 1 : 0,
      timestamp,
      timestamp,
      runID,
    )
    if (result.changes === 0) throw new Error(`Run ${runID} 不存在`)
  }

  saveAgentRunCheckpoint(input: Omit<AgentRunCheckpoint, "createdAt" | "updatedAt">) {
    const timestamp = now()
    this.sqlite.query(`INSERT INTO agent_run_checkpoints (run_id, session_id, stage, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id = excluded.session_id, stage = excluded.stage, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
      input.runID,
      input.sessionID,
      input.stage,
      input.state,
      stringify(input.payload),
      input.version,
      timestamp,
      timestamp,
    )
    return this.getAgentRunCheckpoint(input.runID)!
  }

  getAgentRunCheckpoint(runID: string): AgentRunCheckpoint | null {
    const row = this.sqlite.query("SELECT run_id, session_id, stage, state, payload, version, created_at, updated_at FROM agent_run_checkpoints WHERE run_id = ?").get(runID) as {
      run_id: string
      session_id: string
      stage: AgentRunCheckpoint["stage"]
      state: AgentRunCheckpoint["state"]
      payload: string
      version: number
      created_at: number
      updated_at: number
    } | null
    return row ? {
      runID: row.run_id,
      sessionID: row.session_id,
      stage: row.stage,
      state: row.state,
      payload: parse<Record<string, unknown>>(row.payload),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null
  }

  deleteAgentRunCheckpoint(runID: string) {
    this.sqlite.query("DELETE FROM agent_run_checkpoints WHERE run_id = ?").run(runID)
  }

  currentPlan(runID: string) {
    const row = this.sqlite.query("SELECT data FROM parts WHERE run_id = ? AND type = 'plan' ORDER BY created_at DESC LIMIT 1").get(runID) as { data: string } | null
    if (!row) return null
    const data = parse<Record<string, unknown>>(row.data)
    return typeof data.markdown === "string" ? data.markdown : null
  }

  createResumableQuestion(input: Omit<ResumableQuestion, "id" | "createdAt"> & { id?: string; createdAt?: number; checkpoint: Omit<AgentRunCheckpoint, "runID" | "sessionID" | "state" | "createdAt" | "updatedAt"> }) {
    const id = input.id ?? crypto.randomUUID()
    const createdAt = input.createdAt ?? now()
    this.transaction(() => {
      this.sqlite.query("INSERT INTO questions (id, session_id, run_id, tool_call_id, payload, payload_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)").run(
        id,
        input.sessionID,
        input.runID,
        input.toolCallID,
        stringify(input.payload),
        input.payloadVersion,
        createdAt,
      )
      this.sqlite.query(`INSERT INTO agent_run_checkpoints (run_id, session_id, stage, state, payload, version, created_at, updated_at) VALUES (?, ?, ?, 'waiting_question', ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET session_id = excluded.session_id, stage = excluded.stage, state = excluded.state, payload = excluded.payload, version = excluded.version, updated_at = excluded.updated_at`).run(
        input.runID,
        input.sessionID,
        input.checkpoint.stage,
        stringify(input.checkpoint.payload),
        input.checkpoint.version,
        createdAt,
        createdAt,
      )
      this.setRunWorkflowState(input.runID, { status: "waiting_question", currentStage: input.checkpoint.stage, canContinueFromPlan: false })
      this.upsertPart(input.sessionID, { id, runID: input.runID, type: "question", status: "pending", data: input.payload, createdAt, updatedAt: createdAt })
    })
    return { id, sessionID: input.sessionID, runID: input.runID, toolCallID: input.toolCallID, payload: input.payload, payloadVersion: input.payloadVersion, createdAt } satisfies ResumableQuestion
  }

  resolveResumableQuestion(id: string, answer: unknown, ignored = false) {
    const row = this.sqlite.query("SELECT session_id, run_id, status FROM questions WHERE id = ?").get(id) as { session_id: string; run_id: string; status: string } | null
    if (!row || row.status !== "pending") return null
    const timestamp = now()
    this.transaction(() => {
      const checkpoint = this.getAgentRunCheckpoint(row.run_id)
      if (!checkpoint || checkpoint.state !== "waiting_question") throw new Error(`问题 ${id} 没有可恢复 checkpoint`)
      this.sqlite.query("UPDATE questions SET status = 'resolved', answer = ?, resolved_at = ? WHERE id = ? AND status = 'pending'").run(stringify({ value: answer, ignored }), timestamp, id)
      this.saveAgentRunCheckpoint({
        ...checkpoint,
        state: "ready",
        payload: { ...checkpoint.payload, questionID: id, answer },
      })
      this.setRunWorkflowState(row.run_id, { status: "queued", currentStage: checkpoint.stage, canContinueFromPlan: false })
      const part = this.getPart(id)
      if (part) this.upsertPart(row.session_id, { ...part, status: "completed", data: { ...part.data, answer, ignored }, updatedAt: timestamp })
    })
    return { sessionID: row.session_id, runID: row.run_id }
  }

  waitForPlanConfirmation(input: Omit<AgentRunCheckpoint, "state" | "createdAt" | "updatedAt">) {
    return this.transaction(() => {
      const checkpoint = this.saveAgentRunCheckpoint({ ...input, state: "waiting_plan_confirmation" })
      this.setRunWorkflowState(input.runID, { status: "waiting_plan_confirmation", currentStage: input.stage, canContinueFromPlan: true })
      return checkpoint
    })
  }

  decidePlan(runID: string, decision: "continue" | "reject") {
    const row = this.sqlite.query("SELECT session_id, status, current_stage FROM runs WHERE id = ?").get(runID) as { session_id: string; status: string; current_stage: WorkflowStage["role"] | null } | null
    if (!row) return null
    if (row.status !== "waiting_plan_confirmation") return null
    const nextStatus: RunStatus = decision === "continue" ? "queued" : "completed"
    this.transaction(() => {
      this.setRunWorkflowState(runID, {
        status: nextStatus,
        currentStage: decision === "continue" ? "developer" : null,
        canContinueFromPlan: false,
      })
      const checkpoint = this.getAgentRunCheckpoint(runID)
      if (checkpoint && decision === "continue") this.saveAgentRunCheckpoint({
        ...checkpoint,
        state: "ready",
        payload: { ...checkpoint.payload, planDecision: decision },
      })
      if (decision === "reject") this.deleteAgentRunCheckpoint(runID)
      const plan = this.sqlite.query("SELECT id, data, created_at, updated_at FROM parts WHERE run_id = ? AND type = 'plan' ORDER BY created_at DESC LIMIT 1").get(runID) as { id: string; data: string; created_at: number; updated_at: number } | null
      if (plan) {
        const data = parse<Record<string, unknown>>(plan.data)
        this.upsertPart(row.session_id, {
          id: plan.id,
          runID,
          type: "plan",
          status: "completed",
          data: { ...data, state: decision === "continue" ? "confirmed" : "rejected" },
          createdAt: plan.created_at,
          updatedAt: now(),
        })
      }
    })
    return { sessionID: row.session_id, runID, status: nextStatus, decision }
  }

  upsertPart(sessionID: string, part: SessionPart) {
    this.sqlite.query(`INSERT INTO parts (id, session_id, run_id, type, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at`).run(
      part.id,
      sessionID,
      part.runID,
      part.type,
      part.status,
      stringify(part.data),
      part.createdAt,
      part.updatedAt,
    )
  }

  getPart(partID: string) {
    const row = this.sqlite.query("SELECT id, run_id, type, status, data, created_at, updated_at FROM parts WHERE id = ?").get(partID) as
      | { id: string; run_id: string; type: SessionPart["type"]; status: SessionPart["status"]; data: string; created_at: number; updated_at: number }
      | null
    return row ? { id: row.id, runID: row.run_id, type: row.type, status: row.status, data: parse<Record<string, unknown>>(row.data), createdAt: row.created_at, updatedAt: row.updated_at } satisfies SessionPart : null
  }

  insertEvent(sessionID: string | null, type: string, payload: unknown): EventEnvelope {
    const createdAt = now()
    const result = this.sqlite.query("INSERT INTO events (session_id, type, payload, created_at) VALUES (?, ?, ?, ?)").run(sessionID, type, stringify(payload), createdAt)
    return { id: Number(result.lastInsertRowid), sessionID, type, payload, createdAt }
  }

  eventsAfter(after: number, sessionID?: string, limit = 1000): EventEnvelope[] {
    const rows = sessionID
      ? this.sqlite.query("SELECT id, session_id, type, payload, created_at FROM events WHERE id > ? AND (session_id = ? OR session_id IS NULL) ORDER BY id LIMIT ?").all(after, sessionID, limit)
      : this.sqlite.query("SELECT id, session_id, type, payload, created_at FROM events WHERE id > ? ORDER BY id LIMIT ?").all(after, limit)
    return (rows as Array<{ id: number; session_id: string | null; type: string; payload: string; created_at: number }>).map((row) => ({
      id: row.id,
      sessionID: row.session_id,
      type: row.type,
      payload: parse(row.payload),
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
      this.sqlite.query("INSERT INTO project_settings (project_id, default_model, planner_model, developer_model, reviewer_model, updated_at) VALUES (?, NULL, NULL, NULL, NULL, ?)").run(id, timestamp)
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
    const row = this.sqlite.query("SELECT default_model, planner_model, developer_model, reviewer_model FROM project_settings WHERE project_id = ?").get(projectID) as { default_model: string | null; planner_model: string | null; developer_model: string | null; reviewer_model: string | null } | null
    return {
      defaultModel: row?.default_model ? parse<ModelRef>(row.default_model) : null,
      plannerModel: row?.planner_model ? parse<ModelRef>(row.planner_model) : null,
      developerModel: row?.developer_model ? parse<ModelRef>(row.developer_model) : null,
      reviewerModel: row?.reviewer_model ? parse<ModelRef>(row.reviewer_model) : null,
    }
  }

  saveProjectSettings(projectID: string, settings: ProjectModelSettings) {
    this.requireProject(projectID)
    const timestamp = now()
    this.sqlite.query(`INSERT INTO project_settings (project_id, default_model, planner_model, developer_model, reviewer_model, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET default_model = excluded.default_model, planner_model = excluded.planner_model, developer_model = excluded.developer_model, reviewer_model = excluded.reviewer_model, updated_at = excluded.updated_at`).run(
      projectID,
      settings.defaultModel ? stringify(settings.defaultModel) : null,
      settings.plannerModel ? stringify(settings.plannerModel) : null,
      settings.developerModel ? stringify(settings.developerModel) : null,
      settings.reviewerModel ? stringify(settings.reviewerModel) : null,
      timestamp,
    )
    return this.getProjectSettings(projectID)
  }

  resolveProjectModel(projectID: string, role: "planner" | "developer" | "reviewer", globalDefault: ModelRef | null) {
    const settings = this.getProjectSettings(projectID)
    const roleModel = role === "planner" ? settings.plannerModel : role === "developer" ? settings.developerModel : settings.reviewerModel
    return roleModel ?? settings.defaultModel ?? globalDefault
  }

  sessionProjectID(sessionID: string) {
    const row = this.sqlite.query("SELECT project_id FROM sessions WHERE id = ?").get(sessionID) as { project_id: string | null } | null
    if (!row) return null
    return row.project_id
  }

  setSessionProject(sessionID: string, projectID: string | null) {
    if (projectID) this.requireProject(projectID)
    const result = this.sqlite.query("UPDATE sessions SET project_id = ?, updated_at = ? WHERE id = ?").run(projectID, now(), sessionID)
    if (result.changes === 0) throw new Error(`会话 ${sessionID} 不存在`)
  }

  createProposal(input: Omit<StoredProposal, "id" | "status" | "createdAt" | "updatedAt"> & { status?: StoredProposal["status"] }) {
    this.requireProject(input.projectID)
    const id = crypto.randomUUID()
    const timestamp = now()
    const status = input.status ?? "pending"
    this.sqlite.query("INSERT INTO proposals (id, project_id, run_id, role, kind, title, payload, review, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id, input.projectID, input.runID, input.role, input.kind, input.title, stringify(input.payload), input.review, status, timestamp, timestamp,
    )
    return this.proposal(id)!
  }

  private proposal(id: string) {
    const row = this.sqlite.query("SELECT id, project_id, run_id, role, kind, title, payload, review, status, created_at, updated_at FROM proposals WHERE id = ?").get(id) as { id: string; project_id: string; run_id: string; role: StoredProposal["role"]; kind: StoredProposal["kind"]; title: string; payload: string; review: string | null; status: StoredProposal["status"]; created_at: number; updated_at: number } | null
    return row ? { id: row.id, projectID: row.project_id, runID: row.run_id, role: row.role, kind: row.kind, title: row.title, payload: parse(row.payload), review: row.review, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at } satisfies StoredProposal : null
  }

  listProposals(runID: string) {
    const rows = this.sqlite.query("SELECT id FROM proposals WHERE run_id = ? ORDER BY created_at").all(runID) as Array<{ id: string }>
    return rows.flatMap((row) => {
      const proposal = this.proposal(row.id)
      return proposal ? [proposal] : []
    })
  }

  updateProposalStatus(id: string, status: "reviewed" | "rejected", review: string | null = null) {
    const result = this.sqlite.query("UPDATE proposals SET status = ?, review = ?, updated_at = ? WHERE id = ?").run(status, review, now(), id)
    if (result.changes === 0) return null
    return this.proposal(id)
  }
}
