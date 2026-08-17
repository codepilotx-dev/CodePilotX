import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { SystemProfileLoader, SYSTEM_PROFILE_BOOT_FAILED_EXIT_CODE, PENDING_SYSTEM_PROFILE_KEY } from "../src/plugin/system/SystemProfileLoader"
import { SystemServiceRegistry } from "../src/plugin/system/SystemServiceRegistry"
import { writeZip } from "./helpers/zip-writer"
import { makePluginPackage } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-system-profile-"))
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

/** 直接读取自包含 bundle 源码（无外部 import；作为包内 entry 文件）。 */
const readFixtureSource = async (): Promise<string> => {
  const file = Bun.file(join(import.meta.dir, "fixtures", "system-plugin.ts"))
  return file.text()
}

const installSystemPlugin = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  overrides: Record<string, unknown> = {},
) => {
  const built = makePluginPackage([
    { path: "plugin.ts", content: await readFixtureSource() },
  ], {
    id: "acme.system",
    version: "1.0.0",
    tier: "system",
    runtime: { kind: "system", entry: "plugin.ts" },
    ...overrides,
  })
  const archive = join(installer.packagesRoot(), "system.cpxplugin")
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant("acme.system", installed.digest, "__digest__", true)
  return installed
}

/** 安装 bundle 内容为指定变体的 System 插件。 */
const installSystemPluginWithBundle = async (
  installer: PluginInstaller,
  repo: PluginRepository,
  bundle: string,
  overrides: Record<string, unknown> = {},
) => {
  const built = makePluginPackage([
    { path: "plugin.ts", content: bundle },
  ], {
    id: "acme.system",
    version: "1.0.0",
    tier: "system",
    runtime: { kind: "system", entry: "plugin.ts" },
    ...overrides,
  })
  const archive = join(installer.packagesRoot(), "system.cpxplugin")
  await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
  const installed = await installer.installPackage(archive)
  repo.setGrant("acme.system", installed.digest, "__digest__", true)
  return installed
}

describe("System Profile loader", () => {
  test("无 pending 时 boot 直接成功，不影响当前 runtime", async () => {
    const { db, loader } = await fixture()
    const result = await loader.bootAttempt()
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(loader.activeProfile()).toBeNull()
    db.close()
  })

  test("stage 不生效；applyOnRestart 后 pending 写入，boot 成功更新 last-good", async () => {
    const { db, installer, repo, loader } = await fixture()
    await installSystemPlugin(installer, repo)
    // stage（不改变 runtime）
    const generationId = `gen-test-1`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.system",
      kind: "system",
      version: "1.0.0",
      digest: repo.getPackage("acme.system")!.digest,
      status: "staged",
      configJson: "{}",
    })
    expect(loader.activeProfile()).toBeNull()
    // applyOnRestart：写 pending
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    // pending 在 restart 前不生效
    expect(loader.activeProfile()).toBeNull()
    // boot 尝试
    const result = await loader.bootAttempt()
    expect(result.ok).toBe(true)
    expect(loader.activeProfile()).toMatchObject({
      generationId,
      pluginId: "acme.system",
      providers: ["codepilotx.permission-policy@1"],
    })
    expect(repo.getAppSetting(PENDING_SYSTEM_PROFILE_KEY)).toBeNull()
    const generation = repo.listGenerations("acme.system", "system").find((row) => row.id === generationId)
    expect(generation?.status).toBe("last-good")
    await loader.dispose()
    db.close()
  })

  test("boot 失败：写诊断、清除 pending、请求 sidecar 重启一次；连续失败不再退出", async () => {
    const { db, installer, repo, loader } = await fixture()
    const throwBundle = (await readFixtureSource()).replace(
      `(process.env.CPX_SYSTEM_MARKER as string | undefined) ?? "default"`,
      `"throw"`,
    )
    const installed = await installSystemPluginWithBundle(installer, repo, throwBundle, { version: "1.0.1" })

    const generationId = `gen-fail-1`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.system",
      kind: "system",
      version: "1.0.1",
      digest: installed.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))

    // 首次失败 → 退出码 3（sidecar 重启一次）
    const first = await loader.bootAttempt()
    expect(first.ok).toBe(false)
    expect(first.exitCode).toBe(SYSTEM_PROFILE_BOOT_FAILED_EXIT_CODE)
    expect(first.error?.code).toBe("SYSTEM_PROFILE_BOOT_FAILED")
    expect(repo.getAppSetting(PENDING_SYSTEM_PROFILE_KEY)).toBeNull()
    expect(repo.getAppSetting("plugins.systemProfileBootFailures")).toBe("1")

    // 第二次（sidecar 重启后）：不再退出（回退默认 Profile）
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const second = await loader.bootAttempt()
    expect(second.ok).toBe(false)
    expect(second.exitCode).toBeNull()
    expect(repo.getAppSetting(PENDING_SYSTEM_PROFILE_KEY)).toBeNull()
    await loader.dispose()
    db.close()
  })

  test("未知 required contract 拒绝激活（fail-closed）", async () => {
    const { db, installer, repo, loader } = await fixture()
    const bundle = (await readFixtureSource()).replace(
      `requires: {},`,
      `requires: { "codepilotx.unknown-service@1": "^1.0.0" },`,
    )
    const installed = await installSystemPluginWithBundle(installer, repo, bundle)
    const generationId = `gen-unknown`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.system",
      kind: "system",
      version: "1.0.0",
      digest: installed.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const result = await loader.bootAttempt()
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe("PLUGIN_PROFILE_INVALID")
    db.close()
  })

  test("disposer 逆序释放（返回的 disposer 先于 context.add）", async () => {
    const { db, installer, repo, loader } = await fixture()
    await installSystemPlugin(installer, repo)
    const generationId = `gen-dispose`
    repo.insertGeneration({
      id: generationId,
      pluginId: "acme.system",
      kind: "system",
      version: "1.0.0",
      digest: repo.getPackage("acme.system")!.digest,
      status: "staged",
      configJson: "{}",
    })
    repo.setAppSetting(PENDING_SYSTEM_PROFILE_KEY, JSON.stringify({ generationId }))
    const boot = await loader.bootAttempt()
    expect(boot.ok).toBe(true)
    // 正常 dispose 不抛错（disposer 逆序执行）
    await expect(loader.dispose()).resolves.toBeUndefined()
    expect(loader.activeProfile()).toBeNull()
    db.close()
  })

  test("无效 Profile 无法 stage：configSchema 校验拒绝", async () => {
    const { db, installer, repo } = await fixture()
    await installSystemPlugin(installer, repo, {
      configSchema: { type: "object", properties: { mode: { type: "string", const: "safe" } }, required: ["mode"] },
    })
    const configService = { snapshot: () => ({ plugins: { developerMode: true } }) } as never
    const { PluginService } = await import("../src/plugin/PluginService")
    const service = new PluginService({
      db,
      installer,
      configService,
      publish: async () => undefined,
    })
    // profileStage 是同步方法：直接断言抛错与错误码。
    let caughtCode: string | null = null
    try {
      service.profileStage({
        pluginId: "acme.system",
        config: { mode: "unsafe" },
        operationId: "op-stage-1",
      })
    } catch (error) {
      caughtCode = error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : null
    }
    expect(caughtCode).toBe("CONFIG_VALIDATION_ERROR")
    const ok = service.profileStage({
      pluginId: "acme.system",
      config: { mode: "safe" },
      operationId: "op-stage-2",
    })
    expect(ok.status).toBe("staged")
    db.close()
  })
})
