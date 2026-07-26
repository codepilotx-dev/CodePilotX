import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { ConfigService } from "../src/config/ConfigService"
import { ConfigMigrationService } from "../src/config/ConfigMigrationService"
import { ConfigMigrationRepository } from "../src/storage/repositories/config-migration-repository"
import { Model, Provider } from "@codepilotx/model-schema"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
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

    const config = new ConfigService(join(data, "config.toml"))
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
          api: "https://example.com/v1",
          apiKeyEnv: "OPENAI_API_KEY",
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
    expect(db.getSetting<{ generation: number }>("mcp.runtime.v1")?.generation).toBe(4)
    expect(db.getSetting<Record<string, unknown>>("desktop.runtime-state.v1")).toMatchObject({
      recentWorkspaces: [{ path: workspace }],
    })
    expect(await readFile(
      join(workspace, ".codepilotx", "config.toml"),
      "utf8",
    )).toContain('model = "project-model"')
    await expect(readFile(appearancePath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
    await expect(readFile(toolingPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
    await config.dispose()
    db.close()
  })
})
