import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PluginGetDetailsResultSchema, PluginListResultSchema } from "@codepilotx/agent-protocol"
import { Schema } from "effect"
import { PluginManagementService } from "../src/plugin/PluginManagementService"
import { SkillService } from "../src/prompt/SkillService"
import type { RpcRouter } from "../src/transport/rpc/RpcRouter"
import { pluginHandlers } from "../src/transport/rpc/handlers/plugins"
import {
  PluginSettingsConflictError,
  PluginSettingsRepository,
} from "../src/storage/repositories/plugin-settings-repository"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-test-"))
  roots.push(root)
  return root
}

const settingsDatabase = () => {
  const values = new Map<string, unknown>()
  return {
    values,
    getSetting<T>(key: string) {
      return values.get(key) as T | undefined ?? null
    },
    setSetting(key: string, value: unknown) {
      values.set(key, value)
    },
  }
}

const writePlugin = async (input: {
  root: string
  id: string
  extension?: boolean
  details?: boolean
  skillsPath?: string
}) => {
  const pluginRoot = join(input.root, input.id)
  const skillRoot = join(pluginRoot, "skills", input.id)
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(skillRoot, { recursive: true })
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: input.id,
    version: "1.0.0",
    description: "测试插件",
    author: { name: "CodePilotX" },
    skills: input.skillsPath ?? "./skills/",
    interface: {
      displayName: "任务规划",
      shortDescription: "拆解和规划复杂工作",
      developerName: "CodePilotX",
      category: "Productivity",
      ...(input.details === false ? {} : {
        longDescription: "澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。",
        capabilities: ["Planning"],
        defaultPrompt: [
          "帮我把这个目标拆解成可执行的任务计划。",
          "梳理这个项目的里程碑、依赖和主要风险。",
          "为这项工作补充清晰的验收标准。",
        ],
      }),
    },
  }), "utf8")
  await writeFile(join(skillRoot, "SKILL.md"), [
    "---",
    `name: ${input.id}`,
    "description: 测试规划技能",
    "---",
    "",
    "生成任务规划。",
  ].join("\n"), "utf8")
  if (input.extension) {
    await mkdir(join(pluginRoot, ".cpx-plugin"), { recursive: true })
    await writeFile(join(pluginRoot, ".cpx-plugin", "plugin.json"), JSON.stringify({
      schemaVersion: 1,
      installation: "INSTALLED_BY_DEFAULT",
      capabilities: ["task-planning"],
    }), "utf8")
  }
  return pluginRoot
}

describe("PluginManagementService", () => {
  test("discovers a default-installed bundled plugin and contributes its Skill root", async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, "plugins")
    const userHome = join(root, "home")
    await mkdir(userHome, { recursive: true })
    await writePlugin({ root: builtinPluginsRoot, id: "task-planning", extension: true })
    await mkdir(join(builtinPluginsRoot, "invalid-plugin", ".codex-plugin"), { recursive: true })
    await writeFile(
      join(builtinPluginsRoot, "invalid-plugin", ".codex-plugin", "plugin.json"),
      "{}",
      "utf8",
    )
    const service = new PluginManagementService(
      new PluginSettingsRepository(settingsDatabase()),
      { builtinPluginsRoot, userHome },
    )

    const result = await service.list()
    expect(() => Schema.decodeUnknownSync(PluginListResultSchema)(result)).not.toThrow()
    expect(result.plugins).toContainEqual(expect.objectContaining({
      id: "task-planning",
      installed: true,
      enabled: true,
      source: "bundled",
      installationPolicy: "INSTALLED_BY_DEFAULT",
      capabilities: ["task-planning"],
      skills: ["task-planning"],
    }))
    const details = await service.getDetails({ pluginId: "task-planning" })
    expect(() => Schema.decodeUnknownSync(PluginGetDetailsResultSchema)(details)).not.toThrow()
    expect(details.details).toEqual({
      pluginId: "task-planning",
      longDescription: "澄清目标与约束，将复杂工作拆分为里程碑和可执行任务。",
      displayCapabilities: ["Planning"],
      defaultPrompts: [
        "帮我把这个目标拆解成可执行的任务计划。",
        "梳理这个项目的里程碑、依赖和主要风险。",
        "为这项工作补充清晰的验收标准。",
      ],
      skills: [{
        id: "task-planning",
        name: "task-planning",
        description: "测试规划技能",
      }],
    })
    expect(result.plugins).toContainEqual(expect.objectContaining({
      id: "invalid-plugin",
      status: "invalid",
      installed: false,
    }))

    const skillService = new SkillService({
      pluginSkillRoots: () => service.enabledSkillRoots(),
    })
    const catalog = await skillService.scan({
      workspaceRoot: userHome,
      dataRoot: userHome,
      userHome,
      includeWorkspace: false,
    })
    expect(catalog.skills).toEqual([expect.objectContaining({
      name: "task-planning",
      path: "plugin://task-planning/skills/task-planning/SKILL.md",
      format: "codex",
    })])
  })

  test("persists idempotent enablement state and rejects operation conflicts", async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, "plugins")
    const userHome = join(root, "home")
    await mkdir(userHome, { recursive: true })
    await writePlugin({ root: builtinPluginsRoot, id: "task-planning", extension: true })
    const database = settingsDatabase()
    const repository = new PluginSettingsRepository(database)
    const service = new PluginManagementService(repository, { builtinPluginsRoot, userHome })
    await service.list()
    const emitted: Array<{ method: string; params: unknown }> = []
    const runtime = {
      dependencies: { plugins: service },
      emit: async (method: string, params: unknown) => {
        emitted.push({ method, params })
      },
    } as unknown as RpcRouter

    const handlerDetails = await pluginHandlers.handle(runtime, "plugin/getDetails", {
      pluginId: "task-planning",
      workspace: userHome,
    }, {})
    expect(() => Schema.decodeUnknownSync(PluginGetDetailsResultSchema)(handlerDetails)).not.toThrow()

    const disabled = await pluginHandlers.handle(runtime, "plugin/setEnabled", {
      pluginId: "task-planning",
      enabled: false,
      operationId: "operation-1",
    }, {}) as { plugin: { enabled: boolean }; generation: number }
    expect(disabled.plugin.enabled).toBe(false)
    expect((database.values.get("plugins.runtime.v1") as { disabledPluginIds: string[] }).disabledPluginIds)
      .toEqual(["task-planning"])
    await pluginHandlers.handle(runtime, "plugin/setEnabled", {
      pluginId: "task-planning",
      enabled: false,
      operationId: "operation-1",
    }, {})
    expect(emitted).toEqual([{
      method: "plugins/updated",
      params: { generation: disabled.generation },
    }])
    expect(await service.enabledSkillRoots()).toEqual([])

    expect(() => repository.setEnabled({
      pluginId: "task-planning",
      enabled: true,
      operationId: "operation-1",
    })).toThrow(PluginSettingsConflictError)
  })

  test("falls back optional details and rejects out-of-root Skill paths without disclosure", async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, "plugins")
    const userHome = join(root, "home")
    await mkdir(userHome, { recursive: true })
    await writePlugin({
      root: builtinPluginsRoot,
      id: "fallback-planner",
      extension: true,
      details: false,
    })
    const outsideRoot = join(root, "outside-skills")
    await mkdir(join(outsideRoot, "unsafe"), { recursive: true })
    await writeFile(join(outsideRoot, "unsafe", "SKILL.md"), "TOP_SECRET_SKILL_CONTENT", "utf8")
    await writePlugin({
      root: builtinPluginsRoot,
      id: "unsafe-planner",
      extension: true,
      skillsPath: "../../../outside-skills",
    })
    const service = new PluginManagementService(
      new PluginSettingsRepository(settingsDatabase()),
      { builtinPluginsRoot, userHome },
    )

    expect((await service.getDetails({ pluginId: "fallback-planner" })).details).toMatchObject({
      longDescription: "拆解和规划复杂工作",
      displayCapabilities: [],
      defaultPrompts: [],
    })
    const unsafe = (await service.getDetails({ pluginId: "unsafe-planner" })).details
    expect(unsafe.skills).toEqual([])
    expect(JSON.stringify(unsafe)).not.toContain("TOP_SECRET_SKILL_CONTENT")
    expect(JSON.stringify(unsafe)).not.toContain(root)
  })

  test("discovers local marketplace sources without marking them installed", async () => {
    const root = await temporaryRoot()
    const builtinPluginsRoot = join(root, "bundled")
    const userHome = join(root, "home")
    const personalPluginRoot = join(userHome, "plugins")
    await mkdir(builtinPluginsRoot, { recursive: true })
    await writePlugin({ root: personalPluginRoot, id: "personal-planner" })
    const marketplaceDirectory = join(userHome, ".agents", "plugins")
    await mkdir(marketplaceDirectory, { recursive: true })
    await writeFile(join(marketplaceDirectory, "marketplace.json"), JSON.stringify({
      name: "personal",
      plugins: [{
        name: "personal-planner",
        source: { source: "local", path: "./plugins/personal-planner" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity",
      }],
    }), "utf8")
    const service = new PluginManagementService(
      new PluginSettingsRepository(settingsDatabase()),
      { builtinPluginsRoot, userHome },
    )

    expect((await service.list()).plugins).toEqual([expect.objectContaining({
      id: "personal-planner",
      source: "personal",
      installed: false,
      enabled: false,
      status: "ready",
    })])
  })
})
