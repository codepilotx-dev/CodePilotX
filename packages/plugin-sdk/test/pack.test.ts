import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { packPluginDirectory, PLUGIN_PACK_MAX_FILES, PLUGIN_PACK_MAX_TOTAL_BYTES } from "../src/pack"
import { canonicalDigest } from "../src/wire/codec"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const fixtureDirectory = async (files: Record<string, string>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "cpx-pack-"))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split("/"))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, "utf8")
  }
  return root
}

const sampleManifest = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  schemaVersion: 1,
  id: "acme.hello",
  version: "1.0.0",
  displayName: "Hello",
  description: "pack fixture",
  publisher: "acme",
  engines: { pluginApi: "^1" },
  tier: "application",
  runtime: { kind: "process", protocol: "cpx-plugin-rpc@1", executable: "runner.ts" },
  files: {},
  ...overrides,
})

// ── 极简 ZIP 读取（仅测试用：EOCD → central directory → store entry） ──

const readZipEntries = (buffer: Buffer): Array<{ name: string; data: Buffer }> => {
  let eocdOffset = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054B50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error("ZIP 缺少 EOCD")
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries: Array<{ name: string; data: Buffer }> = []
  let offset = cdOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014B50) throw new Error("central directory 损坏")
    const method = buffer.readUInt16LE(offset + 10)
    const size = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8")
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + (method === 0 ? size : size)) })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const sha256Hex = async (buffer: Buffer) => {
  const hash = await Bun.CryptoHasher.hash("sha256", buffer, "hex")
  return hash
}

describe("packPluginDirectory", () => {
  test("打包合法目录：ZIP 结构与 files 哈希一致，digest 确定", async () => {
    const directory = await fixtureDirectory({
      "manifest.json": sampleManifest(),
      "runner.ts": "console.log('hello')\n",
      "assets/icon.svg": "<svg/>",
    })
    const first = await packPluginDirectory({ directory })
    const archive = await readFile(first.outputPath)
    const entries = readZipEntries(archive)
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "assets/icon.svg",
      "manifest.json",
      "runner.ts",
    ])
    const manifestEntry = entries.find((entry) => entry.name === "manifest.json")!
    const manifest = JSON.parse(manifestEntry.data.toString("utf8"))
    expect(manifest.id).toBe("acme.hello")
    // files 自动补全：与源文件一致且哈希正确（manifest.json 自身占位）。
    expect(manifest.files["runner.ts"]).toBe(await sha256Hex(Buffer.from("console.log('hello')\n")))
    expect(manifest.files["assets/icon.svg"]).toBe(await sha256Hex(Buffer.from("<svg/>")))
    expect(manifest.files["manifest.json"]).toBe("0".repeat(64))
    // 安装侧 digest 公式一致：canonicalDigest({ manifest, files 含全部文件实际哈希 }）。
    const expectedDigest = canonicalDigest({
      manifest,
      files: await Promise.all(entries.map(async (entry) => ({
        path: entry.name,
        sha256: await sha256Hex(entry.data),
      }))),
    })
    expect(first.digest).toBe(expectedDigest)
    // 幂等：同一目录再次打包 digest 不变。
    const second = await packPluginDirectory({ directory })
    expect(second.digest).toBe(first.digest)
    expect(second.fileCount).toBe(3)
  })

  test("缺少 manifest.json 时拒绝", async () => {
    const directory = await fixtureDirectory({ "runner.ts": "x" })
    await expect(packPluginDirectory({ directory })).rejects.toMatchObject({ code: "INVALID_MANIFEST" })
  })

  test("manifest 校验失败时拒绝", async () => {
    const directory = await fixtureDirectory({ "manifest.json": sampleManifest({ id: "BAD" }) })
    await expect(packPluginDirectory({ directory })).rejects.toMatchObject({ code: "INVALID_MANIFEST" })
  })

  test("目录包含符号链接时拒绝", async () => {
    const directory = await fixtureDirectory({ "manifest.json": sampleManifest(), "real.txt": "x" })
    try {
      await symlink(join(directory, "real.txt"), join(directory, "linked.txt"))
    } catch {
      return // Windows 无 symlink 权限时跳过该场景
    }
    await expect(packPluginDirectory({ directory })).rejects.toMatchObject({ code: "INVALID_FILE_PATH" })
  })

  test("超过文件数上限时拒绝", async () => {
    const files: Record<string, string> = { "manifest.json": sampleManifest() }
    for (let index = 0; index < PLUGIN_PACK_MAX_FILES + 1; index += 1) {
      files[`f${index}.txt`] = "x"
    }
    const directory = await fixtureDirectory(files)
    await expect(packPluginDirectory({ directory })).rejects.toMatchObject({ code: "PACK_LIMIT" })
  })

  test("超过总大小上限时拒绝", async () => {
    const directory = await fixtureDirectory({ "manifest.json": sampleManifest() })
    await writeFile(join(directory, "big.bin"), Buffer.alloc(PLUGIN_PACK_MAX_TOTAL_BYTES + 1))
    await expect(packPluginDirectory({ directory })).rejects.toMatchObject({ code: "PACK_LIMIT" })
  })
})
