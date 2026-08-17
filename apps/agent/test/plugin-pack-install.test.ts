import { describe, expect, test, afterEach } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { packPluginDirectory } from "@codepilotx/plugin-sdk"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller } from "../src/plugin/installer"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const manifestJson = () => JSON.stringify({
  schemaVersion: 1,
  id: "acme.hello",
  version: "1.0.0",
  displayName: "Hello",
  description: "pack-install 契约 fixture",
  publisher: "acme",
  engines: { pluginApi: "^1" },
  tier: "application",
  runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "runner.ts" },
  files: {},
})

describe("SDK pack 与宿主安装契约", () => {
  test("SDK 打出的 .cpxplugin 可被宿主安装，digest 与包侧一致", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pack-install-"))
    roots.push(root)
    const source = join(root, "source")
    await mkdir(join(source, "assets"), { recursive: true })
    await writeFile(join(source, "manifest.json"), manifestJson(), "utf8")
    await writeFile(join(source, "runner.ts"), "console.log('hello')\n", "utf8")
    await writeFile(join(source, "assets/icon.svg"), "<svg/>", "utf8")

    const packed = await packPluginDirectory({ directory: source })

    const db = new AgentDatabase({
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    })
    const pluginRoot = join(root, "plugins")
    await mkdir(pluginRoot, { recursive: true })
    const installer = new PluginInstaller({ root: pluginRoot, db })
    const installed = await installer.installPackage(packed.outputPath)
    expect(installed.pluginId).toBe("acme.hello")
    expect(installed.source).toBe("package")
    expect(installed.digest).toBe(packed.digest)
    db.close()
  })

  test("宿主重算 digest 与 SDK 包侧一致（公式完全对齐）", async () => {
    const root = await mkdtemp(join(tmpdir(), "codepilotx-pack-install-"))
    roots.push(root)
    const source = join(root, "source")
    await mkdir(source, { recursive: true })
    await writeFile(join(source, "manifest.json"), manifestJson(), "utf8")
    await writeFile(join(source, "runner.ts"), "v1", "utf8")

    const packed = await packPluginDirectory({ directory: source })

    const db = new AgentDatabase({
      historyPath: join(root, "history.sqlite"),
      profilePath: join(root, "profile.sqlite"),
    })
    const pluginRoot = join(root, "plugins")
    await mkdir(pluginRoot, { recursive: true })
    const installer = new PluginInstaller({ root: pluginRoot, db })
    await installer.installPackage(packed.outputPath)
    // 重复安装（宿主侧重新计算 digest）必须得到相同结果。
    const again = await installer.installPackage(packed.outputPath)
    expect(again.digest).toBe(packed.digest)
    db.close()
  })
})
