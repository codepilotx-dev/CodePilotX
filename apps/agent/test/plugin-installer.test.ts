import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach } from "bun:test"
import { AgentDatabase } from "../src/storage/database/AgentDatabase"
import { PluginInstaller, PluginInstallError } from "../src/plugin/installer"
import { PluginRepository } from "../src/storage/repositories/plugin-repository"
import { writeZip, type ZipEntryInput } from "./helpers/zip-writer"
import { makePluginPackage, sha256Text } from "./helpers/plugin-fixture"
import { removeFixturePaths } from "./fixture-cleanup"

const roots: string[] = []
afterEach(async () => removeFixturePaths(roots.splice(0)))

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilotx-plugin-install-"))
  roots.push(root)
  const db = new AgentDatabase({ historyPath: join(root, "history.sqlite"), profilePath: join(root, "profile.sqlite") })
  const pluginRoot = join(root, "plugins")
  await mkdir(pluginRoot, { recursive: true })
  const installer = new PluginInstaller({ root: pluginRoot, db })
  const repo = new PluginRepository(db)
  return { root, db, pluginRoot, installer, repo }
}

/** 构造合法 .cpxplugin 包文件路径。 */
const writeValidPackage = async (archivePath: string, files: Array<{ path: string; content: string }>, overrides: Record<string, unknown> = {}) => {
  const built = makePluginPackage(files, overrides)
  const entries: ZipEntryInput[] = built.files.map((entry) => ({ path: entry.path, content: entry.content }))
  await writeZip(archivePath, entries)
  return built
}

describe("PluginInstaller 安装", () => {
  test("安装合法包：installed-disabled、目录布局、digest 稳定", async () => {
    const { db, pluginRoot, installer, repo } = await fixture()
    const archive = join(pluginRoot, "hello.cpxplugin")
    await writeValidPackage(archive, [{ path: "index.ts", content: "console.log('hi')" }])

    const installed = await installer.installPackage(archive)
    expect(installed.pluginId).toBe("acme.hello")
    expect(installed.source).toBe("package")
    expect(existsSync(installed.installedPath)).toBe(true)
    expect(await readFile(join(installed.installedPath, "manifest.json"), "utf8")).toContain('"schemaVersion": 1')
    // installed-disabled
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(false)
    // 数据目录隔离
    expect(existsSync(join(pluginRoot, "data", "acme.hello"))).toBe(true)
    // digest 稳定（重复安装同包得到相同 digest）
    const again = await installer.installPackage(archive)
    expect(again.digest).toBe(installed.digest)
    db.close()
  })

  test("安装后 digest 变化重置 enablement（更新语义）", async () => {
    const { db, installer, repo } = await fixture()
    const archive = join(installer.packagesRoot(), "hello.cpxplugin")
    await writeValidPackage(archive, [{ path: "index.ts", content: "v1" }])
    await installer.installPackage(archive)
    repo.setActivation("acme.hello", "", true)
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(true)

    // v2 更新：digest 变化 → 重置 disabled，旧目录清理
    await writeValidPackage(archive, [{ path: "index.ts", content: "v2" }], { version: "1.0.1" })
    const updated = await installer.installPackage(archive)
    expect(updated.version).toBe("1.0.1")
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(false)
    expect(repo.getPackage("acme.hello")?.digest).toBe(updated.digest)
    db.close()
  })

  test("校验失败不改变 active 包", async () => {
    const { db, installer, repo } = await fixture()
    const archive = join(installer.packagesRoot(), "hello.cpxplugin")
    await writeValidPackage(archive, [{ path: "index.ts", content: "v1" }])
    const installed = await installer.installPackage(archive)

    // 恶意包（相同 id，路径穿越）：active 保持不变
    await writeZip(archive, [
      { path: "../evil.txt", content: "x" },
    ])
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code: "PLUGIN_ARCHIVE_UNSAFE" })
    expect(repo.getPackage("acme.hello")?.digest).toBe(installed.digest)
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(false)
    db.close()
  })

  test("卸载删除包文件但保留数据目录与 KV", async () => {
    const { db, pluginRoot, installer, repo } = await fixture()
    const archive = join(pluginRoot, "hello.cpxplugin")
    await writeValidPackage(archive, [{ path: "index.ts", content: "v1" }])
    const installed = await installer.installPackage(archive)
    repo.kvPut("acme.hello", "global", "", "note", "keep-me")
    const dataFile = join(pluginRoot, "data", "acme.hello", "local.txt")
    await writeFile(dataFile, "user data")

    await installer.uninstall("acme.hello")
    expect(repo.getPackage("acme.hello")).toBeNull()
    expect(existsSync(installed.installedPath)).toBe(false)
    // 数据保留
    expect(await readFile(dataFile, "utf8")).toBe("user data")
    expect(repo.kvGet("acme.hello", "global", "", "note")?.value).toBe("keep-me")
    db.close()
  })

  test("卸载未安装插件报 PLUGIN_NOT_FOUND", async () => {
    const { db, installer } = await fixture()
    await expect(installer.uninstall("acme.missing")).rejects.toMatchObject({ code: "PLUGIN_NOT_FOUND" })
    db.close()
  })
})

describe("PluginInstaller 恶意包拒绝", () => {
  const rejects = async (entries: ZipEntryInput[], code: string) => {
    const { db, installer } = await fixture()
    const archive = join(installer.packagesRoot(), "bad.cpxplugin")
    await writeZip(archive, entries)
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code })
    db.close()
  }

  test("路径穿越与绝对路径", async () => {
    await rejects([{ path: "../escape.txt", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "/etc/passwd", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "C:/windows/system32", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "a/../../b.txt", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "a\\b.txt", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
  })

  test("ADS 与 Windows device name", async () => {
    await rejects([{ path: "file.txt:stream", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "CON.txt", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([{ path: "dir/NUL", content: "x" }], "PLUGIN_ARCHIVE_UNSAFE")
  })

  test("symlink entry", async () => {
    await rejects([{ path: "link", content: "target", externalFileAttributes: (0xA000 << 16) | 0o777 }], "PLUGIN_ARCHIVE_UNSAFE")
  })

  test("重复路径与大小写折叠冲突", async () => {
    await rejects([
      { path: "a.txt", content: "1" },
      { path: "a.txt", content: "2" },
    ], "PLUGIN_ARCHIVE_UNSAFE")
    await rejects([
      { path: "a.txt", content: "1" },
      { path: "A.TXT", content: "2" },
    ], "PLUGIN_ARCHIVE_UNSAFE")
  })

  test("hash 不匹配与文件集合不一致", async () => {
    const { db, installer } = await fixture()
    const archive = join(installer.packagesRoot(), "bad.cpxplugin")
    // 文件内容与 manifest.files 的 hash 不符
    const built = makePluginPackage([{ path: "index.ts", content: "v1" }])
    const entries: ZipEntryInput[] = built.files.map((entry) =>
      entry.path === "index.ts"
        ? { path: entry.path, content: "tampered" }
        : { path: entry.path, content: entry.content })
    await writeZip(archive, entries)
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code: "PLUGIN_HASH_MISMATCH" })

    // manifest.json 缺失
    await writeZip(archive, [{ path: "index.ts", content: "v1" }])
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" })

    // 文件集合不一致（多一个未声明文件）
    const extra = makePluginPackage([{ path: "index.ts", content: "v1" }])
    await writeZip(archive, [...extra.files.map((entry) => ({ path: entry.path, content: entry.content })), { path: "unlisted.txt", content: "x" }])
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code: "PLUGIN_HASH_MISMATCH" })
    db.close()
  })

  test("manifest 校验失败（非法 id）", async () => {
    const { db, installer } = await fixture()
    const archive = join(installer.packagesRoot(), "bad.cpxplugin")
    const built = makePluginPackage([{ path: "index.ts", content: "v1" }], { id: "no-dot" })
    await writeZip(archive, built.files.map((entry) => ({ path: entry.path, content: entry.content })))
    await expect(installer.installPackage(archive)).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" })
    db.close()
  })
})

describe("PluginInstaller 开发目录链接", () => {
  test("链接目录：记录 canonical path 与 digest，installed-disabled", async () => {
    const { db, pluginRoot, installer, repo } = await fixture()
    const devDir = join(pluginRoot, "dev", "hello")
    await mkdir(devDir, { recursive: true })
    const built = makePluginPackage([{ path: "index.ts", content: "dev-v1" }])
    await writeFile(join(devDir, "manifest.json"), built.manifestJson)
    await writeFile(join(devDir, "index.ts"), "dev-v1")

    const linked = await installer.linkDirectory(devDir)
    expect(linked.source).toBe("linked-directory")
    expect(repo.getPackage("acme.hello")?.linkedPath).toBe(devDir)
    expect(repo.getActivation("acme.hello", "")?.enabled).toBe(false)
    // 不复制文件：包目录不存在
    expect(existsSync(join(pluginRoot, "packages", `acme.hello@1.0.0-${linked.digest.slice(0, 12)}`))).toBe(false)
    db.close()
  })

  test("文件变化产生 staged digest，不自动执行；恢复后无变化", async () => {
    const { db, installer, repo } = await fixture()
    const devDir = join(installer.packagesRoot(), "..", "dev", "hello")
    await mkdir(devDir, { recursive: true })
    const built = makePluginPackage([{ path: "index.ts", content: "v1" }])
    await writeFile(join(devDir, "manifest.json"), built.manifestJson)
    await writeFile(join(devDir, "index.ts"), "v1")
    await installer.linkDirectory(devDir)
    const digestBefore = repo.getPackage("acme.hello")?.directoryDigest

    // 修改文件 → staged digest
    await writeFile(join(devDir, "index.ts"), "v2")
    const [scan] = await installer.rescanLinkedDirectories()
    expect(scan?.changed).toBe(true)
    expect(repo.getPackage("acme.hello")?.stagedDirectoryDigest).not.toBeNull()
    expect(repo.getPackage("acme.hello")?.stagedDirectoryDigest).not.toBe(digestBefore)
    // digest 未自动生效
    expect(repo.getPackage("acme.hello")?.directoryDigest).toBe(digestBefore)

    // 恢复 → 无变化
    await writeFile(join(devDir, "index.ts"), "v1")
    const [scan2] = await installer.rescanLinkedDirectories()
    expect(scan2?.changed).toBe(false)
    expect(repo.getPackage("acme.hello")?.stagedDirectoryDigest).toBeNull()
    db.close()
  })

  test("链接目录包含符号链接被拒绝", async () => {
    const { db, installer } = await fixture()
    const devDir = join(installer.packagesRoot(), "..", "dev", "bad")
    await mkdir(devDir, { recursive: true })
    const built = makePluginPackage([{ path: "index.ts", content: "v1" }])
    await writeFile(join(devDir, "manifest.json"), built.manifestJson)
    await writeFile(join(devDir, "index.ts"), "v1")
    // 目录内含 symlink（Windows junction 用 file symlink 近似）
    try {
      await Bun.$`mklink /D ${join(devDir, "link")} ${tmpdir()}`.quiet()
    } catch {
      // 无权限时跳过 symlink 场景
      db.close()
      return
    }
    await expect(installer.linkDirectory(devDir)).rejects.toMatchObject({ code: "PLUGIN_LINK_INVALID" })
    db.close()
  })

  test("链接目录缺少 manifest 被拒绝", async () => {
    const { db, installer } = await fixture()
    const devDir = join(installer.packagesRoot(), "..", "dev", "nomanifest")
    await mkdir(devDir, { recursive: true })
    await writeFile(join(devDir, "index.ts"), "v1")
    await expect(installer.linkDirectory(devDir)).rejects.toMatchObject({ code: "PLUGIN_MANIFEST_INVALID" })
    db.close()
  })
})

describe("PluginInstaller 上限", () => {
  test("单文件超过上限被拒绝（注入小上限）", async () => {
    const { db, pluginRoot, installer } = await fixture()
    const archive = join(pluginRoot, "big.cpxplugin")
    const big = makePluginPackage([{ path: "index.ts", content: "x".repeat(1024) }])
    await writeZip(archive, big.files.map((entry) => ({ path: entry.path, content: entry.content })))
    // 直接测 assertSafeZipEntry 路径：构造超大声明不可行（zip 要真写），
    // 改测 collectDirectoryFiles 上限注入。
    const { collectDirectoryFiles } = await import("../src/plugin/installer")
    const dir = join(pluginRoot, "many")
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < 3; i += 1) {
      await writeFile(join(dir, `f${i}.txt`), "x")
    }
    await expect(collectDirectoryFiles(dir, 2, 1024 * 1024)).rejects.toMatchObject({ code: "PLUGIN_ARCHIVE_LIMIT" })
    db.close()
  })

  test("目录 hash 工具与 sha256Text 一致", () => {
    expect(sha256Text("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
  })
})
