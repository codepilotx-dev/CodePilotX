import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase, SCHEMA_VERSION } from "../src/storage/Database"

const paths: string[] = []
afterEach(async () => Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))))

describe("数据库 v2 根基", () => {
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
})
