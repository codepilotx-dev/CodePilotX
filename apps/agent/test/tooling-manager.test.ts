import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TOOLING_CATALOG, ToolingManager } from "../src/tool/ToolingManager"

const roots: string[] = []
const originalGitBash = process.env.CODEPILOTX_GIT_BASH_PATH
const originalRipgrep = process.env.CODEPILOTX_RIPGREP_PATH
const originalNodejs = process.env.CODEPILOTX_NODEJS_PATH
const originalPython = process.env.CODEPILOTX_PYTHON_PATH

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-tooling-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  process.env.CODEPILOTX_GIT_BASH_PATH = originalGitBash
  process.env.CODEPILOTX_RIPGREP_PATH = originalRipgrep
  process.env.CODEPILOTX_NODEJS_PATH = originalNodejs
  process.env.CODEPILOTX_PYTHON_PATH = originalPython
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ToolingManager", () => {
  test("catalog 固定官方版本、HTTPS 下载和归档摘要", () => {
    expect(TOOLING_CATALOG["git-bash"].version).toBe("2.55.0.3")
    expect(TOOLING_CATALOG.ripgrep.version).toBe("15.2.0")
    expect(TOOLING_CATALOG.nodejs).toMatchObject({
      version: "24.18.0",
      archiveSha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
    })
    expect(TOOLING_CATALOG.python).toMatchObject({
      version: "3.14.6",
      archiveSha256: "14b3e9a710a3fcf0bd9b55ab6b60412bd91227563f813fc49040cabc0209e0bd",
    })
    for (const entry of Object.values(TOOLING_CATALOG)) {
      expect(new URL(entry.url).protocol).toBe("https:")
      expect(entry.archiveSha256).toMatch(/^[a-f\d]{64}$/)
    }
  })

  test("默认使用托管版并将独立来源偏好持久化到 tooling home", async () => {
    const root = await temporaryRoot()
    process.env.CODEPILOTX_GIT_BASH_PATH = join(root, "missing-bash.exe")
    process.env.CODEPILOTX_RIPGREP_PATH = join(root, "missing-rg.exe")
    process.env.CODEPILOTX_NODEJS_PATH = join(root, "missing-node.exe")
    process.env.CODEPILOTX_PYTHON_PATH = join(root, "missing-python.exe")
    const manager = new ToolingManager({ root })

    const initial = await manager.listStatuses()
    expect(initial.map((status) => [status.id, status.preference])).toEqual([
      ["nodejs", "managed"],
      ["python", "managed"],
      ["git-bash", "managed"],
      ["ripgrep", "managed"],
    ])
    await Promise.all([
      manager.setPreference("nodejs", "system"),
      manager.setPreference("python", "system"),
      manager.setPreference("git-bash", "system"),
    ])

    const reloaded = new ToolingManager({ root })
    expect((await reloaded.getStatus("nodejs")).preference).toBe("system")
    expect((await reloaded.getStatus("python")).preference).toBe("system")
    expect((await reloaded.getStatus("git-bash")).preference).toBe("system")
    expect((await reloaded.getStatus("ripgrep")).preference).toBe("managed")
    const saved = JSON.parse(await readFile(join(root, "v2", "settings.json"), "utf8"))
    expect(saved.preferences).toEqual({ nodejs: "system", python: "system", "git-bash": "system", ripgrep: "managed" })
  })

  test("v1 偏好与旧统一依赖开关会迁移到四项 v2 设置", async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, "v1"), { recursive: true })
    await writeFile(join(root, "v1", "settings.json"), JSON.stringify({
      version: 1,
      installCodePilotXDependencies: false,
      preferences: { "git-bash": "system", ripgrep: "managed" },
    }), "utf8")
    const manager = new ToolingManager({ root })
    const statuses = await manager.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: "system",
      python: "system",
      "git-bash": "system",
      ripgrep: "managed",
    })
  })

  test("显式旧依赖偏好仅迁移 Node.js 与 Python", async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root, legacyInstallCodePilotXDependencies: false })
    const statuses = await manager.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: "system",
      python: "system",
      "git-bash": "managed",
      ripgrep: "managed",
    })
  })

  test("四项偏好并发更新时按顺序原子持久化且互不覆盖", async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root })
    await Promise.all([
      manager.setPreference("nodejs", "system"),
      manager.setPreference("python", "system"),
      manager.setPreference("git-bash", "system"),
    ])

    const reloaded = new ToolingManager({ root })
    const statuses = await reloaded.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: "system",
      python: "system",
      "git-bash": "system",
      ripgrep: "managed",
    })
  })

  test("resolveEnvironment 对缺失依赖保留逐项结果且不注入 PATH", async () => {
    const root = await temporaryRoot()
    process.env.CODEPILOTX_NODEJS_PATH = join(root, "missing-node.exe")
    process.env.CODEPILOTX_PYTHON_PATH = join(root, "missing-python.exe")
    const manager = new ToolingManager({ root })
    await manager.setPreference("nodejs", "system")
    await manager.setPreference("python", "system")

    const environment = await manager.resolveEnvironment(["nodejs", "python", "nodejs"])
    expect(environment.pathEntries).toEqual([])
    expect([...environment.resolutions.keys()]).toEqual(["nodejs", "python"])
    expect(environment.resolutions.get("nodejs")?.available).toBe(false)
    expect(environment.resolutions.get("python")?.available).toBe(false)
  })

  test("并发安装共用下载且摘要失败不会留下 staging 半成品", async () => {
    const root = await temporaryRoot()
    process.env.CODEPILOTX_RIPGREP_PATH = join(root, "missing-rg.exe")
    let requests = 0
    const manager = new ToolingManager({
      root,
      fetch: (async () => {
        requests += 1
        return new Response("tampered archive", { status: 200, headers: { "content-length": "16" } })
      }) as unknown as typeof fetch,
    })

    const results = await Promise.allSettled([
      manager.install("ripgrep", { force: true }),
      manager.install("ripgrep", { force: true }),
    ])
    expect(requests).toBe(1)
    expect(results.every((result) => result.status === "rejected")).toBe(true)
    expect((await manager.getStatus("ripgrep")).error?.code).toBe("TOOLING_CHECKSUM_MISMATCH")
    expect(await readdir(join(root, ".staging"))).toEqual([])
  })
})
