import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rename, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, SCHEMA_VERSION } from "../src/storage/Database"

const paths: string[] = []
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}
const renamePath = async (source: string, destination: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rename(source, destination); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY" || attempt === 19) throw cause
      await Bun.sleep(50)
    }
  }
}
afterEach(async () => Promise.all(paths.splice(0).map(removePath)))

describe("数据库迁移", () => {
  test("读取旧 on-failure 审批策略时迁移为 on-request", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-on-failure-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread("旧审批策略")
    db.sqlite.query("UPDATE threads SET approval_policy = 'on-failure' WHERE id = ?").run(thread.id)

    expect(db.getThread(thread.id)?.settings.permissionConfig.approvalPolicy).toBe("on-request")
    db.close()
  })

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
    expect(tables).toContain("agent_executions")
    expect(tables).not.toContain("sessions")
    db.close()

    const backupName = (await readdir(root)).find((name) => name.startsWith("agent.legacy-v1-") && name.endsWith(".sqlite"))
    expect(backupName).toBeDefined()
    const backup = new Database(join(root, backupName!), { readonly: true })
    expect(backup.query("SELECT id FROM sessions").get()).toEqual({ id: "legacy-thread" })
    backup.close()
  })

  test("v5 清空会话域，保留项目、Provider、凭据和应用设置并创建备份", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v5-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const legacy = new Database(path, { create: true })
    legacy.exec(`
      PRAGMA user_version = 4;
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_opened_at INTEGER NOT NULL);
      CREATE TABLE project_settings (project_id TEXT PRIMARY KEY, default_model TEXT, planner_model TEXT, developer_model TEXT, reviewer_model TEXT, updated_at INTEGER NOT NULL);
      CREATE TABLE provider_settings (provider_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE credentials (id TEXT PRIMARY KEY, integration_id TEXT NOT NULL UNIQUE, method_id TEXT, label TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, key_version INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, task_mode TEXT NOT NULL, sandbox_mode TEXT NOT NULL, approval_policy TEXT NOT NULL, approvals_reviewer TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO projects VALUES ('project', '项目', '${root.replaceAll("'", "''")}\\project', 1, 1, 1);
      INSERT INTO project_settings VALUES ('project', '{"providerID":"openai","id":"gpt-5"}', NULL, NULL, NULL, 1);
      INSERT INTO provider_settings VALUES ('openai', '{"baseURL":"https://example.test"}', 1);
      INSERT INTO app_settings VALUES ('reviewerModel', '{"providerID":"openai","id":"reviewer"}', 1);
      INSERT INTO credentials VALUES ('credential', 'openai', 'api-key', 'OpenAI', 'ciphertext', 'nonce', 1, 1, 1);
      INSERT INTO threads VALUES ('old-thread', '旧会话', 'chat', 'workspace-write', 'on-request', 'user', 1, 1);
    `)
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("SELECT COUNT(*) AS count FROM threads").get()).toEqual({ count: 0 })
    expect(db.sqlite.query("SELECT id, name FROM projects").get()).toEqual({ id: "project", name: "项目" })
    const preservedDefault = db.getProjectSettings("project").defaultModel
    expect(String(preservedDefault?.providerID)).toBe("openai")
    expect(String(preservedDefault?.id)).toBe("gpt-5")
    expect(db.sqlite.query("SELECT provider_id FROM provider_settings").get()).toEqual({ provider_id: "openai" })
    expect(db.sqlite.query("SELECT integration_id FROM credentials").get()).toEqual({ integration_id: "openai" })
    expect(db.getSetting<{ providerID: string; id: string }>("reviewerModel")).toEqual({ providerID: "openai", id: "reviewer" })
    const tables = new Set((db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
    expect(tables.has("agent_executions")).toBe(true)
    expect(tables.has("agent_checkpoints")).toBe(true)
    expect(tables.has("turn_stages")).toBe(false)
    expect(tables.has("proposals")).toBe(false)
    db.close()

    expect((await readdir(root)).some((name) => name.startsWith(`agent.pre-v${SCHEMA_VERSION}-`) && name.endsWith(".sqlite"))).toBe(true)
  })

  test("v5 到 v6 保留现有 Thread 和 AgentExecution 并增加子 Agent 表", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v6-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const initial = new AgentDatabase(path)
    const thread = initial.createThread("保留的会话")
    initial.close()
    const v5 = new Database(path)
    v5.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE subagent_controls;
      DROP TABLE workspace_writer_leases;
      DROP TABLE subagent_runs;
      DROP TABLE subagent_tasks;
      DROP TABLE input_attachments;
      PRAGMA user_version = 5;
    `)
    v5.close()

    const migrated = new AgentDatabase(path)
    expect(migrated.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(migrated.sqlite.query("SELECT id, title, kind FROM threads WHERE id = ?").get(thread.id)).toEqual({ id: thread.id, title: "保留的会话", kind: "main" })
    const tables = new Set((migrated.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name))
    expect(tables.has("subagent_tasks")).toBe(true)
    expect(tables.has("subagent_runs")).toBe(true)
    expect(tables.has("input_attachments")).toBe(true)
    migrated.close()
  })

  test("v12 到 v13 删除 live 事件并用校验后的压缩库原子替换", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v13-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const initial = new AgentDatabase(path)
    initial.insertEvent("thread:kept", null, "thread/updated", { marker: "durable" })
    const largeCatalog = { catalogVersion: 1, models: [{ id: "model", description: "x".repeat(1_000_000) }] }
    for (let index = 0; index < 6; index += 1) initial.insertEvent(null, null, "catalog/updated", largeCatalog)
    initial.sqlite.exec("PRAGMA user_version = 12; PRAGMA wal_checkpoint(TRUNCATE)")
    initial.close()
    const before = (await stat(path)).size

    const migrated = new AgentDatabase(path)
    expect(migrated.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 13 })
    expect(migrated.sqlite.query("SELECT method FROM events ORDER BY id").all()).toEqual([{ method: "thread/updated" }])
    migrated.close()

    const after = (await stat(path)).size
    expect(after).toBeLessThan(before / 2)
    expect((await readdir(root)).some((name) => name.includes("v12-replaced") || name.includes("v13-compacting"))).toBe(false)
  })

  test("v13 原子替换中断后优先恢复原库再重试迁移", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-v13-recover-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const initial = new AgentDatabase(path)
    const thread = initial.createThread("替换前保留")
    initial.sqlite.exec("PRAGMA user_version = 12; PRAGMA wal_checkpoint(TRUNCATE)")
    initial.close()
    await renamePath(path, `${path}.v12-replaced`)

    const recovered = new AgentDatabase(path)
    expect(recovered.getThread(thread.id)?.title).toBe("替换前保留")
    expect(recovered.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 13 })
    recovered.close()
    expect((await readdir(root)).some((name) => name.includes("v12-replaced"))).toBe(false)
  })
})
