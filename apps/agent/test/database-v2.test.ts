import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, DATA_EPOCH, SCHEMA_VERSION } from "../src/storage/database/AgentDatabase"
import { FINAL_SCHEMA, initializeSchema } from "../src/storage/database/schema-initializer"
import { PROFILE_APPLICATION_ID, PROFILE_SCHEMA_VERSION } from "../src/storage/database/schema"

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
  test("v18 到 v19 从 durable events 恢复被覆盖正文并分配稳定 ordinal", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, turn_id TEXT NOT NULL,
        agent_id TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
        data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT, turn_id TEXT,
        method TEXT NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      PRAGMA user_version = 18;
    `)
    const internalItem = (id: string, type: string, data: Record<string, unknown>, createdAt: number) => ({
      id, turnID: "turn-1", agentID: "agent-1", type, status: "completed", data, createdAt, updatedAt: createdAt,
    })
    const first = internalItem("turn-1:pi:text", "text", { placement: "result", text: "开始检查" }, 100)
    const final = internalItem("turn-1:pi:text", "text", { placement: "result", text: "根 package.json 已读取" }, 200)
    const tool = internalItem("tool-1", "tool", { tool: "Read" }, 101)
    sqlite.query("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      final.id, "thread-1", final.turnID, final.agentID, final.type, final.status, JSON.stringify(final.data), final.createdAt, final.updatedAt,
    )
    sqlite.query("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      tool.id, "thread-1", tool.turnID, tool.agentID, tool.type, tool.status, JSON.stringify(tool.data), tool.createdAt, tool.updatedAt,
    )
    sqlite.query("INSERT INTO items VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "legacy-unproven", "thread-1", "turn-1", "agent-1", "activity", "completed", "{}", 300, 300,
    )
    for (const [method, item, createdAt] of [
      ["item/completed", first, 100],
      ["tool/callStarted", tool, 101],
      ["item/completed", final, 200],
    ] as const) {
      sqlite.query("INSERT INTO events (thread_id, turn_id, method, params, created_at) VALUES (?, ?, ?, ?, ?)").run(
        "thread-1", "turn-1", method, JSON.stringify({ item }), createdAt,
      )
    }

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    const rows = sqlite.query("SELECT id, type, data, ordinal FROM items WHERE turn_id = ? ORDER BY ordinal").all("turn-1") as Array<{
      id: string
      type: string
      data: string
      ordinal: number
    }>
    expect(rows.map((row) => [row.type, JSON.parse(row.data).text ?? null])).toEqual([
      ["text", "开始检查"],
      ["tool", null],
      ["text", "根 package.json 已读取"],
      ["activity", null],
    ])
    expect(rows.map((row) => row.ordinal)).toEqual([0, 1, 2, 3])
    expect(rows.some((row) => row.id === "legacy-unproven")).toBe(true)
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 20 })
    sqlite.close()
  })

  test("v19 到 v20 保留会话和消息并新增 nullable 工作分支", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        content TEXT NOT NULL
      );
      INSERT INTO threads VALUES ('thread-1', '保留的会话');
      INSERT INTO messages VALUES ('message-1', 'thread-1', '保留的消息');
      PRAGMA user_version = 19;
    `)

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query("SELECT id, title, git_branch FROM threads").get()).toEqual({
      id: "thread-1",
      title: "保留的会话",
      git_branch: null,
    })
    expect(sqlite.query("SELECT content FROM messages WHERE id = 'message-1'").get()).toEqual({
      content: "保留的消息",
    })
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: 20 })
    sqlite.close()
  })

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
    expect((db.sqlite.query("PRAGMA table_info(threads)").all() as Array<{ name: string }>).some(column => column.name === "git_branch")).toBe(true)
    db.close()
  })

  test("无法识别的旧 schema 会保留原文件并阻止启动", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pi-v17-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    const seeded = new Database(path, { create: true })
    seeded.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 16;
      CREATE TABLE stale_schema (value TEXT NOT NULL);
      INSERT INTO stale_schema VALUES ('must reset');
    `)
    seeded.close()
    const originalSize = (await stat(path)).size

    expect(() => new AgentDatabase(path)).toThrow("缺少 16 → 17 迁移")
    expect((await stat(path)).size).toBe(originalSize)
  })

  test("旧 history epoch 备份后重建", async () => {
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

    expect((await readdir(root)).some((name) => name.startsWith("agent.sqlite.epoch-0.") && name.endsWith(".bak"))).toBe(true)
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

  test("旧单库原子拆分为 history/profile 并保留来源与备份", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-split-"))
    paths.push(root)
    const legacyPath = join(root, "agent.sqlite")
    const historyPath = join(root, "history.sqlite")
    const profilePath = join(root, "profile.sqlite")
    const legacy = new Database(legacyPath, { create: true })
    legacy.exec("PRAGMA foreign_keys = ON")
    legacy.exec(FINAL_SCHEMA.join(";\n"))
    legacy.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{"theme":"dark"}', 1);
      INSERT INTO projects VALUES ('project:1', '项目', 'F:\\workspace', 1, 1, 1);
      INSERT INTO project_settings VALUES ('project:1', NULL, 1);
      INSERT INTO threads (id, title, project_id, workspace_kind, created_at, updated_at)
        VALUES ('thread:1', '保留的会话', 'project:1', 'project', 1, 1);
      INSERT INTO memory_entries VALUES ('memory:1', 'user', '', '偏好深色主题', 'thread:1', 'hash:1', 1, 1);
    `)
    legacy.close()

    const db = new AgentDatabase({ legacyPath, historyPath, profilePath })
    expect(db.getThread("thread:1")?.title).toBe("保留的会话")
    expect(db.getSetting<{ theme: string }>("desktop.settings.v1")).toEqual({ theme: "dark" })
    expect(db.getProject("project:1")?.name).toBe("项目")
    expect(db.profileSqlite.query("SELECT content FROM memory_entries WHERE id = 'memory:1'").get()).toEqual({ content: "偏好深色主题" })
    expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE name IN ('app_settings', 'projects', 'memory_entries')").all()).toEqual([])
    expect(db.profileSqlite.query("PRAGMA application_id").get()).toEqual({ application_id: PROFILE_APPLICATION_ID })
    expect(db.profileSqlite.query("PRAGMA user_version").get()).toEqual({ user_version: PROFILE_SCHEMA_VERSION })
    db.sqlite.query("DELETE FROM threads WHERE id = 'thread:1'").run()
    expect(db.profileSqlite.query("SELECT source_thread_id FROM memory_entries WHERE id = 'memory:1'").get()).toEqual({ source_thread_id: "thread:1" })
    db.close()

    const names = await readdir(root)
    expect(names.some((name) => name.startsWith("agent.sqlite.epoch-") && name.endsWith(".bak"))).toBe(true)
    expect(names).toContain("agent.sqlite")
  })

  test("history epoch 更换只备份并重建会话库", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-history-epoch-"))
    paths.push(root)
    const pathsForDatabase = {
      legacyPath: join(root, "agent.sqlite"),
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    }
    const initial = new AgentDatabase(pathsForDatabase)
    initial.setSetting("desktop.settings.v1", { fontSize: 16 })
    const staleThread = initial.createThread("应重建的会话")
    initial.close()
    const staleHistory = new Database(pathsForDatabase.historyPath)
    staleHistory.exec("PRAGMA application_id = 1")
    staleHistory.close()

    const reopened = new AgentDatabase(pathsForDatabase)
    expect(reopened.getThread(staleThread.id)).toBeNull()
    expect(reopened.getSetting<{ fontSize: number }>("desktop.settings.v1")).toEqual({ fontSize: 16 })
    reopened.close()
    expect((await readdir(root)).some((name) => name.startsWith("history.sqlite.epoch-1.") && name.endsWith(".bak"))).toBe(true)
  })

  test("资料迁移校验失败时保留旧库且不发布正式双库", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-profile-failure-"))
    paths.push(root)
    const legacyPath = join(root, "agent.sqlite")
    const historyPath = join(root, "history.sqlite")
    const profilePath = join(root, "profile.sqlite")
    const legacy = new Database(legacyPath, { create: true })
    legacy.exec(FINAL_SCHEMA.join(";\n"))
    legacy.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{broken', 1);
    `)
    legacy.close()

    expect(() => new AgentDatabase({ legacyPath, historyPath, profilePath })).toThrow("不是有效 JSON")
    expect(await Bun.file(legacyPath).exists()).toBe(true)
    expect(await Bun.file(profilePath).exists()).toBe(false)
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
