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
})
