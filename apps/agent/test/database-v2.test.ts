import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, DATA_EPOCH, SCHEMA_VERSION } from "../src/storage/Database"

const paths: string[] = []
const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}
afterEach(async () => Promise.all(paths.splice(0).map(removePath)))

describe("数据库 Pi epoch", () => {
  test("读取旧 on-failure 审批策略时迁移为 on-request", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-on-failure-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const thread = db.createThread("旧审批策略")
    db.sqlite.query("UPDATE threads SET approval_policy = 'on-failure' WHERE id = ?").run(thread.id)

    expect(db.getThread(thread.id)?.settings.permissionConfig.approvalPolicy).toBe("on-request")
    db.close()
  })

  test("新数据库创建 Pi session schema", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pi-epoch-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))

    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.query("PRAGMA application_id").get()).toEqual({ application_id: DATA_EPOCH })
    const tables = new Set((db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name))
    expect(tables.has("pi_sessions")).toBe(true)
    expect(tables.has("pi_session_entries")).toBe(true)
    db.close()
  })

  test("v16 升级为带 Thread ownership 的 v17 Pi schema 并清理孤儿", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pi-v17-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const seeded = new AgentDatabase(path)
    const validThread = seeded.createThread("valid")
    seeded.sqlite.query("UPDATE threads SET id = 'thread-valid' WHERE id = ?").run(validThread.id)
    seeded.close()
    const legacy = new Database(path, { create: true })
    legacy.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE pi_session_entries;
      DROP TABLE pi_sessions;
      PRAGMA user_version = 16;
      CREATE TABLE pi_sessions (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        leaf_id TEXT,
        name TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE pi_session_entries (
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
      CREATE TABLE agent_thread_items (
        thread_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (thread_id, ordinal)
      );
      INSERT INTO pi_sessions VALUES ('valid', 'thread-valid', 'creator', NULL, NULL, 1, 1);
      INSERT INTO pi_sessions VALUES ('orphan', 'thread-missing', 'creator', NULL, NULL, 1, 1);
      INSERT INTO pi_session_entries VALUES ('valid', 0, 'entry-valid', NULL, 'message', '{}', 1);
      INSERT INTO pi_session_entries VALUES ('orphan', 0, 'entry-orphan', NULL, 'message', '{}', 1);
      PRAGMA foreign_keys = ON;
    `)
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("SELECT id FROM pi_sessions ORDER BY id").all()).toEqual([{ id: "valid" }])
    expect(db.sqlite.query("SELECT id FROM pi_session_entries ORDER BY id").all()).toEqual([{ id: "entry-valid" }])
    expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_thread_items'").get()).toBeNull()
    expect(db.sqlite.query("PRAGMA foreign_key_check").all()).toEqual([])
    expect((db.sqlite.query("PRAGMA foreign_key_list(pi_sessions)").all() as Array<{ table: string; from: string; on_delete: string }>))
      .toContainEqual(expect.objectContaining({ table: "threads", from: "thread_id", on_delete: "CASCADE" }))
    db.close()

    expect((await readdir(root)).some((name) => name.includes("pre-v17"))).toBe(true)
  })

  test("旧 epoch 数据库及 WAL/SHM 被一次性清空且不创建备份", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-reset-pi-epoch-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const legacy = new Database(path, { create: true })
    legacy.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA user_version = 13;
      CREATE TABLE legacy_marker (value TEXT NOT NULL);
      INSERT INTO legacy_marker VALUES ('must disappear');
    `)
    legacy.close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    const tables = new Set((db.sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name))
    expect(tables.has("legacy_marker")).toBe(false)
    expect(tables.has("pi_sessions")).toBe(true)
    db.close()

    expect((await readdir(root)).some((name) => name.includes("legacy") || name.includes("pre-v"))).toBe(false)
  })

  test("当前 Pi epoch 重开时保留数据", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-keep-pi-epoch-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const initial = new AgentDatabase(path)
    const thread = initial.createThread("保留的会话")
    initial.close()

    const reopened = new AgentDatabase(path)
    expect(reopened.getThread(thread.id)?.title).toBe("保留的会话")
    expect(reopened.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    reopened.close()
  })

  test("v16 持久化 projectless workspace 和创建操作幂等键", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-projectless-v16-"))
    paths.push(root)
    const db = new AgentDatabase(join(root, "agent.sqlite"))
    const workspaceRoot = join(root, "managed", "thread-1")
    const cwd = join(workspaceRoot, "work")
    const outputDirectory = join(workspaceRoot, "outputs")

    const thread = db.createThread({
      id: "thread:projectless",
      title: "无项目会话",
      workspace: { kind: "projectless", workspaceRoot, cwd, outputDirectory },
      operationID: "operation:projectless-create",
      requestHash: "request-hash",
    })

    expect(thread.workspace).toEqual({
      kind: "projectless",
      projectID: null,
      workspaceRoot,
      cwd,
      outputDirectory,
    })
    expect(db.threadWorkspace(thread.id)).toEqual(thread.workspace)
    expect(db.threadForCreateOperation("operation:projectless-create")).toEqual({
      threadID: thread.id,
      requestHash: "request-hash",
    })
    expect(() => db.createThread({
      title: "越界会话",
      workspace: {
        kind: "projectless",
        workspaceRoot,
        cwd: join(root, "outside"),
        outputDirectory,
      },
    })).toThrow("必须位于工作区根目录内")
    db.close()
  })
})
