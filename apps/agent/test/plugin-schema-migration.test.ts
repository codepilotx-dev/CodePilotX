import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "bun:test"
import { initializeSchema } from "../src/storage/database/schema-initializer"
import { PROFILE_APPLICATION_ID, PROFILE_SCHEMA_VERSION } from "../src/storage/database/schema"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const PLUGIN_TABLES = [
  "plugin_packages",
  "plugin_activations",
  "plugin_grants",
  "plugin_profile_generations",
  "plugin_operations",
  "plugin_kv",
]

describe("Profile schema 3 → 4 迁移", () => {
  test("v3 库事务迁移到 v4，旧数据保留，新表可用", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-schema-"))
    roots.push(root)
    const path = join(root, "profile.sqlite")
    const sqlite = new Database(path)
    sqlite.exec(`
      CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO app_settings VALUES ('theme', 'dark', 100);
      PRAGMA user_version = 3;
      PRAGMA application_id = ${PROFILE_APPLICATION_ID};
    `)
    sqlite.close()

    const migrated = new Database(path)
    initializeSchema(migrated, "profile")
    expect(migrated.query("PRAGMA user_version").get()).toEqual({ user_version: PROFILE_SCHEMA_VERSION })
    expect(migrated.query("PRAGMA application_id").get()).toEqual({ application_id: PROFILE_APPLICATION_ID })
    expect(migrated.query("SELECT value FROM app_settings WHERE key = 'theme'").get()).toEqual({ value: "dark" })
    const tables = new Set((migrated.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name))
    for (const table of PLUGIN_TABLES) {
      expect(tables.has(table), table).toBe(true)
    }
    // 新表可直接读写。
    migrated.query("INSERT INTO plugin_kv (plugin_id, scope, workspace_key, key, value, version, updated_at) VALUES ('acme.hello', 'global', '', 'k', 'v', 1, 1)").run()
    expect(migrated.query("SELECT value FROM plugin_kv WHERE key = 'k'").get()).toEqual({ value: "v" })
    migrated.close()
  })

  test("迁移幂等：重复初始化不改变版本与数据", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-schema-"))
    roots.push(root)
    const path = join(root, "profile.sqlite")
    const sqlite = new Database(path)
    initializeSchema(sqlite, "profile")
    sqlite.query("INSERT INTO plugin_activations (plugin_id, workspace_key, enabled, updated_at) VALUES ('acme.x', '', 0, 1)").run()
    initializeSchema(sqlite, "profile")
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: PROFILE_SCHEMA_VERSION })
    expect(sqlite.query("SELECT enabled FROM plugin_activations WHERE plugin_id = 'acme.x'").get()).toEqual({ enabled: 0 })
    sqlite.close()
  })

  test("新库（user_version=0）直接建到 v4", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-schema-"))
    roots.push(root)
    const path = join(root, "profile.sqlite")
    const sqlite = new Database(path)
    initializeSchema(sqlite, "profile")
    expect(sqlite.query("PRAGMA user_version").get()).toEqual({ user_version: PROFILE_SCHEMA_VERSION })
    sqlite.close()
  })

  test("高于 v4 的 schema 被旧代码打开时保持 user_version 与未知表", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-schema-"))
    roots.push(root)
    const path = join(root, "profile.sqlite")
    const sqlite = new Database(path)
    initializeSchema(sqlite, "profile")
    sqlite.exec(`
      CREATE TABLE future_plugin_records (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT INTO future_plugin_records VALUES ('future:1', '{"keep":true}');
      PRAGMA user_version = ${PROFILE_SCHEMA_VERSION + 1};
    `)
    sqlite.close()

    const reopened = new Database(path)
    initializeSchema(reopened, "profile")
    expect(reopened.query("PRAGMA user_version").get()).toEqual({ user_version: PROFILE_SCHEMA_VERSION + 1 })
    expect(reopened.query("SELECT payload FROM future_plugin_records WHERE id = 'future:1'").get()).toEqual({ payload: '{"keep":true}' })
    reopened.close()
  })
})
