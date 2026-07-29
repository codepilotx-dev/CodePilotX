import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, DATA_EPOCH, HISTORY_APPLICATION_ID, SCHEMA_VERSION } from "../src/storage/database/AgentDatabase"
import { FINAL_SCHEMA, HISTORY_SCHEMA, initializeSchema } from "../src/storage/database/schema-initializer"
import { PROFILE_APPLICATION_ID, PROFILE_SCHEMA_VERSION } from "../src/storage/database/schema"

const paths: string[] = []
const HISTORY_V19_SCHEMA = HISTORY_SCHEMA
  .filter((statement) => !statement.startsWith("CREATE TRIGGER threads_workspace_"))
  .map((statement) => statement.startsWith("CREATE TABLE threads ")
    ? statement
        .replace(", workspace_roots TEXT, instruction_sources TEXT", "")
        .replace(", git_branch TEXT)", ")")
    : statement)

const removePath = async (path: string) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { await rm(path, { recursive: true, force: true }); return } catch (cause) {
      if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "EBUSY") throw cause
      await Bun.sleep(100)
    }
  }
}
afterEach(async () => Promise.all(paths.splice(0).map(removePath)))

describe("数据库兼容与迁移", () => {
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
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
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
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test("v19 到 v20 保留会话和消息并新增 nullable 工作分支", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY, title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'main',
        created_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT,
        method TEXT NOT NULL,
        params TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO threads (id, title) VALUES ('thread-1', '保留的会话');
      INSERT INTO messages (id, thread_id, content) VALUES ('message-1', 'thread-1', '保留的消息');
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
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test("v21 到 v22 只恢复被纯标题事件覆盖的会话活跃时间", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(HISTORY_SCHEMA.join(";\n"))
    sqlite.exec("PRAGMA user_version = 21")
    for (const [id, createdAt, updatedAt] of [
      ["thread:title", 100, 900],
      ["thread:empty", 150, 950],
      ["thread:active-after-title", 200, 1_000],
      ["thread:title-and-archive", 250, 800],
    ] as const) {
      sqlite.query("INSERT INTO threads (id, title, created_at, updated_at) VALUES (?, '标题', ?, ?)").run(
        id,
        createdAt,
        updatedAt,
      )
    }
    for (const [id, threadID, createdAt, ordinal] of [
      ["message:title", "thread:title", 300, 0],
      ["message:before-title", "thread:active-after-title", 400, 0],
      ["message:after-title", "thread:active-after-title", 1_000, 1],
      ["message:archive", "thread:title-and-archive", 500, 0],
    ] as const) {
      sqlite.query(`
        INSERT INTO messages (id, thread_id, turn_id, role, content, created_at, ordinal)
        VALUES (?, ?, NULL, 'user', '内容', ?, ?)
      `).run(id, threadID, createdAt, ordinal)
    }
    for (const [threadID, patch, updatedAt] of [
      ["thread:title", { title: "新标题" }, 900],
      ["thread:empty", { title: null }, 950],
      ["thread:active-after-title", { title: "旧标题" }, 900],
      ["thread:title-and-archive", { title: "归档标题", archived: true }, 800],
    ] as const) {
      sqlite.query(`
        INSERT INTO events (thread_id, turn_id, method, params, created_at)
        VALUES (?, NULL, 'thread/updated', ?, ?)
      `).run(threadID, JSON.stringify({ threadId: threadID, patch, updatedAt }), updatedAt)
    }

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    const activityByThread = new Map(
      (sqlite.query("SELECT id, updated_at FROM threads ORDER BY id").all() as Array<{
        id: string
        updated_at: number
      }>).map(row => [row.id, row.updated_at]),
    )
    expect(activityByThread.get("thread:title")).toBe(300)
    expect(activityByThread.get("thread:empty")).toBe(150)
    expect(activityByThread.get("thread:active-after-title")).toBe(1_000)
    expect(activityByThread.get("thread:title-and-archive")).toBe(800)
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test("v22 到 v23 新增独立未读表并保留现有会话", () => {
    const sqlite = new Database(":memory:")
    sqlite.exec(HISTORY_SCHEMA
      .filter((statement) => !statement.startsWith("CREATE TABLE thread_read_state"))
      .join(";\n"))
    sqlite.exec(`
      PRAGMA user_version = 22;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:existing', '保留的会话', 1, 2);
    `)

    initializeSchema(sqlite)
    initializeSchema(sqlite)

    expect(sqlite.query("SELECT id, title FROM threads").get()).toEqual({
      id: "thread:existing",
      title: "保留的会话",
    })
    expect(sqlite.query("SELECT * FROM thread_read_state").all()).toEqual([])
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    sqlite.close()
  })

  test("已知 history application ID 2 从 schema 19 原地升级并保留会话", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-history-v19-"))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, "agent.sqlite"),
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    }
    const legacy = new Database(databasePaths.historyPath, { create: true })
    legacy.exec(HISTORY_V19_SCHEMA.join(";\n"))
    legacy.exec(`
      PRAGMA application_id = 2;
      PRAGMA user_version = 19;
      INSERT INTO threads (id, title, created_at, updated_at)
      VALUES ('thread:legacy', '保留的旧会话', 1, 1);
    `)
    legacy.close()

    const db = new AgentDatabase(databasePaths)

    expect(db.getThread("thread:legacy")?.title).toBe("保留的旧会话")
    expect(db.sqlite.query("PRAGMA application_id").get()).toEqual({
      application_id: HISTORY_APPLICATION_ID,
    })
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({
      user_version: SCHEMA_VERSION,
    })
    db.close()
  })

  test("旧客户端打开更高 history schema 时保留未知结构并继续读写核心会话", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-history-future-"))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, "agent.sqlite"),
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    }
    const initial = new AgentDatabase(databasePaths)
    const existing = initial.createThread("已有会话")
    initial.close()

    const future = new Database(databasePaths.historyPath)
    future.exec(`
      ALTER TABLE threads ADD COLUMN future_note TEXT;
      CREATE TABLE future_feature_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_feature_records VALUES ('future:1', '{"enabled":true}');
      UPDATE threads SET future_note = 'keep' WHERE id = '${existing.id}';
      PRAGMA user_version = ${SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.getThread(existing.id)?.title).toBe("已有会话")
    const created = reopened.createThread("旧客户端新建会话")
    expect(reopened.getThread(created.id)?.title).toBe("旧客户端新建会话")
    expect(reopened.sqlite.query("PRAGMA user_version").get()).toEqual({
      user_version: SCHEMA_VERSION + 1,
    })
    expect(reopened.sqlite.query("SELECT payload FROM future_feature_records WHERE id = 'future:1'").get()).toEqual({
      payload: '{"enabled":true}',
    })
    expect(reopened.sqlite.query("SELECT future_note FROM threads WHERE id = ?").get(existing.id)).toEqual({
      future_note: "keep",
    })
    reopened.close()
  })

  test("旧客户端打开更高 profile schema 时保留未知设置结构", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-profile-future-"))
    paths.push(root)
    const databasePaths = {
      legacyPath: join(root, "agent.sqlite"),
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    }
    const initial = new AgentDatabase(databasePaths)
    initial.setSetting("compatibility.known", { enabled: true })
    initial.close()

    const future = new Database(databasePaths.profilePath)
    future.exec(`
      CREATE TABLE future_profile_records (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      INSERT INTO future_profile_records VALUES ('future:profile', '{"keep":true}');
      PRAGMA user_version = ${PROFILE_SCHEMA_VERSION + 1};
    `)
    future.close()

    const reopened = new AgentDatabase(databasePaths)
    expect(reopened.getSetting<{ enabled: boolean }>("compatibility.known")).toEqual({ enabled: true })
    expect(reopened.profileSqlite.query("PRAGMA user_version").get()).toEqual({
      user_version: PROFILE_SCHEMA_VERSION + 1,
    })
    expect(reopened.profileSqlite.query(
      "SELECT payload FROM future_profile_records WHERE id = 'future:profile'",
    ).get()).toEqual({ payload: '{"keep":true}' })
    reopened.close()
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

  test("空白 SQLite 文件可以初始化为当前 CodePilotX 数据库", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-empty-database-"))
    paths.push(root)
    const path = join(root, "agent.sqlite")
    new Database(path, { create: true }).close()

    const db = new AgentDatabase(path)
    expect(db.sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: SCHEMA_VERSION })
    expect(db.sqlite.query("PRAGMA application_id").get()).toEqual({
      application_id: HISTORY_APPLICATION_ID,
    })
    db.close()
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

  test("旧单库原子拆分为 history/profile 并保留来源且不创建备份", async () => {
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
      INSERT INTO projects VALUES ('project:1', '项目', NULL, 1, 1, 1);
      INSERT INTO project_settings VALUES ('project:1', NULL, '', 1, 1);
      INSERT INTO project_folders VALUES ('folder:1', 'project:1', 'F:\\workspace', 'f:/workspace', 'primary', 0, 1, 1);
      INSERT INTO threads (
        id, title, project_id, workspace_kind, workspace_cwd, workspace_roots,
        instruction_sources, created_at, updated_at
      ) VALUES (
        'thread:1', '保留的会话', 'project:1', 'project', 'F:\\workspace',
        '[{"folderId":"folder:1","path":"F:\\\\workspace","role":"primary"}]', '[]', 1, 1
      );
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
    expect(names.some((name) => name.endsWith(".bak"))).toBe(false)
    expect(names).toContain("agent.sqlite")
  })

  test("混合 history v17 原子拆分并保留会话与设置且不创建备份", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-split-history-v17-"))
    paths.push(root)
    const legacyPath = join(root, "agent.sqlite")
    const historyPath = join(root, "history.sqlite")
    const profilePath = join(root, "profile.sqlite")
    const mixed = new Database(historyPath, { create: true })
    mixed.exec(FINAL_SCHEMA.join(";\n"))
    mixed.exec(`
      PRAGMA application_id = ${DATA_EPOCH};
      PRAGMA user_version = 17;
      INSERT INTO app_settings VALUES ('desktop.settings.v1', '{"theme":"dark"}', 1);
      INSERT INTO threads (
        id, title, workspace_kind, created_at, updated_at
      ) VALUES ('thread:mixed', '混合库会话', 'legacy', 1, 1);
    `)
    mixed.close()

    const db = new AgentDatabase({ legacyPath, historyPath, profilePath })
    expect(db.getThread("thread:mixed")?.title).toBe("混合库会话")
    expect(db.getSetting<{ theme: string }>("desktop.settings.v1")).toEqual({ theme: "dark" })
    expect(db.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'app_settings'").get()).toBeNull()
    db.close()

    const names = await readdir(root)
    expect(names).toContain("history.sqlite")
    expect(names).toContain("profile.sqlite")
    expect(names.some((name) => name.endsWith(".bak"))).toBe(false)
    expect(names.some((name) => name.includes(".migrating"))).toBe(false)
  })

  test("未知 history application ID 保留原库并阻止覆盖", async () => {
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

    expect(() => new AgentDatabase(pathsForDatabase)).toThrow(
      "history.sqlite 不属于受支持的 CodePilotX 数据代际",
    )
    const preserved = new Database(pathsForDatabase.historyPath, { strict: true })
    expect(preserved.query("SELECT title FROM threads WHERE id = ?").get(staleThread.id)).toEqual({
      title: "应重建的会话",
    })
    expect(preserved.query("PRAGMA application_id").get()).toEqual({ application_id: 1 })
    preserved.close()
    expect((await readdir(root)).some((name) => name.includes(".bak"))).toBe(false)
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
