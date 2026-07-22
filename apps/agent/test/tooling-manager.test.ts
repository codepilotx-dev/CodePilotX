import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TOOLING_CATALOG, ToolingManager } from "../src/tool/ToolingManager"

const roots: string[] = []
const originalGitBash = process.env.CODEPILOTX_GIT_BASH_PATH
const originalRipgrep = process.env.CODEPILOTX_RIPGREP_PATH

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-tooling-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  process.env.CODEPILOTX_GIT_BASH_PATH = originalGitBash
  process.env.CODEPILOTX_RIPGREP_PATH = originalRipgrep
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("ToolingManager", () => {
  test("catalog 固定官方版本、HTTPS 下载和归档摘要", () => {
    expect(TOOLING_CATALOG["git-bash"].version).toBe("2.55.0.3")
    expect(TOOLING_CATALOG.ripgrep.version).toBe("15.2.0")
    for (const entry of Object.values(TOOLING_CATALOG)) {
      expect(new URL(entry.url).protocol).toBe("https:")
      expect(entry.archiveSha256).toMatch(/^[a-f\d]{64}$/)
    }
  })

  test("默认使用托管版并将独立来源偏好持久化到 tooling home", async () => {
    const root = await temporaryRoot()
    process.env.CODEPILOTX_GIT_BASH_PATH = join(root, "missing-bash.exe")
    process.env.CODEPILOTX_RIPGREP_PATH = join(root, "missing-rg.exe")
    const manager = new ToolingManager({ root })

    const initial = await manager.listStatuses()
    expect(initial.map((status) => [status.id, status.preference])).toEqual([
      ["git-bash", "managed"],
      ["ripgrep", "managed"],
    ])
    await manager.setPreference("git-bash", "system")

    const reloaded = new ToolingManager({ root })
    expect((await reloaded.getStatus("git-bash")).preference).toBe("system")
    expect((await reloaded.getStatus("ripgrep")).preference).toBe("managed")
    const saved = JSON.parse(await readFile(join(root, "v1", "settings.json"), "utf8"))
    expect(saved.preferences).toEqual({ "git-bash": "system", ripgrep: "managed" })
  })

  test("损坏或未知的设置值会安全恢复为托管偏好", async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, "v1"), { recursive: true })
    await writeFile(join(root, "v1", "settings.json"), JSON.stringify({ version: 999, preferences: { "git-bash": "other", ripgrep: 1 } }), "utf8")
    const manager = new ToolingManager({ root })
    const statuses = await manager.listStatuses()
    expect(statuses.every((status) => status.preference === "managed")).toBe(true)
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
