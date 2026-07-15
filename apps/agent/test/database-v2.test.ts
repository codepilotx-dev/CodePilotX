import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, SCHEMA_VERSION } from "../src/storage/Database"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("数据库迁移根基", () => {
  test("发现 legacy Session schema 时备份旧库并重建 Thread schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v2-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const legacy = new Database(path, { create: true })
    legacy.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('legacy-thread')")
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    const tables = (db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name)
    expect(tables).toContain("threads")
    expect(tables).not.toContain("sessions")
    db.close()

    const backupName = (await readdir(root)).find((name) => name.startsWith("agent.legacy-v1-") && name.endsWith(".sqlite"))
    expect(backupName).toBeDefined()
    const backup = new Database(join(root, backupName!), { readonly: true })
    expect(backup.query("SELECT id FROM sessions").get()).toEqual({ id: "legacy-thread" })
    backup.close()
  })

  test("将 v2 权限模式原子回填为 Codex 三字段配置", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v3-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const legacy = new Database(path, { create: true })
    legacy.exec(`
      PRAGMA user_version = 2;
      CREATE TABLE turns (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL, mode TEXT NOT NULL, permission_mode TEXT NOT NULL, model_ref TEXT NOT NULL, strategy TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE inputs (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT, content TEXT NOT NULL, model_ref TEXT NOT NULL, permission_mode TEXT NOT NULL, strategy TEXT NOT NULL, task_mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO turns VALUES ('ask', 't', 'completed', 'chat', 'ask', '{}', 'queue', NULL, NULL, 1, 1);
      INSERT INTO turns VALUES ('review', 't', 'completed', 'chat', 'review', '{}', 'queue', NULL, NULL, 1, 1);
      INSERT INTO turns VALUES ('full', 't', 'completed', 'chat', 'full', '{}', 'queue', NULL, NULL, 1, 1);
      INSERT INTO inputs VALUES ('ask', 't', 'ask', 'a', '{}', 'ask', 'queue', 'chat', 'completed', 1);
      INSERT INTO inputs VALUES ('review', 't', 'review', 'r', '{}', 'review', 'queue', 'chat', 'completed', 1);
      INSERT INTO inputs VALUES ('full', 't', 'full', 'f', '{}', 'full', 'queue', 'chat', 'completed', 1);
    `)
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("SELECT id, sandbox_mode, approval_policy, approvals_reviewer FROM turns ORDER BY id").all()).toEqual([
      { id: "ask", sandbox_mode: "workspace-write", approval_policy: "on-request", approvals_reviewer: "user" },
      { id: "full", sandbox_mode: "danger-full-access", approval_policy: "never", approvals_reviewer: "auto_review" },
      { id: "review", sandbox_mode: "workspace-write", approval_policy: "on-request", approvals_reviewer: "auto_review" },
    ])
    expect(db.sqlite.query("SELECT id, sandbox_mode, approval_policy, approvals_reviewer FROM inputs ORDER BY id").all()).toEqual([
      { id: "ask", sandbox_mode: "workspace-write", approval_policy: "on-request", approvals_reviewer: "user" },
      { id: "full", sandbox_mode: "danger-full-access", approval_policy: "never", approvals_reviewer: "auto_review" },
      { id: "review", sandbox_mode: "workspace-write", approval_policy: "on-request", approvals_reviewer: "auto_review" },
    ])
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    db.close()

    const reopened = new AgentDatabase(path)
    expect(reopened.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    reopened.close()
  })

  test("将 v3 Thread 从最新 Input 回填设置，空 Thread 使用安全默认值", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v4-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const legacy = new Database(path, { create: true })
    legacy.exec(`
      PRAGMA user_version = 3;
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE inputs (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        content TEXT NOT NULL,
        model_ref TEXT NOT NULL,
        permission_mode TEXT NOT NULL,
        sandbox_mode TEXT NOT NULL,
        approval_policy TEXT NOT NULL,
        approvals_reviewer TEXT NOT NULL,
        strategy TEXT NOT NULL,
        task_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO threads VALUES ('history', '有历史', 1, 1);
      INSERT INTO threads VALUES ('empty', '空会话', 1, 1);
      INSERT INTO inputs VALUES ('old', 'history', NULL, 'old', '{}', 'ask', 'workspace-write', 'on-request', 'user', 'queue', 'chat', 'completed', 1);
      INSERT INTO inputs VALUES ('latest', 'history', NULL, 'latest', '{}', 'full', 'danger-full-access', 'never', 'auto_review', 'queue', 'plan', 'completed', 2);
    `)
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.getThreadSettings("history")).toEqual({
      taskMode: "plan",
      permissionConfig: { sandboxMode: "danger-full-access", approvalPolicy: "never", approvalsReviewer: "auto_review" },
    })
    expect(db.getThreadSettings("empty")).toEqual({
      taskMode: "chat",
      permissionConfig: { sandboxMode: "workspace-write", approvalPolicy: "on-request", approvalsReviewer: "user" },
    })
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    db.close()

    const reopened = new AgentDatabase(path)
    expect(reopened.getThreadSettings("history")?.taskMode).toBe("plan")
    expect(reopened.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    reopened.close()
  })
})
