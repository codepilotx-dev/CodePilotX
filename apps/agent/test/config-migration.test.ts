import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout as delay } from "node:timers/promises"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { ConfigService } from "../src/config/ConfigService"
import { ConfigMigrationService } from "../src/config/ConfigMigrationService"
import { ConfigMigrationRepository } from "../src/storage/repositories/config-migration-repository"
import { Model, Provider } from "@codepilotx/model-schema"
import { planPiProviderConfigMigration } from "../src/provider/pi/PiProviderConfigMigration"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await rm(root, { recursive: true, force: true })
        return
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "EBUSY" || attempt === 199) {
          throw cause
        }
        Bun.gc(true)
        await delay(25)
      }
    }
  }))
})

describe("ConfigMigrationService", () => {
  test("文件值优先地迁移旧偏好，并幂等拆分运行状态", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-config-migration-"))
    roots.push(root)
    const data = join(root, "data")
    const workspace = join(root, "workspace")
    const appearancePath = join(root, "appearance-settings.json")
    const toolingPath = join(root, "tooling", "v2", "settings.json")
    const db = new AgentDatabase({
      historyPath: join(data, "history.sqlite"),
      profilePath: join(data, "profile.sqlite"),
    })
    const project = db.createProject({ rootPath: workspace })
    db.setSetting("desktop.settings.v1", {
      showContextUsage: false,
      recentWorkspaces: [{ path: workspace, name: "workspace" }],
      sidebarManualOrder: { all: ["session-1"] },
      enableMemory: true,
    })
    db.setSetting("defaultModel", {
      providerID: "openai",
      id: "legacy-default",
    })
    db.setSetting("reviewerModel", {
      providerID: "openai",
      id: "legacy-reviewer",
    })
    db.setProviderSettings("openai", {
      api: "https://example.com/v1",
      apiKey: "must-not-migrate",
      accessToken: "must-not-migrate-either",
      apiKeyEnv: "OPENAI_API_KEY",
    })
    db.saveProjectSettings(project.id, {
      defaultModel: Model.Ref.make({
        providerID: Provider.ID.make("openai"),
        id: Model.ID.make("project-model"),
      }),
    })
    db.setSetting("mcp.settings.v2", {
      version: 2,
      generation: 4,
      user: {
        context7: {
          name: "context7",
          scope: "user",
          enabled: true,
          transport: { type: "http", url: "https://example.com/mcp" },
        },
      },
      local: {},
      operations: [{ operationId: "mcp:1", fingerprint: "hash", generation: 4 }],
    })
    db.setSetting("skills.settings.v1", {
      version: 1,
      disabledPathHashes: ["a".repeat(64)],
      generation: 2,
      updatedAt: 1,
      operations: [],
    })
    await writeFile(
      appearancePath,
      JSON.stringify({ version: 6, mode: "dark" }),
      "utf8",
    )
    await mkdir(join(root, "tooling", "v2"), { recursive: true })
    await writeFile(toolingPath, JSON.stringify({
      version: 2,
      preferences: { nodejs: "system", python: "managed" },
    }), "utf8")

    const config = new ConfigService(join(data, "config.json"))
    await config.initialize()
    await config.writeValue({ keyPath: ["model"], value: "file-wins" })
    const migrate = () => new ConfigMigrationService(
      config,
      new ConfigMigrationRepository(db),
      appearancePath,
      toolingPath,
    ).run()
    await migrate()
    await migrate()

    const read = await config.read()
    expect(read.config).toMatchObject({
      model: "file-wins",
      model_provider: "openai",
      task_models: { reviewer: "legacy-reviewer" },
      features: { memory: true },
      desktop: {
        showContextUsage: false,
        appearance: { version: 6, mode: "dark" },
        tooling: { nodejs: "system", python: "managed" },
      },
      model_providers: {
        openai: {
          kind: "builtin",
          enabled: false,
          api: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      },
      model_catalog: { schema_version: 2 },
      migration: {
        unresolved_providers: {
          openai: {
            provider_id: "openai",
            fields: ["api", "apiKeyEnv"],
          },
        },
      },
      mcp_servers: {
        context7: { enabled: true },
      },
    })
    expect(JSON.stringify(read.config)).not.toContain("must-not-migrate")
    expect(db.getSetting("desktop.settings.v1")).toBeNull()
    expect(db.getSetting("mcp.settings.v2")).toBeNull()
    expect(db.getSetting("skills.settings.v1")).toBeNull()
    expect(
      db.getSetting<{ completed: boolean }>("config.json.migration.v1")?.completed,
    ).toBe(true)
    expect(db.getSetting<{ generation: number }>("mcp.runtime.v1")?.generation).toBe(4)
    expect(db.getSetting<Record<string, unknown>>("desktop.runtime-state.v1")).toMatchObject({
      recentWorkspaces: [{ path: workspace }],
      sidebarManualOrder: { all: ["session-1"] },
    })
    expect(await readFile(join(data, "config.json"), "utf8")).not.toContain(
      "sidebarManualOrder",
    )
    expect(await readFile(
      join(workspace, ".codepilotx", "config.json"),
      "utf8",
    )).toContain('"model": "project-model"')
    await expect(readFile(appearancePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(toolingPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
    db.profileSqlite.query(
      "DELETE FROM app_settings WHERE key = 'config.json.migration.v1'",
    ).run()
    db.setSetting("config.toml.migration.v1", { completed: true })
    expect(new ConfigMigrationRepository(db).read().completed).toBe(true)
    await config.dispose()
    db.close()
  })

  test("已完成旧迁移后仍将 config.json 中的桌面运行状态搬到本机数据库", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-config-runtime-migration-"))
    roots.push(root)
    const data = join(root, "data")
    const configPath = join(data, "config.json")
    const db = new AgentDatabase({
      historyPath: join(data, "history.sqlite"),
      profilePath: join(data, "profile.sqlite"),
    })
    db.setSetting("config.json.migration.v1", { completed: true })
    db.setSetting("desktop.runtime-state.v1", {
      lastActiveWorkspacePath: "F:/local-wins",
    })
    await mkdir(data, { recursive: true })
    await writeFile(configPath, [
      "{",
      "  // 可迁移配置中的未知内容和注释必须保留",
      '  "future_setting": { "keep": true },',
      '  "desktop": {',
      '    "recentWorkspaces": [{ "path": "F:/portable" }],',
      '    "lastActiveWorkspacePath": "F:/stale",',
      '    "showContextUsage": true,',
      "  },",
      "}",
      "",
    ].join("\n"), "utf8")
    const config = new ConfigService(configPath)
    await config.initialize()
    const migrate = () => new ConfigMigrationService(
      config,
      new ConfigMigrationRepository(db),
    ).run()

    await migrate()
    await migrate()

    expect(db.getSetting<Record<string, unknown>>("desktop.runtime-state.v1")).toMatchObject({
      recentWorkspaces: [{ path: "F:/portable" }],
      lastActiveWorkspacePath: "F:/local-wins",
    })
    const persisted = await readFile(configPath, "utf8")
    expect(persisted).toContain("可迁移配置中的未知内容和注释必须保留")
    expect(persisted).toContain('"future_setting"')
    expect(persisted).toContain('"showContextUsage": true')
    expect(persisted).not.toContain("recentWorkspaces")
    expect(persisted).not.toContain("lastActiveWorkspacePath")
    await config.dispose()
    db.close()
  })

  test("将可识别的 Provider 配置迁移为 Pi v2，并停用无法映射的配置", () => {
    const current = {
      model_providers: {
        local: {
          name: "Local",
          api: "http://127.0.0.1:11434/v1",
          npm: "@ai-sdk/openai-compatible",
          env: ["LOCAL_API_KEY"],
          models: { chat: { name: "Chat", reasoning: true } },
        },
        unknown: {
          api: "https://example.com/v1",
          npm: "@ai-sdk/google",
          models: { gemini: { name: "Gemini" } },
        },
      },
    }
    const edits = planPiProviderConfigMigration(current)
    const byPath = new Map(edits.map((edit) => [edit.keyPath.join("."), edit.value]))

    expect(byPath.get("model_catalog.schema_version")).toBe(2)
    expect(byPath.get("model_providers.local.kind")).toBe("custom")
    expect(byPath.get("model_providers.local.enabled")).toBe(true)
    expect(byPath.get("model_providers.local.base_url")).toBe(
      "http://127.0.0.1:11434/v1",
    )
    expect(byPath.get("model_providers.local.models.chat")).toBeUndefined()
    expect(byPath.get("model_providers.local.models.chat.api")).toBe(
      "openai-completions",
    )
    expect(byPath.get("model_providers.local.models.chat.context_window")).toBe(
      32768,
    )
    expect(byPath.get("model_providers.unknown.enabled")).toBe(false)
    expect(
      byPath.get("migration.unresolved_providers.unknown"),
    ).toMatchObject({
      provider_id: "unknown",
      fields: ["npm"],
    })
    expect(
      byPath.has("migration.unresolved_providers.local"),
    ).toBe(false)
  })
})
