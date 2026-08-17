import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { PluginRuntimeManager } from "../src/plugin/runtime/manager"
import { PluginContributionAdapter } from "../src/plugin/contributions/adapter"
import { createPluginBroker } from "../src/plugin/contributions/broker"
import { PluginService } from "../src/plugin/PluginService"
import { McpConfigService } from "../src/mcp/McpConfigService"
import { SkillService } from "../src/prompt/SkillService"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const runnerSource = () => readFile(join(import.meta.dir, "fixtures", "plugin-runner.ts"), "utf8")

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-contrib-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  const manager = new PluginRuntimeManager({
    db,
    installer,
    publish: async () => undefined,
    initializeTimeoutMs: 500,
  })
  const adapter = new PluginContributionAdapter({ db, manager })
  manager.setBrokerProvider((pluginId) => createPluginBroker({ pluginId, repo, manager }))
  return { root, db, installer, repo, manager, adapter }
}

/** 安装 full-stack runner 包（贡献全部 7 类声明）。 */
const installFullStack = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  overrides: Record<string, unknown> = {},
) => {
  const runner = (await runnerSource()).replace('process.env.CPX_MODE ?? "normal"', '"normal"')
  const skillMarkdown = "---\nname: plugin-skill\ndescription: 插件技能\n---\n\n技能正文\n"
  const built = makePluginPackage([
    { path: "runner.ts", content: runner },
    { path: "skills/plugin-skill/SKILL.md", content: skillMarkdown },
  ], {
    id: "acme.fullstack",
    version: "1.0.0",
    runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "runner.ts" },
    contributes: {
      tools: [{
        name: "hello",
        description: "打招呼",
        inputSchema: { type: "object", properties: { name: { type: "string" } } },
      }],
      skills: [{ root: "skills/plugin-skill" }],
      mcpServers: [{
        name: "fixture-mcp",
        transport: { kind: "stdio", command: "bun", args: ["mcp.ts"] },
        toolPolicy: { allow: ["read"] },
      }],
      promptCommands: [{ id: "hello", title: "打招呼", promptTemplate: "请向用户问好" }],
      settings: [{ key: "greeting", title: "问候语", control: "string", default: "你好" }],
      workbenchViews: [{ id: "hello-view", title: "Hello" }],
      services: [{
        key: "acme.counter@1",
        version: "1.0.0",
        methods: { increment: { input: { type: "object" }, output: { type: "object" } } },
      }],
    },
    ...overrides,
  })
  const archive = join(installer.packagesRoot(), "fullstack.cpxplugin")
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant("acme.fullstack", installed.digest, "__digest__", true)
  repo.setActivation("acme.fullstack", "", true)
  return installed
}

const describeContributions = describe

describe("插件贡献目录", () => {
  test("full-stack 插件贡献全部 7 类声明", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    expect(manager.status("acme.fullstack")).toBe("active")

    const list = adapter.contributionList()
    expect(list.tools).toHaveLength(1)
    expect(list.tools[0]!.pluginId).toBe("acme.fullstack")
    expect(list.skills).toHaveLength(1)
    expect(list.mcpServers).toHaveLength(1)
    expect(list.promptCommands).toHaveLength(1)
    expect(list.settings).toHaveLength(1)
    expect(list.workbenchViews).toHaveLength(1)

    // MCP 转换（provenance + 唯一名）
    const mcp = adapter.mcpDeclarations()
    expect(mcp).toHaveLength(1)
    expect(mcp[0]!.pluginId).toBe("acme.fullstack")
    expect(mcp[0]!.name).toBe("acme.fullstack.fixture-mcp")
    expect(mcp[0]!.declaration.transport).toMatchObject({ type: "stdio", command: "bun" })

    // 命令触发器
    const triggers = adapter.commandTriggers()
    expect(triggers[0]!.trigger).toBe("plugin:acme.fullstack:hello")

    // Skill bases（containment = 包根）
    const bases = adapter.skillBases()
    expect(bases).toHaveLength(1)
    expect(bases[0]!.pluginId).toBe("acme.fullstack")
    await manager.dispose()
    db.close()
  })

  test("disable 后贡献全部撤销；update 后新 turn 使用新定义", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    expect(adapter.contributionList().tools).toHaveLength(1)

    // disable → 撤销
    repo.setActivation("acme.fullstack", "", false)
    await manager.reconcile()
    expect(adapter.contributionList().tools).toHaveLength(0)

    // update（v2 改名工具）→ 新定义
    await installFullStack(installer, repo, { version: "1.0.1" })
    await manager.reconcile()
    // 重新 enable（digest 变化重置 disabled）
    repo.setActivation("acme.fullstack", "", true)
    await manager.reconcile()
    expect(adapter.contributionList().tools).toHaveLength(1)
    await manager.dispose()
    db.close()
  })

  test("插件工具定义：默认 policy 审批、外部状态默认 true、origin 记录 provenance", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    const builders: Array<{ kind: string; value: unknown }> = []
    adapter.registerTurnContributions({
      addToolDefinition: (definition) => { builders.push({ kind: "tool", value: definition }) },
      addPromptSection: () => undefined,
      addGuard: () => undefined,
      addObserver: () => undefined,
      addInterceptor: () => undefined,
    })
    const tool = builders[0]!.value as { approvalStrategy: string; capabilities: { externalState: boolean }; origin: { kind: string; pluginId: string }; sdkName: string }
    expect(tool.sdkName).toBe("plugin.acme.fullstack.hello")
    expect(tool.approvalStrategy).toBe("policy")
    expect(tool.capabilities.externalState).toBe(true)
    expect(tool.origin).toMatchObject({ kind: "plugin", pluginId: "acme.fullstack" })
    await manager.dispose()
    db.close()
  })

  test("插件工具执行经 manager 转发 plugin/toolExecute", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    const builders: Array<{ kind: string; value: unknown }> = []
    adapter.registerTurnContributions({
      addToolDefinition: (definition) => { builders.push({ kind: "tool", value: definition }) },
      addPromptSection: () => undefined,
      addGuard: () => undefined,
      addObserver: () => undefined,
      addInterceptor: () => undefined,
    })
    const tool = builders[0]!.value as { execute: (input: unknown, context: unknown) => Promise<unknown> }
    const result = await tool.execute({ name: "world" }, {
      signal: new AbortController().signal,
      invocation: { toolCallID: "call-1" },
    })
    expect(result).toMatchObject({ echoed: { toolCallID: "call-1", toolName: "hello" } })
    await manager.dispose()
    db.close()
  })

  test("KV broker 按插件隔离：跨插件不可读", async () => {
    const { db, repo } = await fixture()
    const manager = { serviceProvider: () => null } as unknown as PluginRuntimeManager
    const brokerA = createPluginBroker({ pluginId: "acme.a", repo, manager })
    const brokerB = createPluginBroker({ pluginId: "acme.b", repo, manager })
    let response: unknown = undefined
    brokerA("host/kvPut", { key: "secret", value: "data-a", scope: "global" }, (result) => { response = result })
    expect(response).toEqual({ ok: true, version: 1 })
    brokerA("host/kvGet", { key: "secret", scope: "global" }, (result) => { response = result })
    expect(response).toBe("data-a")
    brokerB("host/kvGet", { key: "secret", scope: "global" }, (result) => { response = result })
    expect(response).toBeNull()
    db.close()
  })

  test("credentialUse 只返回 brokered reference，明文不跨 wire", async () => {
    const { db, repo } = await fixture()
    const manager = { serviceProvider: () => null } as unknown as PluginRuntimeManager
    repo.kvPut("acme.a", "global", "", "credential:api", JSON.stringify({ secret: "sk-123" }))
    const broker = createPluginBroker({ pluginId: "acme.a", repo, manager })
    let response: unknown = undefined
    broker("host/credentialUse", { slot: "api", purpose: "调用外部服务" }, (result) => { response = result })
    expect(response).toEqual({ granted: true, reference: "plugin:acme.a:api" })
    expect(JSON.stringify(response)).not.toContain("sk-123")
    db.close()
  })

  test("Settings：configSchema 校验拒绝无效配置", async () => {
    const { db, installer, repo } = await fixture()
    await installFullStack(installer, repo, {
      configSchema: { type: "object", properties: { greeting: { type: "string", maxLength: 5 } }, required: ["greeting"] },
    })
    const configService = { snapshot: () => ({ plugins: { developerMode: true } }) } as never
    const service = new PluginService({
      db,
      installer,
      configService,
      publish: async () => undefined,
    })
    await expect(service.configUpdate({
      pluginId: "acme.fullstack",
      config: { greeting: "x".repeat(10) },
      operationId: "op-cfg-1",
    })).rejects.toMatchObject({ code: "CONFIG_VALIDATION_ERROR" })
    const ok = await service.configUpdate({ pluginId: "acme.fullstack", config: { greeting: "你好" }, operationId: "op-cfg-2" })
    expect(ok.config).toEqual({ greeting: "你好" })
    db.close()
  })

  test("插件 Skill 进入 catalog（origin=plugin + pluginId），资源不能越出包根", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    const skillService = new SkillService()
    const catalog = await skillService.scan({
      workspaceRoot: tmpdir(),
      dataRoot: tmpdir(),
      userHome: tmpdir(),
      includeWorkspace: false,
      extraBases: adapter.skillBases(),
    })
    const skill = catalog.skills.find((entry) => entry.name === "plugin-skill")
    expect(skill).toBeDefined()
    expect(skill?.origin).toBe("plugin")
    expect(skill?.pluginId).toBe("acme.fullstack")
    // 资源读取越界拒绝（SkillService 既有 containment）
    await expect(skillService.read("plugin-skill")).resolves.toBeDefined()
    await expect(skillService.resolveResource("plugin-skill", "../../outside.txt")).rejects.toThrow()
    await manager.dispose()
    db.close()
  })

  test("MCP 声明合并进 McpConfigService（用户声明优先）", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    const configs = new McpConfigService(
      new (await import("../src/storage/repositories/mcp-settings-repository")).McpSettingsRepository(db),
      undefined,
      () => adapter.mcpDeclarations().map(({ name, pluginId, declaration }) => ({ name, pluginId, declaration: declaration as never })),
    )
    const list = await configs.list()
    const pluginServer = list.servers.find((item) => item.server.name === "acme.fullstack.fixture-mcp")
    expect(pluginServer).toBeDefined()
    expect(pluginServer?.effective).toBe(true)
    await manager.dispose()
    db.close()
  })

  test("贡献目录经 PluginService 暴露（contribution/list 数据源）", async () => {
    const { db, installer, repo, manager, adapter } = await fixture()
    await installFullStack(installer, repo)
    await manager.reconcile()
    const service = new PluginService({
      db,
      installer,
      configService: { snapshot: () => ({ plugins: { developerMode: true } }) } as never,
      publish: async () => undefined,
      contributionList: () => adapter.contributionList(),
    })
    const list = service.contributionList() as { tools: Array<{ pluginId: string }>; promptCommands: Array<{ pluginId: string }> }
    expect(list.tools).toHaveLength(1)
    expect(list.promptCommands).toHaveLength(1)
    await manager.dispose()
    db.close()
  })
})
