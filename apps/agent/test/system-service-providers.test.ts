import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { SystemProfileLoader, PENDING_SYSTEM_PROFILE_KEY } from "../src/plugin/system/SystemProfileLoader"
import { SystemServiceRegistry } from "../src/plugin/system/SystemServiceRegistry"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-system-provider-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  const registry = new SystemServiceRegistry()
  const loader = new SystemProfileLoader(db, registry)
  return { root, db, installer, repo, loader, registry }
}

const installProvider = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  bundle: string,
  id: string,
  provides: string[],
) => {
  const built = makePluginPackage([{ path: "plugin.ts", content: bundle }], {
    id,
    version: "1.0.0",
    tier: "system",
    runtime: { kind: "system", entry: "plugin.ts" },
    contributes: {
      services: provides.map((key) => ({
        key,
        version: "1.0.0",
        methods: { ping: { input: { type: "object" }, output: { type: "object" } } },
      })),
    },
  })
  const archive = join(installer.packagesRoot(), `${id}.cpxplugin`)
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant(id, installed.digest, "__digest__", true)
  return installed
}

const MODEL_RUNTIME_BUNDLE = `export default {
  id: "acme.model-provider",
  version: "1.0.0",
  displayName: "测试模型 Provider",
  provides: ["codepilotx.model-runtime@1"],
  requires: {},
  register: (context) => {
    context.registerProvider("codepilotx.model-runtime@1", {
      listCatalog: async () => ({
        providers: [{ id: "fixture-provider", name: "Fixture Provider" }],
        models: [{
          providerID: "fixture-provider",
          id: "fixture-model",
          name: "Fixture Model",
          enabled: true,
          capabilities: { input: ["text"], output: ["text"] },
        }],
      }),
      resolveModel: async () => ({ ok: true }),
    })
    return undefined
  },
}
`

const TOOL_RUNTIME_BUNDLE = `export default {
  id: "acme.tool-provider",
  version: "1.0.0",
  displayName: "测试工具 Provider",
  provides: ["codepilotx.tool-runtime@1"],
  requires: {},
  register: (context) => {
    context.registerProvider("codepilotx.tool-runtime@1", {
      listTools: () => [{
        sdkName: "fixture-tool",
        description: "fixture 工具",
        inputSchema: { type: "object" },
      }],
    })
    return undefined
  },
}
`

describe("System service providers（PR 8A）", () => {
  test("默认实现：无激活 provider 时 registry 返回 null（行为不变）", async () => {
    const { db, registry } = await fixture()
    expect(registry.resolve("codepilotx.model-runtime@1")).toBeNull()
    expect(registry.providerOf("codepilotx.model-runtime@1")).toBeNull()
    expect(registry.summary()).toEqual([])
    db.close()
  })

  test("model-runtime provider 激活后注册进 registry，覆盖默认", async () => {
    const { db, installer, repo, loader, registry } = await fixture()
    const installed = await installProvider(installer, repo, MODEL_RUNTIME_BUNDLE, "acme.model-provider", ["codepilotx.model-runtime@1"])
    const generationId = `gen-model`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.model-provider",
      kind: "system",
      version: "1.0.0",
      digest: installed.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const boot = await loader.bootAttempt()
    expect(boot.ok).toBe(true)
    const provider = registry.resolve<{ listCatalog: () => Promise<{ models: Array<{ id: string }> }> }>("codepilotx.model-runtime@1")
    expect(provider).not.toBeNull()
    expect(registry.providerOf("codepilotx.model-runtime@1")).toBe("acme.model-provider")
    const catalog = await provider!.listCatalog()
    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0]!.id).toBe("fixture-model")
    await loader.dispose()
    db.close()
  })

  test("tool-runtime provider 激活后提供自定义工具目录", async () => {
    const { db, installer, repo, loader, registry } = await fixture()
    const installed = await installProvider(installer, repo, TOOL_RUNTIME_BUNDLE, "acme.tool-provider", ["codepilotx.tool-runtime@1"])
    const generationId = `gen-tool`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.tool-provider",
      kind: "system",
      version: "1.0.0",
      digest: installed.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const boot = await loader.bootAttempt()
    expect(boot.ok).toBe(true)
    const provider = registry.resolve<{ listTools: () => Array<{ sdkName: string }> }>("codepilotx.tool-runtime@1")
    expect(provider).not.toBeNull()
    const tools = provider!.listTools()
    expect(tools[0]!.sdkName).toBe("fixture-tool")
    await loader.dispose()
    db.close()
  })

  test("provider 注册缺失（声明了但未注册）时激活失败，不破坏 last-good", async () => {
    const { db, installer, repo, loader, registry } = await fixture()
    const bundle = `export default {
      id: "acme.bad-provider",
      version: "1.0.0",
      displayName: "坏 Provider",
      provides: ["codepilotx.model-runtime@1"],
      requires: {},
      register: () => undefined,
    }
`
    const installed = await installProvider(installer, repo, bundle, "acme.bad-provider", ["codepilotx.model-runtime@1"])
    const generationId = `gen-bad`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.bad-provider",
      kind: "system",
      version: "1.0.0",
      digest: installed.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const boot = await loader.bootAttempt()
    expect(boot.ok).toBe(false)
    // 未激活：registry 保持默认（无 provider），last-good 不受影响。
    expect(registry.resolve("codepilotx.model-runtime@1")).toBeNull()
    const generation = repo.listGenerations("acme.bad-provider", "system").find((row) => row.id === generationId)
    expect(generation?.status).toBe("staged")
    db.close()
  })
})
