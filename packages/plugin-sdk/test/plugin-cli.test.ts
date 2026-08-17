import { describe, expect, test, afterEach } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { packPluginDirectory } from "../src/pack"

const cliPath = join(import.meta.dir, "../scripts/plugin-cli.ts")
const runnerFixturePath = join(import.meta.dir, "../fixtures/runner-fixture.ts")

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const runCli = async (args: string[]) => {
  const proc = Bun.spawn({
    cmd: [process.execPath, cliPath, ...args],
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

const fixtureManifest = () => JSON.stringify({
  schemaVersion: 1,
  id: "acme.hello",
  version: "1.0.0",
  displayName: "Hello",
  description: "cli fixture",
  publisher: "acme",
  engines: { pluginApi: "^1" },
  tier: "application",
  runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "runner.ts" },
  files: {},
})

describe("plugin-cli", () => {
  test("validate：合法 manifest 退出 0 并打印 id@version", async () => {
    const root = await mkdtemp(join(tmpdir(), "cpx-cli-"))
    roots.push(root)
    const manifestPath = join(root, "manifest.json")
    await writeFile(manifestPath, fixtureManifest(), "utf8")
    const { exitCode, stdout } = await runCli(["validate", manifestPath])
    expect(exitCode).toBe(0)
    expect(stdout).toContain("✓ 合法：acme.hello@1.0.0")
  })

  test("validate：非法 manifest 退出 1 且只输出安全错误码", async () => {
    const root = await mkdtemp(join(tmpdir(), "cpx-cli-"))
    roots.push(root)
    const manifestPath = join(root, "manifest.json")
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, id: "BAD" }), "utf8")
    const { exitCode, stderr } = await runCli(["validate", manifestPath])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("INVALID_MANIFEST")
    expect(stderr).not.toContain("BAD")
  })

  test("pack：打包成功并输出 digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "cpx-cli-"))
    roots.push(root)
    const directory = join(root, "plugin")
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, "manifest.json"), fixtureManifest(), "utf8")
    await writeFile(join(directory, "runner.ts"), "console.log('hi')", "utf8")
    const outputPath = join(root, "out.cpxplugin")
    const { exitCode, stdout } = await runCli(["pack", directory, "-o", outputPath])
    expect(exitCode).toBe(0)
    expect(stdout).toContain("✓ 已打包")
    expect(stdout).toMatch(/digest：[0-9a-f]{64}/)
    // CLI 产物与库函数产物一致（同一 digest 公式）。
    const viaLib = await packPluginDirectory({ directory, outputPath: join(root, "out2.cpxplugin") })
    expect(stdout).toContain(viaLib.digest)
  })

  test("conformance:runner：合规 runner 退出 0，全部检查通过", async () => {
    const { exitCode, stdout } = await runCli([
      "conformance:runner", process.execPath, runnerFixturePath,
      "--plugin-id", "acme.hello", "--generation", "g-1",
    ])
    expect(exitCode).toBe(0)
    expect(stdout).toContain("runner conformance 全部通过")
  })

  test("未知命令退出 1 并打印支持列表", async () => {
    const { exitCode, stderr } = await runCli(["nope"])
    expect(exitCode).toBe(1)
    expect(stderr).toContain("validate/pack/conformance:runner/conformance:persistence")
  })
})
